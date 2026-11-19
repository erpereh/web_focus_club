param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Bootstrap', 'Functions', 'Hosting', 'Rules')]
    [string]$Stage
)

$ErrorActionPreference = 'Stop'
$raizFocus = Split-Path -Parent $PSScriptRoot
$proyectoFocus = 'focus-club-f73b8'
Push-Location -LiteralPath $raizFocus
try {
    function Comprobar-SalidaFocus {
        if ($LASTEXITCODE -ne 0) { throw "El comando anterior ha fallado ($LASTEXITCODE). No continuar." }
    }
    function Publicar-TandasFocus([string]$Configuracion, [string[]]$Nombres, [bool]$Portal = $false) {
        if ($Nombres.Count -eq 0) { throw 'Lista de Functions vacía.' }
        for ($inicioFocus = 0; $inicioFocus -lt $Nombres.Count; $inicioFocus += 5) {
            $finFocus = [Math]::Min($inicioFocus + 4, $Nombres.Count - 1)
            $loteFocus = @($Nombres[$inicioFocus..$finFocus])
            $prefijoFocus = if ($Portal) { 'functions:portal:' } else { 'functions:' }
            $filtroFocus = ($loteFocus | ForEach-Object { "$prefijoFocus$_" }) -join ','
            Write-Host "Publicando tanda de $($loteFocus.Count): $($loteFocus -join ', ')"
            & firebase deploy --project $proyectoFocus --config $Configuracion --only $filtroFocus
            Comprobar-SalidaFocus
        }
    }
    & node scripts/release-controls.cjs assert-stage --project $proyectoFocus --manifest release/manifest.json --stage $Stage
    Comprobar-SalidaFocus
    $manifiestoFocus = Get-Content -Raw -LiteralPath 'release/manifest.json' | ConvertFrom-Json
    switch ($Stage) {
        'Bootstrap' {
            & node scripts/release-controls.cjs preflight --project $proyectoFocus --manifest release/manifest.json
            Comprobar-SalidaFocus
            foreach ($artefactoFocus in $manifiestoFocus.bootstrap.artifacts) {
                Publicar-TandasFocus -Configuracion $artefactoFocus.config -Nombres @($artefactoFocus.functions) -Portal ([bool]$artefactoFocus.portal)
            }
            & firebase deploy --project $proyectoFocus --config 'release/bootstrap/firebase.json' --only 'firestore:rules'
            Comprobar-SalidaFocus
            & node scripts/release-controls.cjs verify-bootstrap --project $proyectoFocus --manifest release/manifest.json
            Comprobar-SalidaFocus
        }
        'Functions' {
            Publicar-TandasFocus -Configuracion 'firebase.json' -Nombres @($manifiestoFocus.webFunctions)
            Push-Location -LiteralPath '../app_focus_club'
            try {
                & firebase deploy --project $proyectoFocus --only 'functions:portal:deleteOwnAccount'
                Comprobar-SalidaFocus
            } finally { Pop-Location }
        }
        'Hosting' {
            & firebase deploy --project $proyectoFocus --only 'hosting'
            Comprobar-SalidaFocus
        }
        'Rules' {
            & firebase deploy --project $proyectoFocus --only 'firestore:rules'
            Comprobar-SalidaFocus
        }
    }
} finally { Pop-Location }
