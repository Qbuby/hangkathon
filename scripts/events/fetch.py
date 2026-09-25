#!/usr/bin/env python3
"""全球赛事/活动每日抓取（stdlib-only，跑在宿主机的 systemd timer 上）。

  python3 scripts/events/fetch.py                                  # 全部源 → JSON 到 stdout
  python3 scripts/events/fetch.py --source mlh --source topcoder   # 只跑指定源
  python3 scripts/events/fetch.py --source mlh --fixture fixtures/mlh.html   # 离线跑解析
  python3 scripts/events/fetch.py --self-check                     # 对全部 fixture 做离线自检

窗口口径（用户定的）：开始日期落在 [今天-7天, 今天+90天]；
没有开始日期但截止日期在 [今天, +90天] 的也收（Deadline 驱动的目录站），
两者之外的丢弃。解析不出任何日期的条目一律丢弃。

每个源独立容错：一个源挂了不影响其他源，错误记进 sources.{name}.error。
结果由 deploy/events-fetch.sh POST 到应用的 /api/events/ingest 入库。
"""

import argparse
import gzip
import json
import re
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone
from html import unescape
from pathlib import Path

WINDOW_PAST_DAYS = 7
WINDOW_FUTURE_DAYS = 90
DEFAULT_TIMEOUT = 20
FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 HangkathonEvents/1.0")

MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

# "March 15, 2027" / "Mar 15" / "SEP 27"（不带年份时按「过去的月份归明年」推断）
MONTH_DAY_RE = re.compile(
    r"\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|"
    r"aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+"
    r"(\d{1,2})(?:st|nd|rd|th)?(?:\s*,\s*|\s+)(20\d\d)?",
    re.I,
)
# "15 March 2027"
DAY_MONTH_RE = re.compile(r"\b(\d{1,2})\s+(jan\w*|feb\w*|mar\w*|apr\w*|may|jun\w*|jul\w*|aug\w*|sep\w*|oct\w*|nov\w*|dec\w*)\.?(?:\s*,?\s*(20\d\d))?", re.I)
ISO_DATE_RE = re.compile(r"\b(20\d\d)-(\d\d)-(\d\d)\b")


def http_get(url: str, timeout: int = DEFAULT_TIMEOUT) -> str:
    """GET 一个页面/接口，gzip 解压，跟随跳转，失败重试一次。"""
    last_error: Exception | None = None
    for attempt in range(2):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": UA,
                "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "Accept-Encoding": "gzip",
            })
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read()
                if raw[:2] == b"\x1f\x8b":
                    raw = gzip.decompress(raw)
                return raw.decode("utf-8", "replace")
        except Exception as error:  # noqa: BLE001 —— 任何网络错误都只重试一次
            last_error = error
            time.sleep(1.5)
    raise RuntimeError(f"GET {url} 失败：{last_error}")


def strip_tags(html: str) -> str:
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", html))).strip()


def _mk(year: int, month: int, day: int) -> datetime | None:
    try:
        return datetime(year, month, day, tzinfo=timezone.utc)
    except ValueError:
        return None


def _infer_year(now: datetime, month: int) -> int:
    # 没写年份的月份：已经过去的归到明年（页面上写 "Mar 15" 多半指下一个 3 月 15 日）
    year = now.year
    if (month, 1) < (now.month, 1):
        year += 1
    return year


def find_dates(text: str, now: datetime | None = None, default_year: int | None = None) -> list[datetime]:
    """从一段文字里抠出所有能认出的日期，升序去重。认不出的就空。"""
    now = now or datetime.now(timezone.utc)
    found: list[datetime] = []

    def push(value: datetime | None) -> None:
        if value and value.year >= now.year - 1 and value not in found:
            found.append(value)

    for m in ISO_DATE_RE.finditer(text):
        push(_mk(int(m.group(1)), int(m.group(2)), int(m.group(3))))
    for m in MONTH_DAY_RE.finditer(text):
        month = MONTHS[m.group(1)[:3].lower()]
        day = int(m.group(2))
        year = int(m.group(3)) if m.group(3) else (default_year or _infer_year(now, month))
        push(_mk(year, month, day))
    for m in DAY_MONTH_RE.finditer(text):
        month = MONTHS[m.group(2)[:3].lower()]
        year = int(m.group(3)) if m.group(3) else (default_year or _infer_year(now, month))
        push(_mk(year, month, int(m.group(1))))
    return sorted(found)


PRIZE_RE = re.compile(r"\$\s?([\d,]+(?:\.\d+)?)\s*([kKmM]?)")


def find_prize(text: str) -> str | None:
    m = PRIZE_RE.search(text)
    if not m:
        return None
    value = float(m.group(1).replace(",", ""))
    unit = m.group(2).lower()
    value = value * (1_000 if unit == "k" else 1_000_000 if unit == "m" else 1)
    return f"${int(value):,}" if value >= 1 else None


