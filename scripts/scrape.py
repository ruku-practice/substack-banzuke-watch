#!/usr/bin/env python3
"""Substack番付 (substackbanzuke.com) 日次TOP30スクレイパー — つみあげウォッチ用。

data/banzuke_full.csv に「未取得の日付だけ」をまとめて追記する（バックフィル方式）。
GitHub Actions の実行が遅延・スキップされても、翌日以降に自動で穴埋めされる（自己修復）。

使い方:
  python3 scripts/scrape.py            # 既存データの最後〜昨日(JST)までの未取得日を取りに行く
  python3 scripts/scrape.py --date 2026-06-22   # 特定日のみ取得（上書き）
  python3 scripts/scrape.py --since 2026-05-07  # この日以降の未取得日を全て

終了コード（黙って失敗しないための見張り・2026-09-13追加）:
  0 = 昨日(JST)までの全日がそろった
  2 = 取れていない日が残った（昨日分が未公開のまま・取得エラー等）
  3 = ページ構造の変化を検知した（行はあるのに解析できない）＝パーサの修正が必要

2026-09-13: 元サイトが 2026-09-06〜07 の改修で各行の「N位」表記・「発行元:」・カテゴリ表示を削除した。
旧パーサは順位の <b> を必須にしていたため全行を捨てて0件になり、「未公開」と誤判定して
リトライを繰り返したまま exit 0 していた。新形式では <ol> 内の並び順を順位として扱う。
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
JST = timezone(timedelta(hours=9))

HERE = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = os.path.normpath(os.path.join(HERE, "..", "data", "banzuke_full.csv"))

CSV_COLUMNS = [
    "fetched_at", "date", "rank", "title", "publisher", "url",
    "attention_score", "likes", "restacks", "comments", "category", "is_ruku",
]

# 昨日分だけ「まだ公開前」の可能性があるのでリトライする。Cloud Run のタスク上限(1200秒)に収まる値にする。
RETRY_ATTEMPTS = int(os.getenv("BANZUKE_RETRY_ATTEMPTS", "3"))
RETRY_INTERVAL = int(os.getenv("BANZUKE_RETRY_INTERVAL", "120"))
REQUEST_GAP = float(os.getenv("BANZUKE_REQUEST_GAP", "2.0"))  # 元サイトへの負荷を抑える間隔(秒)
FETCH_ERROR_WAIT = int(os.getenv("BANZUKE_FETCH_ERROR_WAIT", "10"))  # 通信エラー（途中切断など）の取り直し間隔(秒)
# 元サイトに本当にページが無い日を恒久的に許容する場合のみ指定（カンマ区切り YYYY-MM-DD）
KNOWN_MISSING = {d.strip() for d in os.getenv("BANZUKE_KNOWN_MISSING", "").split(",") if d.strip()}

EXIT_OK, EXIT_MISSING, EXIT_STRUCTURE = 0, 2, 3

OK, NOT_PUBLISHED, FETCH_ERROR, STRUCTURE_CHANGED = "ok", "not_published", "fetch_error", "structure_changed"


def today_jst() -> date:
    return datetime.now(timezone.utc).astimezone(JST).date()


class BanzukeParser(HTMLParser):
    """日次ページ（section.ssr-archive > ol > li）を解析する。

    旧形式: <li><b>1位</b> <span class="topic-label">カテゴリ</span> <a>題</a> <span>発行元: 名前</span> <small>指標</small>
    新形式: <li><a>題</a> <span>名前</span> <small>指標</small>   ← 順位は並び順
    """

    def __init__(self):
        super().__init__()
        self.entries = []
        self.found_archive = False
        self.archive_label = ""
        self.li_count = 0
        self._in_archive = False
        self._in_ol = False
        self._in_li = False
        self._current = {}
        self._collect_mode = None
        self._text_buf = ""
        self._next_href = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "section" and "ssr-archive" in (a.get("class") or "").split():
            self._in_archive = True
            self.found_archive = True
            self.archive_label = a.get("aria-label") or ""
        elif self._in_archive and tag == "ol" and not self._in_ol:
            self._in_ol = True
        elif self._in_ol and tag == "li":
            self._in_li = True
            self.li_count += 1
            self._current = {"position": self.li_count}
            self._collect_mode = None
        elif self._in_li:
            if tag == "b" and self._collect_mode is None:
                self._collect_mode = "rank"
                self._text_buf = ""
            elif tag == "span":
                classes = (a.get("class") or "").split()
                if "topic-label" in classes:
                    self._collect_mode = "category"
                # 発行元は class の無い span だけ。「新」「PR」等の飾り span を発行元として拾わない（断 2026-09-13 指摘）
                elif not classes and self._collect_mode is None and "publisher" not in self._current:
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
            cur = self._current
            # 1項目でも欠けた行は採らない→件数不一致で「構造変化」として止まる（空欄で黙って書かない）
            if cur.get("url") and cur.get("title") and cur.get("publisher") and cur.get("scores_ok"):
                cur.setdefault("rank", cur["position"])
                self.entries.append(cur)
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
                # 指標が1つでも読めない行は「0」で埋めずに解析失敗として扱う（0に見せない）
                if att and lk and rs and cm:
                    self._current["attention_score"] = int(att.group(1))
                    self._current["likes"] = int(lk.group(1))
                    self._current["restacks"] = int(rs.group(1))
                    self._current["comments"] = int(cm.group(1))
                    self._current["scores_ok"] = True
                self._collect_mode = None

    def handle_data(self, data):
        if self._collect_mode:
            self._text_buf += data


def expected_archive_label(target: date) -> str:
    return f"{target.year}年{target.month}月{target.day}日"


def parse_page(html: str, target: date):
    """HTML → (rows, status, detail)。ネットワークに触れないのでテストしやすい。"""
    parser = BanzukeParser()
    parser.feed(html)
    # 未公開日（今日・未来日）は ssr-archive の無いトップページ相当が 200 で返る
    if not parser.found_archive or parser.li_count == 0:
        return [], NOT_PUBLISHED, "ssr-archive が無い（未公開）"
    if parser.archive_label and expected_archive_label(target) not in parser.archive_label:
        return [], STRUCTURE_CHANGED, f"別の日のページが返った: {parser.archive_label}"
    if len(parser.entries) != parser.li_count:
        return [], STRUCTURE_CHANGED, f"行 {parser.li_count} 件のうち解析できたのは {len(parser.entries)} 件"
    ranks = sorted(e["rank"] for e in parser.entries)
    if ranks != list(range(1, len(ranks) + 1)):
        return [], STRUCTURE_CHANGED, f"順位が 1..{len(ranks)} の連番になっていない: {ranks[:5]}..."

    fetched_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    rows = []
    for e in sorted(parser.entries, key=lambda e: e["rank"]):
        rows.append({
            "fetched_at": fetched_at,
            "date": target.isoformat(),
            "rank": e["rank"],
            "title": e.get("title", ""),
            "publisher": e.get("publisher", ""),
            "url": e.get("url", ""),
            "attention_score": e["attention_score"],
            "likes": e["likes"],
            "restacks": e["restacks"],
            "comments": e["comments"],
            "category": e.get("category", ""),
            "is_ruku": "1" if RUKU_DOMAIN in e.get("url", "") else "0",
        })
    return rows, OK, f"{len(rows)} 件"


def fetch_date(target: date):
    url = BASE_URL.format(date=target.isoformat())
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; tsumiage-watch/1.0)"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            html = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return [], NOT_PUBLISHED, "HTTP 404"
        return [], FETCH_ERROR, f"HTTP {e.code}"
    except Exception as e:
        return [], FETCH_ERROR, str(e)
    return parse_page(html, target)


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


def missing_dates(since: date, until: date, existing: set) -> list:
    out = []
    d = since
    while d <= until:
        if d.isoformat() not in existing and d.isoformat() not in KNOWN_MISSING:
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
        new, status, detail = fetch_date(target)
        print(f"{target}: {status} ({detail})")
        if not new:
            print(f"Nothing to save for {target}")
            return EXIT_STRUCTURE if status == STRUCTURE_CHANGED else EXIT_MISSING
        rows = [r for r in load_all_rows() if r.get("date") != args.date]
        rows.extend(new)
        rows.sort(key=lambda r: (r.get("date", ""), int(r.get("rank") or 99)))
        write_all(rows)
        print(f"Saved {len(new)} rows for {target}")
        return EXIT_OK

    # 当日分は夜に確定するため、対象は昨日(JST)まで
    yesterday = today_jst() - timedelta(days=1)
    since = date.fromisoformat(args.since) if args.since else BACKFILL_START
    targets = missing_dates(since, yesterday, load_existing_dates())
    if not targets:
        print(f"No missing dates. Up to date (through {yesterday}).")
        return EXIT_OK

    print(f"Missing dates: {len(targets)} ({targets[0]} .. {targets[-1]})")
    total = 0
    failures = {}
    for i, t in enumerate(targets):
        if i:
            time.sleep(REQUEST_GAP)
        # 昨日分だけ公開遅れを待つ。通信エラーは短い間隔で取り直す。構造変化はリトライしても直らないので即打ち切る。
        attempts = max(RETRY_ATTEMPTS, 2) if t == yesterday else 2
        for attempt in range(1, attempts + 1):
            new, status, detail = fetch_date(t)
            print(f"Fetching {t} (attempt {attempt}/{attempts}): {status} ({detail})")
            if status in (OK, STRUCTURE_CHANGED) or attempt == attempts:
                break
            if status == NOT_PUBLISHED and t != yesterday:
                break  # 過去日が未公開なら待っても出ない
            wait = RETRY_INTERVAL if status == NOT_PUBLISHED else FETCH_ERROR_WAIT
            print(f"  Retrying in {wait} seconds...")
            time.sleep(wait)
        if new:
            append_rows(new)
            total += len(new)
            print(f"  +{len(new)} rows")
        else:
            failures[t.isoformat()] = (status, detail)

    print(f"Done. Added {total} rows.")
    if not failures:
        return EXIT_OK
    for d, (status, detail) in failures.items():
        print(f"::error::番付 {d} を取得できませんでした: {status}（{detail}）")
    if any(status == STRUCTURE_CHANGED for status, _ in failures.values()):
        print("::error::元サイトのページ構造が変わった可能性があります。scripts/scrape.py の解析を確認してください。")
        return EXIT_STRUCTURE
    return EXIT_MISSING


if __name__ == "__main__":
    sys.exit(main())
