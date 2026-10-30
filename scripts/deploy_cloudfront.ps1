# deploy_cloudfront.ps1 - Automated S3 + CloudFront deployment according to PROJECT_MASTER_PLAN.md (§13 & §14)
param (
    [string]$Region = "ap-south-1",
    [string]$BucketName = ""
)

$ErrorActionPreference = "Stop"

Write-Host "=== 1. Checking AWS Caller Identity ===" -ForegroundColor Cyan
$identityJson = aws sts get-caller-identity --output json | ConvertFrom-Json
$accountId = $identityJson.Account
$callerArn = $identityJson.Arn
Write-Host "Account: $accountId"
Write-Host "ARN:     $callerArn"

if (-not $BucketName) {
    $BucketName = "biblio-trend-$accountId"
}
Write-Host "Target S3 Bucket: $BucketName" -ForegroundColor Cyan

# Ensure frontend build is up-to-date
Write-Host "`n=== 2. Building Frontend ===" -ForegroundColor Cyan
Push-Location "frontend"
npm run build
Pop-Location

# 1. S3 Bucket Creation
Write-Host "`n=== 3. Ensuring S3 Bucket Exists ===" -ForegroundColor Cyan
$bucketExists = $false
try {
    aws s3api head-bucket --bucket $BucketName 2>$null
    $bucketExists = $true
    Write-Host "Bucket $BucketName already exists." -ForegroundColor Green
} catch {
    Write-Host "Creating bucket $BucketName in $Region..." -ForegroundColor Yellow
    if ($Region -eq "us-east-1") {
        aws s3api create-bucket --bucket $BucketName
    } else {
        aws s3api create-bucket --bucket $BucketName --region $Region --create-bucket-configuration LocationConstraint=$Region
    }
}

# Tag S3 Bucket
Write-Host "Tagging S3 Bucket with Project=biblio-trend, Environment=dev, CostCenter=free-tier..."
aws s3api put-bucket-tagging --bucket $BucketName --tagging "TagSet=[{Key=Project,Value=biblio-trend},{Key=Environment,Value=dev},{Key=CostCenter,Value=free-tier}]"

# Block all public access (CloudFront OAC will access it privately)
Write-Host "Enforcing S3 Block Public Access..."
aws s3api put-public-access-block --bucket $BucketName --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

# 2. CloudFront Origin Access Control (OAC)
Write-Host "`n=== 4. Configuring CloudFront Origin Access Control (OAC) ===" -ForegroundColor Cyan
$oacName = "biblio-trend-oac-$accountId"
$existingOac = aws cloudfront list-origin-access-controls --output json | ConvertFrom-Json
$oac = $existingOac.OriginAccessControlList.Items | Where-Object { $_.Name -eq $oacName }

if (-not $oac) {
    Write-Host "Creating Origin Access Control: $oacName..."
    $oacConfig = @{
        Name = $oacName
        Description = "OAC for biblio-trend S3 bucket"
        SigningProtocol = "sigv4"
        SigningBehavior = "always"
        OriginAccessControlOriginType = "s3"
    } | ConvertTo-Json -Compress

    $oacResult = aws cloudfront create-origin-access-control --origin-access-control-config "$oacConfig" --output json | ConvertFrom-Json
    $oacId = $oacResult.OriginAccessControl.Id
} else {
    $oacId = $oac.Id
    Write-Host "Using existing OAC: $oacId" -ForegroundColor Green
}

# 3. CloudFront Distribution
Write-Host "`n=== 5. Configuring CloudFront Distribution ===" -ForegroundColor Cyan
$s3Domain = "$BucketName.s3.$Region.amazonaws.com"
if ($Region -eq "us-east-1") {
    $s3Domain = "$BucketName.s3.amazonaws.com"
}
$originId = "S3-$BucketName"

# Check if distribution already exists for this origin
$existingDists = aws cloudfront list-distributions --output json | ConvertFrom-Json
$dist = $existingDists.DistributionList.Items | Where-Object { 
    $_.Origins.Items | Where-Object { $_.DomainName -eq $s3Domain } 
}

