# Deploying the dashboard (AWS, frontend only)

This repository ships **one** AWS deployment: the static React build on
**S3 + CloudFront** with a private origin. It is deliberately narrow.

> **Scope.** The data pipeline (Step Functions, container Lambdas, ECR,
> DynamoDB, API Gateway) described in `PROJECT_MASTER_PLAN.md` §3 is **not**
> part of this stack. The dashboard reads pre-generated JSON snapshots that
> are bundled into the build, so no API tier is needed until live querying
> becomes a requirement.

## What gets created

| Resource | Purpose | Notes |
|---|---|---|
| S3 bucket | Private origin for the build | Block Public Access on all four switches; no website endpoint |
| CloudFront distribution | Public HTTPS entry point | Private origin via OAC (SigV4), not a public bucket |
| Origin Access Control | Signs CloudFront → S3 | Bucket policy trusts **this distribution only** |
| Budget (optional) | $1/month email alert | Only when `BudgetAlertEmail` is set |

No compute, no database, no queue, no certificate (the default
`*.cloudfront.net` domain is used).

## Cost

| Item | Expected |
|---|---|
| S3 storage (~20 MB build) | a few cents/month |
| CloudFront egress | $0 within the always-free 1 TB/month |
| CloudFront requests | $0 within the always-free 10M/month |
| **Total** | **roughly $0 – $1/month** |

`PriceClass_100` (US/Canada/Europe) is the default because it is the
cheapest edge footprint. Add `--parameter-overrides PriceClass=PriceClass_All`
only if you need global edges.

## Prerequisites

Both CLIs are required, and the script refuses to run without them:

```bash
# AWS CLI
# https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html
aws --version

# AWS SAM CLI
# https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html
sam --version

# Credentials for the account you intend to bill
aws configure          # or: aws sso login --profile <name>
aws sts get-caller-identity
```

## Deploy

```bash
make deploy                  # build the SPA, then deploy
make deploy-fast             # deploy the existing dist/ without rebuilding
ENV=prod ./scripts/deploy.sh # a separate prod stack
```

The script prints the account and identity it is about to deploy with, then:

1. builds the frontend (`vite build`, with snapshots copied by `prebuild`)
2. deploys/updates the CloudFormation stack
3. uploads with **per-asset cache headers** — hashed bundles are
   `immutable, 1 year`; `index.html` and `snapshots-run.json` are
   `no-cache, must-revalidate`
4. prunes objects no longer in the build
5. invalidates CloudFront so the new entry point is live immediately

A brand-new distribution takes a few minutes to propagate; the first request
may briefly 403.

### Why the cache headers matter

The single most common static-site bug is serving `index.html` with a long
cache. It pins returning visitors to a build whose hashed bundles have been
deleted. The script sets `no-cache` on the two entry points and `immutable`
only on fingerprinted assets.

### SPA routing

The app owns its paths (`/leaderboard`, `/domain/…`). The distribution maps
S3 `403`/`404` to `/index.html` with a **200**, so deep links and hard
refreshes work without a router-specific server.

## Teardown

```bash
make teardown                # prompts for confirmation
./scripts/teardown.sh --yes  # non-interactive
```

This empties the bucket **first** (CloudFormation cannot delete a non-empty
bucket, which is the usual reason a teardown half-fails), disables the
distribution, deletes the stack, then verifies the bucket and stack are
gone. The site stops serving immediately.

Two things it intentionally leaves behind:

- the SAM deployment artifact bucket (`aws-sam-cli-managed-*`) — tiny, reused
  by future deploys
- the optional `$1` budget, if you created one — delete it in the Billing
  console

## Verifying the scripts without AWS

Neither the deploy nor the teardown script has been run against a real
account from this repository, because no credentials exist in the dev
environment. Their control flow is covered by a stubbed harness:

```bash
make test-deploy
```

`scripts/test-deploy-dryrun.sh` puts recording stubs for `aws` and `sam` on
`PATH` and asserts 24 behaviours, including that:

- a missing AWS CLI fails with an actionable message
- `--help` makes no AWS calls
- the stack deploys **before** any upload
- the bucket is emptied **before** the stack delete
- teardown deletes nothing when unconfirmed
- a missing stack is a clean no-op

The first real deploy is still the first real deploy: check the printed
account ID matches what you expect before confirming.
