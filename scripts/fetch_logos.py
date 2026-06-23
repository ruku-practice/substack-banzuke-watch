#!/usr/bin/env python3
"""各発行元（Substackパブリケーション）のロゴ画像URLを集めて data/logos.json に保存する。

各パブリケーションのトップページHTMLの preloads JSON から `logo_url` を抽出し、
substackcdn の署名を保ったまま小サイズ(96x96 webp)のアバターURLに変換して保存する。
既に取得済みのホストはスキップする（増分実行）。GitHub Actions でも回せるよう軽量。
"""

import csv
import json
import os
import re
import time
import urllib.request
from urllib.parse import urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = os.path.normpath(os.path.join(HERE, "..", "data", "banzuke_full.csv"))
LOGOS_PATH = os.path.normpath(os.path.join(HERE, "..", "data", "logos.json"))

PREFIX = "https://substackcdn.com/image/fetch/"
LOGO_RE = re.compile(r'logo_url\\?":\\?"(https://substackcdn\.com/image/fetch/[^"\\]+)')
UA = {"User-Agent": "Mozilla/5.0 (compatible; tsumiage-watch/1.0)"}


def small_avatar(logo_url: str) -> str:
    """フルサイズのlogo_urlを 96x96 webp の小型アバターURLに変換（署名は保持）。"""
    if not logo_url.startswith(PREFIX):
        return logo_url
    rest = logo_url[len(PREFIX):]
    transforms, sep, origin = rest.partition("/")
    if not sep:
        return logo_url
    sig = transforms.split(",")[0]  # $s_!XXXX! 署名トークン
    return f"{PREFIX}{sig},w_96,h_96,c_fill,f_webp,q_auto:good,fl_progressive:steep/{origin}"


def fetch_logo(host: str):
    url = f"https://{host}/"
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=20) as r:
            html = r.read().decode("utf-8", errors="replace")
    except Exception as e:
        print(f"  ! {host}: fetch error {e}")
        return None
    m = LOGO_RE.search(html)
    if not m:
        print(f"  ? {host}: logo_url not found")
        return None
    return small_avatar(m.group(1))


def hosts_from_csv():
    seen = []
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            h = (urlparse(row.get("url", "")).netloc or "").lower()
            if h and h not in seen:
                seen.append(h)
    return seen


def main():
    logos = {}
    if os.path.exists(LOGOS_PATH):
        with open(LOGOS_PATH, encoding="utf-8") as f:
            logos = json.load(f)

    hosts = hosts_from_csv()
    todo = [h for h in hosts if h not in logos]
    print(f"hosts: {len(hosts)}  already: {len(logos)}  to fetch: {len(todo)}")

    added = 0
    for i, h in enumerate(todo, 1):
        logo = fetch_logo(h)
        if logo:
            logos[h] = logo
            added += 1
            print(f"  [{i}/{len(todo)}] {h} OK")
        else:
            logos[h] = ""  # 失敗も記録して再取得ループを避ける（次回は空のまま）
        time.sleep(0.25)
        if added and added % 20 == 0:
            _save(logos)

    _save(logos)
    have = sum(1 for v in logos.values() if v)
    print(f"Done. logos.json: {len(logos)} hosts ({have} with logo)")


def _save(logos):
    os.makedirs(os.path.dirname(LOGOS_PATH), exist_ok=True)
    with open(LOGOS_PATH, "w", encoding="utf-8") as f:
        json.dump(logos, f, ensure_ascii=False, indent=0)


if __name__ == "__main__":
    main()
