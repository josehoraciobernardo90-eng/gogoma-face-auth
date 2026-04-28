# Gogoma Sentinel - Setup Script
# Este script instala todas as dependencias e baixa os modelos de IA

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   GOGOMA SENTINEL - SETUP AUTOMATICO   " -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path

# 1. Instalar dependencias do servidor
Write-Host "[1/4] Instalando dependencias do servidor..." -ForegroundColor Yellow
Set-Location "$ROOT\server"
npm install
Write-Host "    Servidor OK!" -ForegroundColor Green
Write-Host ""

# 2. Instalar dependencias do cliente
Write-Host "[2/4] Instalando dependencias do cliente..." -ForegroundColor Yellow
Set-Location "$ROOT\client"
npm install
Write-Host "    Cliente OK!" -ForegroundColor Green
Write-Host ""

# 3. Baixar modelos face-api.js
Write-Host "[3/4] Baixando modelos de IA (face-api.js)..." -ForegroundColor Yellow
$MODELS_DIR = "$ROOT\client\public\models"
New-Item -ItemType Directory -Force -Path $MODELS_DIR | Out-Null

$BASE_URL = "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights"
$MODEL_FILES = @(
    "tiny_face_detector_model-shard1",
    "tiny_face_detector_model-weights_manifest.json",
    "face_landmark_68_model-shard1",
    "face_landmark_68_model-weights_manifest.json",
    "face_recognition_model-shard1",
    "face_recognition_model-shard2",
    "face_recognition_model-weights_manifest.json"
)

foreach ($file in $MODEL_FILES) {
    $url = "$BASE_URL/$file"
    $dest = "$MODELS_DIR\$file"
    if (-not (Test-Path $dest)) {
        Write-Host "    Baixando: $file" -ForegroundColor Gray
        try {
            Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
        } catch {
            Write-Host "    AVISO: Nao foi possivel baixar $file - verifique a conexao" -ForegroundColor Red
        }
    } else {
        Write-Host "    Ja existe: $file" -ForegroundColor Gray
    }
}
Write-Host "    Modelos OK!" -ForegroundColor Green
Write-Host ""

# 4. Verificar arquivo .env
Write-Host "[4/4] Verificando configuracao .env..." -ForegroundColor Yellow
$ENV_FILE = "$ROOT\server\.env"
if (Test-Path $ENV_FILE) {
    $envContent = Get-Content $ENV_FILE -Raw
    if ($envContent -match "sua_chave_aqui") {
        Write-Host ""
        Write-Host "============================================" -ForegroundColor Red
        Write-Host "  ATENCAO: Configure seu .env do servidor!  " -ForegroundColor Red
        Write-Host "============================================" -ForegroundColor Red
        Write-Host "  Abra: server\.env" -ForegroundColor Yellow
        Write-Host "  Substitua 'sua_chave_aqui' pela sua chave Azure Face API" -ForegroundColor Yellow
        Write-Host ""
    } else {
        Write-Host "    .env configurado!" -ForegroundColor Green
    }
} else {
    Write-Host "    ERRO: Arquivo .env nao encontrado!" -ForegroundColor Red
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   SETUP COMPLETO! Como iniciar:        " -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Terminal 1 (servidor):" -ForegroundColor White
Write-Host "    cd server && npm run dev" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Terminal 2 (cliente):" -ForegroundColor White
Write-Host "    cd client && npm run dev" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Abra: http://localhost:5173" -ForegroundColor Cyan
Write-Host ""

Set-Location $ROOT
