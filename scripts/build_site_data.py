#!/usr/bin/env python3
"""data/banzuke_full.csv を集計して site/data.json を生成する。

発行元（＝Substackパブリケーション）を **URLホスト** で名寄せして、
期間別（累積 / 今月 / 直近30日 / 直近7日 / 月別）の発行元ランキングと、
番付トレンド（順位帯別の平均指標・カテゴリ別）を出力する。
"""

import csv
import json
import os
import re
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from urllib.parse import urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = os.path.normpath(os.path.join(HERE, "..", "data", "banzuke_full.csv"))
LOGOS_PATH = os.path.normpath(os.path.join(HERE, "..", "data", "logos.json"))
SUBS_PATH = os.path.normpath(os.path.join(HERE, "..", "data", "subscribers.json"))
OUT_PATH = os.path.normpath(os.path.join(HERE, "..", "site", "data.json"))
DAILY_PATH = os.path.normpath(os.path.join(HERE, "..", "site", "daily.json"))

SITE_NAME = "Substack番付 つみあげウォッチ"
RUKU_HOST = "rukupractice.substack.com"

LOGOS = {}


def load_logos():
    global LOGOS
    if os.path.exists(LOGOS_PATH):
        with open(LOGOS_PATH, encoding="utf-8") as f:
            LOGOS = json.load(f)


def host_of(url: str) -> str:
    try:
        return (urlparse(url).netloc or "").lower()
    except Exception:
        return ""


def to_int(v, default=0):
    try:
        return int(str(v).strip())
    except Exception:
        return default


def load_rows():
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    out = []
    for r in rows:
        d = (r.get("date") or "").strip()
        rank = to_int(r.get("rank"), 0)
        url = (r.get("url") or "").strip()
        if not d or rank <= 0:
            continue
        host = host_of(url)
        out.append({
            "date": d,
            "rank": rank,
            "title": (r.get("title") or "").strip(),
            "publisher": (r.get("publisher") or "").strip(),
            "url": url,
            "host": host,
            # 名寄せキー: ホスト優先。無ければ発行元名のベース部分。
            "key": host or re.split(r"[｜|]", r.get("publisher") or "")[0].strip(),
            "attention": to_int(r.get("attention_score")),
            "likes": to_int(r.get("likes")),
            "restacks": to_int(r.get("restacks")),
            "comments": to_int(r.get("comments")),
            "category": (r.get("category") or "").strip(),
        })
    return out


