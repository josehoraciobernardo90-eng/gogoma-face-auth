# Gogoma Sentinel - Iniciar Todos os Servicos
# Execute este script para iniciar o servidor e o cliente ao mesmo tempo

$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host "  [GOGOMA SENTINEL] Iniciando..." -ForegroundColor Green
Write-Host ""

# Inicia o servidor em background
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$ROOT\server'; Write-Host '[SERVER] Iniciando na porta 3001...' -ForegroundColor Cyan; npm run dev" -WindowStyle Normal

Start-Sleep -Seconds 2

# Inicia o cliente em background
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$ROOT\client'; Write-Host '[CLIENT] Iniciando na porta 7777...' -ForegroundColor Green; npm run dev" -WindowStyle Normal

Start-Sleep -Seconds 4

# Abre o browser
Start-Process "http://localhost:7777"

Write-Host "  Sistema iniciado! Abrindo http://localhost:7777..." -ForegroundColor Green
