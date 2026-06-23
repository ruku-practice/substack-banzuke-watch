#!/usr/bin/env python3
"""発行元ごとの OGPカード画像（site/cards/<host>.png）と
OGPメタ付きの軽量HTML（site/p/<host>/index.html）を生成する。

X/SNSにそのページURLを貼ると、その発行元のカードがプレビュー表示される。
人間がアクセスした場合はJSでアプリ本体（?p=<host>）へリダイレクトする。

毎朝のGitHub ActionsでPages配信物として生成する（Gitにはコミットしない）。
日本語フォントが要るため、CIでは fonts-noto-cjk を導入して実行する。
"""

import html as H
import io
import json
import os
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.normpath(os.path.join(HERE, "..", "site"))
DATA_PATH = os.path.join(SITE, "data.json")
LOGOS_PATH = os.path.normpath(os.path.join(HERE, "..", "data", "logos.json"))
ICON_PATH = os.path.join(SITE, "icon.png")
CARDS_DIR = os.path.join(SITE, "cards")
P_DIR = os.path.join(SITE, "p")

BASE = "https://ruku-practice.github.io/substack-banzuke-watch"

ACC = (239, 96, 17)
ACC2 = (201, 75, 0)
INK = (33, 29, 24)
INK2 = (92, 84, 72)
INK3 = (138, 129, 116)
PAPER = (245, 241, 234)

BOLD_FONTS = [
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJKjp-Bold.otf",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc",
]
REG_FONTS = [
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJKjp-Regular.otf",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
]
_FONT_CACHE = {}


def font(size, bold=True):
    key = (size, bold)
    if key in _FONT_CACHE:
        return _FONT_CACHE[key]
    for path in (BOLD_FONTS if bold else REG_FONTS):
        if os.path.exists(path):
            try:
                f = ImageFont.truetype(path, size)
                _FONT_CACHE[key] = f
                return f
            except Exception:
                continue
    f = ImageFont.load_default()
    _FONT_CACHE[key] = f
    return f


def trunc(draw, text, fnt, maxw):
    if draw.textlength(text, font=fnt) <= maxw:
        return text
    t = text
    while len(t) > 1 and draw.textlength(t + "…", font=fnt) > maxw:
        t = t[:-1]
    return t + "…"


def fetch_image(url):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=20) as r:
            return Image.open(io.BytesIO(r.read())).convert("RGBA")
    except Exception:
        return None


def circle_avatar(img, size):
    img = img.resize((size, size), Image.LANCZOS)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size, size), fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def score_of(pub, top10_rank, n, period_days):
    pct = (n - top10_rank) / (n - 1) if n > 1 else 1
    continuity = min(1, pub["days"] / period_days) if period_days else 0
    rank_power = max(0, (31 - pub["avg_rank"]) / 30) if pub["avg_rank"] else 0
    return round(45 + pct * 25 + continuity * 18 + rank_power * 12)


def score_label(s):
    if s >= 80: return "横綱級"
    if s >= 70: return "大関級"
    if s >= 62: return "関脇級"
    if s >= 55: return "小結級"
    return "幕内級"


