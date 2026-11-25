const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const pwshAvailable = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], { encoding: 'utf8' }).status === 0;
const literal = value => "'" + value.replaceAll("'", "''") + "'";
function runScenario({ complete = false, resume = true, lostResponse = false, readFailure = false, noProgress = false, stage = 'Bootstrap', wrongCalendarPlan = false, pendingSelective = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-bootstrap-script-test-'));
  try {
    const projectDirectory = path.join(directory, 'web_focus_club');
    fs.mkdirSync(projectDirectory);
    fs.mkdirSync(path.join(directory, 'app_focus_club'));
    const scriptPath = path.join(projectDirectory, 'scripts/deploy-release.ps1');
    fs.mkdirSync(path.join(projectDirectory, 'scripts'));
    fs.copyFileSync(path.resolve(__dirname, '../../scripts/deploy-release.ps1'), scriptPath);
    const plan = pending => ({ verifiedFunctions: pending ? ['alreadyPublished'] : ['alreadyPublished', 'deleteOwnAccount'], pendingFunctions: pending ? ['deleteOwnAccount'] : [],
      batches: pending ? [{ config: 'release/bootstrap/portal/firebase.json', portal: true, codebase: 'portal', functions: ['deleteOwnAccount'] }] : [],
      ...(pendingSelective ? { pendingSelective: [{ name: 'updateOwnAppointmentSlot' }] } : {}), rules: { status: complete ? 'verified' : 'pending' } });
    const calendarPlan = { pendingFunctions: [wrongCalendarPlan ? 'anotherFunction' : 'syncAppointmentWithGoogleCalendar'] };
    const command = `
      $global:LASTEXITCODE=0; $global:published=${complete ? '$true' : '$false'}; $global:invocations=@(); $global:lostResponse=${lostResponse ? '$true' : '$false'}
      function global:node {
        param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Items)
        $global:LASTEXITCODE=0
        if ($Items[1] -in @('plan-bootstrap-resume', 'plan-functions-resume')) {
          ${readFailure ? '$global:LASTEXITCODE=9; return' : ''}
          if ($global:published) { ${literal(JSON.stringify(plan(false)))} } else { ${literal(JSON.stringify(plan(true)))} }
        }
        if ($Items[1] -eq 'plan-calendar-hotfix') {
          if ($global:published) { '{"pendingFunctions":[]}' } else { ${literal(JSON.stringify(calendarPlan))} }
        }
        if ($Items[1] -eq 'verify-calendar-hotfix' -and -not $global:published) { $global:LASTEXITCODE=9 }
      }
      function global:firebase {
        param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Items)
        $global:invocations += ($Items -join ' '); $global:LASTEXITCODE=0
        if ($Items[-1] -in @('functions:portal:deleteOwnAccount','functions:syncAppointmentWithGoogleCalendar')) {
          ${noProgress ? '$global:published=$false' : '$global:published=$true'}
          if ($global:lostResponse) { $global:lostResponse=$false; $global:LASTEXITCODE=7 }
        }
      }
      try { & ${literal(scriptPath)} -Stage ${stage} ${resume ? '-Resume' : ''} } catch { Write-Host ('ERROR=' + $_.Exception.Message) }
      ${lostResponse ? `try { & ${literal(scriptPath)} -Stage ${stage} -Resume } catch { Write-Host ('RETRY_ERROR=' + $_.Exception.Message) }` : ''}
      Write-Host ('CALLS=' + (ConvertTo-Json -Compress -InputObject @($global:invocations)))
    `;
    const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.status, 0, result.stderr);
    const calls = JSON.parse(result.stdout.split(/\r?\n/).find(line => line.startsWith('CALLS=')).slice(6));
    return { calls, output: result.stdout };
  } finally {
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('focus-bootstrap-script-test-')) throw new Error('Unsafe test cleanup target.');
    fs.rmSync(resolved, { recursive: true });
  }
}
test('PowerShell Resume deploys only pending portal function, then preparatory rules', { skip: !pwshAvailable }, () => {
  const result = runScenario(); assert.equal(result.calls.length, 2);
  assert.match(result.calls[0], /--config release\/bootstrap\/portal\/firebase.json --only functions:portal:deleteOwnAccount/);
  assert.doesNotMatch(result.calls[0], /alreadyPublished/); assert.match(result.calls[1], /--only firestore:rules/);
});
test('PowerShell completed retry performs no deployment', { skip: !pwshAvailable }, () => assert.deepEqual(runScenario({ complete: true }).calls, []));
test('PowerShell lost response stops, then retry skips the function that actually succeeded', { skip: !pwshAvailable }, () => {
  const result = runScenario({ lostResponse: true }); assert.match(result.output, /ERROR=.*7/); assert.equal(result.calls.length, 2);
  assert.equal(result.calls.filter(call => call.includes('functions:portal:deleteOwnAccount')).length, 1); assert.match(result.calls[1], /firestore:rules/);
});
test('PowerShell read failure stops before any deploy', { skip: !pwshAvailable }, () => { const result = runScenario({ readFailure: true }); assert.deepEqual(result.calls, []); assert.match(result.output, /ERROR=.*9/); });
test('PowerShell requires Resume for a partial Bootstrap', { skip: !pwshAvailable }, () => { const result = runScenario({ resume: false }); assert.deepEqual(result.calls, []); assert.match(result.output, /parcialmente publicado/); });
test('PowerShell Resume cannot be used to bypass Hosting controls', { skip: !pwshAvailable }, () => { const result = runScenario({ stage: 'Hosting' }); assert.deepEqual(result.calls, []); assert.match(result.output, /solo se admite para Bootstrap y Functions/); });
test('PowerShell Functions Resume verifies published batches and uses the portal codebase', { skip: !pwshAvailable }, () => {
  const result = runScenario({ stage: 'Functions', lostResponse: true });
  assert.match(result.output, /ERROR=.*7/);
  assert.doesNotMatch(result.output, /RETRY_ERROR/);
  assert.deepEqual(result.calls, ['deploy --project focus-club-f73b8 --only functions:portal:deleteOwnAccount']);
});
test('PowerShell Functions Resume stops if a successful CLI exit does not publish a reviewed revision', { skip: !pwshAvailable }, () => {
  const result = runScenario({ stage: 'Functions', noProgress: true });
  assert.equal(result.calls.length, 1);
  assert.match(result.output, /No se ha acreditado la tanda anterior/);
});
test('PowerShell generic deployment stops before deploying a pending occupancy hotfix', { skip: !pwshAvailable }, () => {
  const result = runScenario({ stage: 'Functions', pendingSelective: true });
  assert.deepEqual(result.calls, []);
  assert.match(result.output, /publicación selectiva individual/);
});
test('PowerShell Calendar hotfix deploys exactly one function and verifies it without redeploying', { skip: !pwshAvailable }, () => {
  const stage = { stage: 'CalendarHotfix', resume: false };
  assert.deepEqual(runScenario(stage).calls, ['deploy --project focus-club-f73b8 --config firebase.json --only functions:syncAppointmentWithGoogleCalendar']);
  assert.deepEqual(runScenario({ ...stage, complete: true }).calls, []);
  const failed = runScenario({ ...stage, noProgress: true });
  assert.match(failed.output, /ERROR=.*9/);
  assert.equal(failed.calls.length, 1);
  const unrelated = runScenario({ ...stage, wrongCalendarPlan: true });
  assert.match(unrelated.output, /otras Functions/);
  assert.deepEqual(unrelated.calls, []);
});

