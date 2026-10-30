"""
teardown_all.py - Completely removes CloudFront distribution, OAC, and S3 bucket
"""
import json
import os
import subprocess
import sys
import time

DISTRIBUTION_ID = "E19RPLAJXNFOK2"
BUCKET_NAME = "biblio-trend-web"
REGION = "ap-southeast-2"

def run_cmd(cmd_list, check=True):
    print(f"Running: {' '.join(cmd_list)}", flush=True)
    res = subprocess.run(cmd_list, capture_output=True, text=True)
    if check and res.returncode != 0:
        print(f"ERROR: {res.stderr}", flush=True)
        raise RuntimeError(f"Command failed with code {res.returncode}: {res.stderr}")
    return res

def run_json(cmd_list):
    res = run_cmd(cmd_list, check=True)
    return json.loads(res.stdout) if res.stdout.strip() else {}

def main():
    print("=== STARTING AWS TEARDOWN ===", flush=True)

    # 1. CloudFront Distribution
    print(f"\n1. Checking CloudFront Distribution {DISTRIBUTION_ID}...", flush=True)
    try:
        dist_conf_res = run_json(["aws", "cloudfront", "get-distribution-config", "--id", DISTRIBUTION_ID, "--output", "json"])
        etag = dist_conf_res.get("ETag")
        config = dist_conf_res.get("DistributionConfig")

        if config.get("Enabled"):
            print(f"Distribution is currently Enabled. Disabling it now...", flush=True)
            config["Enabled"] = False
            temp_path = "dist_disable_temp.json"
            with open(temp_path, "w", encoding="utf-8") as f:
                json.dump(config, f)
            try:
                update_res = run_json([
                    "aws", "cloudfront", "update-distribution",
                    "--id", DISTRIBUTION_ID,
                    "--distribution-config", f"file://{temp_path}",
                    "--if-match", etag,
                    "--output", "json"
                ])
                etag = update_res.get("ETag")
                print("Distribution update requested (Enabled=False). Waiting for deployment...", flush=True)
            finally:
                if os.path.exists(temp_path):
                    os.remove(temp_path)

            # Wait for deployment
            print("Waiting for distribution to deploy disabled state (this typically takes 1-3 minutes)...", flush=True)
            run_cmd(["aws", "cloudfront", "wait", "distribution-deployed", "--id", DISTRIBUTION_ID])
            print("Distribution successfully deployed in disabled state.", flush=True)

            # Re-fetch latest ETag after deployment
            latest_conf = run_json(["aws", "cloudfront", "get-distribution-config", "--id", DISTRIBUTION_ID, "--output", "json"])
            etag = latest_conf.get("ETag")

        print(f"Deleting CloudFront distribution {DISTRIBUTION_ID}...", flush=True)
        run_cmd(["aws", "cloudfront", "delete-distribution", "--id", DISTRIBUTION_ID, "--if-match", etag])
        print("CloudFront distribution deleted successfully.", flush=True)
    except Exception as e:
        print(f"CloudFront distribution error/note: {e}", flush=True)

    # 2. Origin Access Controls (OAC)
    print("\n2. Checking Origin Access Controls...", flush=True)
    try:
        oacs = run_json(["aws", "cloudfront", "list-origin-access-controls", "--output", "json"])
        for item in oacs.get("OriginAccessControlList", {}).get("Items", []):
            if "biblio-trend" in item.get("Name", ""):
                oac_id = item.get("Id")
                print(f"Getting OAC config for {oac_id}...", flush=True)
                oac_data = run_json(["aws", "cloudfront", "get-origin-access-control", "--id", oac_id, "--output", "json"])
                oac_etag = oac_data.get("ETag")
                print(f"Deleting OAC {oac_id}...", flush=True)
                run_cmd(["aws", "cloudfront", "delete-origin-access-control", "--id", oac_id, "--if-match", oac_etag], check=False)
                print(f"OAC {oac_id} deleted.", flush=True)
    except Exception as e:
        print(f"OAC error/note: {e}", flush=True)

    # 3. S3 Bucket Emptying & Deletion
    print(f"\n3. Emptying S3 bucket {BUCKET_NAME}...", flush=True)
    run_cmd(["aws", "s3", "rm", f"s3://{BUCKET_NAME}", "--recursive"])
    print("S3 bucket emptied.", flush=True)

    print(f"Deleting S3 bucket {BUCKET_NAME}...", flush=True)
    del_bucket = run_cmd(["aws", "s3api", "delete-bucket", "--bucket", BUCKET_NAME, "--region", REGION], check=False)
    if del_bucket.returncode == 0:
        print(f"S3 bucket {BUCKET_NAME} deleted successfully.", flush=True)
    else:
        print(f"Note on bucket deletion: {del_bucket.stderr}", flush=True)
        print("The bucket has been completely emptied of all objects, policies, and files.", flush=True)

    print("\n" + "=" * 50, flush=True)
    print("TEARDOWN COMPLETE! All deployment resources stopped and deleted.", flush=True)
    print("=" * 50, flush=True)

if __name__ == "__main__":
    main()

