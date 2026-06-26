#!/usr/bin/env bash
# 番付ハイランカー 日次更新（Cloud Run Job のエントリポイント）
# 必要env: GH_TOKEN（Secret Manager から注入。repo push 権限のあるトークン）
set -euo pipefail

REPO="ruku-practice/substack-banzuke-watch"
# Secret由来の末尾改行/空白を除去（URLに混入すると git が拒否する）
GH_TOKEN="$(printf '%s' "${GH_TOKEN:-}" | tr -d '\r\n[:space:]')"
ORIGIN="https://x-access-token:${GH_TOKEN}@github.com/${REPO}.git"
WORK=/work

echo "==================== $(date) banzuke daily (cloud run) start ===================="

rm -rf "$WORK"
git clone --quiet "$ORIGIN" "$WORK"
cd "$WORK"
git config user.name  "cloud-run-bot"
git config user.email "cloud-run-bot@users.noreply.github.com"

# --- データ収集・集計 ---
python3 scripts/scrape.py
python3 scripts/fetch_logos.py
python3 scripts/fetch_subscribers.py || true   # 購読者概数（参考値・失敗しても続行）
python3 scripts/build_site_data.py

# --- 蓄積データを main へコミット ---
git add data/banzuke_full.csv data/logos.json data/subscribers.json data/subscribers_history.json site/data.json
if git diff --staged --quiet; then
  echo "データ変更なし（本日分は未公開の可能性）"
else
  git commit -q -m "data: 自動更新 $(TZ=Asia/Tokyo date +%Y-%m-%d) [cloud-run]"
  git push --quiet origin HEAD:main
  echo "✓ data を main に push"
fi

# --- 発行元OGPカード/ページ生成（Pages配信のみ・mainにはコミットしない） ---
python3 scripts/make_publisher_pages.py

# --- site/ を gh-pages ブランチ(ルート)へ公開（毎回orphanで上書き） ---
PAGES=/tmp/pages
rm -rf "$PAGES"
cp -r site "$PAGES"
cd "$PAGES"
touch .nojekyll
git init -q
git checkout -q -b gh-pages
git config user.name  "cloud-run-bot"
git config user.email "cloud-run-bot@users.noreply.github.com"
git add -A
git commit -q -m "deploy $(TZ=Asia/Tokyo date +%Y-%m-%dT%H:%M)"
git push -f --quiet "$ORIGIN" gh-pages
echo "✓ site を gh-pages に公開"

echo "==================== $(date) banzuke daily done ===================="
