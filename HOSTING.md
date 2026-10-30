# How to host the whole thing on AWS

A teaching guide. Read this before running anything.

---

## 1. First, the mental model

"Hosting" a data product like this means solving **three separate problems**,
and they have completely different shapes:

```
   ┌─────────────┐      ┌─────────────┐      ┌─────────────┐
   │  1. PRODUCE │      │  2. STORE   │      │  3. SERVE   │
   │  the data   │ ───► │  the data   │ ───► │  the site   │
   └─────────────┘      └─────────────┘      └─────────────┘
    Python pipeline      S3 bucket            S3 + CloudFront
    ~3000 lines          JSON snapshots       React build
    RATE-LIMITED         ~476 KB              ~19 MB
```

Most people conflate these into "deploy to AWS" and then get stuck, because
each one wants a **different AWS service** and a different mental model.

- **Produce** is slow, stateful, and rate-limited. It is a *job*, not a server.
- **Store** is dumb and cheap. It is *files*.
- **Serve** is fast and stateless. It is a *CDN*.

The single biggest mistake is picking the same tool for all three.

---

## 2. Why this particular project is unusual

Two facts about *this* repo drive every decision below. Learn these and the
architecture chooses itself.

### Fact 1: the data changes monthly, not hourly

Look at `snapshots/` — there are four runs, days apart. The dashboard is a
**periodic publication**, like a magazine issue. It is not a live feed.

This matters enormously. It means you do **not** need:

- a database with a live query API
- Lambda functions answering per-request
- DynamoDB, API Gateway, or any always-on compute

All of that exists to serve *real-time* reads. You have none.

### Fact 2: the pipeline is rate-limit-bound, not compute-bound

From `config/settings.yaml`:

```yaml
# OpenAlex polite pool = 1000 credits/day/IP (~20h reset).
# Backfills MUST be laddered across days: 814 pages for a full domain
# >> 1000/day. Keep ≤800/day and always leave ≥100 credits headroom.
```

A full backfill of one domain needs ~814 pages. You get ~1000 credits **per
day**. So a complete backfill of all 20 domains takes **multiple days**, and
is deliberately throttled to be a good citizen.

Now compare that to AWS Lambda: **15 minute hard timeout**.

> **The pipeline physically cannot run inside a Lambda.** Not because of code,
> it is because the upstream API makes you go slow. This is the trap the
> master plan's "six container Lambdas" design walks into, and it is worth
> understanding before you build it.

The right tool for "go slow for three days" is a **scheduled job on a machine
that can sleep** — a small EC2 instance, or a CI runner that runs weekly
increments.

---

## 3. What actually exists today

Be clear-eyed about this before planning anything.

| Piece | Status |
|---|---|
| Python pipeline (`pipelines/`, `stats/`) | ✅ **Real** — ~3,000 lines, works locally |
| Snapshot JSON output | ✅ **Real** — `snapshots/<run_id>/`, ~476 KB |
| React dashboard | ✅ **Real** — 7 views, builds to 19 MB |
| `template.yaml` (S3 + CloudFront) | ✅ **Written**, not yet deployed |
| `scripts/deploy.sh` / `teardown.sh` | ✅ **Written**, dry-run tested (24 checks) |
| `lambdas/*/handler.py` | ❌ **All 0 bytes** |
| `lambdas/*/Dockerfile` | ❌ **All 0 bytes** |
| Step Functions state machine | ❌ Does not exist |
| DynamoDB tables | ❌ Does not exist |
| `read_api` Lambda + API Gateway | ❌ Does not exist |
| CI / scheduled refresh | ❌ Does not exist |

So "the whole thang" is **not** a deployment problem. It is: *the pipeline
exists, the website exists, and the glue between them was never written.*

---

## 4. The three tiers, honestly compared

### Tier A — Static site (recommended start)

Serve the pre-built snapshots. Refresh = rebuild + re-upload.

- **Effort:** already done
- **Cost:** ~$0–1/month
- **You get:** a real public URL, HTTPS, global CDN
- **You give up:** automatic refresh

### Tier B — Static site + scheduled refresh ← **the sweet spot**

Everything in Tier A, plus a weekly job that re-runs the pipeline and
re-uploads the snapshots.

- **Effort:** half a day
- **Cost:** ~$0–1/month (GitHub Actions free minutes, or a $3/mo `t4g.nano`)
- **You get:** the site updates itself
- **You give up:** nothing meaningful

### Tier C — The full serverless design

Six container Lambdas, Step Functions, DynamoDB, API Gateway.

