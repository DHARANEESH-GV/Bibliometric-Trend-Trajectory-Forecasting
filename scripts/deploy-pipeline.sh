#!/usr/bin/env bash
# ============================================================================
# deploy-pipeline.sh — build the pipeline image and deploy AWS Batch.
#
# This is the "produce the data" half. It is SEPARATE from ./scripts/deploy.sh
# (which publishes the website). Deploy the site first; run this when you want
# AWS itself to refresh the snapshots.
#
# Order of operations, and why:
#   1. deploy the Batch stack with a placeholder image  (the repo must exist
#      before an image can be pushed into it)
#   2. build + push the image into that repo
#   3. update the stack with the real image URI
#
# Usage:
#   ./scripts/deploy-pipeline.sh                 # full: build + push + deploy
#   ./scripts/deploy-pipeline.sh --skip-build    # reuse :latest already in ECR
#   ./scripts/deploy-pipeline.sh --no-schedule   # manual triggers only
# ============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK_NAME="${PIPELINE_STACK:-biblio-trend-pipeline-dev}"
ENV_NAME="${ENV:-dev}"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
SKIP_BUILD=0
SCHEDULE="true"

for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --no-schedule) SCHEDULE="false" ;;
    -h|--help) sed -n '2,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

say "Pre-flight"
for cmd in aws docker; do
  command -v "$cmd" >/dev/null 2>&1 || fail "$cmd not found in PATH."
done

aws sts get-caller-identity --region "$REGION" >/dev/null 2>&1 || fail \
  "No usable AWS credentials. Run 'aws configure' first."

docker info >/dev/null 2>&1 || fail \
  "The Docker daemon is not running. Start it, or pass --skip-build to reuse
   the image already in ECR."

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text --region "$REGION")"
echo "    account: $ACCOUNT_ID"
echo "    region : $REGION"
echo "    stack  : $STACK_NAME"

# ---------------------------------------------------------------------------
# 1. Discover public subnets in the default VPC.
#
# A public subnet routes to an Internet Gateway, so the Fargate task can
# reach ECR and OpenAlex with NO NAT Gateway (~$32/month avoided). This is the
# single most expensive mistake available in this architecture.
# ---------------------------------------------------------------------------
say "Looking up the default VPC"
VPC_ID="$(aws ec2 describe-vpcs --region "$REGION" \
  --filters Name=is-default,Values=true \
  --query 'Vpcs[0].VpcId' --output text 2>/dev/null || echo 'None')"

if [ -z "$VPC_ID" ] || [ "$VPC_ID" = "None" ]; then
  fail "No default VPC found in $REGION.
   Either create one (aws ec2 create-default-vpc) or pass subnet IDs via the
   SUBNETS environment variable. Public subnets are required so the job has
   outbound internet without a NAT Gateway."
fi
echo "    vpc: $VPC_ID"

if [ -n "${SUBNETS:-}" ]; then
  SUBNET_LIST="$SUBNETS"
  echo "    using SUBNETS override: $SUBNET_LIST"
else
  SUBNET_LIST="$(aws ec2 describe-subnets --region "$REGION" \
    --filters "Name=vpc-id,Values=$VPC_ID" "Name=map-public-ip-on-launch,Values=true" \
    --query 'Subnets[].SubnetId' --output text | tr '\t' ',')"
  [ -n "$SUBNET_LIST" ] || fail \
    "No public subnets in $VPC_ID. Set SUBNETS=<id,id> to choose them yourself."
  echo "    public subnets: $SUBNET_LIST"
fi

# ---------------------------------------------------------------------------
# 2. Deploy the stack so the ECR repository exists.
# ---------------------------------------------------------------------------
say "Deploying the Batch stack (initial)"
sam deploy \
  --template-file "$REPO_ROOT/cloudformation/pipeline-batch.yaml" \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --capabilities CAPABILITY_IAM \
  --resolve-s3 \
  --no-confirm-changeset \
  --parameter-overrides \
      "SubnetIds=$SUBNET_LIST" \
      "EnableSchedule=$SCHEDULE" \
      "PipelineImageUri=public.ecr.aws/docker/library/python:3.12-slim"

REPO_URI="$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='RepositoryUri'].OutputValue" --output text)"
BUCKET="$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='SnapshotsBucketName'].OutputValue" --output text)"
[ -n "$REPO_URI" ] || fail "Could not read RepositoryUri from stack outputs."
echo "    repo  : $REPO_URI"
echo "    bucket: $BUCKET"

# ---------------------------------------------------------------------------
# 3. Build and push the real image.
# ---------------------------------------------------------------------------
if [ "$SKIP_BUILD" -eq 0 ]; then
  say "Building the pipeline image"
  # arm64 is cheaper on Fargate and matches Graviton pricing. Build for the
  # same architecture the tasks run on, or Fargate rejects the image.
  docker build \
    --platform linux/arm64 \
    -f "$REPO_ROOT/docker/Dockerfile.batch" \
    -t biblio-pipeline:latest \
    "$REPO_ROOT"

  say "Pushing to ECR"
  aws ecr get-login-password --region "$REGION" \
    | docker login --username AWS --password-stdin "${REPO_URI%%/*}"
  docker tag biblio-pipeline:latest "$REPO_URI:latest"
  docker push "$REPO_URI:latest"

  SIZE_MB="$(aws ecr describe-images --region "$REGION" \
    --repository-name "${REPO_URI##*/}" --image-ids imageTag=latest \
    --query 'imageDetails[0].imageSizeInBytes' --output text 2>/dev/null \
    | awk '{printf "%.0f", $1/1048576}' || echo '?')"
  echo "    image size: ${SIZE_MB} MB (free tier allows 500 MB total)"
  case "$SIZE_MB" in
    ''|'?') : ;;
    *) [ "$SIZE_MB" -gt 500 ] && echo "    WARNING: over the 500 MB free tier." ;;
  esac
else
  say "Skipping build (--skip-build); reusing $REPO_URI:latest"
fi

# ---------------------------------------------------------------------------
# 4. Update the stack to use the real image.
# ---------------------------------------------------------------------------
say "Updating the stack with the real image"
sam deploy \
  --template-file "$REPO_ROOT/cloudformation/pipeline-batch.yaml" \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --capabilities CAPABILITY_IAM \
  --resolve-s3 \
  --no-confirm-changeset \
  --no-fail-on-empty-changeset \
  --parameter-overrides \
      "SubnetIds=$SUBNET_LIST" \
      "EnableSchedule=$SCHEDULE" \
      "PipelineImageUri=$REPO_URI:latest"

say "Deployed"
cat <<EOF

    Snapshots bucket : $BUCKET
    ECR repository   : $REPO_URI
    Schedule         : $SCHEDULE (Mondays 06:00 UTC)

    Run a job now and watch it:
      ./scripts/run-pipeline.sh

    Tear it down (keeps the website online):
      ./scripts/teardown.sh --stack "$STACK_NAME"

EOF
