# ============================================================================
# RunCrew Studio — Compilation en exécutable autonome Windows
# ============================================================================
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

$desktop = [Environment]::GetFolderPath("Desktop")
Write-Host "🔨 Compilation de RunCrew_Studio.exe vers $desktop..." -ForegroundColor Cyan

npx -y pkg server.js --target node18-win-x64 --output "$desktop\RunCrew_Studio.exe"

if (Test-Path "$desktop\RunCrew_Studio.exe") {
    Write-Host "✅ Exécutable compilé avec succès sur le Bureau : $desktop\RunCrew_Studio.exe" -ForegroundColor Green
} else {
    Write-Host "❌ Erreur lors de la compilation avec pkg." -ForegroundColor Red
}
