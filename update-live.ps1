# Ensure local main has latest changes from remote
Write-Host "Fetching latest changes..." -ForegroundColor Cyan
git fetch origin main:main

# Force push local main to remote live branch
Write-Host "Pushing main -> live..." -ForegroundColor Cyan
git push origin main:refs/heads/live --force

# Update local 'live' branch pointer to match main
git branch -f live main

Write-Host "Successfully synced main to live! Vercel & Render build triggered." -ForegroundColor Green
