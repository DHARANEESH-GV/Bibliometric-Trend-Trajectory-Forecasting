#!/usr/bin/env bash
# ============================================================================
# sync-snapshots.sh — pull the newest snapshot from the pipeline bucket into
# the repo, so the website can be rebuilt against it.
#
# The pipeline (AWS Batch) and the website (CloudFront) are separate stacks
# with separate buckets. Snapshots land in the pipeline bucket; the site
# reads from the site bucket. This is the bridge between them.
#
# Usage:
#   ./scripts/sync-snapshots.sh              # newest snapshot only
#   ./scripts/sync-snapshots.sh --all        # every snapshot in the bucket
# ============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIPELINE_STACK="${PIPELINE_STACK:-biblio-trend-pipeline-dev}"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
ALL=0

for arg in "$@"; do
  case "$arg" in
    --all) ALL=1 ;;
    -h|--help) sed -n '2,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

command -v aws >/dev/null 2>&1 || fail "AWS CLI not found."

BUCKET="$(aws cloudformation describe-stacks --stack-name "$PIPELINE_STACK" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='SnapshotsBucketName'].OutputValue" --output text 2>/dev/null || true)"
[ -n "$BUCKET" ] && [ "$BUCKET" != "None" ] || fail \
  "Could not find the pipeline stack '$PIPELINE_STACK'. Deploy it first:
     ./scripts/deploy-pipeline.sh"

say "Snapshots bucket: $BUCKET"

# The pipeline uploads runs as snapshots/<run_id>/. Take the newest by name:
# run ids are sortable UTC stamps (settings.yaml run_id_format).
if [ "$ALL" -eq 1 ]; then
  say "Syncing every snapshot run"
  aws s3 sync "s3://$BUCKET/snapshots" "$REPO_ROOT/snapshots" \
    --region "$REGION" --only-show-errors
else
  LATEST="$(aws s3 ls "s3://$BUCKET/snapshots/" --region "$REGION" 2>/dev/null \
    | awk '$1=="PRE"{print $2}' | tr -d '/' | sort | tail -1)"
  [ -n "$LATEST" ] || fail "No snapshot runs found in s3://$BUCKET/snapshots/.
   Run the pipeline first: ./scripts/run-pipeline.sh"

  say "Syncing newest run: $LATEST"
  aws s3 sync "s3://$BUCKET/snapshots/$LATEST" "$REPO_ROOT/snapshots/$LATEST" \
    --region "$REGION" --only-show-errors
fi

NEWEST="$(ls -1d "$REPO_ROOT"/snapshots/*/ 2>/dev/null | sort | tail -1)"
[ -n "$NEWEST" ] || fail "No snapshots on disk after sync."
say "Local snapshots now:
    $NEWEST"

cat <<EOF

    Publish the site against this data:

      make deploy

EOF
