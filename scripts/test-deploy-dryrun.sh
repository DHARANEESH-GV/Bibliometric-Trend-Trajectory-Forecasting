#!/usr/bin/env bash
# ============================================================================
# test-deploy-dryrun.sh — verify the deploy/teardown scripts' control flow
# WITHOUT touching AWS.
#
# The real scripts are dangerous (they create and delete cloud resources), and
# no credentials exist in this environment, so this harness puts stub `aws`
# and `sam` binaries on PATH that record their arguments instead of calling
# the network. It proves: pre-flight gating, argument parsing, that no
# destructive call runs pre-confirmation, and the exact command sequence.
#
# Run: ./scripts/test-deploy-dryrun.sh
# ============================================================================
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STUB_DIR="$(mktemp -d)"
LOG="$STUB_DIR/calls.log"
PASS=0
FAIL=0

cleanup() { rm -rf "$STUB_DIR"; }
trap cleanup EXIT

pass() { PASS=$((PASS+1)); printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
fail() { FAIL=$((FAIL+1)); printf '  \033[31mFAIL\033[0m  %s\n' "$1"; }
check() { if eval "$2"; then pass "$1"; else fail "$1"; fi; }

# ---- Stub binaries --------------------------------------------------------
# Each records the invoked command, then prints whatever the script expects
# to parse back (account id, stack outputs) from STUB_* variables.
cat > "$STUB_DIR/aws" <<'STUB'
#!/usr/bin/env bash
echo "aws $*" >> "$STUB_LOG"
# Stateful markers so delete-stack actually "removes" the stack for the
# verification step, and so the distribution config round-trips.
DELETED_MARK="$STUB_DIR/.stack-deleted"
touch "$STUB_DIR/.pf" 2>/dev/null || true

case "$*" in
  "sts get-caller-identity"*) 
    case "$*" in
      *"--query Account"*) echo "${STUB_ACCOUNT:-123456789012}" ;;
      *"--query Arn"*) echo "arn:aws:iam::123456789012:user/stub" ;;
      *) echo '{"Account":"123456789012"}' ;;
    esac ;;
  *describe-stacks*BucketName*) echo "${STUB_BUCKET:-biblio-trend-dev-site-123456789012}" ;;
  *describe-stacks*DistributionId*) echo "${STUB_DIST:-E1234567890ABC}" ;;
  *describe-stacks*SiteUrl*) echo "https://d111111abcdef8.cloudfront.net" ;;
  # Once delete-stack has run, describe-stacks must fail (like real AWS).
  *describe-stacks*)
    if [ -f "$DELETED_MARK" ]; then exit 254; fi
    [ "${STUB_STACK_EXISTS:-1}" = "1" ] && echo '{"Stacks":[]}' || exit 254 ;;
  "s3api head-bucket"*)
    if [ -f "$STUB_DIR/.bucket-deleted" ]; then exit 254; fi
    [ "${STUB_BUCKET_EXISTS:-1}" = "1" ] && exit 0 || exit 254 ;;
  # Emptying the bucket is what makes the bucket deletable in the real world.
  "s3 rm s3://"*) touch "$STUB_DIR/.bucket-deleted" 2>/dev/null; exit 0 ;;
  "cloudfront get-distribution-config"*"--query ETag"*) echo "ETAGSTUB" ;;
  "cloudfront get-distribution-config"*"--query DistributionConfig"*)
    echo '{"CallerReference":"stub","Enabled":true,"Comment":"stub","Origins":{"Quantity":1,"Items":[]},"DefaultCacheBehavior":{"TargetOriginId":"s3-origin","ViewerProtocolPolicy":"redirect-to-https"},"DefaultRootObject":"index.html"}' ;;
  "cloudfront update-distribution"*) exit 0 ;;
  "cloudfront create-invalidation"*) echo "I2J0K1L2M3N4O5" ;;
  "cloudformation delete-stack"*) touch "$DELETED_MARK"; touch "$STUB_DIR/.bucket-deleted"; exit 0 ;;
  "cloudformation wait"*) exit 0 ;;
  *) exit 0 ;;
esac
STUB
chmod +x "$STUB_DIR/aws"

cat > "$STUB_DIR/sam" <<'STUB'
#!/usr/bin/env bash
echo "sam $*" >> "$STUB_LOG"
exit 0
STUB
chmod +x "$STUB_DIR/sam"

# A fake npm so --skip-build path is testable too.
cat > "$STUB_DIR/npm" <<'STUB'
#!/usr/bin/env bash
echo "npm $*" >> "$STUB_LOG"
exit 0
STUB
chmod +x "$STUB_DIR/npm"

export PATH="$STUB_DIR:$PATH"
export STUB_LOG="$LOG"
export STUB_DIR

echo
echo "=== deploy.sh ==="

# --- 1. Missing credentials is refused with an actionable message ----------
: > "$LOG"
OUT="$(env PATH="$STUB_DIR:/usr/bin:/bin" STUB_LOG="$LOG" \
  bash -c "command -v aws >/dev/null && echo stub-present" 2>&1)"
check "harness puts stubs on PATH" '[ "$OUT" = "stub-present" ]'

