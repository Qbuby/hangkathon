#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""抖音作品数据抓取：分享链接 → 文案 + 点赞 / 评论 / 转发 / 收藏。

签名不是本仓库写的，而是 Evil0ctal/Douyin_TikTok_Download_API v5.1.1 的
native 签名层（逐字 vendor 在 vendor/，出处与许可见 vendor/README.md）。
所以本脚本：不需要浏览器、不需要 Postgres/Redis、不需要任何第三方包，
只要有 Python 3.10+ 和一条能出网的线路。

用法:
  python3 fetch.py <分享链接|作品id>     # 结果以 JSON 打到 stdout
  python3 fetch.py --self-check          # 离线自检，不联网

选项:
  --raw       结果里附带平台原始 payload（排查用）
  --timeout N 单次请求超时秒数（默认 20）
  --retry N   失败后换新身份重试次数（默认 1）

退出码: 0 成功 / 1 抓取或解析失败 / 2 用法错误
"""

import argparse
import json
import os
import re
import secrets
import sys
import time
from datetime import datetime, timezone
from urllib import error, request

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "vendor"))
from dtk.signing.native import websign  # noqa: E402  vendored
from dtk.signing.native.abogus import ABogus  # noqa: E402  vendored

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
DETAIL_API = "https://www.douyin.com/aweme/v1/web/aweme/detail/?"
TTWID_API = "https://ttwid.bytedance.com/ttwid/union/register/"

# 与浏览器 www.douyin.com 的 web 端一致的参数集；少一个都可能被判成爬虫。
BASE_PARAMS = [
    ("device_platform", "webapp"), ("aid", "6383"), ("channel", "channel_pc_web"),
    ("pc_client_type", "1"), ("pc_libra_divert", "Windows"), ("update_version_code", "170400"),
    ("support_h265", "1"), ("support_dash", "0"), ("version_code", "290100"),
    ("version_name", "29.1.0"), ("cookie_enabled", "true"), ("screen_width", "1920"),
    ("screen_height", "1080"), ("browser_language", "zh-CN"), ("browser_platform", "Win32"),
    ("browser_name", "Chrome"), ("browser_version", "131.0.0.0"), ("browser_online", "true"),
    ("engine_name", "Blink"), ("engine_version", "131.0.0.0"), ("os_name", "Windows"),
    ("os_version", "10"), ("cpu_core_num", "12"), ("device_memory", "8"),
    ("platform", "PC"), ("downlink", "10"), ("effective_type", "4g"), ("round_trip_time", "50"),
]


def note(*parts):
    """诊断信息走 stderr，stdout 只留给 JSON 结果。"""
    sys.stderr.write(" ".join(str(p) for p in parts) + "\n")
    sys.stderr.flush()


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def http(url, headers=None, data=None, timeout=20, follow=True):
    req = request.Request(url, data=data)
    for key, value in (headers or {}).items():
        req.add_header(key, value)
    opener = request.build_opener() if follow else request.build_opener(NoRedirect)
    try:
        with opener.open(req, timeout=timeout) as resp:
            return resp.status, dict(resp.headers), resp.read()
    except error.HTTPError as exc:
        return exc.code, dict(exc.headers), exc.read()
    except Exception as exc:  # noqa: BLE001  网络层什么都可能抛，一律当失败
        return 0, {}, str(exc).encode()


def mint_ttwid(timeout):
    """匿名换一个 ttwid；拿不到也能继续，只是少一层像浏览器的证据。"""
    body = json.dumps({
        "region": "cn", "aid": 1768, "needFid": False, "service": "www.ixigua.com",
        "migrate_info": {"ticket": "", "source": "node"},
        "cbUrlProtocol": "https", "union": True,
    }).encode()
    status, headers, _ = http(
        TTWID_API, data=body, timeout=timeout,
        headers={"Content-Type": "application/json", "User-Agent": UA},
    )
    raw = headers.get("Set-Cookie") or headers.get("set-cookie") or ""
    found = re.search(r"ttwid=([^;]+)", raw)
    if status == 200 and found:
        return found.group(1)
    note("  ttwid 没拿到（http=%s），继续匿名请求" % status)
    return None


def resolve_aweme_id(raw, timeout):
    """分享短链 / 长链 / 纯 id → 作品 id。"""
    text = raw.strip()
    if re.fullmatch(r"\d{15,}", text):
        return text, "直接给的 id"
    if "v.douyin.com" in text or "iesdouyin.com" in text:
        status, headers, _ = http(text, headers={"User-Agent": UA}, timeout=timeout, follow=False)
        location = headers.get("Location") or headers.get("location") or ""
        found = re.search(r"/(?:video|share/video)/(\d{15,})", location)
        if found:
            return found.group(1), "短链跳转"
        note("  短链没跳到作品页：http=%s location=%s" % (status, location[:90]))
    found = re.search(r"/video/(\d{15,})", text)
    if found:
        return found.group(1), "长链正则"
    return None, "解析失败"


def fetch_detail(aweme_id, timeout):
    """一条作品一次请求：a_bogus 覆盖业务参数，Argus 签名再覆盖 a_bogus。"""
    uifid = secrets.token_hex(50)
    ttwid = mint_ttwid(timeout)
    cookie = "s_v_web_id=verify_%s" % secrets.token_hex(16)
    if ttwid:
        cookie = "ttwid=%s; %s" % (ttwid, cookie)

    pairs = list(BASE_PARAMS) + [("aweme_id", aweme_id)]
    raw_query = "&".join("%s=%s" % (key, value) for key, value in pairs)
    a_bogus = ABogus(user_agent=UA).get_value(raw_query)
    query, signature, signature_headers = websign.sign(pairs + [("a_bogus", a_bogus)], uifid)

    headers = {
        "User-Agent": UA,
        "Referer": "https://www.douyin.com/",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Cookie": cookie,
    }
    headers.update(signature_headers)
    status, _, body = http(DETAIL_API + query, headers=headers, timeout=timeout)
    text = body.decode("utf-8", "replace")
    note("  http=%s 长度=%d signature=%s…" % (status, len(text), signature[:12]))

    if status != 200:
        found = re.search(r'"status_msg"\s*:\s*"([^"]*)"', text)
        return None, "上游返回 %s：%s" % (status, found.group(1) if found else text[:80])
    try:
        payload = json.loads(text)
    except ValueError:
        return None, "上游返回的不是 JSON：%s" % text[:80]
    detail = (payload or {}).get("aweme_detail")
    if not detail:
        return None, "上游没有 aweme_detail（作品可能已删除或仅粉丝可见）"
    return detail, ""


def shape(detail, aweme_id):
    stats = detail.get("statistics") or {}
    created = detail.get("create_time")
    published = (
        datetime.fromtimestamp(int(created), timezone.utc).isoformat().replace("+00:00", "Z")
        if created else None
    )
    return {
        "ok": True,
        "awemeId": str(detail.get("aweme_id") or aweme_id),
        "url": "https://www.douyin.com/video/%s" % (detail.get("aweme_id") or aweme_id),
        "caption": detail.get("desc") or "",
        "authorName": (detail.get("author") or {}).get("nickname") or "",
        "diggCount": stats.get("digg_count"),
        "commentCount": stats.get("comment_count"),
        "shareCount": stats.get("share_count"),
        "collectCount": stats.get("collect_count"),
        "publishedAt": published,
        "fetchedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


def self_check():
    """离线自检：不联网，验证 vendor 的签名确实按它文档写的那样工作。

    a_bogus 用上游自带的 decode() 反解，逐个字段对上才算过；这是唯一能
    在离线状态下证明"签名算对了"而不是"恰好没被拒"的办法。
    """
    import random

    from dtk.signing.native.abogus import decode

    query = "device_platform=webapp&aid=6383&aweme_id=7301234567890123456"
    signature = ABogus(user_agent=UA, rng=random.Random(0)).get_value(
        query, now_ms=1758600000000
    )
    recovered = decode(signature)
    checks = [
        ("a_bogus 长度", len(signature), 188),
        ("反解 aid", recovered["aid"], 6383),
        ("反解 page_id", recovered["page_id"], 6241),
        ("反解 sdk_version", tuple(recovered["sdk_version"]), (1, 0, 1, 0)),
        ("反解 now_ms", recovered["now_ms"], 1758600000000),
    ]
    pairs = [("device_platform", "webapp"), ("aid", "6383"), ("aweme_id", "7301234567890123456")]
    _, web_signature, headers = websign.sign(pairs, "0" * 100, timestamp=1758600000)
    checks.append(("x-secsdk-web-signature", web_signature, "091ebf7d860d42038e74dd238e7cbcd0"))
    checks.append(("uifid 请求头", headers.get("uifid"), "0" * 100))

    failed = [name for name, got, want in checks if got != want]
    for name, got, want in checks:
        note("  %s %s = %s" % ("ok " if got == want else "!! ", name, got))
    if failed:
        note("自检失败: %s" % ", ".join(failed))
        return 1
    note("自检通过（离线，未联网）")
    return 0


def main():
    parser = argparse.ArgumentParser(description="抓取抖音作品数据（文案 + 互动数）")
    parser.add_argument("target", nargs="?", help="抖音分享链接或作品 id")
    parser.add_argument("--self-check", action="store_true", help="离线自检后退出")
    parser.add_argument("--raw", action="store_true", help="结果里附带平台原始 payload")
    parser.add_argument("--timeout", type=float, default=20.0)
    parser.add_argument("--retry", type=int, default=1, help="失败后换新身份重试次数")
    args = parser.parse_args()

    if args.self_check:
        return self_check()
    if not args.target:
        parser.error("要一个分享链接或作品 id（或 --self-check）")

    aweme_id, how = resolve_aweme_id(args.target, args.timeout)
    if not aweme_id:
        json.dump({"ok": False, "error": "无法从输入里解析出作品 id"}, sys.stdout, ensure_ascii=False)
        sys.stdout.write("\n")
        return 1
    note("  作品 id=%s（%s）" % (aweme_id, how))

    last = ""
    for attempt in range(max(0, args.retry) + 1):
        if attempt:
            note("  第 %d 次重试（换新 uifid）" % attempt)
            time.sleep(1)
        detail, failure = fetch_detail(aweme_id, args.timeout)
        if detail:
            result = shape(detail, aweme_id)
            if args.raw:
                result["raw"] = detail
            json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
            sys.stdout.write("\n")
            return 0
        last = failure
        note("  失败：%s" % failure)

    json.dump({"ok": False, "awemeId": aweme_id, "error": last}, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    return 1


if __name__ == "__main__":
    sys.exit(main())
