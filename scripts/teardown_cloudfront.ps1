# teardown_cloudfront.ps1 - Teardown biblio-trend S3 + CloudFront resources to return to true $0
param (
    [string]$BucketName = "",
    [string]$DistributionId = ""
)

$ErrorActionPreference = "Stop"

$identityJson = aws sts get-caller-identity --output json | ConvertFrom-Json
$accountId = $identityJson.Account

if (-not $BucketName) {
    $BucketName = "biblio-trend-$accountId"
}

Write-Host "=== TEARDOWN: biblio-trend cloud resources ===" -ForegroundColor Yellow

# CloudFront Distribution deletion
if (-not $DistributionId) {
    Write-Host "Locating CloudFront distribution for $BucketName..."
    $dists = aws cloudfront list-distributions --output json | ConvertFrom-Json
    $targetDist = $dists.DistributionList.Items | Where-Object { 
        $_.Origins.Items | Where-Object { $_.DomainName -like "$BucketName*" } 
    }
    if ($targetDist) {
        $DistributionId = $targetDist.Id
    }
}

if ($DistributionId) {
    Write-Host "Getting ETag for distribution $DistributionId..."
    $distConfig = aws cloudfront get-distribution-config --id $DistributionId --output json | ConvertFrom-Json
    $etag = aws cloudfront get-distribution-config --id $DistributionId --query "ETag" --output text

    if ($distConfig.DistributionConfig.Enabled) {
        Write-Host "Disabling distribution $DistributionId before deletion..."
        $distConfig.DistributionConfig.Enabled = $false
        $configJson = $distConfig.DistributionConfig | ConvertTo-Json -Depth 10
        $tempFile = [System.IO.Path]::GetTempFileName() + ".json"
        [System.IO.File]::WriteAllText($tempFile, $configJson)
        $update = aws cloudfront update-distribution --id $DistributionId --distribution-config "file://$tempFile" --if-match $etag --output json | ConvertFrom-Json
        $etag = $update.ETag
        Remove-Item $tempFile -ErrorAction SilentlyContinue

        Write-Host "Waiting for distribution to deploy disabled state (this may take a few minutes)..."
        aws cloudfront wait distribution-deployed --id $DistributionId
    }

    Write-Host "Deleting distribution $DistributionId..."
    aws cloudfront delete-distribution --id $DistributionId --if-match $etag
    Write-Host "Distribution deleted." -ForegroundColor Green
}

# S3 Bucket cleanup
Write-Host "Emptying S3 bucket $BucketName..."
aws s3 rm s3://$BucketName --recursive
Write-Host "Deleting S3 bucket $BucketName..."
aws s3 rb s3://$BucketName
Write-Host "S3 bucket deleted." -ForegroundColor Green

Write-Host "`nTEARDOWN COMPLETE. Resources wiped, returned to $0." -ForegroundColor Green

