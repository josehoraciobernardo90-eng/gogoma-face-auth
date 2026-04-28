@echo off
title GOGOMA SENTINEL - ORQUESTRADOR PROFISSIONAL
cls
echo =======================================================
echo    GOGOMA SENTINEL V3 - INICIANDO SISTEMA COMPLETO
echo =======================================================

echo [LIMPANDO PORTAS] Verificando se a porta 3001 esta ocupada...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3001') do (
    if NOT "%%a"=="" (
        echo [!] Encerrando processo antigo na porta 3001 (PID %%a)...
        taskkill /f /pid %%a >nul 2>&1
    )
)

echo [1/3] Iniciando Servidor Backend...
start "SENTINEL SERVER" cmd /k "cd server && node server.js"

echo [2/3] Iniciando Aplicativo Frontend...
start "SENTINEL DASHBOARD" cmd /k "cd client && npm run dev"

echo [3/3] Iniciando IA de Monitoramento Sentinel...
timeout /t 5
start "SENTINEL AI ENGINE" cmd /k "python sentinel_edge.py"

echo =======================================================
echo    SISTEMA OPERACIONAL!
echo    Acesse: http://localhost:7777
echo =======================================================
pause
