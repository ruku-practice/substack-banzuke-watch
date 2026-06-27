#!/usr/bin/env python3
"""各発行元の購読者数の概数を集めて保存する。
- data/subscribers.json         … 現在値 {host: {subs, num, handle, checked}}
- data/subscribers_history.json … 日別の数値時系列 {host: {YYYY-MM-DD: num}}（詳細グラフ用）

取得: <host>/about から著者 handle を解決（取得後キャッシュ）→ substack.com/@handle の
"11K+ subscribers" または "969 登録者" 等の概数を抽出。
バケット表記は数値化（11K+→11000, 226→226）。公開していない発行元は subs=null。
1日1回だけ点を記録（同日再実行はスキップ）。
"""

import json
import os
import re
import csv
import time
import urllib.request
from datetime import date
from urllib.parse import urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = os.path.normpath(os.path.join(HERE, "..", "data", "banzuke_full.csv"))
OUT_PATH = os.path.normpath(os.path.join(HERE, "..", "data", "subscribers.json"))
HIST_PATH = os.path.normpath(os.path.join(HERE, "..", "data", "subscribers_history.json"))

UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"}
CAP = int(os.getenv("SUBS_CAP", "250"))
DELAY = float(os.getenv("SUBS_DELAY", "0.8"))


def _get(url, timeout=20):
    try:
        return urllib.request.urlopen(urllib.request.Request(url, headers=UA),
                                      timeout=timeout).read().decode("utf-8", "replace")
    except Exception:
        return None


def label_to_num(label: str):
    """'11K+'->11000, '1.1K+'->1100, '226'->226, '13M+'->13000000."""
    if not label:
        return None
    s = label.strip().replace("+", "").replace(",", "")
    mul = 1
    if s and s[-1] in "Kk":
        mul, s = 1000, s[:-1]
    elif s and s[-1] in "Mm":
        mul, s = 1_000_000, s[:-1]
    try:
        return int(float(s) * mul)
    except Exception:
        return None


def resolve_handle(host):
    about = _get(f"https://{host}/about")
    if not about:
        return None
    # Multiple patterns for robustness (page may have different JSON escaping)
    patterns = [
        r'handle\\?"\s*:\s*\\?"([a-zA-Z0-9_.\-]+)',
        r'"handle":\s*"([a-zA-Z0-9_.\-]+)"',
        r'handle:\s*"([a-zA-Z0-9_.\-]+)"',
    ]
    for pat in patterns:
        m = re.search(pat, about)
        if m:
            return m.group(1)
    return None


def fetch_label(handle):
    prof = _get(f"https://substack.com/@{handle}")
    if not prof:
        return None
    # Support both English and Japanese (Substack sometimes shows "登録者")
    m = re.search(r'([0-9][0-9.,]*[KkMm]?\+?)\s*(subscribers?|登録者)', prof, re.IGNORECASE)
    return m.group(1).upper().replace(" ", "") if m else None


def hosts_from_csv():
    seen = []
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            h = (urlparse(row.get("url", "")).netloc or "").lower()
            if h and h not in seen:
                seen.append(h)
    return seen


def load(path, default):
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return default


def main():
    cur = load(OUT_PATH, {})
    hist = load(HIST_PATH, {})
    today = date.today().isoformat()

    hosts = hosts_from_csv()
    # 本日まだ記録していないホストのみ対象（1日1点）
    todo = [h for h in hosts if today not in hist.get(h, {})]
    print(f"hosts {len(hosts)} / 本日未取得 {len(todo)} / cap {CAP}")
    done = 0
    for h in todo:
        if done >= CAP:
            break
        handle = (cur.get(h) or {}).get("handle") or resolve_handle(h)
        label = fetch_label(handle) if handle else None
        num = label_to_num(label)
        cur[h] = {"subs": label, "num": num, "handle": handle, "checked": today}
        if num is not None:
            hist.setdefault(h, {})[today] = num
        print(f"  {h} (@{handle}) -> {label}")
        done += 1
        time.sleep(DELAY)

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(cur, f, ensure_ascii=False, indent=1)
    with open(HIST_PATH, "w", encoding="utf-8") as f:
        json.dump(hist, f, ensure_ascii=False, separators=(",", ":"))
    have = sum(1 for v in cur.values() if v.get("subs"))
    print(f"saved: 現在 {len(cur)}件(ラベルあり {have}) / 履歴 {len(hist)}ホスト / 今回取得 {done}")


if __name__ == "__main__":
    main()
