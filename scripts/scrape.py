#!/usr/bin/env python3
"""Substack番付 (substackbanzuke.com) 日次TOP30スクレイパー — つみあげウォッチ用。

data/banzuke_full.csv に「未取得の日付だけ」をまとめて追記する（バックフィル方式）。
GitHub Actions の実行が遅延・スキップされても、翌日以降に自動で穴埋めされる（自己修復）。

使い方:
  python3 scripts/scrape.py            # 既存データの最後〜今日までの未取得日を取りに行く
  python3 scripts/scrape.py --date 2026-06-22   # 特定日のみ取得（上書き）
  python3 scripts/scrape.py --since 2026-05-07  # この日以降の未取得日を全て
"""

import argparse
import csv
import os
import re
import sys
import time
import urllib.request
import urllib.error
from datetime import date, datetime, timedelta, timezone
from html.parser import HTMLParser

BASE_URL = "https://substackbanzuke.com/daily/{date}"
BACKFILL_START = date(2026, 5, 7)
RUKU_DOMAIN = "rukupractice.substack.com"

HERE = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = os.path.normpath(os.path.join(HERE, "..", "data", "banzuke_full.csv"))

CSV_COLUMNS = [
    "fetched_at", "date", "rank", "title", "publisher", "url",
    "attention_score", "likes", "restacks", "comments", "category", "is_ruku",
]


class BanzukeParser(HTMLParser):
    """substackbanzuke.com の日次ページ（section.ssr-archive > ol > li）を解析。"""

    def __init__(self):
        super().__init__()
        self.entries = []
        self._in_archive = False
        self._in_ol = False
        self._in_li = False
        self._current = {}
        self._collect_mode = None
        self._text_buf = ""
        self._next_href = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "section" and a.get("class", "") == "ssr-archive":
            self._in_archive = True
        elif self._in_archive and tag == "ol" and not self._in_ol:
            self._in_ol = True
        elif self._in_ol and tag == "li":
            self._in_li = True
            self._current = {}
            self._collect_mode = None
        elif self._in_li:
            if tag == "b" and self._collect_mode is None:
                self._collect_mode = "rank"
                self._text_buf = ""
            elif tag == "span":
                cls = a.get("class", "")
                if cls == "topic-label":
                    self._collect_mode = "category"
                elif self._collect_mode is None:
                    self._collect_mode = "publisher"
                self._text_buf = ""
            elif tag == "a":
                self._collect_mode = "title"
                self._next_href = a.get("href", "")
                self._text_buf = ""
            elif tag == "small":
                self._collect_mode = "scores"
                self._text_buf = ""

    def handle_endtag(self, tag):
        if tag == "section" and self._in_archive:
            self._in_archive = False
        elif tag == "ol" and self._in_ol:
            self._in_ol = False
        elif tag == "li" and self._in_li:
            self._in_li = False
            if "rank" in self._current:
                self.entries.append(self._current)
            self._current = {}
            self._collect_mode = None
        elif self._in_li and self._collect_mode:
            if self._collect_mode == "rank" and tag == "b":
                m = re.search(r"(\d+)位", self._text_buf)
                if m:
                    self._current["rank"] = int(m.group(1))
                self._collect_mode = None
            elif self._collect_mode == "category" and tag == "span":
                self._current["category"] = self._text_buf.strip()
                self._collect_mode = None
            elif self._collect_mode == "title" and tag == "a":
                self._current["title"] = self._text_buf.strip()
                self._current["url"] = self._next_href or ""
                self._collect_mode = None
            elif self._collect_mode == "publisher" and tag == "span":
                pub = self._text_buf.strip()
                if pub.startswith("発行元:"):
                    pub = pub[len("発行元:"):].strip()
                self._current["publisher"] = pub
                self._collect_mode = None
            elif self._collect_mode == "scores" and tag == "small":
                t = self._text_buf
                att = re.search(r"注目度\s*(\d+)", t)
                lk = re.search(r"♥\s*(\d+)", t)
                rs = re.search(r"Restack\s*(\d+)", t)
                cm = re.search(r"コメント\s*(\d+)", t)
                self._current["attention_score"] = int(att.group(1)) if att else 0
                self._current["likes"] = int(lk.group(1)) if lk else 0
                self._current["restacks"] = int(rs.group(1)) if rs else 0
                self._current["comments"] = int(cm.group(1)) if cm else 0
                self._collect_mode = None

    def handle_data(self, data):
        if self._collect_mode:
            self._text_buf += data