- **Effort:** weeks, and it fights Fact 2 above
- **Cost:** $1–5/month, with real risk of exceeding free tier (ECR, NAT)
- **You get:** an API, live queries, per-request reads
- **You give up:** your time, for capability you do not currently need

**My recommendation: build Tier B. Skip C entirely unless you later need
per-request querying.**

---

## 5. Tier A — step by step

### 5.1 Install the tools

```bash
# AWS CLI v2
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o awscliv2.zip
unzip awscliv2.zip && sudo ./aws/install
aws --version

# SAM CLI
pip install aws-sam-cli
sam --version
```

### 5.2 Create an IAM user — do NOT use the root account

This is the most important security step and the one beginners skip.

Root account = full account control, cannot be restricted, and if a script
misbehaves it can delete everything including your billing history.

1. IAM console → **Users** → **Create user** → name it `biblio-deploy`
2. **Do not** tick "Provide user access to the console". This is a
   programmatic identity only.
3. Attach policies. Start with:
   - `AmazonS3FullAccess`
   - `CloudFrontFullAccess`
   - `AWSCloudFormationFullAccess`
   - `IAMFullAccess` ← needed once, so CloudFormation can create the
     distribution's service role. Narrow this later.
4. **Security credentials** → **Create access key** → choose "CLI"
5. Store them:

```bash
aws configure
# Access key ID, Secret access key
# region: us-east-1     ← CloudFront is global but its certs live here
# output: json
```

Verify you are the *user*, not root:

```bash
aws sts get-caller-identity
# "Arn": "arn:aws:iam::123456789012:user/biblio-deploy"   ← good
# "Arn": "arn:aws:iam::123456789012:root"                ← STOP
```

### 5.3 Set a budget alert BEFORE deploying

AWS will happily bill you into the hundreds if something loops. One command:

```bash
aws budgets create-budget \
  --account-id "$(aws sts get-caller-identity --query Account --output text)" \
  --budget '{
    "BudgetName":"biblio-guardrail",
    "BudgetLimit":{"Amount":"1","Unit":"USD"},
    "TimeUnit":"MONTHLY",
    "BudgetType":"COST"
  }' \
  --notifications-with-subscribers '[{
    "Notification":{"NotificationType":"ACTUAL","ComparisonOperator":"GREATER_THAN","Threshold":80,"ThresholdType":"PERCENTAGE"},
    "Subscribers":[{"SubscriptionType":"EMAIL","Address":"you@example.com"}]
  }]'
```

### 5.4 Deploy

```bash
make deploy        # builds the SPA, then deploys the stack
```

The script will print your account and IAM identity and stop if anything
looks wrong. It uploads with per-asset cache headers (see `DEPLOY.md` for why
that matters) and invalidates CloudFront.

You get a `https://d111111abcdef8.cloudfront.net` URL. That is your site, live.

### 5.5 Refreshing the data

```bash
make snapshots     # regenerate JSON from the current data/
make deploy        # rebuild + re-upload
```

That is Tier A: manual but real.

---

## 6. Tier B — automate the refresh

The key insight: **do not put the pipeline in a Lambda.** Put it in a cron job.

### Option B1 — GitHub Actions (free, zero infrastructure)

This is what I would do. Create `.github/workflows/refresh.yml`:

```yaml
name: Refresh snapshots

on:
  schedule:
    - cron: '0 6 * * 1'        # Mondays 06:00 UTC
  workflow_dispatch:            # manual trigger button

jobs:
  refresh:
    runs-on: ubuntu-latest
    timeout-minutes: 350        # long: the pipeline is rate-limit bound
    permissions:
      id-token: write           # for keyless AWS auth
      contents: read
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
          cache: pip

      - run: pip install -r requirements.txt

      # Incremental only, never a full backfill: the polite pool is
      # 1000 credits/day and a backfill takes days.
      - run: make stats snapshots

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/biblio-ci
          aws-region: us-east-1

      - run: ./scripts/deploy.sh --skip-build   # uploads the new snapshots

      - name: Rebuild frontend against new data
        run: make deploy                         # full path: build + deploy
```

**Why this works:** the runner can live for hours, it costs nothing on public
repos, and the data ends up in the same S3 bucket Tier A already uses.

Use **OIDC** (`role-to-assume`) rather than storing access keys as GitHub
secrets. It means no long-lived credentials exist anywhere to leak.

### Option B2 — a tiny always-on box

If you want the pipeline on AWS itself:

- `t4g.nano` EC2 (arm64, ~$3/month, or free tier for 12 months)
- A `systemd` timer runs `make stats snapshots` weekly
- It writes to the same S3 bucket with `aws s3 sync`

