#!/usr/bin/env bash
# ============================================================================
# deploy.sh — build the dashboard and publish it to S3 + CloudFront.
#
# Deploys ONLY the static frontend. No compute, no database, no pipeline.
# Safe to re-run: it is idempotent, and a failed upload leaves the previous
# deploy serving (S3 sync never deletes until the stack succeeds).
#
# Usage:
#   ./scripts/deploy.sh                    # dev stack, build + deploy
#   ./scripts/deploy.sh --skip-build       # deploy the existing dist/
#   ENV=prod ./scripts/deploy.sh           # prod stack
#
# Teardown: ./scripts/teardown.sh
# ============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$REPO_ROOT/frontend"
STACK_NAME="${STACK_NAME:-biblio-trend-dev}"
ENV_NAME="${ENV:-dev}"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
SKIP_BUILD=0

for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    -h|--help)
      sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 0. Pre-flight. Everything here fails fast and explains the fix, because a
#    half-configured deploy is far more confusing than a refused one.
# ---------------------------------------------------------------------------
say "Pre-flight checks"

command -v aws >/dev/null 2>&1 || fail \
  "AWS CLI not found. Install it: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"

command -v sam >/dev/null 2>&1 || fail \
  "AWS SAM CLI not found. Install it: https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html"

aws sts get-caller-identity --region "$REGION" >/dev/null 2>&1 || fail \
  "No usable AWS credentials. Configure them with 'aws configure' (or SSO)
   and confirm the account is the one you intend to bill."

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text --region "$REGION")"
CALLER_ARN="$(aws sts get-caller-identity --query Arn --output text --region "$REGION")"
echo "    account : $ACCOUNT_ID"
echo "    identity: $CALLER_ARN"
echo "    region  : $REGION"
echo "    stack   : $STACK_NAME"

# ---------------------------------------------------------------------------
# 1. Build the dashboard.
# ---------------------------------------------------------------------------
if [ "$SKIP_BUILD" -eq 0 ]; then
  say "Building the frontend"
  npm --prefix "$FRONTEND_DIR" run build
else
  say "Skipping build (--skip-build)"
  [ -f "$FRONTEND_DIR/dist/index.html" ] || fail \
    "No build found at $FRONTEND_DIR/dist. Run without --skip-build."
fi

[ -f "$FRONTEND_DIR/dist/index.html" ] || fail "dist/index.html missing after build."
[ -d "$FRONTEND_DIR/dist/snapshots" ] || fail \
  "dist/snapshots missing. The build's prebuild step copies snapshots; run:
     make snapshots && npm --prefix frontend run build"

# ---------------------------------------------------------------------------
# 2. Deploy (or update) the infrastructure stack.
# ---------------------------------------------------------------------------
say "Deploying the CloudFormation stack"
sam deploy \
  --template-file "$REPO_ROOT/template.yaml" \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --capabilities CAPABILITY_IAM \
  --resolve-s3 \
  --no-confirm-changeset \
  --no-fail-on-empty-changeset \
  --tags Project=biblio-trend Environment="$ENV_NAME" CostCenter=free-tier

BUCKET="$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue" --output text)"
DIST_ID="$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" --output text)"
SITE_URL="$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='SiteUrl'].OutputValue" --output text)"

[ -n "$BUCKET" ] || fail "Could not read BucketName from the stack outputs."
[ -n "$DIST_ID" ] || fail "Could not read DistributionId from the stack outputs."

echo "    bucket      : $BUCKET"
echo "    distribution: $DIST_ID"

# ---------------------------------------------------------------------------
# 3. Upload. Cache-Control is set per asset class — getting this wrong is the
#    classic static-site bug: an immutable-cached index.html pins returning
#    visitors to a stale build forever.
# ---------------------------------------------------------------------------
DIST_DIR="$FRONTEND_DIR/dist"

say "Uploading hashed assets (immutable, 1 year)"
# Vite fingerprints these filenames, so a new build produces new URLs and the
# long cache can never serve stale bytes for a changed file.
aws s3 sync "$DIST_DIR/assets" "s3://$BUCKET/assets" \
  --region "$REGION" --only-show-errors \
  --cache-control "public,max-age=31536000,immutable"

say "Uploading snapshots (short cache)"
# Data refreshes per pipeline run; a 5-minute TTL keeps it current without
# re-fetching a few hundred KB on every navigation.
if [ -d "$DIST_DIR/snapshots" ]; then
  aws s3 sync "$DIST_DIR/snapshots" "s3://$BUCKET/snapshots" \
    --region "$REGION" --only-show-errors \
    --cache-control "public,max-age=300"
fi

say "Uploading media and static files"
for special in "$DIST_DIR"/*.mp4 "$DIST_DIR"/*.png "$DIST_DIR"/*.svg; do
  [ -e "$special" ] || continue
  aws s3 cp "$special" "s3://$BUCKET/$(basename "$special")" \
    --region "$REGION" --only-show-errors \
    --cache-control "public,max-age=86400"
done

say "Uploading app files"
aws s3 sync "$DIST_DIR" "s3://$BUCKET" \
  --region "$REGION" --only-show-errors \
  --exclude "assets/*" --exclude "snapshots/*" \
  --exclude "*.mp4" --exclude "*.png" --exclude "*.svg" \
  --cache-control "public,max-age=600"

# index.html and the run manifest must never be cached: they are the entry
# points that point at the currently-live hashed bundle.
say "Setting no-cache on entry points"
aws s3 cp "$DIST_DIR/index.html" "s3://$BUCKET/index.html" \
  --region "$REGION" --only-show-errors \
  --cache-control "no-cache,no-store,must-revalidate" \
  --content-type "text/html; charset=utf-8"
if [ -f "$DIST_DIR/snapshots-run.json" ]; then
  aws s3 cp "$DIST_DIR/snapshots-run.json" "s3://$BUCKET/snapshots-run.json" \
    --region "$REGION" --only-show-errors \
    --cache-control "no-cache,no-store,must-revalidate" \
    --content-type "application/json"
fi

# Remove objects whose build output no longer exists (old hashed bundles).
say "Pruning objects no longer in the build"
aws s3 sync "$DIST_DIR" "s3://$BUCKET" --delete \
  --region "$REGION" --only-show-errors \
  --exclude "assets/*" --exclude "snapshots/*" --exclude "index.html" \
  --exclude "snapshots-run.json" --exclude "*.mp4" --exclude "*.png" --exclude "*.svg"
aws s3 sync "$DIST_DIR/assets" "s3://$BUCKET/assets" --delete \
  --region "$REGION" --only-show-errors

# ---------------------------------------------------------------------------
# 4. Invalidate so the new index.html is served immediately.
# ---------------------------------------------------------------------------
say "Invalidating CloudFront"
INVALIDATION="$(aws cloudfront create-invalidation \
  --distribution-id "$DIST_ID" --paths "/*" \
  --query 'Invalidation.Id' --output text)"
echo "    invalidation: $INVALIDATION"

say "Deployed"
cat <<EOF

    URL: $SITE_URL

    Note: a brand-new distribution takes a few minutes to propagate to
    every edge location. The first request may 403 briefly.

    Re-deploy after a code change:
      ./scripts/deploy.sh

    Remove every AWS resource this created (returns the account to \$0):
      ./scripts/teardown.sh --stack "$STACK_NAME"

EOF
