# Substack番付 つみあげウォッチ

Substack番付（[substackbanzuke.com](https://substackbanzuke.com/)）の日々のTOP30を **つみあげ集計** して、
**発行元（書き手）別ランキング** を期間別（累積 / 今月 / 直近30日 / 直近7日 / 月別）で見られる
非公式スタッツサイトです。

- 📈 **書く人へ**：自分や憧れの書き手が、通算でどれだけ上位常連かが分かる
- 🔎 **読む人へ**：継続的に良い記事を出している書き手を見つけてフォローできる
- 📊 **番付トレンド**：順位別の平均注目度・順位帯別の平均指標・カテゴリ別ランキング

> 「お悩み解決サイト選手権」応募作品。

## 仕組み

毎朝 GitHub Actions が自動で番付を収集 → 集計 → サイトを更新します（PCの起動は不要）。

```
scripts/scrape.py            # substackbanzuke.com から未取得日（昨日まで）を収集 → data/banzuke_full.csv
scripts/build_site_data.py   # 集計 → site/data.json
scripts/check_freshness.py   # 鮮度の見張り：最新日が昨日より古ければ失敗にする
site/                        # 静的サイト（GitHub Pages で配信）
.github/workflows/daily.yml  # 毎朝の自動実行（cron）＋最後に鮮度チェック
tests/                       # 解析の検査（python3 -m unittest discover -s tests）
```

- **名寄せ**：発行元はSubstackの **URLホスト** で同一人物として合算（タグライン変更にも追従）。
- **自己修復**：実行が遅延・スキップされても、未取得日を翌日以降にまとめて取得（バックフィル方式）。
- **黙って止まらない**：取得できない日が残ると `scrape.py` は終了コード2、ページの形が変わると3で終わり、毎朝のワークフローは最後の鮮度チェックで失敗（赤）になります。
- **欠測の表示**：取れなかった日の購読者数（後から遡れない）と、2026-09-06 以降のカテゴリ（元サイトが表示を終了）は、0や「未設定」にせず「欠測」として表示します。

## ローカルで動かす

```bash
python3 scripts/scrape.py            # データ更新（未取得日のみ）
python3 scripts/build_site_data.py   # data.json 生成
python3 -m http.server -d site 8000  # http://localhost:8000 で確認
```

## データ出典

データ提供：[Substack番付（substackbanzuke.com）](https://substackbanzuke.com/)。
本サイトはそのデータを個人が集計した **非公式** のスタッツサイトです。

## Python環境構築（ローカル）

本番（Cloud Run Job）は `python:3.12-slim`。ローカルで動かす場合は venv を推奨：

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

※2026-07-12 開発部が `scripts/make_publisher_pages.py` / `make_og.py` の依存（Pillow）から
`requirements.txt` を新規作成（非破壊・既存ファイルなし）。他のscriptsは標準ライブラリのみ。
