$root = $PSScriptRoot

$backend = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"

# Iniciar Flask
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "Set-Location '$backend'; .\.venv\Scripts\Activate.ps1; python -m flask --app app.py run --debug"
)

# Iniciar frontend si existe
if (Test-Path (Join-Path $frontend "package.json")) {
    Start-Process powershell -ArgumentList @(
        "-NoExit",
        "-Command",
        "Set-Location '$frontend'; npm run dev"
    )
}
else {
    Write-Host "No se encontró frontend/package.json. Se inició únicamente Flask."
}