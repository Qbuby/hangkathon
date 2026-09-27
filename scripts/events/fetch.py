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

from __future__ import annotations

import argparse
import gzip
import json
import re
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin

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
       description: str | None = None, tags: list[str] | None = None,
       image: str | None = None) -> dict:
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
        "image": (image[:1000] if image else None),
    }


def in_window(item: dict, now: datetime) -> bool:
    """近期口径：开始日期落在 [-7d, +90d]；或已在进行、结束/截止日期在 [now, +90d]。"""
    hi = now + timedelta(days=WINDOW_FUTURE_DAYS)
    start = item.get("starts")
    if start and (now - timedelta(days=WINDOW_PAST_DAYS)) <= start <= hi:
        return True
    return any(end and now <= end <= hi for end in (item.get("ends"), item.get("deadline")))


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
        "imageUrl": (unescape(item["image"]) if item.get("image") else None),
        "tags": item.get("tags") or [],
    }


# ---------------------------------------------------------------- 适配器

def parse_topcoder(data: list | dict) -> list[dict]:
    items = data if isinstance(data, list) else data.get("challenges") or []
    out = []
    for d in items:
        # task 字段早期是布尔、现在是 {isTask: bool, ...} 对象 —— 两种都兼容
        task = d.get("task")
        if isinstance(task, dict):
            task = task.get("isTask")
        if task:
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


def _meta(block: str, prop: str) -> str | None:
    m = re.search(rf'itemProp="{prop}" content="([^"]+)"', block, re.I)
    return m.group(1) if m else None


