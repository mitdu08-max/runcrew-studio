# ============================================================================
# RunCrew Studio - Compilation en executable autonome Windows
# ============================================================================
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

# 1. Verification / Build de l'interface React moderne
if (Test-Path "ui_web\dist\index.html") {
    Copy-Item "ui_web\dist\index.html" "ui_dist.html" -Force
    Write-Host "[BUILD] Interface React moderne detectee (ui_dist.html prepare)." -ForegroundColor Green
} elseif (Test-Path "ui_web\package.json") {
    Write-Host "[BUILD] Compilation du bundle React ui_web..." -ForegroundColor Cyan
    npm --prefix ui_web run build
    Copy-Item "ui_web\dist\index.html" "ui_dist.html" -Force
}

$desktop = [Environment]::GetFolderPath("Desktop")
Write-Host "[BUILD] Compilation de RunCrew_Studio.exe vers $desktop..." -ForegroundColor Cyan

npx -y pkg server.js --target node18-win-x64 --output "$desktop\RunCrew_Studio.exe"

if (Test-Path "$desktop\RunCrew_Studio.exe") {
    Write-Host "[SUCCESS] Executable compile avec succes sur le Bureau : $desktop\RunCrew_Studio.exe" -ForegroundColor Green
} else {
    Write-Host "[ERROR] Erreur lors de la compilation avec pkg." -ForegroundColor Red
}
