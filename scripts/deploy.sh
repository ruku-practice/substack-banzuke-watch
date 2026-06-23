#!/usr/bin/env bash
# Substack番付 つみあげウォッチ — GitHub 公開＆Pages有効化スクリプト
#
# 前提: gh CLI がインストール済み＆認証済み（brew install gh && gh auth login）
# 使い方:  bash scripts/deploy.sh [リポジトリ名]
#   例:    bash scripts/deploy.sh substack-banzuke-watch
set -euo pipefail

REPO_NAME="${1:-substack-banzuke-watch}"
cd "$(dirname "$0")/.."

if ! command -v gh >/dev/null 2>&1; then
  echo "✗ gh CLI が見つかりません。先に: brew install gh && gh auth login"
  exit 1
fi
gh auth status >/dev/null 2>&1 || { echo "✗ gh 未認証です。gh auth login を実行してください"; exit 1; }

USER="$(gh api user --jq .login)"
echo "▶ GitHubユーザー: $USER / リポジトリ名: $REPO_NAME"

# 1) リポジトリ作成（公開）＋ push
if gh repo view "$USER/$REPO_NAME" >/dev/null 2>&1; then
  echo "▶ 既存リポジトリを使用: $USER/$REPO_NAME"
  git remote remove origin 2>/dev/null || true
  git remote add origin "https://github.com/$USER/$REPO_NAME.git"
  git push -u origin main
else
  echo "▶ リポジトリを新規作成して push します"
  gh repo create "$REPO_NAME" --public --source=. --remote=origin --push \
    --description "Substack番付 つみあげウォッチ — 発行元別ランキングの非公式スタッツ"
fi

# 2) GitHub Pages を「GitHub Actions」ソースで有効化
echo "▶ GitHub Pages を有効化（source: GitHub Actions）"
gh api -X POST "repos/$USER/$REPO_NAME/pages" \
  -f "build_type=workflow" >/dev/null 2>&1 \
  || gh api -X PUT "repos/$USER/$REPO_NAME/pages" -f "build_type=workflow" >/dev/null 2>&1 \
  || echo "  （Pages設定は初回ワークフロー実行時に確定する場合があります）"

# 3) 初回ワークフローを起動（収集→集計→デプロイ）
echo "▶ 初回の自動更新ワークフローを起動"
gh workflow run daily.yml || echo "  （Actionsタブから daily-update を手動実行してください）"

echo ""
echo "✅ 完了。数分後に公開されます:"
echo "   https://$USER.github.io/$REPO_NAME/"
echo "   進捗: gh run watch  または リポジトリの Actions タブ"
