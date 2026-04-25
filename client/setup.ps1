# Setup script para baixar os modelos do face-api.js
# ---------------------------------------------------
# Este script cria a pasta public\models e baixa os três modelos necessários:
#   - ssd_mobilenetv1
#   - face_landmark_68
#   - face_recognition
# Ele usa URLs oficiais do repositório face-api.js-models.
# ---------------------------------------------------
$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$modelsDir   = Join-Path $projectRoot "public\models"

Write-Host "Diretório do projeto: $projectRoot"
Write-Host "Criando pasta de modelos em: $modelsDir"

if (-Not (Test-Path $modelsDir)) {
    New-Item -ItemType Directory -Path $modelsDir -Force | Out-Null
    Write-Host "Pasta criada."
} else {
    Write-Host "Pasta já existe."
}

# URLs dos arquivos de manifesto (os .bin são baixados automaticamente quando o face‑api os solicita)
$urls = @(
    "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/ssd_mobilenetv1_model-weights_manifest.json",
    "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/face_landmark_68_model-weights_manifest.json",
    "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/face_recognition_model-weights_manifest.json"
)

foreach ($url in $urls) {
    $fileName = Split-Path $url -Leaf
    $destPath = Join-Path $modelsDir $fileName
    Write-Host "Baixando $fileName..."
    Invoke-WebRequest -Uri $url -OutFile $destPath -UseBasicParsing
    Write-Host "  -> Salvo em $destPath"
}

Write-Host "Todos os manifestos foram baixados."
Write-Host "Quando a aplicação rodar, o face‑api.js baixará automaticamente os arquivos .bin referenciados nos manifestos."
Write-Host "Pronto! Agora execute: npm run dev"
