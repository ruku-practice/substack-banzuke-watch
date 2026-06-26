#!/usr/bin/env python3
"""各発行元（Substackパブリケーション）の購読者数の概数ラベルを集めて
data/subscribers.json に保存する（参考値・増減追跡はしない静的指標）。

取得方法:
  1) https://<host>/about の埋め込みJSONから著者 handle と publication の概数を拾う
  2) https://substack.com/@<handle> から "11K+ subscribers" 形式の概数ラベルを拾う
     （ユーザー要望の表示形式。取れなければ about の "Over N" を "NK+" に変換）

公開していない発行元は subs=null（→フロントは非表示）。バケット表示のため
頻繁には変わらない。CHECK_TTL_DAYS 以内は再取得しない＋1回 CAP 件までに制限。
"""

import json
import os
import re
import sys
import csv
import time
import urllib.request
from datetime import date, datetime, timedelta
from urllib.parse import urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = os.path.normpath(os.path.join(HERE, "..", "data", "banzuke_full.csv"))
OUT_PATH = os.path.normpath(os.path.join(HERE, "..", "data", "subscribers.json"))

UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"}
CAP = int(os.getenv("SUBS_CAP", "60"))         # 1回の実行で取得する最大数
CHECK_TTL_DAYS = int(os.getenv("SUBS_TTL", "14"))
DELAY = float(os.getenv("SUBS_DELAY", "1.0"))


def _get(url, timeout=20):
    try:
        req = urllib.request.Request(url, headers=UA)
        return urllib.request.urlopen(req, timeout=timeout).read().decode("utf-8", "replace")
    except Exception:
        return None


def _compact(n: int) -> str:
    """10000 -> '10K', 2000 -> '2K', 100000 -> '100K', 500 -> '500'."""
    if n >= 1_000_000:
        return f"{n // 1_000_000}M"
    if n >= 1000:
        return f"{n // 1000}K"
    return str(n)


def subs_for_host(host: str):
    """(subs_label or None) を返す。"""
    about = _get(f"https://{host}/about")
    handle = None
    about_label = None
    if about:
        m = re.search(r'handle\\?"\s*:\s*\\?"([a-zA-Z0-9_.\-]+)', about)
        if m:
            handle = m.group(1)
        mo = re.search(r'Over\s+([0-9,]+)\s+subscribers', about)
        if mo:
            about_label = _compact(int(mo.group(1).replace(",", ""))) + "+"
    # プロフィールの "11K+ subscribers" を優先
    if handle:
        prof = _get(f"https://substack.com/@{handle}")
        if prof:
            mp = re.search(r'([0-9][0-9.]*[KkMm]?\+?)\s*subscribers', prof)
            if mp:
                return mp.group(1).upper().replace(" ", "")
    return about_label


def hosts_from_csv():
    seen = []
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            h = (urlparse(row.get("url", "")).netloc or "").lower()
            if h and h not in seen:
                seen.append(h)
    return seen


def main():
    cache = {}
    if os.path.exists(OUT_PATH):
        try:
            with open(OUT_PATH, encoding="utf-8") as f:
                cache = json.load(f)
        except Exception:
            cache = {}
    today = date.today()

    def stale(h):
        c = cache.get(h)
        if not c or "checked" not in c:
            return True
        try:
            return (today - datetime.fromisoformat(c["checked"]).date()) >= timedelta(days=CHECK_TTL_DAYS)
        except Exception:
            return True

    hosts = hosts_from_csv()
    todo = [h for h in hosts if stale(h)]
    print(f"hosts {len(hosts)} / stale {len(todo)} / cap {CAP}")
    done = 0
    for h in todo:
        if done >= CAP:
            break
        subs = subs_for_host(h)
        cache[h] = {"subs": subs, "checked": today.isoformat()}
        print(f"  {h} -> {subs}")
        done += 1
        time.sleep(DELAY)

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=1)
    have = sum(1 for v in cache.values() if v.get("subs"))
    print(f"saved {OUT_PATH}: {len(cache)}件 (購読者ラベルあり {have}) / 今回取得 {done}")


if __name__ == "__main__":
    main()