Slightly more work than B1, one more thing to patch. Only worth it if you
want everything inside one account.

---

## 7. Tier C — the full design, and why to be careful

If you genuinely need per-request queries later, here is what the master plan
specifies and what it actually requires.

### What you would have to build

| Component | Work involved |
|---|---|
| `fetch_openalex` handler | Wrap `pipelines/openalex_client.py`; cursor state in DynamoDB |
| `fetch_patents` handler | Wrap the BigQuery export; CPC→domain mapping |
| `normalize` handler | Wrap `pipelines/normalize.py`; DuckDB in a container |
| `aggregate` handler | Wrap `stats/trajectories.py` |
| `score` handler | Wrap `stats/emergence.py` + `forecasts.py` |
| `read_api` handler | **Does not exist anywhere yet.** Write from scratch |
| Step Functions | Map state, retries, error paths |
| DynamoDB | 4 tables, GSIs, TTL |
| API Gateway | 5 routes, CORS, throttling |
| 6 Dockerfiles | python:3.12-slim + duckdb + pyarrow + statsmodels |

That is real engineering — weeks, not hours.

### The three traps

**Trap 1 — the 15-minute timeout vs multi-day rate limits.**
Covered in §2. The fix is to make the Lambda *resume* across invocations:
store the cursor in DynamoDB, cap each run at ~800 pages, and re-invoke via
Step Functions or EventBridge until complete. That is a genuinely hard state
machine to get right, and it is why a cron job is the better tool.

**Trap 2 — ECR's 500 MB free tier.**
Container images with `duckdb` + `pyarrow` + `statsmodels` land around
250–400 MB *per image*. Six images = over the free tier. Every re-push during
Dockerfile iteration adds more. Check with:

```bash
aws ecr describe-repositories --query 'repositories[].repositoryUri' --output text
aws ecr describe-images --repository-name <name> --query 'imageDetails[].imageSizeInBytes'
```

**Trap 3 — NAT Gateway.** The single most expensive mistake available.
A container Lambda in a private VPC needs outbound internet to reach
OpenAlex, and NAT Gateway costs ~$32/month plus data processing. **Do not put
these Lambdas in a VPC at all** — they only need the public internet, which
they get by default. The plan explicitly lists NAT Gateway as avoided; keep
it that way.

---

## 8. What it actually costs

| Tier | Monthly | Notes |
|---|---|---|
| A — static only | **$0–1** | S3 cents; CloudFront free tier is 1 TB egress + 10M requests |
| B — static + GitHub Actions | **$0–1** | CI minutes free on public repos |
| B — static + `t4g.nano` | **~$3** | One small box running a weekly timer |
| C — full serverless | **$1–5** | + ECR storage risk, + step function transitions |

For 476 KB of snapshots and a 19 MB site, Tier A is effectively free. There is
no scale problem to solve here.

---

## 9. Mistakes to avoid

1. **Using the root account.** Create an IAM user. Non-negotiable.
2. **No budget alert.** Set $1 before your first deploy, not after.
3. **Long-caching `index.html`.** Pins users to a deleted bundle. Handled in
   `deploy.sh`, but know why.
4. **Deploying the pipeline to Lambda because "serverless".** Your bottleneck
   is OpenAlex's daily credit limit, not compute.
5. **Putting Lambdas in a VPC.** NAT Gateway will cost more than everything
   else combined.
6. **Forgetting that CloudFront takes ~5 minutes to propagate.** A fresh
   distribution 403s briefly. Not broken.
7. **Deleting the CloudFormation stack without emptying S3 first.** The
   delete fails and leaves a billed bucket. `teardown.sh` handles this.
8. **Committing `.env` / access keys.** Check `git status` before every push.

---

## 10. The path I would take

```
Week 1   Tier A            make deploy → public URL.        (done, ready now)
Week 2   Custom domain     ACM cert + Route 53, ~$1/mo
Week 3   Tier B            GitHub Actions weekly refresh
Later    Tier C            ONLY if per-request queries become necessary
```

Tier A+B gets you a self-updating public dashboard for roughly **$1/month**.
That is the entire product. Tier C adds an API nobody has asked for yet.

---

## 11. Quick reference

```bash
make test-deploy        # 24 checks, no AWS calls
make deploy             # build + deploy
make deploy-fast        # deploy existing dist/
make teardown           # prompts, empties bucket first
./scripts/teardown.sh --yes
```

- Template: `template.yaml` (5 resources: bucket, OAC, policy, distribution, budget)
- Full deploy reference: `DEPLOY.md`
- Design decisions: `PROJECT_MASTER_PLAN.md` §3–§4, §13–§14
