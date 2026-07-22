# list_all.ps1 - Find TS files with missing .ts extensions in imports
Get-ChildItem -Path "src" -Recurse -Filter "*.ts" | ForEach-Object {
    $file = $_.FullName
    $lines = Get-Content $file
    $matches = $lines | ForEach-Object {
        if ($_ -match "from\s+['\"][^\.]*[^\\.]['\"](?=[^'\n]*\.)") {
            # Check if any '.' exists after the path (but not at the end)
            New-Object -TypeName PSObject -Property @{
                File = $file
                Line = $_
                LineNumber = $Matches.Index + 1
            }
        }
    }
    if ($matches) {
        Write-Host "`nFile: $file" -ForegroundColor Yellow
        Write-Host "Lines:" -ForegroundColor Cyan
        $matches | ForEach-Object {
            Write-Host "  Line ${_.LineNumber}: ${_.Line}" -ForegroundColor Green
        }
    }
}