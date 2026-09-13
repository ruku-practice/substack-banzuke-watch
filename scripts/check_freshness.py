#!/usr/bin/env python3
"""鮮度の見張り — 新しい日が入っていなければ非0で終わる（CI を赤くする）。

2026-09-13 追加。9/6〜9/12 の停止は「実行は成功・データは古いまま」で1週間気づけなかった。
ジョブの成否ではなく、データそのものの日付を見て判定する。

使い方:
  python3 scripts/check_freshness.py                       # リポジトリ内の data/ と site/data.json を検査
  python3 scripts/check_freshness.py --data-url https://ruku-practice.github.io/substack-banzuke-watch/data.json \
      --retries 10 --retry-wait 60                         # 公開中のサイトを検査（CDN反映待ちつき）

判定:
  ✗(exit 2) 番付の最新日が 昨日(JST) より古い / 途中に抜けた日がある / data.json の最新日が CSV と食い違う
  △(警告のみ) 購読者数の履歴に 直近2日(JST) の点が1件も無い（購読者数は遡って取れないため、気づくための警告）
"""

import argparse
import csv
import json
import os
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone

JST = timezone(timedelta(hours=9))
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
BACKFILL_START = date(2026, 5, 7)


def today_jst() -> date:
    return datetime.now(timezone.utc).astimezone(JST).date()


def load_json_url(url, retries, wait, want_end):
    last = None
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(f"{url}?t={int(time.time())}", headers={"Cache-Control": "no-cache"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                last = json.load(resp)
            if last.get("date_range", {}).get("end", "") >= want_end:
                return last
            print(f"  公開サイトの最新日 {last.get('date_range', {}).get('end')}（{attempt}/{retries}）…反映待ち")
        except Exception as e:
            print(f"  取得失敗（{attempt}/{retries}）: {e}")
        if attempt < retries:
            time.sleep(wait)
    return last


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", default=os.path.join(ROOT, "data", "banzuke_full.csv"))
    ap.add_argument("--data", default=os.path.join(ROOT, "site", "data.json"))
    ap.add_argument("--subs-hist", default=os.path.join(ROOT, "data", "subscribers_history.json"))
    ap.add_argument("--data-url", help="公開中の data.json を検査する（指定時は CSV・購読者は見ない）")
    ap.add_argument("--retries", type=int, default=1)
    ap.add_argument("--retry-wait", type=int, default=60)
    ap.add_argument("--known-missing", default=os.getenv("BANZUKE_KNOWN_MISSING", ""),
                    help="元サイトに本当にページが無い日（カンマ区切り）")
    args = ap.parse_args()

    today = today_jst()
    expected = (today - timedelta(days=1)).isoformat()
    errors, warnings = [], []
    print(f"鮮度チェック: 今日(JST) {today} ／ 必要な最新日 {expected}")

    if args.data_url:
        data = load_json_url(args.data_url, args.retries, args.retry_wait, expected)
        end = (data or {}).get("date_range", {}).get("end", "")
        print(f"  公開サイト data.json の最新日: {end or '（読めない）'}")
        if end < expected:
            errors.append(f"公開サイトの番付が {end or '不明'} で止まっています（必要: {expected}）")
    else:
        with open(args.csv, newline="", encoding="utf-8") as f:
            dates = {r["date"] for r in csv.DictReader(f) if r.get("date")}
        newest = max(dates) if dates else ""
        known = {d.strip() for d in args.known_missing.split(",") if d.strip()}
        holes = []
        d = BACKFILL_START
        last = min(newest, expected)
        while newest and d.isoformat() <= last:
            if d.isoformat() not in dates and d.isoformat() not in known:
                holes.append(d.isoformat())
            d += timedelta(days=1)
        print(f"  CSV の最新日: {newest or '（空）'} ／ 途中の抜け: {len(holes)} 日")
        if newest < expected:
            errors.append(f"番付CSVが {newest or '空'} で止まっています（必要: {expected}）")
        if holes:
            errors.append(f"番付CSVに抜けた日があります: {', '.join(holes[:10])}{' …' if len(holes) > 10 else ''}")

        with open(args.data, encoding="utf-8") as f:
            end = json.load(f).get("date_range", {}).get("end", "")
        print(f"  site/data.json の最新日: {end}")
        if end != newest:
            errors.append(f"site/data.json（{end}）が CSV（{newest}）と食い違っています＝集計が古い")

        if os.path.exists(args.subs_hist):
            with open(args.subs_hist, encoding="utf-8") as f:
                hist = json.load(f)
            recent = {today.isoformat(), expected}
            n = sum(1 for v in hist.values() if recent & set(v))
            print(f"  購読者数: 直近2日に点がある発行元 {n} 件")
            if n == 0:
                warnings.append("購読者数の履歴に直近2日の点がありません（購読者数は遡って取れないので、この日は欠測になります）")

    for w in warnings:
        print(f"::warning::{w}")
    for e in errors:
        print(f"::error::{e}")
    if errors:
        print("✗ 鮮度チェック不合格")
        return 2
    print("✓ 鮮度チェック合格")
    return 0


if __name__ == "__main__":
    sys.exit(main())
