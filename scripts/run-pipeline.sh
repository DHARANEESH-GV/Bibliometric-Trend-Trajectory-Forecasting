#!/usr/bin/env bash
# ============================================================================
# run-pipeline.sh — submit a Batch job on demand and follow its logs.
#
# The weekly schedule exists, but you will want to trigger a run yourself
# while setting things up. This submits the job, waits for it, and prints the
# log stream so a failure is readable rather than a bare job id.
#
# Usage:
#   ./scripts/run-pipeline.sh                     # mode=stats (rebuild)
#   ./scripts/run-pipeline.sh --mode snapshots    # only the dashboard JSON
#   ./scripts/run-pipeline.sh --mode domain --domain quantum_computing
#   ./scripts/run-pipeline.sh --no-follow         # submit and return
# ============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK_NAME="${PIPELINE_STACK:-biblio-trend-pipeline-dev}"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
MODE="stats"
DOMAIN=""
FOLLOW=1

while [ $# -gt 0 ]; do
  case "$1" in
    --mode) MODE="${2:?--mode needs a value}"; shift 2 ;;
    --domain) DOMAIN="${2:?--domain needs a value}"; shift 2 ;;
    --no-follow) FOLLOW=0; shift ;;
    --stack) STACK_NAME="${2:?--stack needs a value}"; shift 2 ;;
    -h|--help) sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

command -v aws >/dev/null 2>&1 || fail "AWS CLI not found."
aws sts get-caller-identity --region "$REGION" >/dev/null 2>&1 || fail "No usable AWS credentials."

QUEUE="$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='JobQueueArn'].OutputValue" --output text)"
JOB_DEF="$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='JobDefinitionArn'].OutputValue" --output text)"
LOG_GROUP="$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='LogGroupName'].OutputValue" --output text)"

[ -n "$QUEUE" ] || fail "Could not read JobQueueArn. Is the pipeline stack deployed?"
[ -n "$JOB_DEF" ] || fail "Could not read JobDefinitionArn."

[ "$MODE" = "domain" ] && [ -z "$DOMAIN" ] && fail "--mode domain requires --domain <slug>"

# Container overrides carry the mode; the job definition's default is stats.
ENV_OVERRIDES="[{\"name\":\"BIBLIO_MODE\",\"value\":\"$MODE\"}"
if [ -n "$DOMAIN" ]; then
  ENV_OVERRIDES="$ENV_OVERRIDES,{\"name\":\"BIBLIO_DOMAIN\",\"value\":\"$DOMAIN\"}"
fi
ENV_OVERRIDES="$ENV_OVERRIDES]"

say "Submitting job (mode=$MODE${DOMAIN:+, domain=$DOMAIN})"
JOB_ID="$(aws batch submit-job --region "$REGION" \
  --job-name "biblio-$(date -u +%Y%m%dT%H%M%SZ)" \
  --job-queue "$QUEUE" \
  --job-definition "$JOB_DEF" \
  --container-overrides "{\"environment\": $ENV_OVERRIDES}" \
  --query 'jobId' --output text)"
echo "    job id: $JOB_ID"

if [ "$FOLLOW" -eq 0 ]; then
  echo
  echo "    Follow with:"
  echo "      aws logs tail $LOG_GROUP --follow --region $REGION"
  exit 0
fi

say "Waiting for the job (this can take a long time — the pipeline is rate-limited)"
# `batch wait` has a 30s poll ceiling that is fine here; the long part is the
# job itself. We poll explicitly so we can report status transitions.
LAST=""
for _ in $(seq 1 720); do   # 720 * 30s = 6 hours, matching the job timeout
  STATUS="$(aws batch describe-jobs --jobs "$JOB_ID" --region "$REGION" \
    --query 'jobs[0].status' --output text)"
  if [ "$STATUS" != "$LAST" ]; then
    echo "    $(date -u +%H:%M:%S)  $STATUS"
    LAST="$STATUS"
  fi
  case "$STATUS" in
    SUCCEEDED) say "Job succeeded"; break ;;
    FAILED)
      say "Job FAILED"
      REASON="$(aws batch describe-jobs --jobs "$JOB_ID" --region "$REGION" \
        --query 'jobs[0].container.reason' --output text)"
      echo "    reason: $REASON"
      echo
      echo "    Recent logs:"
      aws logs tail "$LOG_GROUP" --region "$REGION" --since 1h 2>/dev/null | tail -n 40 || true
      exit 1
      ;;
  esac
  sleep 30
done

[ "$LAST" = "SUCCEEDED" ] || fail "Timed out waiting for the job (last status: $LAST)."

say "Recent logs"
aws logs tail "$LOG_GROUP" --region "$REGION" --since 3h 2>/dev/null | tail -n 30 || true

cat <<EOF

    The run wrote snapshots to the snapshots bucket. To publish them:

      ./scripts/sync-snapshots.sh
      ./scripts/deploy.sh --skip-build

EOF
