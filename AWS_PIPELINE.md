# Running the pipeline in AWS (Batch on Fargate)

This is the **"produce the data"** half. The website is a separate stack
(`template.yaml`). You can run either without the other.

> **Read this first — why not Lambda.**
> `config/settings.yaml` caps ingestion at ~800 OpenAlex credits/day, and a
> full domain backfill needs ~814 pages. A run therefore takes **hours by
> design**. Lambda has a 15-minute hard timeout and physically cannot hold it.
> Batch has no such ceiling, retries automatically, and Fargate means no
> instances to patch. This is the single most important constraint in the
> whole deployment.

---

## The two stacks

```
   template.yaml                    cloudformation/pipeline-batch.yaml
   ─────────────                    ──────────────────────────────────
   SERVE                            PRODUCE
   S3 + CloudFront                  AWS Batch (Fargate)
   site bucket                      snapshots bucket + ECR
   ~$0-1/mo                         ~$0.25/mo (a few cents per run)

            ▲                                    │
            └──── scripts/sync-snapshots.sh ─────┘
                  (pulls new snapshots, then make deploy)
```

They are deliberately separate. You can tear down the compute stack and the
website stays online, still serving the last snapshot.

---

## Order of operations

```bash
# 1. Website (do this first — it needs no compute)
make deploy

# 2. Pipeline
make pipeline          # builds the image, pushes to ECR, deploys Batch

# 3. Trigger a run
make pipeline-run

# 4. Publish the new data
make snapshots-pull
make deploy
```

---

## What the pipeline stack creates

| Resource | Purpose |
|---|---|
| **ECR repository** | Holds `biblio-trend-pipeline`; lifecycle policy keeps 5 images |
| **Snapshots bucket** | Where runs are written; 180-day expiry on old runs |
| **Batch compute env** | Fargate, no instances, `MaxvCpus: 4` |
| **Job definition** | 2 vCPU / 4 GB, 6-hour timeout, 1 retry |
| **EventBridge rule** | Mondays 06:00 UTC (optional) |
| **Two IAM roles** | Execution role (pull image, ship logs) vs job role (S3 only) |
| **CloudWatch log group** | 30-day retention |

### Why two IAM roles

The *execution* role lets ECS pull the image and write logs. The *job* role is
what your Python code may do — S3 read/write on its own bucket only. Keeping
them separate means a compromised dependency in the pipeline cannot push
images or read task metadata.

---

## The cost traps, and how this avoids them

**1. NAT Gateway — ~$32/month, the most expensive mistake available.**
A Fargate task in a *private* subnet needs NAT to reach ECR and OpenAlex.
This stack uses **public subnets**, which route to an Internet Gateway for
free. `deploy-pipeline.sh` finds them for you:

```bash
aws ec2 describe-subnets \
  --filters Name=vpc-id,Values=$(aws ec2 describe-vpcs \
      --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text) \
            Name=map-public-ip-on-launch,Values=true \
  --query 'Subnets[].SubnetId' --output text
```

If you have no default VPC, create one (`aws ec2 create-default-vpc`) or pass
`SUBNETS=<id,id>`.

**2. ECR's 500 MB free tier.** The image is ~400 MB (duckdb + pyarrow +
statsmodels). The lifecycle policy keeps 5 images, and `deploy-pipeline.sh`
prints the size with a warning past 500 MB total.

**3. A hung job billing forever.** `AttemptDurationSeconds: 21600` (6 hours)
caps it. Fargate stops charging the moment the task exits.

**Actual cost:** a 2-hour run at 2 vCPU / 4 GB is **~$0.06**. Weekly, that is
under **$0.25/month**. Nothing runs in between.

---

## Triggering runs

```bash
make pipeline-run                                  # rebuild all data products
./scripts/run-pipeline.sh --mode snapshots         # dashboard JSON only
./scripts/run-pipeline.sh --mode domain --domain quantum_computing
./scripts/run-pipeline.sh --no-follow              # submit, don't wait
```

The script submits the job, polls status (printing each transition), prints
the failure reason and recent logs if it fails, and on success shows the logs.

### Modes

`docker/entrypoint.py` is the container entry point. Make is fine
interactively but a poor fit for Batch — it cannot report per-stage progress,
cannot fail loudly on a partial run, and re-runs whatever it thinks is stale.

| Mode | Does |
|---|---|
| `stats` (default) | trajectories → bursts → forecasts → emergence → patents → snapshots |
| `snapshots` | only the dashboard JSON |
| `domain` | fetch → normalize → aggregate for one `BIBLIO_DOMAIN` |

It exits **non-zero** if any stage fails, and also if zero snapshots were
produced — the "green job that did nothing" failure mode.

---

## Data hand-off

The container's disk is destroyed when the task exits, so snapshots must reach
S3 or the work is lost. `entrypoint.py` uploads the newest run to
`s3://<snapshots-bucket>/snapshots/<run_id>/` using the job role (boto3, no
credentials in the image).

To publish them:

```bash
make snapshots-pull    # newest run → ./snapshots/<run_id>/
make deploy            # rebuild the site against it
```

---

## Watching a run

```bash
aws logs tail /aws/batch/biblio-trend-dev --follow
```

Logs are structured per stage:

```
[biblio 06:00:01] mode=stats python=3.12.7
[biblio 06:00:01] START trajectories: python stats/trajectories.py
[biblio 06:00:14] DONE  trajectories in 13.2s
...
[biblio 06:02:41] OK latest=20261102T060001Z
[biblio 06:02:42] uploading snapshots/20261102T060001Z -> s3://...
```

---

## Building the image manually

```bash
docker build --platform linux/arm64 \
  -f docker/Dockerfile.batch -t biblio-pipeline .

aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin <acct>.dkr.ecr.us-east-1.amazonaws.com
docker tag biblio-pipeline:latest <acct>.dkr.ecr.us-east-1.amazonaws.com/biblio-trend-pipeline:latest
docker push <acct>.dkr.ecr.us-east-1.amazonaws.com/biblio-trend-pipeline:latest
```

Build for `linux/arm64` — that is what Fargate runs, and Graviton pricing is
~20% cheaper. A mismatched architecture fails with a confusing exec error.

The image does **not** contain `raw/` or `staged/` (472 MB, gitignored). It
contains code, `config/`, and the tracked `data/` products, and fetches the
rest at runtime.

---

## Teardown

```bash
./scripts/teardown.sh --stack biblio-trend-pipeline-dev
```

Removes the Batch environment, ECR repo, and snapshots bucket. **The website
stays online** — it is a different stack.

---

## Verification without AWS

```bash
make test-deploy     # 35 checks, stubbed aws/sam/docker, zero AWS calls
```

Covers: job submission, mode/domain validation, newest-snapshot selection,
entrypoint exit codes, and that the website bucket is emptied before its stack
delete.

Nothing here has been run against a real account — no credentials exist in
this environment. The first real run is the first real run.
