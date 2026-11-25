param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Bootstrap', 'Functions', 'Hosting', 'Rules', 'CalendarHotfix', 'RemainingSelective')]
    [string]$Stage,
    [switch]$Resume,
    [ValidateSet('onNotificationOutboxCreated', 'onUserProfileCreatedWelcomeEmail', 'createUserFromAdmin', 'updateMaxCapacityFromAdmin')]
    [string]$FunctionName
)

$ErrorActionPreference = 'Stop'
if ($Resume -and $Stage -notin @('Bootstrap', 'Functions')) { throw '-Resume solo se admite para Bootstrap y Functions.' }
if (($Stage -eq 'RemainingSelective') -ne [bool]$FunctionName) { throw 'Indica -FunctionName únicamente con -Stage RemainingSelective.' }
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
    if ($Stage -notin @('CalendarHotfix', 'RemainingSelective')) {
        & node scripts/release-controls.cjs assert-stage --project $proyectoFocus --manifest release/manifest.json --stage $Stage
        Comprobar-SalidaFocus
    }
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
            $tandaAnteriorFocus = @()
            $primeraComprobacionFocus = $true
            while ($true) {
                $salidaPlanFocus = & node scripts/release-controls.cjs plan-functions-resume --project $proyectoFocus --manifest release/manifest.json
                Comprobar-SalidaFocus
                $planFocus = ($salidaPlanFocus -join "`n") | ConvertFrom-Json
                $sinVerificarFocus = @($tandaAnteriorFocus | Where-Object { $_ -notin @($planFocus.verifiedFunctions) })
                if ($sinVerificarFocus.Count -gt 0) { throw "No se ha acreditado la tanda anterior: $($sinVerificarFocus -join ', '). Revisar y continuar con -Resume." }
                if ($planFocus.pendingSelective -or $planFocus.pendingRemainingSelective) { throw 'Hay paquetes pendientes de publicación selectiva individual. El paquete definitivo general no los sustituye.' }
                if ($primeraComprobacionFocus -and -not $Resume -and @($planFocus.verifiedFunctions).Count -gt 0 -and @($planFocus.pendingFunctions).Count -gt 0) {
                    throw 'Functions definitivas parcialmente publicadas. Usa -Stage Functions -Resume para omitir las verificadas.'
                }
                $primeraComprobacionFocus = $false
                Write-Host "Functions definitivas: $(@($planFocus.verifiedFunctions).Count) verificadas, $(@($planFocus.pendingFunctions).Count) pendientes."
                if (@($planFocus.batches).Count -eq 0) { break }
                $loteFocus = @($planFocus.batches)[0]
                $tandaAnteriorFocus = @($loteFocus.functions)
                if ($tandaAnteriorFocus.Count -lt 1 -or $tandaAnteriorFocus.Count -gt 5) { throw 'Tanda definitiva fuera del límite revisado.' }
                if ($loteFocus.codebase -eq 'portal') {
                    if ($tandaAnteriorFocus.Count -ne 1 -or $tandaAnteriorFocus[0] -ne 'deleteOwnAccount') { throw 'El plan portal no coincide con su único punto de entrada.' }
                    Push-Location -LiteralPath '../app_focus_club'
                    try {
                        & firebase deploy --project $proyectoFocus --only 'functions:portal:deleteOwnAccount'
                        Comprobar-SalidaFocus
                    } finally { Pop-Location }
                } elseif ($loteFocus.codebase -eq 'default') {
                    Publicar-TandasFocus -Configuracion 'firebase.json' -Nombres $tandaAnteriorFocus
                } else { throw 'Codebase no reconocido en el plan definitivo.' }
            }
        }
        'Hosting' {
            & firebase deploy --project $proyectoFocus --only 'hosting'
            Comprobar-SalidaFocus
        }
        'Rules' {
            & firebase deploy --project $proyectoFocus --only 'firestore:rules'
            Comprobar-SalidaFocus
        }
        'CalendarHotfix' {
            $salidaPlanFocus = & node scripts/release-controls.cjs plan-calendar-hotfix --project $proyectoFocus --manifest release/manifest.json
            Comprobar-SalidaFocus
            $planFocus = ($salidaPlanFocus -join "`n") | ConvertFrom-Json
            $pendientesFocus = @($planFocus.pendingFunctions)
            if ($pendientesFocus.Count -eq 1 -and $pendientesFocus[0] -eq 'syncAppointmentWithGoogleCalendar') {
                Publicar-TandasFocus -Configuracion 'firebase.json' -Nombres $pendientesFocus
            } elseif ($pendientesFocus.Count -ne 0) { throw 'El plan contiene otras Functions. Se cancela la publicación selectiva.' }
            & node scripts/release-controls.cjs verify-calendar-hotfix --project $proyectoFocus --manifest release/manifest.json
            Comprobar-SalidaFocus
        }
        'RemainingSelective' {
            $salidaPlanFocus = & node scripts/release-controls.cjs plan-remaining-selective --project $proyectoFocus --manifest release/manifest.json --function $FunctionName
            Comprobar-SalidaFocus
            $planFocus = ($salidaPlanFocus -join "`n") | ConvertFrom-Json
            if ($FunctionName -notin @($planFocus.remainingSelectiveFunctions)) {
                $preflightFocus = $planFocus.preflight
                if ($preflightFocus.name -cne $FunctionName -or $preflightFocus.config -cnotmatch '^release/remaining-selective/[a-f0-9]{20}/firebase\.json$' -or
                    $preflightFocus.buildCpu -le 0 -or $preflightFocus.runWrites -le 0 -or $preflightFocus.functionWrites -le 0 -or
                    $preflightFocus.cpu.limit -le $preflightFocus.cpu.peak -or $preflightFocus.memory.limit -le $preflightFocus.memory.peak) {
                    throw 'El preflight no acredita el paquete exacto y las cuotas. No se inicia la publicación.'
                }
                Write-Host "Publicando individualmente $FunctionName"
                & firebase deploy --non-interactive --project $proyectoFocus --config $preflightFocus.config --only "functions:$FunctionName"
                Comprobar-SalidaFocus
            }
            & node scripts/release-controls.cjs verify-remaining-selective --project $proyectoFocus --manifest release/manifest.json --function $FunctionName
            Comprobar-SalidaFocus
        }
    }
} finally { Pop-Location }