def parse_mlh(html: str, year: int | None = None) -> list[dict]:
    """MLH 赛季页的卡片带 schema.org Event 微数据，日期/线上线下/地点直接从微数据拿。"""
    from urllib.parse import unquote_plus
    out = []
    for m in MLH_CARD_RE.finditer(html):
        url, external_id, inner = m.group(1), m.group(2), m.group(3)
        starts = _parse_iso(_meta(inner, "startDate"))
        if not starts:
            continue
        ends = _parse_iso(_meta(inner, "endDate"))
        attendance = _meta(inner, "eventAttendanceMode") or ""
        online = True if "OnlineEventAttendanceMode" in attendance else (False if "OfflineEventAttendanceMode" in attendance else None)
        name = _meta(inner, "name")
        if not name:
            utm = re.search(r"utm_content=([^\"&]+)", url)
            if utm:
                name = unquote_plus(utm.group(1))
        if not name:
            h = re.search(r"<h\d[^>]*>(.*?)</h\d>", inner, re.S)
            name = strip_tags(h.group(1)) if h else f"MLH event {external_id}"
        location_m = re.search(r'itemProp="location"[^>]*>(.*?)</div>', inner, re.S)
        location = strip_tags(location_m.group(1))[:120] if location_m else None
        out.append(ev(
            "mlh", external_id, name,
            url=unescape(url.split("?")[0]), category="hackathon",
            starts=starts, ends=ends,
            location=location, online=online,
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
        # 卡片链接有两种写法：合作方站的绝对地址、自家站的相对地址（/competitions/306/...）
        url = urljoin("https://www.drivendata.org/", m.group(1))
        title, block = m.group(2), m.group(3)
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


CW_DENY = ("expire", "latest", "category", "page", "feed", "author", "about", "contact",
           "advertise", "submit", "calendar", "privacy", "terms", "disclaimer")


def parse_contestwatchers(html: str) -> list[dict]:
    """/latest-contests/ 的条目：<a href=permalink>标题(+缩略图/介绍)</a>，
    截止日期在卡片相邻文本里，抓不到日期的跳过。首页的 cw_fresh 卡片也是这个锚点结构。"""
    out = []
    seen: set[str] = set()
    for m in re.finditer(r'<a\b[^>]*href="(https://www\.contestwatchers\.com/([a-z0-9-]{12,})/)"[^>]*>(.*?)</a>', html, re.S):
        url, slug, inner = m.group(1), m.group(2), m.group(3)
        if any(part in slug for part in CW_DENY):
            continue
        h2 = re.search(r"<h2[^>]*>(.*?)</h2>", inner, re.S)
        title = strip_tags(h2.group(1)) if h2 else strip_tags(re.sub(r"<img[^>]*>", " ", inner))
        if len(title) < 15 or url.rstrip("/") in seen:
            continue
        window_text = strip_tags(html[m.end():m.end() + 1200])
        dates = find_dates(window_text)
        if not dates:
            continue
        seen.add(url.rstrip("/"))
        out.append(ev(
            "contestwatchers", slug, title,
            url=url, category="award",
            starts=dates[0], ends=dates[1] if len(dates) > 1 else None,
            prize=find_prize(window_text),
        ))
    return out


def source_contestwatchers() -> list[dict]:
    items = parse_contestwatchers(http_get("https://www.contestwatchers.com/latest-contests/"))
    try:
        items += parse_contestwatchers(http_get("https://www.contestwatchers.com/"))
    except Exception:  # noqa: BLE001 —— 首页拿不到就用列表页
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



# ------------------------------------------------- 详情页 enrichment


class PageTextExtractor(HTMLParser):
    """收集详情页的正文段落与 og:image。跳过导航/脚本等噪音，段落 <50 字的丢弃。"""

    SKIP = {"script", "style", "nav", "header", "footer", "aside", "noscript", "form", "button", "select", "svg", "iframe"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.skip_depth = 0
        self.capture = 0
        self.buf: list[str] = []
        self.texts: list[str] = []
        self.og_image: str | None = None

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)
        if tag in self.SKIP:
            self.skip_depth += 1
            return
        if tag == "meta":
            key = (attrs_dict.get("property") or attrs_dict.get("name") or "").lower()
            if key in ("og:image", "twitter:image") and attrs_dict.get("content"):
                self.og_image = self.og_image or attrs_dict["content"].strip()
        if tag in ("p", "li"):
            self.capture += 1
            self.buf.append("")

    def handle_endtag(self, tag):
        if tag in self.SKIP:
            self.skip_depth = max(0, self.skip_depth - 1)
            return
        if tag in ("p", "li") and self.capture:
            self.capture -= 1
            text = re.sub(r"\s+", " ", "".join(self.buf.pop())).strip()
            if len(text) >= 50:
                self.texts.append(text)

    def handle_data(self, d):
        if self.skip_depth == 0 and self.capture and self.buf:
            self.buf[-1] += d


# 各来源详情页通用的平台样板文案（出现即整段丢弃）
BOILERPLATE_MARKERS = (
    "微信扫码报名", "轻松获取电子票", "购票已达上限", "我要报名 我要报名",
    "互动吧平台特此说明", "避免相关的经济损失", "如出现相关纠纷", "付费推广",
    "谨防诈骗", "佐敦网络科技", "国内外受欢迎的活动平台", "活动过程中的相关纠纷",
)


def extract_detail(html: str, base_url: str) -> tuple[str | None, str | None]:
    """返回 (海报图 URL, 正文文本)。正文少于 160 字视为提取失败（None）。"""
    parser = PageTextExtractor()
    try:
        parser.feed(html)
        parser.close()
    except Exception:
        pass
    seen: set[str] = set()
    paras: list[str] = []
    for text in parser.texts:
        if "cookie" in text.lower() or "javascript" in text.lower():
            continue
        if "{{" in text or "}}" in text:  # Vue/模板占位符页面的噪音
            continue
        if any(marker in text for marker in BOILERPLATE_MARKERS):
            continue  # 平台样板文案（防诈骗声明、平台介绍、按钮组）
        key = text[:80]
        if key in seen:
            continue
        seen.add(key)
        paras.append(text)
    body = ""
    for para in paras:
        if len(body) + len(para) + 2 > 4000:
            break
        body = f"{body}{chr(10) * 2}{para}" if body else para
    image = parser.og_image
    if image and image.startswith("/"):
        image = urljoin(base_url, image)
    return (image or None), (body if len(body) >= 160 else None)


def enrich_from(need_path: str) -> int:
    """读 ingest 响应里的 needDetail 清单，逐个抓来源详情页，输出 details JSON。"""
    payload = json.loads(Path(need_path).read_text(encoding="utf-8"))
    details = []
    for item in payload.get("needDetail", [])[:30]:
        url = item.get("url")
        source = item.get("source", "")
        source_id = item.get("sourceId", "")
        if not url or not source or not source_id:
            continue
        try:
            page = http_get(url, timeout=15)
            image, text = extract_detail(page, url)
            details.append({"source": source, "sourceId": source_id, "imageUrl": image, "detailText": text})
            print(f"[enrich] {source_id[:40]}: {'正文 ' + str(len(text)) + ' 字' if text else '未提取到正文'}", file=sys.stderr)
        except Exception as error:  # noqa: BLE001 —— 单页失败不影响其余
            print(f"[enrich] {source_id[:40]}: {type(error).__name__}: {error}"[:160], file=sys.stderr)
        time.sleep(0.8)
    json.dump({"details": details}, sys.stdout, ensure_ascii=False)
    sys.stdout.write(chr(10))
    return 0



# ------------------------------------------------- 国内平台（互动吧，江浙沪线下活动）

HUDONGBA_CITIES = [("杭州", "hangzhou"), ("上海", "shanghai"), ("南京", "nanjing"), ("苏州", "suzhou")]
HUDONGBA_CATEGORIES = (101, 125)  # 101=互联网 125=企业服务
CJK_DATE = re.compile(r"(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日(?:\s*(\d{1,2}):(\d{2}))?")


def parse_cjk_date(text: str, now: datetime) -> datetime | None:
    """解析「10月17日 09:00 开始」「2026年10月17日」这类中文日期。"""
    match = CJK_DATE.search(text)
    if not match:
        return None
    year = int(match.group(1)) if match.group(1) else now.year
    try:
        value = datetime(year, int(match.group(2)), int(match.group(3)),
                         int(match.group(4) or 9), int(match.group(5) or 0), tzinfo=timezone.utc)
    except ValueError:
        return None
    if value < now - timedelta(days=WINDOW_PAST_DAYS + 1) and year == now.year:
        try:
            value = value.replace(year=year + 1)
        except ValueError:
            return None
    return value


def parse_hudongba(html: str, city: str = "杭州", now: datetime | None = None) -> list[dict]:
    now = now or datetime.now(timezone.utc)
    items: list[dict] = []
    positions = [m.start() for m in re.finditer("find_main_div", html)]
    for idx, start in enumerate(positions):
        chunk = html[start:start + 1200]
        pre = html[max(0, start - 900):start]  # 海报锚点在 find_main_div 之前
        url_m = re.search(r'find_main_title">\s*<a href="([^"]+)"', chunk)
        title_m = re.search(r'find_main_title">\s*<a[^>]*>\s*([^<]+?)\s*</a>', chunk)
        time_m = re.search(r'find_main_time">\s*([^<]+?)\s*</div>', chunk)
        addr_m = re.search(r'find_main_address">\s*([^<]+?)\s*</div>', chunk)
        pic_m = re.search(r'hd_pic[^>]*src="([^"]+)"', pre)
        if not url_m or not title_m:
            continue
        starts = parse_cjk_date(time_m.group(1) if time_m else "", now)
        if not starts:
            continue
        id_m = re.search(r"party/([a-z0-9]+)\.html", url_m.group(1))
        if not id_m:
            continue
        addr = strip_tags(addr_m.group(1)) if addr_m else ""
        items.append(ev("hudongba", id_m.group(1), title_m.group(1),
                        url=url_m.group(1).strip().split("?")[0], category="activity",
                        starts=starts, location=f"{city} · {addr}" if addr else city,
                        online=False, image=pic_m.group(1) if pic_m else None))
    return items


def source_hudongba() -> list[dict]:
    now = datetime.now(timezone.utc)
    items: list[dict] = []
    seen: set[str] = set()
    for city, slug in HUDONGBA_CITIES:
        for cid in HUDONGBA_CATEGORIES:
            try:
                html = http_get(f"https://www.hudongba.com/{slug}/{cid}-0-2-0-0-1/", timeout=15)
            except Exception:  # noqa: BLE001 —— 单页失败不影响其余城市
                continue
            for item in parse_hudongba(html, city, now):
                if item["sourceId"] in seen:
                    continue
                seen.add(item["sourceId"])
                items.append(item)
            time.sleep(0.5)
    items.sort(key=lambda item: item["starts"] or datetime.max.replace(tzinfo=timezone.utc))
    return items[:60]


# ---------------------------------------------------------------- 入口

ADAPTERS = {
    "hudongba": (source_hudongba, parse_hudongba, ".html"),
    "topcoder": (source_topcoder, parse_topcoder, ".json"),
    "mlh": (source_mlh, parse_mlh, ".html"),
    "drivendata": (source_drivendata, parse_drivendata, ".html"),
    "contestwatchers": (source_contestwatchers, parse_contestwatchers, ".html"),
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
    parser.add_argument("--enrich-from", metavar="FILE", help="读 ingest 响应里的 needDetail 清单，抓来源详情页并输出 details JSON")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT)
    args = parser.parse_args()

    if args.self_check:
        return self_check()
    if args.enrich_from:
        return enrich_from(args.enrich_from)
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