def draw_card(pub, score, label, score_rank, avatar):
    W, Hh = 1200, 630
    img = Image.new("RGB", (W, Hh), PAPER)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 8], fill=ACC)
    # ghost 番
    gh = Image.new("RGBA", (W, Hh), (0, 0, 0, 0))
    ImageDraw.Draw(gh).text((W - 60, Hh // 2), "番", font=font(520), fill=(236, 96, 13, 18), anchor="rm")
    img.paste(Image.alpha_composite(img.convert("RGBA"), gh).convert("RGB"), (0, 0))
    d = ImageDraw.Draw(img)

    # アバター
    asz = 130
    if avatar is not None:
        img.paste(circle_avatar(avatar, asz), (70, 60), circle_avatar(avatar, asz))
    else:
        d.ellipse((70, 60, 70 + asz, 60 + asz), fill=ACC)
        ch = (pub["name"] or "?").strip()[:1]
        d.text((70 + asz / 2, 60 + asz / 2), ch, font=font(64), fill=(255, 255, 255), anchor="mm")
    d.ellipse((70, 60, 70 + asz, 60 + asz), outline=(0, 0, 0, 20), width=1)

    # 名前・ホスト
    d.text((228, 74), trunc(d, pub["name"], font(46), 660), font=font(46), fill=INK)
    d.text((228, 134), trunc(d, pub["host"], font(26, False), 660), font=font(26, False), fill=INK3)
    d.text((228, 176), "累積（全期間）の番付スタッツ", font=font(24), fill=INK2)

    # 偏差値リング
    cx, cy, rr = 1058, 128, 74
    d.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), outline=(240, 227, 210), width=14)
    # 進捗弧
    import math
    frac = max(0.02, min(1, (score - 40) / 60))
    bbox = (cx - rr, cy - rr, cx + rr, cy + rr)
    d.arc(bbox, -90, -90 + frac * 360, fill=ACC, width=14)
    d.text((cx, cy - 6), str(score), font=font(56), fill=ACC2, anchor="mm")
    d.text((cx, cy + 34), "番付偏差値", font=font(18), fill=INK3, anchor="mm")
    d.text((cx, cy - rr - 18), label, font=font(26), fill=ACC2, anchor="mm")

    # スタッツ 10枠（5×2）
    stats = [
        ("登場日数", f"{pub['days']}日"),
        ("最高順位", f"{pub['best_rank']}位" if pub.get("best_rank") else "–"),
        ("平均順位", f"{pub['avg_rank']}位"),
        ("1位", f"{pub['top1']}回"),
        ("Top3", f"{pub['top3']}回"),
        ("Top10", f"{pub['top10']}回"),
        ("平均注目度", str(pub["avg_attention"])),
        ("平均いいね", str(pub["avg_likes"])),
        ("平均Restack", str(pub["avg_restacks"])),
        ("偏差値順位", f"{score_rank}位"),
    ]
    bx0, by0, bh, gap, rgap = 70, 248, 100, 18, 16
    bw = (W - 140 - gap * 4) / 5
    for i, (l, v) in enumerate(stats):
        bx = bx0 + (i % 5) * (bw + gap)
        by = by0 + (i // 5) * (bh + rgap)
        d.rounded_rectangle((bx, by, bx + bw, by + bh), radius=14, fill=(251, 249, 244), outline=(231, 224, 211), width=1)
        d.text((bx + bw / 2, by + 36), str(v), font=font(32), fill=INK, anchor="mm")
        d.text((bx + bw / 2, by + 74), l, font=font(18, False), fill=INK3, anchor="mm")

    # フッター
    fy = 556
    d.line((70, fy, W - 70, fy), fill=(231, 224, 211), width=1)
    try:
        icon = Image.open(ICON_PATH).convert("RGBA").resize((40, 40), Image.LANCZOS)
        img.paste(icon, (70, fy + 22), icon)
    except Exception:
        pass
    d.text((122, fy + 26), "Substack番付 つみあげウォッチ", font=font(24), fill=INK)
    d.text((W - 70, fy + 26), "ruku-practice.github.io/substack-banzuke-watch", font=font(20, False), fill=INK3, anchor="ra")
    return img


STUB = """<!DOCTYPE html><html lang="ja"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{name}｜Substack番付 つみあげウォッチ</title>
<meta name="description" content="{desc}">
<meta property="og:site_name" content="Substack番付 つみあげウォッチ">
<meta property="og:type" content="website">
<meta property="og:title" content="{ogtitle}">
<meta property="og:description" content="{desc}">
<meta property="og:image" content="{base}/cards/{host}.png">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:image:alt" content="{ogtitle}">
<meta property="og:url" content="{base}/p/{host}/">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{ogtitle}">
<meta name="twitter:description" content="{desc}">
<meta name="twitter:image" content="{base}/cards/{host}.png">
<meta name="twitter:image:alt" content="{ogtitle}">
<link rel="icon" href="{base}/favicon-32.png">
<script>location.replace("{base}/?p={host}#ranking");</script>
</head><body style="font-family:sans-serif;padding:24px">
<p><a href="{base}/?p={host}#ranking">{name} の番付スタッツを見る →</a></p>
</body></html>"""


def main():
    data = json.load(open(DATA_PATH, encoding="utf-8"))
    logos = json.load(open(LOGOS_PATH, encoding="utf-8")) if os.path.exists(LOGOS_PATH) else {}
    cum = next((p for p in data["periods"] if p["key"] == "cumulative"), data["periods"][0])
    pubs = cum["publishers"]
    n = len(pubs)
    period_days = cum["days"]

    # cumulative.publishers は既に Top10降順（同点 ruku→host）で並ぶ＝top10_rank=index+1
    scored = []
    for i, p in enumerate(pubs):
        if not p.get("host"):
            continue
        s = score_of(p, i + 1, n, period_days)
        scored.append((s, p))
    # 偏差値順位
    order = sorted(range(len(scored)), key=lambda k: -scored[k][0])
    rank_of = {}
    for r, k in enumerate(order):
        rank_of[scored[k][1]["host"]] = r + 1

    os.makedirs(CARDS_DIR, exist_ok=True)
    os.makedirs(P_DIR, exist_ok=True)

    # アバターを並列取得
    hosts = [p["host"] for _, p in scored]
    avatars = {}

    def _fetch(host):
        url = logos.get(host)
        avatars[host] = fetch_image(url) if url else None

    with ThreadPoolExecutor(max_workers=8) as ex:
        list(ex.map(_fetch, hosts))

    count = 0
    for s, p in scored:
        host = p["host"]
        label = score_label(s)
        srank = rank_of.get(host, "–")
        img = draw_card(p, s, label, srank, avatars.get(host))
        img.save(os.path.join(CARDS_DIR, host + ".png"), "PNG")

        desc = (f"偏差値{s}（{label}）/ 偏差値順位{srank}位 ・ Top10 {p['top10']}回 / "
                f"最高{p.get('best_rank') or '–'}位 / 平均{p['avg_rank']}位。"
                "Substack番付の日々のTOP30を累積した非公式スタッツ。")
        ogtitle = f"{p['name']}｜番付偏差値 {s}（{label}）"
        pdir = os.path.join(P_DIR, host)
        os.makedirs(pdir, exist_ok=True)
        with open(os.path.join(pdir, "index.html"), "w", encoding="utf-8") as f:
            f.write(STUB.format(name=H.escape(p["name"]), desc=H.escape(desc),
                                ogtitle=H.escape(ogtitle), host=host, base=BASE))
        count += 1

    print(f"Generated {count} publisher cards + pages into site/cards and site/p")


if __name__ == "__main__":
    main()
