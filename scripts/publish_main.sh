#!/usr/bin/env bash
# 手元の main（修正コード＋取り直しデータ）を公開する。既定はドライラン＝何も外へ出さない。
#
#   bash scripts/publish_main.sh            # ドライラン：push するコミットと鮮度チェックの結果を表示するだけ
#   bash scripts/publish_main.sh --execute  # 実行：main へ push → Actions を force で起動（gh-pages 再公開＋鮮度チェック）
#
# 前提: gh 認証済み・ネットワーク可（Claude から動かすときはサンドボックス外で）
# 2026-09-13 作成（9/6〜の更新停止の修理を公開するため）。以後のコード修正の公開にも使える。
set -euo pipefail
cd "$(dirname "$0")/.."

EXECUTE=0
[ "${1:-}" = "--execute" ] && EXECUTE=1
REPO="ruku-practice/substack-banzuke-watch"
DATA_FILES=(data/banzuke_full.csv data/logos.json data/subscribers.json data/subscribers_history.json site/data.json)

[ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || { echo "✗ main ブランチで実行してください"; exit 1; }
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "✗ 未コミットの変更があります（先にコミットしてください）"; git status --short; exit 1
fi

git fetch -q origin
AHEAD=$(git rev-list --count origin/main..HEAD)
BEHIND=$(git rev-list --count HEAD..origin/main)
echo "▶ 手元の main は origin より ${AHEAD} 件先行 / ${BEHIND} 件遅れ"
git log --oneline origin/main..HEAD
[ "$AHEAD" -gt 0 ] || { echo "✓ push するものはありません"; exit 0; }

if [ "$BEHIND" -gt 0 ]; then
  echo "▶ その間に origin/main へ入った自動更新:"
  git log --oneline HEAD..origin/main
  if [ "$EXECUTE" -eq 1 ]; then
    # 自動更新はデータファイルしか触らない。衝突したら手元（取り直し済み）を採用し、増えた日を足してから再集計する。
    git rebase -X theirs origin/main
    python3 scripts/scrape.py || true
    python3 scripts/fetch_subscribers.py || true
    python3 scripts/build_site_data.py
    git add "${DATA_FILES[@]}"
    git diff --cached --quiet || git commit -q -m "data: 取り直しの追補 $(TZ=Asia/Tokyo date +%F) [fix]"
  else
    echo "  （--execute 時は rebase → 増えた日の追加取得 → 再集計してから push します）"
  fi
fi

echo "▶ 鮮度チェック（手元のデータ）"
python3 scripts/check_freshness.py || { echo "✗ 手元のデータが古いので push しません"; exit 1; }

if [ "$EXECUTE" -eq 0 ]; then
  echo "── ドライラン終了（push していません）。公開するには: bash scripts/publish_main.sh --execute"
  exit 0
fi

git push origin HEAD:main
gh workflow run daily.yml -R "$REPO" -f force=true
sleep 8
gh run list -R "$REPO" --workflow daily.yml -L 1
echo "✓ push 済み・Actions 起動済み。公開サイトへの反映を待ちます（最大30分）"

# --- 反映の確認：公開中の data.json の最新日と、app.js のキャッシュバスター ---
SITE="https://ruku-practice.github.io/substack-banzuke-watch"
python3 scripts/check_freshness.py --data-url "$SITE/data.json" --retries 30 --retry-wait 60 \
  || { echo "✗ 30分待っても公開サイトの最新日が昨日に届きません。gh run list -R $REPO --workflow daily.yml -L 1 で Actions を確認"; exit 1; }
echo "▶ 公開中 data.json の date_range:"
curl -s "$SITE/data.json?t=$(date +%s)" | python3 -c "import json,sys; print(json.load(sys.stdin)['date_range'])"
echo "▶ 公開中 index.html の app.js 版:"
curl -s "$SITE/index.html?t=$(date +%s)" | grep -o 'app.js?v=[0-9-]*'
echo "✓ 公開サイトに反映済み。Actions の最後の「鮮度チェック」が緑かも確認: gh run list -R $REPO --workflow daily.yml -L 1"