test('PowerShell remaining selective uses the reviewed singleton and stops on failed checks', { skip: !pwshAvailable }, () => {
  const name = 'onNotificationOutboxCreated';
  const config = 'release/remaining-selective/1234567890abcdef1234/firebase.json';
  const preflight = { name, config, buildCpu: 4, runWrites: 30, functionWrites: 60, cpu: { limit: 20000, peak: 10000 }, memory: { limit: 42949672960, peak: 3000000 } };
  const script = path.resolve(__dirname, '../../scripts/deploy-release.ps1');
  const run = (plan, { dryRead = 0, deploy = 0, verify = 0 } = {}) => {
    const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', `
      function global:node {
        param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Items)
        if ($Items[1] -eq 'plan-remaining-selective') { $global:LASTEXITCODE=${dryRead}; ${literal(JSON.stringify(plan))} }
        elseif ($Items[1] -eq 'verify-remaining-selective') { Write-Host 'verified'; $global:LASTEXITCODE=${verify} }
        else { throw 'Unexpected control' }
      }
      function global:firebase {
        param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Items)
        Write-Host ('DEPLOY=' + ($Items -join ' ')); $global:LASTEXITCODE=${deploy}
      }
      try { & ${literal(script)} -Stage RemainingSelective -FunctionName ${name} } catch { Write-Host ('ERROR=' + $_.Exception.Message) }
    `], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  const first = run({ preflight });
  assert.match(first, new RegExp(`DEPLOY=deploy --non-interactive --project focus-club-f73b8 --config ${config} --only functions:${name}`));
  assert.match(first, /verified/);
  const retry = run({ remainingSelectiveFunctions: [name] });
  assert.doesNotMatch(retry, /DEPLOY=/);
  assert.match(retry, /verified/);
  assert.doesNotMatch(run({ preflight }, { dryRead: 9 }), /DEPLOY=|verified/);
  assert.doesNotMatch(run({ preflight: { ...preflight, config: 'firebase.json' } }), /DEPLOY=|verified/);
  assert.doesNotMatch(run({ preflight }, { deploy: 7 }), /verified/);
  assert.match(run({ preflight }, { verify: 8 }), /ERROR=.*8/);
});