def aggregate_publishers(rows):
    """期間内の行リスト → 発行元別集計（リスト）。"""
    g = defaultdict(lambda: {
        "dates": set(), "appearances": 0, "top1": 0, "top3": 0, "top10": 0,
        "rank_sum": 0, "best_rank": 99, "att_sum": 0,
        "likes": 0, "restacks": 0, "comments": 0,
        "latest_date": "", "first_date": "", "name": "", "host": "", "url": "",
        "category_counts": defaultdict(int),
    })
    for r in rows:
        s = g[r["key"]]
        s["dates"].add(r["date"])
        s["appearances"] += 1
        rk = r["rank"]
        if rk == 1:
            s["top1"] += 1
        if rk <= 3:
            s["top3"] += 1
        if rk <= 10:
            s["top10"] += 1
        s["rank_sum"] += rk
        s["best_rank"] = min(s["best_rank"], rk)
        s["att_sum"] += r["attention"]
        s["likes"] += r["likes"]
        s["restacks"] += r["restacks"]
        s["comments"] += r["comments"]
        if r["category"]:
            s["category_counts"][r["category"]] += 1
        if not s["first_date"] or r["date"] < s["first_date"]:
            s["first_date"] = r["date"]
        # 表示名・リンクは「期間内で最新日付」の表記を採用
        if r["date"] >= s["latest_date"]:
            s["latest_date"] = r["date"]
            s["name"] = r["publisher"]
            s["host"] = r["host"]
            s["url"] = ("https://" + r["host"] + "/") if r["host"] else r["url"]

    out = []
    for key, s in g.items():
        n = s["appearances"]
        cat = ""
        if s["category_counts"]:
            cat = sorted(s["category_counts"].items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
        out.append({
            "name": s["name"] or key,
            "host": s["host"],
            "url": s["url"],
            "days": len(s["dates"]),
            "appearances": n,
            "first_date": s["first_date"] or None,
            "category": cat,
            "top1": s["top1"],
            "top3": s["top3"],
            "top10": s["top10"],
            "avg_rank": round(s["rank_sum"] / n, 1) if n else 0,
            "best_rank": s["best_rank"] if s["best_rank"] != 99 else None,
            "avg_attention": round(s["att_sum"] / n, 1) if n else 0,
            "avg_likes": round(s["likes"] / n, 1) if n else 0,
            "avg_restacks": round(s["restacks"] / n, 1) if n else 0,
            "avg_comments": round(s["comments"] / n, 1) if n else 0,
        })
    # 既定ソート: Top10降順 → 同点は rukupractice 最上位 → ホスト(slug)昇順
    out.sort(key=lambda p: (-p["top10"], 0 if p["host"] == RUKU_HOST else 1, p["host"]))
    return out


def period_payload(key, label, rows):
    if not rows:
        return None
    dates = sorted({r["date"] for r in rows})
    return {
        "key": key,
        "label": label,
        "start": dates[0],
        "end": dates[-1],
        "days": len(dates),
        "entries": len(rows),
        "publishers": aggregate_publishers(rows),
        "trends": {
            **compute_trends(rows),
            "categories": category_stats(rows),
        },
    }


def compute_trends(rows):
    # 順位ごとの平均注目度（1..10）
    per_rank = defaultdict(lambda: {"n": 0, "att": 0, "likes": 0})
    for r in rows:
        if r["rank"] <= 10:
            pr = per_rank[r["rank"]]
            pr["n"] += 1
            pr["att"] += r["attention"]
            pr["likes"] += r["likes"]
    per_rank_attention = [
        {"rank": rk, "n": v["n"],
         "avg_attention": round(v["att"] / v["n"], 1) if v["n"] else 0,
         "avg_likes": round(v["likes"] / v["n"], 1) if v["n"] else 0}
        for rk, v in sorted(per_rank.items())
    ]

    # 順位帯別の平均指標
    bands = [("1位", 1, 1), ("2〜3位", 2, 3), ("4〜10位", 4, 10),
             ("11〜20位", 11, 20), ("21〜30位", 21, 30)]
    band_stats = []
    for label, lo, hi in bands:
        sub = [r for r in rows if lo <= r["rank"] <= hi]
        n = len(sub)
        if not n:
            continue
        band_stats.append({
            "label": label, "n": n,
            "avg_attention": round(sum(r["attention"] for r in sub) / n, 1),
            "avg_likes": round(sum(r["likes"] for r in sub) / n, 1),
            "avg_restacks": round(sum(r["restacks"] for r in sub) / n, 1),
            "avg_comments": round(sum(r["comments"] for r in sub) / n, 1),
        })

    # 要点サマリー（上位の平均注目度など）
    def avg_att(pred):
        sub = [r["attention"] for r in rows if pred(r["rank"])]
        return round(sum(sub) / len(sub), 1) if sub else 0
    summary = {
        "avg_att_rank1": avg_att(lambda rk: rk == 1),
        "avg_att_top3": avg_att(lambda rk: rk <= 3),
        "avg_att_top10": avg_att(lambda rk: rk <= 10),
        "avg_att_all": avg_att(lambda rk: True),
    }

    return {"summary": summary, "per_rank_attention": per_rank_attention, "bands": band_stats}


def category_stats(rows):
    g = defaultdict(lambda: {"entries": 0, "att": 0, "top10": 0, "top3": 0})
    for r in rows:
        c = r["category"] or "（カテゴリ未設定）"
        s = g[c]
        s["entries"] += 1
        s["att"] += r["attention"]
        if r["rank"] <= 10:
            s["top10"] += 1
        if r["rank"] <= 3:
            s["top3"] += 1
    out = [{
        "category": c, "entries": s["entries"], "top10": s["top10"], "top3": s["top3"],
        "avg_attention": round(s["att"] / s["entries"], 1) if s["entries"] else 0,
    } for c, s in g.items()]
    out.sort(key=lambda x: (-x["top10"], -x["entries"]))
    return out


def load_subscribers():
    """data/subscribers.json → {host: "11K+"} の概数ラベル（参考値・公開分のみ）。"""
    if not os.path.exists(SUBS_PATH):
        return {}
    try:
        with open(SUBS_PATH, encoding="utf-8") as f:
            raw = json.load(f)
    except Exception:
        return {}
    return {h: v.get("subs") for h, v in raw.items() if v.get("subs")}


def main():
    load_logos()
    subscribers = load_subscribers()
    rows = load_rows()
    if not rows:
        raise SystemExit("No rows in CSV")

    all_dates = sorted({r["date"] for r in rows})
    start, end = all_dates[0], all_dates[-1]
    end_d = date.fromisoformat(end)

    # 期間スライス
    last7_start = (end_d - timedelta(days=6)).isoformat()
    last30_start = (end_d - timedelta(days=29)).isoformat()
    cur_ym = end[:7]  # YYYY-MM（最新データ月）

    def in_range(r, lo):
        return r["date"] >= lo

    periods = []
    periods.append(period_payload("cumulative", "累積（全期間）", rows))
    _cy, _cm = cur_ym.split("-")
    periods.append(period_payload("this_month", f"今月（{_cy}年{int(_cm)}月）",
                                  [r for r in rows if r["date"][:7] == cur_ym]))
    periods.append(period_payload("last30", "直近30日",
                                  [r for r in rows if in_range(r, last30_start)]))
    periods.append(period_payload("last7", "直近7日",
                                  [r for r in rows if in_range(r, last7_start)]))
    # 月別（新しい順）。今月は「今月」タブと重複するので個別の月タブにはしない。
    months = sorted({r["date"][:7] for r in rows}, reverse=True)
    for ym in months:
        if ym == cur_ym:
            continue
        y, m = ym.split("-")
        p = period_payload(ym, f"{y}年{int(m)}月", [r for r in rows if r["date"][:7] == ym])
        if p:
            p["is_month"] = True  # フロント側で「直近3ヶ月タブ / それ以前はプルダウン」に振り分ける
        periods.append(p)
    periods = [p for p in periods if p]

    data = {
        "site_name": SITE_NAME,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": {"name": "Substack番付", "url": "https://substackbanzuke.com/"},
        "date_range": {"start": start, "end": end, "days": len(all_dates), "entries": len(rows)},
        "publisher_count": len({r["key"] for r in rows}),
        "logo_count": sum(1 for v in LOGOS.values() if v),
        "logos": {h: u for h, u in LOGOS.items() if u},
        "subscribers": subscribers,  # {host: "11K+"} 購読者数の概数（参考値・公開分のみ）
        "periods": periods,
    }

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    kb = os.path.getsize(OUT_PATH) / 1024

    # 日次データ（発行元詳細グラフ・日別TOP30ビューア用）を別ファイルに出力。
    # サイトは必要なときだけ遅延読み込みする（data.json は軽量に保つ）。
    days = {}
    for r in rows:
        days.setdefault(r["date"], []).append({
            "r": r["rank"], "h": r["host"], "n": r["publisher"], "u": r["url"],
            "t": r["title"], "a": r["attention"], "l": r["likes"],
            "rs": r["restacks"], "c": r["comments"], "cat": r["category"],
        })
    for d in days:
        days[d].sort(key=lambda e: e["r"])
    daily = {"dates": all_dates, "days": days}
    with open(DAILY_PATH, "w", encoding="utf-8") as f:
        json.dump(daily, f, ensure_ascii=False, separators=(",", ":"))
    dkb = os.path.getsize(DAILY_PATH) / 1024

    print(f"Wrote {OUT_PATH} ({kb:.0f} KB) + daily.json ({dkb:.0f} KB)")
    print(f"  range {start}..{end} ({len(all_dates)} days, {len(rows)} entries, "
          f"{data['publisher_count']} publishers)")
    print(f"  periods: {', '.join(p['key'] for p in periods)}")


if __name__ == "__main__":
    main()