: > "$LOG"
env PATH="/usr/bin:/bin" AWS_REGION=us-east-1 \
  bash "$REPO_ROOT/scripts/deploy.sh" --skip-build > /tmp/_bad.out 2>&1
check "fails when the AWS CLI is absent" '[ $? -ne 0 ]'

# --- 2. --help works and is side-effect free ------------------------------
: > "$LOG"
env STUB_LOG="$LOG" bash "$REPO_ROOT/scripts/deploy.sh" --help > /tmp/_help.out 2>&1
check "--help exits 0" '[ $? -eq 0 ]'
check "--help documents usage" 'grep -q "Usage:" /tmp/_help.out'
check "--help makes no AWS calls" '[ ! -s "$LOG" ]'

# --- 3. Unknown argument is rejected --------------------------------------
env STUB_LOG="$LOG" bash "$REPO_ROOT/scripts/deploy.sh" --nonsense > /tmp/_badarg.out 2>&1
check "unknown argument exits nonzero" '[ $? -ne 0 ]'

# --- 4. Happy path (--skip-build) performs the upload sequence ------------
mkdir -p "$REPO_ROOT/frontend/dist/assets" "$REPO_ROOT/frontend/dist/snapshots"
[ -f "$REPO_ROOT/frontend/dist/index.html" ] || echo '<html></html>' > "$REPO_ROOT/frontend/dist/index.html"
[ -f "$REPO_ROOT/frontend/dist/snapshots-run.json" ] || echo '{"run_id":"x"}' > "$REPO_ROOT/frontend/dist/snapshots-run.json"
[ -f "$REPO_ROOT/frontend/dist/assets/app.js" ] || echo 'x' > "$REPO_ROOT/frontend/dist/assets/app.js"

: > "$LOG"
env STUB_LOG="$LOG" AWS_REGION=us-east-1 \
  bash "$REPO_ROOT/scripts/deploy.sh" --skip-build > /tmp/_deploy.out 2>&1
DEPLOY_RC=$?
check "deploy exits 0 on the happy path" '[ $DEPLOY_RC -eq 0 ]'
check "deploy runs sam deploy" 'grep -q "^sam deploy" "$LOG"'
check "deploy uploads hashed assets with immutable cache" \
  'grep -q "s3 sync .*dist/assets .*--cache-control public,max-age=31536000,immutable" "$LOG"'
check "deploy sets no-cache on index.html" \
  'grep -q "s3 cp .*dist/index.html .*no-cache,no-store,must-revalidate" "$LOG"'
check "deploy invalidates the distribution" 'grep -q "cloudfront create-invalidation" "$LOG"'
check "deploy prunes stale objects" 'grep -cq "s3 sync .* --delete" "$LOG"'
check "deploy prints the site URL" 'grep -q "cloudfront.net" /tmp/_deploy.out'

# Ordering matters: the upload must happen AFTER the stack exists.
STACK_LINE=$(grep -n '^sam deploy' "$LOG" | head -1 | cut -d: -f1)
UPLOAD_LINE=$(grep -n 's3 sync .*dist/assets' "$LOG" | head -1 | cut -d: -f1)
check "stack deploys before any upload" '[ -n "$STACK_LINE" ] && [ -n "$UPLOAD_LINE" ] && [ "$STACK_LINE" -lt "$UPLOAD_LINE" ]'

echo
echo "=== teardown.sh ==="

# --- 5. Refuses to delete without confirmation when non-interactive ------
: > "$LOG"
env STUB_LOG="$LOG" AWS_REGION=us-east-1 \
  bash "$REPO_ROOT/scripts/teardown.sh" < /dev/null > /tmp/_td1.out 2>&1
TD1=$?
check "teardown refuses without --yes on a TTY-less run" '[ $TD1 -ne 0 ]'
check "teardown deletes NOTHING when unconfirmed" '! grep -q "delete-stack" "$LOG"'

# --- 6. Stack absent is a clean no-op ------------------------------------
: > "$LOG"
env STUB_LOG="$LOG" STUB_STACK_EXISTS=0 AWS_REGION=us-east-1 \
  bash "$REPO_ROOT/scripts/teardown.sh" --yes > /tmp/_td2.out 2>&1
check "teardown with a missing stack exits 0" '[ $? -eq 0 ]'
check "teardown with a missing stack deletes nothing" '! grep -q "delete-stack" "$LOG"'

# --- 7. Full teardown empties the bucket BEFORE deleting the stack ------
: > "$LOG"
env STUB_LOG="$LOG" AWS_REGION=us-east-1 \
  bash "$REPO_ROOT/scripts/teardown.sh" --yes > /tmp/_td3.out 2>&1
TD3=$?
check "teardown --yes exits 0" '[ $TD3 -eq 0 ]'
check "teardown empties the bucket" 'grep -q "s3 rm s3://" "$LOG"'
check "teardown disables the distribution" 'grep -q "cloudfront update-distribution" "$LOG"'
check "teardown deletes the stack" 'grep -q "cloudformation delete-stack" "$LOG"'

