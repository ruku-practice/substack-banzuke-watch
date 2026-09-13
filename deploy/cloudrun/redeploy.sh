#!/usr/bin/env bash
# Cloud Run Job「banzuke-daily」のイメージを deploy/cloudrun/ から作り直す（run.sh の変更を反映）。既定はドライラン。
#
#   bash deploy/cloudrun/redeploy.sh            # ドライラン：現在の設定と実行するコマンドを表示するだけ
#   bash deploy/cloudrun/redeploy.sh --execute  # 実行：ソースからビルドしてジョブを更新
#
# scripts/*.py は実行時に main から clone されるので、push だけで反映される。
# このスクリプトが要るのは run.sh（イメージに焼き込み）を変えたときだけ。
# 2026-09-13: run.sh に「取れない日があっても公開までは進め、最後に鮮度チェックで失敗にする」を追加した。
set -euo pipefail
cd "$(dirname "$0")"

JOB=banzuke-daily
REGION=asia-northeast1
PROJECT=writeinfo2spreadsheet
FMT="yaml(spec.template.spec.template.spec.containers[0].image,spec.template.spec.template.spec.timeoutSeconds,spec.template.spec.template.spec.maxRetries,spec.template.spec.template.spec.containers[0].env[].name)"

echo "▶ 現在のジョブ設定（Secret は名前だけ表示）"
gcloud run jobs describe "$JOB" --region "$REGION" --project "$PROJECT" --format="$FMT"

CMD=(gcloud run jobs deploy "$JOB" --source . --region "$REGION" --project "$PROJECT")
echo "▶ 実行するコマンド: ${CMD[*]}"
if [ "${1:-}" != "--execute" ]; then
  echo "── ドライラン終了（何も変えていません）。反映するには: bash deploy/cloudrun/redeploy.sh --execute"
  exit 0
fi

"${CMD[@]}"
echo "▶ 反映後のジョブ設定（image が変わり、GH_TOKEN・timeout 1200・maxRetries が残っていれば合格）"
gcloud run jobs describe "$JOB" --region "$REGION" --project "$PROJECT" --format="$FMT"
