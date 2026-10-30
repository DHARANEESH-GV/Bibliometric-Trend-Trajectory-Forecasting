"""
deploy_cloudfront.py - Automates S3 + CloudFront deployment according to PROJECT_MASTER_PLAN.md (§13 & §14)
"""
import json
import os
import subprocess
import sys
import uuid

BUCKET_NAME = "biblio-trend-web"
REGION = "ap-southeast-2"
S3_DOMAIN = f"{BUCKET_NAME}.s3.{REGION}.amazonaws.com"
ORIGIN_ID = f"S3-{BUCKET_NAME}"
OAC_NAME = "biblio-trend-web-oac"
CACHE_POLICY_OPTIMIZED = "658327ea-f89d-4fab-a63d-7e88639e58f6"

def run_cmd(cmd_list, check=True):
    print(f"Running: {' '.join(cmd_list)}")
    res = subprocess.run(cmd_list, capture_output=True, text=True)
    if check and res.returncode != 0:
        print(f"ERROR: {res.stderr}")
        raise RuntimeError(f"Command failed with code {res.returncode}: {res.stderr}")
    return res

def run_json(cmd_list):
    res = run_cmd(cmd_list, check=True)
    return json.loads(res.stdout) if res.stdout.strip() else {}

def main():
    print("=== 1. Checking AWS Caller Identity ===")
    ident = run_json(["aws", "sts", "get-caller-identity", "--output", "json"])
    account_id = ident.get("Account")
    caller_arn = ident.get("Arn")
    print(f"Account: {account_id}")
    print(f"ARN:     {caller_arn}")

    print("\n=== 2. Verifying S3 Bucket ===")
    check_bucket = run_cmd(["aws", "s3api", "head-bucket", "--bucket", BUCKET_NAME, "--region", REGION], check=False)
    if check_bucket.returncode != 0:
        raise RuntimeError(f"Bucket {BUCKET_NAME} is not accessible: {check_bucket.stderr}")
    print(f"Bucket '{BUCKET_NAME}' in '{REGION}' verified.")

    print("\n=== 3. Tagging Bucket & Ensuring Block Public Access ===")
    tagging = {
        "TagSet": [
            {"Key": "Project", "Value": "biblio-trend"},
            {"Key": "Environment", "Value": "dev"},
            {"Key": "CostCenter", "Value": "free-tier"}
        ]
    }
    run_cmd([
        "aws", "s3api", "put-bucket-tagging",
        "--bucket", BUCKET_NAME,
        "--region", REGION,
        "--tagging", json.dumps(tagging)
    ])

    pab_config = "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
    run_cmd([
        "aws", "s3api", "put-public-access-block",
        "--bucket", BUCKET_NAME,
        "--region", REGION,
        "--public-access-block-configuration", pab_config
    ])
    print("Bucket tags and Public Access Block confirmed.")

    print("\n=== 4. Setting Up CloudFront Origin Access Control (OAC) ===")
    oac_list = run_json(["aws", "cloudfront", "list-origin-access-controls", "--output", "json"])
    oac_items = oac_list.get("OriginAccessControlList", {}).get("Items", [])
    oac_id = None
    for item in oac_items:
        if item.get("Name") == OAC_NAME:
            oac_id = item.get("Id")
            print(f"Found existing OAC: {oac_id}")
            break

    if not oac_id:
        print(f"Creating Origin Access Control: {OAC_NAME}...")
        oac_config = {
            "Name": OAC_NAME,
            "Description": "OAC for biblio-trend-web S3 origin",
            "SigningProtocol": "sigv4",
            "SigningBehavior": "always",
            "OriginAccessControlOriginType": "s3"
        }
        oac_res = run_json([
            "aws", "cloudfront", "create-origin-access-control",
            "--origin-access-control-config", json.dumps(oac_config),
            "--output", "json"
        ])
        oac_id = oac_res["OriginAccessControl"]["Id"]
        print(f"Created OAC: {oac_id}")

    print("\n=== 5. Setting Up CloudFront Distribution ===")
    dists = run_json(["aws", "cloudfront", "list-distributions", "--output", "json"])
    dist_items = dists.get("DistributionList", {}).get("Items", [])
    dist_id = None
    dist_domain = None
    dist_arn = None

    for d in dist_items:
        origins = d.get("Origins", {}).get("Items", [])
        for o in origins:
            if o.get("DomainName") == S3_DOMAIN:
                dist_id = d.get("Id")
                dist_domain = d.get("DomainName")
                dist_arn = d.get("ARN")
                print(f"Found existing distribution: {dist_id} ({dist_domain})")
                break
        if dist_id:
            break

    if not dist_id:
        print(f"Creating new CloudFront distribution for {S3_DOMAIN}...")
        dist_config = {
            "CallerReference": str(uuid.uuid4()),
            "Comment": "biblio-trend global frontend distribution",
            "DefaultRootObject": "index.html",
            "Enabled": True,
            "Origins": {
                "Quantity": 1,
                "Items": [
                    {
                        "Id": ORIGIN_ID,
                        "DomainName": S3_DOMAIN,
                        "OriginAccessControlId": oac_id,
                        "S3OriginConfig": {
                            "OriginAccessIdentity": ""
                        }
                    }
                ]
            },
            "DefaultCacheBehavior": {
                "TargetOriginId": ORIGIN_ID,
                "ViewerProtocolPolicy": "redirect-to-https",
                "AllowedMethods": {
                    "Quantity": 2,
                    "Items": ["GET", "HEAD"],
                    "CachedMethods": {
                        "Quantity": 2,
                        "Items": ["GET", "HEAD"]
                    }
                },
                "CachePolicyId": CACHE_POLICY_OPTIMIZED,
                "Compress": True
            },
            "CustomErrorResponses": {
                "Quantity": 2,
                "Items": [
                    {
                        "ErrorCode": 403,
                        "ResponsePagePath": "/index.html",
                        "ResponseCode": "200",
                        "ErrorCachingMinTTL": 0
                    },
                    {
                        "ErrorCode": 404,
                        "ResponsePagePath": "/index.html",
                        "ResponseCode": "200",
                        "ErrorCachingMinTTL": 0
                    }
                ]
            }
        }

        temp_cfg_path = "dist_config_temp.json"
        with open(temp_cfg_path, "w", encoding="utf-8") as f:
            json.dump(dist_config, f)

        try:
            create_res = run_json([
                "aws", "cloudfront", "create-distribution",
                "--distribution-config", f"file://{temp_cfg_path}",
                "--output", "json"
            ])
            dist_id = create_res["Distribution"]["Id"]
            dist_domain = create_res["Distribution"]["DomainName"]
            dist_arn = create_res["Distribution"]["ARN"]
            print(f"Created Distribution: {dist_id} ({dist_domain})")
        finally:
            if os.path.exists(temp_cfg_path):
                os.remove(temp_cfg_path)

    # Tag the distribution
    try:
        dist_tags = {
            "Items": [
                {"Key": "Project", "Value": "biblio-trend"},
                {"Key": "Environment", "Value": "dev"},
                {"Key": "CostCenter", "Value": "free-tier"}
            ]
        }
        run_cmd([
            "aws", "cloudfront", "tag-resource",
            "--resource", dist_arn,
            "--tags", json.dumps(dist_tags)
        ], check=False)
    except Exception as e:
        print(f"Tag note: {e}")

    print("\n=== 6. Applying S3 Bucket Policy for CloudFront OAC ===")
    bucket_policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "AllowCloudFrontServicePrincipalReadOnly",
                "Effect": "Allow",
                "Principal": {
                    "Service": "cloudfront.amazonaws.com"
                },
                "Action": "s3:GetObject",
                "Resource": f"arn:aws:s3:::{BUCKET_NAME}/*",
                "Condition": {
                    "StringEquals": {
                        "AWS:SourceArn": dist_arn
                    }
                }
            }
        ]
    }
    temp_pol_path = "bucket_policy_temp.json"
    with open(temp_pol_path, "w", encoding="utf-8") as f:
        json.dump(bucket_policy, f)

    try:
        run_cmd([
            "aws", "s3api", "put-bucket-policy",
            "--bucket", BUCKET_NAME,
            "--region", REGION,
            "--policy", f"file://{temp_pol_path}"
        ])
        print("S3 Bucket Policy successfully attached.")
    finally:
        if os.path.exists(temp_pol_path):
            os.remove(temp_pol_path)

    print("\n=== 7. Uploading Frontend to S3 ===")
    # 1. Hashed static assets (immutable 1-year cache)
    run_cmd([
        "aws", "s3", "sync", "frontend/dist", f"s3://{BUCKET_NAME}/",
        "--exclude", "index.html",
        "--exclude", "snapshots/*",
        "--exclude", "snapshots-run.json",
        "--cache-control", "public, max-age=31536000, immutable"
    ])
    # 2. Dynamic snapshots and SPA index.html (must revalidate)
    run_cmd([
        "aws", "s3", "sync", "frontend/dist", f"s3://{BUCKET_NAME}/",
        "--exclude", "*",
        "--include", "index.html",
        "--include", "snapshots/*",
        "--include", "snapshots-run.json",
        "--cache-control", "public, max-age=0, must-revalidate"
    ])
    print("Frontend assets synced successfully.")

    print("\n=== 8. Invaliding CloudFront Cache ===")
    inval_res = run_json([
        "aws", "cloudfront", "create-invalidation",
        "--distribution-id", dist_id,
        "--paths", "/*",
        "--output", "json"
    ])
    inval_id = inval_res.get("Invalidation", {}).get("Id")
    print(f"CloudFront invalidation created: {inval_id}")

    print("\n" + "=" * 60)
    print("DEPLOYMENT SUCCESSFUL!")
    print(f"Global CloudFront URL: https://{dist_domain}")
    print(f"Distribution ID:       {dist_id}")
    print(f"S3 Bucket:             {BUCKET_NAME} ({REGION})")
    print("=" * 60)
    return dist_domain, dist_id

if __name__ == "__main__":
    main()