def ev(source: str, source_id: str, title: str, *, url: str, category: str,
       starts: datetime | None = None, ends: datetime | None = None,
       deadline: datetime | None = None, location: str | None = None,
       online: bool | None = None, prize: str | None = None,
       description: str | None = None, tags: list[str] | None = None) -> dict:
    return {
        "source": source,
        "sourceId": str(source_id)[:200],
        "title": strip_tags(title)[:300],
        "url": url,
        "category": category,
        "starts": starts,
        "ends": ends,
        "deadline": deadline,
        "location": (location[:200] if location else None),
        "online": online,
        "prize": prize,
        "description": description[:280] if description else None,
        "tags": [str(t)[:40] for t in (tags or [])][:10],
    }


def in_window(item: dict, now: datetime) -> bool:
    start = item.get("starts")
    if start:
        return (now - timedelta(days=WINDOW_PAST_DAYS)) <= start <= (now + timedelta(days=WINDOW_FUTURE_DAYS))
    end = item.get("ends") or item.get("deadline")
    if end:
        return now <= end <= (now + timedelta(days=WINDOW_FUTURE_DAYS))
    return False


def finalize(item: dict) -> dict:
    iso = lambda d: d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if d else None  # noqa: E731
    return {
        "source": item["source"],
        "sourceId": item["sourceId"],
        "title": item["title"],
        # HTML 属性里抠出来的链接要还原实体（&amp; 等）
        "url": unescape(item["url"]),
        "category": item["category"],
        "location": item.get("location"),
        "online": item.get("online"),
        "startsAt": iso(item.get("starts")),
        "endsAt": iso(item.get("ends")),
        "deadlineAt": iso(item.get("deadline")),
        "prize": item.get("prize"),
        "description": item.get("description"),
        "tags": item.get("tags") or [],
    }


# ---------------------------------------------------------------- 适配器

def parse_topcoder(data: list | dict) -> list[dict]:
    items = data if isinstance(data, list) else data.get("challenges") or []
    out = []
    for d in items:
        if d.get("task"):
            continue
        legacy = d.get("legacy") or {}
        cid = legacy.get("legacyId") or d.get("id")
        total = 0
        for s in d.get("prizeSets") or []:
            if s.get("type") == "placement":
                for p in s.get("prizes") or []:
                    if isinstance(p.get("value"), (int, float)):
                        total += p["value"]
        out.append(ev(
            "topcoder", d.get("id") or cid, d.get("name") or "",
            url=f"https://www.topcoder.com/challenges/{cid}",
            category="competition",
            starts=_parse_iso(d.get("startDate")),
            ends=_parse_iso(d.get("endDate") or d.get("submissionEndDate")),
            online=True, location="Online",
            prize=f"${int(total):,}" if total else None,
            description=strip_tags(d.get("description") or d.get("overview") or ""),
            tags=(d.get("tags") or [])[:10],
        ))
    return out


def source_topcoder() -> list[dict]:
    return parse_topcoder(json.loads(http_get(
        "https://api.topcoder.com/v6/challenges?perPage=100&status=Active")))


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None


MLH_CARD_RE = re.compile(r'href="(https://events\.mlh\.io/events/(\d+)[^"]*)"[^>]*>(.*?)</a>', re.S)
LOCATION_RE = re.compile(r"\b([A-Z][A-Za-z .'-]{2,40},\s*(?:[A-Z]{2}|[A-Z][a-z]{2,}))\b")


def parse_mlh(html: str, year: int | None = None) -> list[dict]:
    year = year or datetime.now(timezone.utc).year
    out = []
    for m in MLH_CARD_RE.finditer(html):
        url, external_id, inner = m.group(1), m.group(2), m.group(3)
        text = strip_tags(inner)
        dates = find_dates(text, default_year=year)
        if not dates:
            continue
        head = text[:MONTH_DAY_RE.search(text).start()].strip(" ·|-–,") if MONTH_DAY_RE.search(text) else text[:80]
        location_m = LOCATION_RE.search(text)
        out.append(ev(
            "mlh", external_id, head or text[:80],
            url=url, category="hackathon",
            starts=dates[0], ends=dates[1] if len(dates) > 1 else None,
            location=location_m.group(1) if location_m else None,
            online=True if "online" in text.lower() else (None if location_m else True),
        ))
    return out


def source_mlh() -> list[dict]:
    year = datetime.now(timezone.utc).year
    items: list[dict] = []
    for season in (year, year + 1):
        try:
            items.extend(parse_mlh(http_get(f"https://www.mlh.com/seasons/{season}/events"), season))
        except Exception:  # noqa: BLE001 —— 明年的赛季页可能还不存在
            pass
    return items


