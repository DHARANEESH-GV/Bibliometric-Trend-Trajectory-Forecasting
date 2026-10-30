#!/usr/bin/env bash
# ============================================================================
# teardown.sh — remove every AWS resource the dashboard stack created.
#
# The master plan (§13) promises teardown "returns the account to true $0".
# Deleting a CloudFormation stack does NOT empty a non-empty S3 bucket, so
# the bucket must be emptied first or the whole delete fails and leaves
# resources (and a billed bucket) behind.
#
# Usage:
#   ./scripts/teardown.sh                  # PROMPTS before deleting
#   ./scripts/teardown.sh --yes            # no prompt (CI / deliberate)
#   ./scripts/teardown.sh --stack other    # different stack name
# ============================================================================
set -euo pipefail

STACK_NAME="${STACK_NAME:-biblio-trend-dev}"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
ASSUME_YES=0

while [ $# -gt 0 ]; do
  case "$1" in
    --yes|-y) ASSUME_YES=1; shift ;;
    --stack) STACK_NAME="${2:?--stack needs a value}"; shift 2 ;;
    -h|--help) sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

command -v aws >/dev/null 2>&1 || fail "AWS CLI not found."

say "Pre-flight"
aws sts get-caller-identity --region "$REGION" >/dev/null 2>&1 || fail \
  "No usable AWS credentials."
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text --region "$REGION")"
echo "    account: $ACCOUNT_ID"
echo "    stack  : $STACK_NAME"

if ! aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" >/dev/null 2>&1; then
  say "Stack '$STACK_NAME' does not exist in $REGION — nothing to do."
  exit 0
fi

BUCKET="$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue" --output text)"
DIST_ID="$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" --output text)"

cat <<EOF

    About to permanently delete:

      stack        $STACK_NAME
      bucket       ${BUCKET:-<not found>}  (and every object inside it)
      distribution ${DIST_ID:-<not found>}

    This cannot be undone. The site will stop serving.

EOF

if [ "$ASSUME_YES" -ne 1 ]; then
  if [ ! -t 0 ]; then
    fail "Refusing to delete without confirmation. Re-run with --yes."
  fi
  printf '    Type the stack name to confirm: '
  read -r CONFIRM
  [ "$CONFIRM" = "$STACK_NAME" ] || fail "Confirmation did not match. Aborted."
fi

# 1. Empty the bucket. CloudFormation cannot delete a non-empty bucket, so
#    skipping this is the single most common reason a teardown half-fails.
if [ -n "$BUCKET" ] && aws s3api head-bucket --bucket "$BUCKET" --region "$REGION" 2>/dev/null; then
  say "Emptying bucket $BUCKET"
  # Delete current objects and every non-current version / delete marker.
  aws s3 rm "s3://$BUCKET" --recursive --region "$REGION" --only-show-errors
  VERSIONS="$(aws s3api list-object-versions --bucket "$BUCKET" --region "$REGION" \
    --query '{Objects: Versions[].{Key:Key,VersionId:VersionId}}' --output json 2>/dev/null || echo '{"Objects":null}')"
  if [ "$(printf '%s' "$VERSIONS" | tr -d '[:space:]')" != '{"Objects":null}' ]; then
    printf '%s' "$VERSIONS" > /tmp/biblio-versions.json
    aws s3api delete-objects --bucket "$BUCKET" --region "$REGION" \
      --delete file:///tmp/biblio-versions.json >/dev/null 2>&1 || true
    rm -f /tmp/biblio-versions.json
  fi
else
  echo "    (bucket already gone)"
fi

# 2. Disable and delete the distribution. CloudFormation disables it first,
#    but an interrupted deploy can leave it enabled, which blocks deletion.
if [ -n "$DIST_ID" ]; then
  say "Disabling CloudFront distribution $DIST_ID"
  ETAG="$(aws cloudfront get-distribution-config --id "$DIST_ID" \
    --query 'ETag' --output text 2>/dev/null || echo '')"
  if [ -n "$ETAG" ]; then
    aws cloudfront get-distribution-config --id "$DIST_ID" \
      --query 'DistributionConfig' --output json > /tmp/biblio-dist.json 2>/dev/null || true
    if [ -s /tmp/biblio-dist.json ]; then
      python3 - <<'PY' > /tmp/biblio-dist-disabled.json 2>/dev/null || cp /tmp/biblio-dist.json /tmp/biblio-dist-disabled.json
import json
with open('/tmp/biblio-dist.json') as f:
    cfg = json.load(f)
cfg['Enabled'] = False
print(json.dumps(cfg))
PY
      aws cloudfront update-distribution --id "$DIST_ID" \
        --distribution-config file:///tmp/biblio-dist-disabled.json \
        --if-match "$ETAG" >/dev/null 2>&1 || true
    fi
    rm -f /tmp/biblio-dist.json /tmp/biblio-dist-disabled.json
  fi
fi

# 3. Delete the stack itself.
say "Deleting CloudFormation stack"
aws cloudformation delete-stack --stack-name "$STACK_NAME" --region "$REGION"
aws cloudformation wait stack-delete-complete --stack-name "$STACK_NAME" --region "$REGION" \
  || fail "Stack deletion did not complete. Check the CloudFormation console for the
   blocking resource (usually a non-empty bucket or an enabled distribution)."

# 4. Verify.
say "Verifying"
if aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" >/dev/null 2>&1; then
  fail "Stack still present after delete."
fi
if [ -n "$BUCKET" ] && aws s3api head-bucket --bucket "$BUCKET" --region "$REGION" 2>/dev/null; then
  fail "Bucket $BUCKET still exists."
fi

cat <<EOF

    Teardown complete. Stack, bucket and distribution are gone.

    Two things this script does NOT remove, by design:
      - The SAM deployment artifact bucket (aws-sam-cli-managed-*). It is
        tiny and reused by future deploys.
      - The optional \$1 cost budget, if you created one with an email.
        Delete it in the Billing console if you want it gone.

EOF