def fetch_date(target: date) -> list:
    url = BASE_URL.format(date=target.isoformat())
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; tsumiage-watch/1.0)"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            html = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        print(f"  HTTP {e.code} for {target}")
        return []
    except Exception as e:
        print(f"  Error fetching {target}: {e}")
        return []

    parser = BanzukeParser()
    parser.feed(html)
    if not parser.entries:
        print(f"  No entries for {target} (page may not exist yet)")
        return []

    fetched_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    rows = []
    for e in parser.entries:
        if "rank" not in e:
            continue
        rows.append({
            "fetched_at": fetched_at,
            "date": target.isoformat(),
            "rank": e.get("rank", ""),
            "title": e.get("title", ""),
            "publisher": e.get("publisher", ""),
            "url": e.get("url", ""),
            "attention_score": e.get("attention_score", 0),
            "likes": e.get("likes", 0),
            "restacks": e.get("restacks", 0),
            "comments": e.get("comments", 0),
            "category": e.get("category", ""),
            "is_ruku": "1" if RUKU_DOMAIN in e.get("url", "") else "0",
        })
    return rows


def load_existing_dates() -> set:
    if not os.path.exists(CSV_PATH):
        return set()
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        return {r.get("date", "").strip() for r in csv.DictReader(f) if r.get("date", "").strip()}


def write_all(rows: list):
    os.makedirs(os.path.dirname(CSV_PATH), exist_ok=True)
    with open(CSV_PATH, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        w.writeheader()
        w.writerows(rows)


def load_all_rows() -> list:
    if not os.path.exists(CSV_PATH):
        return []
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def append_rows(rows: list):
    exists = os.path.exists(CSV_PATH)
    with open(CSV_PATH, "a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        if not exists:
            w.writeheader()
        w.writerows(rows)


def missing_dates(since: date, existing: set) -> list:
    today = datetime.now(timezone.utc).date() + timedelta(hours=9)  # JST 寄せ（おおよそ）
    today = datetime.now(timezone.utc).astimezone(timezone(timedelta(hours=9))).date()
    out = []
    d = since
    while d <= today:
        if d.isoformat() not in existing:
            out.append(d)
        d += timedelta(days=1)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", help="特定日のみ取得（上書き）")
    ap.add_argument("--since", help="この日以降の未取得日を全て (YYYY-MM-DD)")
    args = ap.parse_args()

    if args.date:
        target = date.fromisoformat(args.date)
        rows = load_all_rows()
        rows = [r for r in rows if r.get("date") != args.date]
        new = fetch_date(target)
        if new:
            rows.extend(new)
            rows.sort(key=lambda r: (r.get("date", ""), int(r.get("rank") or 99)))
            write_all(rows)
            print(f"Saved {len(new)} rows for {target}")
        else:
            print(f"Nothing to save for {target}")
        return

    existing = load_existing_dates()
    since = date.fromisoformat(args.since) if args.since else BACKFILL_START
    targets = missing_dates(since, existing)
    if not targets:
        print("No missing dates. Up to date.")
        return

    print(f"Missing dates: {len(targets)} ({targets[0]} .. {targets[-1]})")
    
    # JSTでの今日・昨日を定義
    today_jst = datetime.now(timezone.utc).astimezone(timezone(timedelta(hours=9))).date()
    yesterday_jst = today_jst - timedelta(days=1)
    
    max_retries = 6
    retry_interval = 600  # 10分
    
    total = 0
    for t in targets:
        # リトライ対象は昨日以前の未取得日とする（今日以降のデータは未公開が正常なためリトライしない）
        is_retry_target = (t <= yesterday_jst)
        
        attempt = 0
        new = []
        while attempt < max_retries:
            attempt_str = f" (attempt {attempt + 1}/{max_retries})" if is_retry_target else ""
            print(f"Fetching {t}{attempt_str}...")
            new = fetch_date(t)
            if new:
                break
            
            if not is_retry_target:
                break
                
            attempt += 1
            if attempt < max_retries:
                print(f"  No entries. Retrying in {retry_interval} seconds...")
                time.sleep(retry_interval)
                
        if new:
            append_rows(new)
            total += len(new)
            print(f"  +{len(new)} rows")
        else:
            print(f"  Could not retrieve data for {t} after attempts.")
            
        time.sleep(1.0)
    print(f"Done. Added {total} rows.")


if __name__ == "__main__":
    main()
