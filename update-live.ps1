Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "      DEPLOYMENT SOURCE SELECTOR          " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "1) main (Default)" -ForegroundColor Yellow
Write-Host "2) release/v2.0.0" -ForegroundColor Yellow
Write-Host "3) release/v3.0.0" -ForegroundColor Yellow
Write-Host "4) Custom tag / branch" -ForegroundColor Yellow
Write-Host "==========================================" -ForegroundColor Cyan

$choice = Read-Host "Select an option [1-4] (Press Enter for default)"

switch ($choice) {
    "2" { $target = "release/v2.0.0" }
    "3" { $target = "release/v3.0.0" }
    "4" { $target = Read-Host "Enter custom tag/ref name" }
    Default { $target = "main" }
}

if ([string]::IsNullOrWhitespace($target)) {
    Write-Host "No ref specified. Operation canceled." -ForegroundColor Red
    exit
}

Write-Host "`nDeploying '$target' -> remote 'live'..." -ForegroundColor Cyan

# Push target directly to explicit branch refspec refs/heads/live
git push origin ${target}:refs/heads/live --force

if ($LASTEXITCODE -eq 0) {
    Write-Host "`nSuccessfully force-synced '$target' to 'live'! Build triggered." -ForegroundColor Green
} else {
    Write-Host "`nDeployment failed." -ForegroundColor Red
}