DRIVENDATA_CARD_RE = re.compile(
    r'<h3 class="text-xl lh-sm panel-competition-title">\s*<a href="([^"]+)"[^>]*>(.*?)</a>\s*</h3>(.*?)(?=<h3 class="text-xl lh-sm panel-competition-title"|$)', re.S)


def parse_drivendata(html: str) -> list[dict]:
    out = []
    for m in DRIVENDATA_CARD_RE.finditer(html):
        url, title, block = m.group(1), m.group(2), m.group(3)
        text = strip_tags(block)
        dates = find_dates(block)
        if not dates:
            continue
        out.append(ev(
            "drivendata", url.rstrip("/").rsplit("/", 1)[-1], title,
            url=url, category="competition",
            starts=dates[0] if len(dates) > 1 else None, ends=dates[-1],
            prize=find_prize(text),
            description=text[:280],
        ))
    return out


def source_drivendata() -> list[dict]:
    return parse_drivendata(http_get("https://www.drivendata.org/competitions/"))


CW_DENY = ("expire-", "/category/", "/tag/", "/page/", "/feed", "/author/", "/about", "/contact",
           "/advertise", "/submit", "/calendar", "/privacy", "/terms", "/disclaimer")


def parse_contestwatchers(html: str) -> list[dict]:
    out = []
    seen: set[str] = set()
    for m in re.finditer(r'<a\b[^>]*href="(https://www\.contestwatchers\.com/[^"]+)"[^>]*>(.*?)</a>', html, re.S):
        url, title = m.group(1), strip_tags(m.group(2))
        if len(title) < 15 or any(part in url for part in CW_DENY):
            continue
        if url.rstrip("/") in seen:
            continue
        dates = find_dates(strip_tags(html[m.end():m.end() + 420]))
        if not dates:
            continue
        seen.add(url.rstrip("/"))
        out.append(ev(
            "contestwatchers", url.rstrip("/").rsplit("/", 1)[-1], title,
            url=url, category="award",
            starts=dates[0], ends=dates[1] if len(dates) > 1 else None,
            prize=find_prize(strip_tags(html[m.end():m.end() + 420])),
        ))
    return out


def source_contestwatchers() -> list[dict]:
    return parse_contestwatchers(http_get("https://www.contestwatchers.com/category/submit-before-deadline/"))


def parse_reedsy(html: str) -> list[dict]:
    out = []
    seen: set[str] = set()
    for m in re.finditer(r'href="(/resources/writing-contests/([a-z0-9-]+))"[^>]*>(.*?)</a>', html, re.S):
        path, slug, inner = m.group(1), m.group(2), m.group(3)
        if slug in ("page", "how-it-works", "about"):
            continue
        title = strip_tags(inner)
        if len(title) < 8:
            continue
        url = f"https://reedsy.com{path}"
        if url in seen:
            continue
        window_text = strip_tags(html[m.end():m.end() + 520])
        dates = find_dates(window_text)
        if not dates:
            continue
        seen.add(url)
        out.append(ev(
            "reedsy", slug, title,
            url=url, category="award",
            starts=dates[0], ends=dates[1] if len(dates) > 1 else None,
            prize=find_prize(window_text),
        ))
    return out


def source_reedsy() -> list[dict]:
    items: list[dict] = []
    for page in ("", "page/2/"):
        try:
            items.extend(parse_reedsy(http_get(f"https://reedsy.com/resources/writing-contests/{page}")))
        except Exception:  # noqa: BLE001 —— 第二页拿不到就用第一页
            pass
    return items


def parse_xprize(html: str) -> list[dict]:
    out = []
    seen: set[str] = set()
    for m in re.finditer(r'<a\b[^>]*href="(/competitions/([a-z0-9-]+))"[^>]*>(.*?)</a>', html, re.S):
        path, slug, inner = m.group(1), m.group(2), m.group(3)
        title = strip_tags(inner)
        if slug in ("status",) or len(title) < 6:
            continue
        url = f"https://www.xprize.org{path}"
        if url in seen:
            continue
        dates = find_dates(strip_tags(html[m.end():m.end() + 600]))
        if not dates:
            continue
        seen.add(url)
        out.append(ev("xprize", slug, title, url=url, category="award", starts=dates[0],
                      ends=dates[1] if len(dates) > 1 else None))
    return out


def source_xprize() -> list[dict]:
    return parse_xprize(http_get("https://www.xprize.org/competitions"))


SC_DENY = ("/category/", "/user/", "/about", "/faq", "/terms", "/privacy")