EMPTY_LINE=$(grep -n 's3 rm s3://' "$LOG" | head -1 | cut -d: -f1)
DEL_LINE=$(grep -n 'cloudformation delete-stack' "$LOG" | head -1 | cut -d: -f1)
check "bucket is emptied before the stack delete" \
  '[ -n "$EMPTY_LINE" ] && [ -n "$DEL_LINE" ] && [ "$EMPTY_LINE" -lt "$DEL_LINE" ]'

# --- 8. --stack override is honoured ------------------------------------
: > "$LOG"
env STUB_LOG="$LOG" AWS_REGION=us-east-1 \
  bash "$REPO_ROOT/scripts/teardown.sh" --yes --stack custom-stack > /tmp/_td4.out 2>&1
check "--stack override reaches cloudformation" 'grep -q "custom-stack" "$LOG"'

echo
echo "=== run-pipeline.sh ==="

# The pipeline scripts need extra stub surface: Batch submit/describe and
# log tailing. Extend the same recorder so ordering can still be asserted.
cat > "$STUB_DIR/aws" <<'STUB'
#!/usr/bin/env bash
echo "aws $*" >> "$STUB_LOG"
case "$*" in
  "sts get-caller-identity"*)
    case "$*" in
      *"--query Account"*) echo "123456789012" ;;
      *"--query Arn"*) echo "arn:aws:iam::123456789012:user/stub" ;;
      *) echo '{"Account":"123456789012"}' ;;
    esac ;;
  *describe-stacks*JobQueueArn*) echo "arn:aws:batch:us-east-1:123456789012:job-queue/q" ;;
  *describe-stacks*JobDefinitionArn*) echo "arn:aws:batch:us-east-1:123456789012:job-definition/d:1" ;;
  *describe-stacks*LogGroupName*) echo "/aws/batch/biblio-trend-dev" ;;
  *describe-stacks*SnapshotsBucketName*) echo "biblio-trend-dev-snapshots-123456789012" ;;
  *describe-stacks*) echo '{"Stacks":[]}' ;;
  "batch submit-job"*) echo "JOBID123" ;;
  "batch describe-jobs"*"--query jobs[0].status"*) echo "SUCCEEDED" ;;
  "batch describe-jobs"*) echo "ok" ;;
  "logs tail"*) echo "log line" ;;
  "s3 ls"*) printf 'PRE 20261029T094600Z/\nPRE 20261001T000000Z/\n' ;;
  "s3 sync"*|"s3 cp"*|"s3 rm"*|"s3api "*) exit 0 ;;
  *) exit 0 ;;
esac
STUB
chmod +x "$STUB_DIR/aws"

: > "$LOG"
env STUB_LOG="$LOG" AWS_REGION=us-east-1 \
  bash "$REPO_ROOT/scripts/run-pipeline.sh" > /tmp/_rp1.out 2>&1
check "run-pipeline submits a job" 'grep -q "batch submit-job" "$LOG"'
check "run-pipeline submits with stats mode" 'grep -q "BIBLIO_MODE" "$LOG"'
check "run-pipeline follows to completion" 'grep -q "batch describe-jobs" "$LOG"'
check "run-pipeline reports success" 'grep -q "Job succeeded" /tmp/_rp1.out'

: > "$LOG"
env STUB_LOG="$LOG" AWS_REGION=us-east-1 \
  bash "$REPO_ROOT/scripts/run-pipeline.sh" --mode domain > /tmp/_rp2.out 2>&1
check "run-pipeline rejects mode=domain without --domain" '[ $? -ne 0 ]'
check "run-pipeline submits nothing when invalid" '! grep -q "submit-job" "$LOG"'

: > "$LOG"
env STUB_LOG="$LOG" AWS_REGION=us-east-1 \
  bash "$REPO_ROOT/scripts/run-pipeline.sh" --mode domain --domain quantum_computing > /tmp/_rp3.out 2>&1
check "run-pipeline passes the domain through" 'grep -q "BIBLIO_DOMAIN" "$LOG"'

echo
echo "=== sync-snapshots.sh ==="

: > "$LOG"
env STUB_LOG="$LOG" AWS_REGION=us-east-1 \
  bash "$REPO_ROOT/scripts/sync-snapshots.sh" > /tmp/_ss1.out 2>&1
check "sync reads the snapshots bucket from the stack" 'grep -q "s3 sync s3://biblio-trend-dev-snapshots" "$LOG"'
check "sync picks the NEWEST run, not just any" 'grep -q "20261029T094600Z" "$LOG"'

echo
echo "=== entrypoint.py ==="
EP="$REPO_ROOT/docker/entrypoint.py"
check "entrypoint rejects an unknown mode" \
  'python3 "$EP" bogus >/dev/null 2>&1; [ $? -eq 2 ]'
check "entrypoint requires a domain for mode=domain" \
  'python3 "$EP" domain >/dev/null 2>&1; [ $? -eq 2 ]'

echo
echo "----------------------------------------"
printf '  %d passed, %d failed\n' "$PASS" "$FAIL"
echo "----------------------------------------"
[ "$FAIL" -eq 0 ] || exit 1