if (-not $dist) {
    Write-Host "Creating new CloudFront Distribution for $s3Domain..." -ForegroundColor Yellow
    $callerRef = [guid]::NewGuid().ToString()

    $distConfig = @{
        CallerReference = $callerRef
        Comment = "biblio-trend global frontend distribution"
        DefaultRootObject = "index.html"
        Enabled = $true
        Origins = @{
            Quantity = 1
            Items = @(
                @{
                    Id = $originId
                    DomainName = $s3Domain
                    OriginAccessControlId = $oacId
                    S3OriginConfig = @{
                        OriginAccessIdentity = ""
                    }
                }
            )
        }
        DefaultCacheBehavior = @{
            TargetOriginId = $originId
            ViewerProtocolPolicy = "redirect-to-https"
            AllowedMethods = @{
                Quantity = 2
                Items = @("GET", "HEAD")
                CachedMethods = @{
                    Quantity = 2
                    Items = @("GET", "HEAD")
                }
            }
            ForwardedValues = @{
                QueryString = $false
                Cookies = @{ Forward = "none" }
            }
            MinTTL = 0
            DefaultTTL = 86400
            MaxTTL = 31536000
            Compress = $true
        }
        CustomErrorResponses = @{
            Quantity = 2
            Items = @(
                @{
                    ErrorCode = 403
                    ResponsePagePath = "/index.html"
                    ResponseCode = "200"
                    ErrorCachingMinTTL = 0
                },
                @{
                    ErrorCode = 404
                    ResponsePagePath = "/index.html"
                    ResponseCode = "200"
                    ErrorCachingMinTTL = 0
                }
            )
        }
    }

    $distConfigJson = $distConfig | ConvertTo-Json -Depth 10
    $tempConfigFile = [System.IO.Path]::GetTempFileName() + ".json"
    [System.IO.File]::WriteAllText($tempConfigFile, $distConfigJson)

    $createResult = aws cloudfront create-distribution --distribution-config "file://$tempConfigFile" --output json | ConvertFrom-Json
    Remove-Item $tempConfigFile -ErrorAction SilentlyContinue

    $distId = $createResult.Distribution.Id
    $distDomain = $createResult.Distribution.DomainName
    $distArn = $createResult.Distribution.ARN
} else {
    $distId = $dist.Id
    $distDomain = $dist.DomainName
    $distArn = $dist.ARN
    Write-Host "Found existing CloudFront distribution: $distId ($distDomain)" -ForegroundColor Green
}

# Tag CloudFront Distribution
Write-Host "Tagging CloudFront Distribution..."
aws cloudfront tag-resource --resource $distArn --tags "Items=[{Key=Project,Value=biblio-trend},{Key=Environment,Value=dev},{Key=CostCenter,Value=free-tier}]" 2>$null

# 4. S3 Bucket Policy for CloudFront OAC
Write-Host "`n=== 6. Applying S3 Bucket Policy for CloudFront Access ===" -ForegroundColor Cyan
$bucketPolicy = @{
    Version = "2012-10-17"
    Statement = @(
        @{
            Sid = "AllowCloudFrontServicePrincipalReadOnly"
            Effect = "Allow"
            Principal = @{
                Service = "cloudfront.amazonaws.com"
            }
            Action = "s3:GetObject"
            Resource = "arn:aws:s3:::$BucketName/*"
            Condition = @{
                StringEquals = @{
                    "AWS:SourceArn" = $distArn
                }
            }
        }
    )
} | ConvertTo-Json -Depth 6

$tempPolicyFile = [System.IO.Path]::GetTempFileName() + ".json"
[System.IO.File]::WriteAllText($tempPolicyFile, $bucketPolicy)
aws s3api put-bucket-policy --bucket $BucketName --policy "file://$tempPolicyFile"
Remove-Item $tempPolicyFile -ErrorAction SilentlyContinue
Write-Host "Bucket policy applied." -ForegroundColor Green

# 5. Uploading Frontend Assets
Write-Host "`n=== 7. Uploading Frontend to S3 ===" -ForegroundColor Cyan
# Immutable hashed assets
aws s3 sync frontend/dist s3://$BucketName/ --exclude "index.html" --exclude "snapshots/*" --exclude "snapshots-run.json" --cache-control "public, max-age=31536000, immutable"
# HTML & Dynamic snapshot JSONs (must revalidate)
aws s3 sync frontend/dist s3://$BucketName/ --exclude "*" --include "index.html" --include "snapshots/*" --include "snapshots-run.json" --cache-control "public, max-age=0, must-revalidate"

# 6. CloudFront Cache Invalidation
Write-Host "`n=== 8. CloudFront Invalidation ===" -ForegroundColor Cyan
aws cloudfront create-invalidation --distribution-id $distId --paths "/*" | Out-Null
Write-Host "Invalidation initiated." -ForegroundColor Green

Write-Host "`n========================================================" -ForegroundColor Green
Write-Host "DEPLOYMENT COMPLETE!" -ForegroundColor Green
Write-Host "Global CloudFront URL: https://$distDomain" -ForegroundColor Cyan
Write-Host "Distribution ID:       $distId" -ForegroundColor Cyan
Write-Host "Bucket:                $BucketName" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Green

