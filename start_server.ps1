#!/usr/bin/env pwsh
param(
  [int]$Port = 4444
)

$ErrorActionPreference = 'Stop'

# Stop existing server on this port
$existing = netstat -ano | Select-String ":${Port}\s" | ForEach-Object { ($_ -split '\s+')[-1] } | Select-Object -Unique
if ($existing) {
    foreach ($procId in $existing) {
        if ($procId -match '^\d+$') {
            Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue | Out-Null
        }
    }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidFile = Join-Path $scriptDir ".server.pid"
if (Test-Path $pidFile) { Remove-Item $pidFile -Force -ErrorAction SilentlyContinue | Out-Null }

$proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c","set PORT=$Port && npx ts-node src/index.ts" -WorkingDirectory $scriptDir -NoNewWindow -PassThru
Set-Content -Path $pidFile -Value $proc.Id
Write-Host "Server starting on port $Port"
