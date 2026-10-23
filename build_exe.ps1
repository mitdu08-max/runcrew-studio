# ============================================================================
# RunCrew Studio - Compilation en executable autonome Windows
# ============================================================================
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

$desktop = [Environment]::GetFolderPath("Desktop")
Write-Host "[BUILD] Compilation de RunCrew_Studio.exe vers $desktop..." -ForegroundColor Cyan

npx -y pkg server.js --target node18-win-x64 --output "$desktop\RunCrew_Studio.exe"

if (Test-Path "$desktop\RunCrew_Studio.exe") {
    Write-Host "[SUCCESS] Executable compile avec succes sur le Bureau : $desktop\RunCrew_Studio.exe" -ForegroundColor Green
} else {
    Write-Host "[ERROR] Erreur lors de la compilation avec pkg." -ForegroundColor Red
}