def parse_studentcompetitions(html: str) -> list[dict]:
    out = []
    seen: set[str] = set()
    for m in re.finditer(r'href="(https://studentcompetitions\.com/competitions/[^"]+)"[^>]*>(.*?)</a>', html, re.S):
        url, title = m.group(1), strip_tags(m.group(2))
        if len(title) < 8 or any(part in url for part in SC_DENY) or url.rstrip("/") in seen:
            continue
        window_text = strip_tags(html[m.end():m.end() + 420])
        dates = find_dates(window_text)
        if not dates:
            continue
        seen.add(url.rstrip("/"))
        out.append(ev(
            "studentcompetitions", url.rstrip("/").rsplit("/", 1)[-1], title,
            url=url, category="competition",
            starts=dates[0], ends=dates[1] if len(dates) > 1 else None,
            prize=find_prize(window_text),
        ))
    return out


def source_studentcompetitions() -> list[dict]:
    return parse_studentcompetitions(http_get("https://studentcompetitions.com/competitions"))


# ---------------------------------------------------------------- 入口

ADAPTERS = {
    "topcoder": (source_topcoder, parse_topcoder, ".json"),
    "mlh": (source_mlh, parse_mlh, ".html"),
    "drivendata": (source_drivendata, parse_drivendata, ".html"),
    "contestwatchers": (source_contestwatchers, parse_contestwatchers, ".html"),
    "reedsy": (source_reedsy, parse_reedsy, ".html"),
    "xprize": (source_xprize, parse_xprize, ".html"),
    "studentcompetitions": (source_studentcompetitions, parse_studentcompetitions, ".html"),
}


def load_fixture(source: str) -> object:
    suffix = ADAPTERS[source][2]
    path = FIXTURE_DIR / f"{source}{suffix}"
    text = path.read_text(encoding="utf-8")
    return json.loads(text) if suffix == ".json" else text


def run(names: list[str], fixture: str | None = None, apply_window: bool = True) -> dict:
    now = datetime.now(timezone.utc)
    result = {
        "fetchedAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "window": {"pastDays": WINDOW_PAST_DAYS, "futureDays": WINDOW_FUTURE_DAYS},
        "sources": {},
        "events": [],
    }
    for name in names:
        fetch, parse, _ = ADAPTERS[name]
        try:
            items = parse(load_fixture(name)) if fixture else fetch()
            kept = [item for item in items if (in_window(item, now) if apply_window else item.get("starts") or item.get("ends") or item.get("deadline"))]
            result["sources"][name] = {"total": len(items), "kept": len(kept), "dropped": len(items) - len(kept)}
            result["events"].extend(kept)
        except Exception as error:  # noqa: BLE001 —— 单源失败不拖垮整轮
            result["sources"][name] = {"total": 0, "kept": 0, "error": f"{type(error).__name__}: {error}"[:200]}
    # 跨源去重（同一 sourceId 以先出现的为准），再按开始日期排序
    unique: dict[tuple[str, str], dict] = {}
    for item in result["events"]:
        unique.setdefault((item["source"], item["sourceId"]), item)
    events = [finalize(item) for item in unique.values()]
    events.sort(key=lambda e: e["startsAt"] or e["endsAt"] or e["deadlineAt"] or "9999")
    result["events"] = events
    return result


def self_check() -> int:
    failures = 0
    for name, (_, _, suffix) in ADAPTERS.items():
        path = FIXTURE_DIR / f"{name}{suffix}"
        if not path.exists():
            print(f"[self-check] {name}: 缺 fixture，跳过", file=sys.stderr)
            continue
        _, parse, _ = ADAPTERS[name]
        parsed = parse(load_fixture(name))
        good = [i for i in parsed if i.get("title") and i.get("url") and (i.get("starts") or i.get("ends") or i.get("deadline"))]
        if not good:
            print(f"[self-check] {name}: fixture 解析出 0 条有效条目", file=sys.stderr)
            failures += 1
        else:
            print(f"[self-check] {name}: {len(good)}/{len(parsed)} 条有效", file=sys.stderr)
    return 1 if failures else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", action="append", choices=sorted(ADAPTERS), help="只跑指定源（可重复）")
    parser.add_argument("--fixture", action="store_true", help="离线模式：从 fixtures/ 读样本")
    parser.add_argument("--no-window", action="store_true", help="不做窗口过滤（离线样本日期固定，会过期）")
    parser.add_argument("--self-check", action="store_true", help="对全部 fixture 做离线自检")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT)
    args = parser.parse_args()

    if args.self_check:
        return self_check()
    names = args.source or sorted(ADAPTERS)
    result = run(names, fixture=args.fixture, apply_window=not args.no_window)
    json.dump(result, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    failed = [n for n, s in result["sources"].items() if s.get("error")]
    if failed:
        print(f"[fetch] {len(failed)} 个源失败：{', '.join(failed)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
