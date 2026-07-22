#!/usr/bin/env pwsh
param(
  [int]$Port = 4444
)

$ErrorActionPreference = 'SilentlyContinue'

# Stop by pidfile if present
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidFile = Join-Path $scriptDir ".server.pid"
if (Test-Path $pidFile) {
    $serverPid = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($serverPid -match '^\d+$') {
        Stop-Process -Id $serverPid -Force | Out-Null
    }
    Remove-Item $pidFile -Force | Out-Null
}

# Stop anything else occupying the port
Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | ForEach-Object {
    Stop-Process -Id $_.OwningProcess -Force | Out-Null
}

Write-Host "No server running on port $Port"
