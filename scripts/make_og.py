#!/usr/bin/env python3
"""SNSシェア用の og-image.png（1200x630）を生成する。日本語フォントが要るためローカルで実行。"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.normpath(os.path.join(HERE, "..", "site"))
ICON = os.path.join(SITE, "icon.png")
OUT = os.path.join(SITE, "og-image.png")

FONT = "/System/Library/Fonts/Hiragino Sans GB.ttc"
def f(sz, idx=1):
    try: return ImageFont.truetype(FONT, sz, index=idx)
    except Exception: return ImageFont.truetype(FONT, sz, index=0)

W, H = 1200, 630
PAPER = (245, 241, 234)
INK = (33, 29, 24)
INK2 = (92, 84, 72)
ACC = (239, 96, 17)

img = Image.new("RGB", (W, H), PAPER)
d = ImageDraw.Draw(img)
# 上部アクセント帯
d.rectangle([0, 0, W, 8], fill=ACC)
# 背景ゴースト「番」
gh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
gd = ImageDraw.Draw(gh)
gd.text((W - 70, H // 2), "番", font=f(560, 1), fill=(236, 96, 13, 20), anchor="rm")
img.paste(Image.alpha_composite(img.convert("RGBA"), gh).convert("RGB"), (0, 0))
d = ImageDraw.Draw(img)

# アイコン
icon = Image.open(ICON).convert("RGBA").resize((150, 150), Image.LANCZOS)
img.paste(icon, (80, 90), icon)

# kicker
d.text((250, 104), "SUBSTACK BANZUKE ・ 非公式スタッツ", font=f(26, 1), fill=ACC)
# タイトル2行
d.text((248, 138), "Substack番付", font=f(86, 1), fill=INK)
d.text((248, 232), "つみあげウォッチ", font=f(86, 1), fill=ACC)

# リード
lead1 = "番付の“その日”を、“つみあげ”で見る。"
lead2 = "日々のTOP30を累積し、続けて伸びている書き手を発行元別に見える化。"
d.text((84, 400), lead1, font=f(36, 1), fill=INK)
d.text((84, 456), lead2, font=f(30, 0), fill=INK2)

# フッターURL
d.line([84, 545, W - 84, 545], fill=(231, 224, 211), width=2)
d.text((84, 562), "ruku-practice.github.io/substack-banzuke-watch", font=f(26, 0), fill=INK2)

img.save(OUT, "PNG")
print("wrote", OUT, os.path.getsize(OUT) // 1024, "KB")
