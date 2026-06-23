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
scripts/scrape.py            # substackbanzuke.com から未取得日を収集 → data/banzuke_full.csv
scripts/build_site_data.py   # 集計 → site/data.json
site/                        # 静的サイト（GitHub Pages で配信）
.github/workflows/daily.yml  # 毎朝の自動実行（cron）
```

- **名寄せ**：発行元はSubstackの **URLホスト** で同一人物として合算（タグライン変更にも追従）。
- **自己修復**：実行が遅延・スキップされても、未取得日を翌日以降にまとめて取得（バックフィル方式）。

## ローカルで動かす

```bash
python3 scripts/scrape.py            # データ更新（未取得日のみ）
python3 scripts/build_site_data.py   # data.json 生成
python3 -m http.server -d site 8000  # http://localhost:8000 で確認
```

## データ出典

データ提供：[Substack番付（substackbanzuke.com）](https://substackbanzuke.com/)。
本サイトはそのデータを個人が集計した **非公式** のスタッツサイトです。
