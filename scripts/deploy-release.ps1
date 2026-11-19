param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Bootstrap', 'Functions', 'Hosting', 'Rules')]
    [string]$Stage,
    [switch]$Resume
)

$ErrorActionPreference = 'Stop'
if ($Resume -and $Stage -ne 'Bootstrap') { throw '-Resume solo se admite para Bootstrap.' }
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
            $primeraComprobacionFocus = $true
            while ($true) {
                & node scripts/release-controls.cjs assert-stage --project $proyectoFocus --manifest release/manifest.json --stage Bootstrap
                Comprobar-SalidaFocus
                $salidaPlanFocus = & node scripts/release-controls.cjs plan-bootstrap-resume --project $proyectoFocus --manifest release/manifest.json
                Comprobar-SalidaFocus
                $planFocus = ($salidaPlanFocus -join "`n") | ConvertFrom-Json
                if ($primeraComprobacionFocus -and -not $Resume -and @($planFocus.verifiedFunctions).Count -gt 0 -and @($planFocus.pendingFunctions).Count -gt 0) {
                    throw 'Bootstrap parcialmente publicado. Usa -Stage Bootstrap -Resume para omitir las Functions verificadas.'
                }
                $primeraComprobacionFocus = $false
                Write-Host "Bootstrap: $(@($planFocus.verifiedFunctions).Count) Functions verificadas; $(@($planFocus.pendingFunctions).Count) pendientes."
                if (@($planFocus.batches).Count -eq 0) { break }
                $lotePendienteFocus = @($planFocus.batches)[0]
                Publicar-TandasFocus -Configuracion $lotePendienteFocus.config -Nombres @($lotePendienteFocus.functions) -Portal ([bool]$lotePendienteFocus.portal)
            }
            if ($planFocus.rules.status -eq 'pending') {
                & node scripts/release-controls.cjs assert-stage --project $proyectoFocus --manifest release/manifest.json --stage Bootstrap
                Comprobar-SalidaFocus
                & firebase deploy --project $proyectoFocus --config 'release/bootstrap/firebase.json' --only 'firestore:rules'
                Comprobar-SalidaFocus
            }
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
