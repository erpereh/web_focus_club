const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const pwshAvailable = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], { encoding: 'utf8' }).status === 0;
const literal = value => "'" + value.replaceAll("'", "''") + "'";
function runScenario({ complete = false, resume = true, lostResponse = false, readFailure = false, stage = 'Bootstrap' } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-bootstrap-script-test-'));
  try {
    fs.mkdirSync(path.join(directory, 'scripts')); fs.mkdirSync(path.join(directory, 'release'));
    fs.copyFileSync(path.resolve(__dirname, '../../scripts/deploy-release.ps1'), path.join(directory, 'scripts/deploy-release.ps1'));
    fs.writeFileSync(path.join(directory, 'release/manifest.json'), JSON.stringify({ bootstrap: { artifacts: [] } }));
    const plan = pending => ({ verifiedFunctions: pending ? ['alreadyPublished'] : ['alreadyPublished', 'deleteOwnAccount'], pendingFunctions: pending ? ['deleteOwnAccount'] : [],
      batches: pending ? [{ config: 'release/bootstrap/portal/firebase.json', portal: true, functions: ['deleteOwnAccount'] }] : [], rules: { status: complete ? 'verified' : 'pending' } });
    const command = `
      $global:LASTEXITCODE=0; $global:published=${complete ? '$true' : '$false'}; $global:invocations=@(); $global:lostResponse=${lostResponse ? '$true' : '$false'}
      function global:node {
        param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Items)
        $global:LASTEXITCODE=0
        if ($Items[1] -eq 'plan-bootstrap-resume') {
          ${readFailure ? '$global:LASTEXITCODE=9; return' : ''}
          if ($global:published) { ${literal(JSON.stringify(plan(false)))} } else { ${literal(JSON.stringify(plan(true)))} }
        }
      }
      function global:firebase {
        param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Items)
        $global:invocations += ($Items -join ' '); $global:LASTEXITCODE=0
        if (($Items -join ' ').Contains('functions:portal:deleteOwnAccount')) {
          $global:published=$true
          if ($global:lostResponse) { $global:lostResponse=$false; $global:LASTEXITCODE=7 }
        }
      }
      try { & ${literal(path.join(directory, 'scripts/deploy-release.ps1'))} -Stage ${stage} ${resume ? '-Resume' : ''} } catch { Write-Host ('ERROR=' + $_.Exception.Message) }
      ${lostResponse ? `try { & ${literal(path.join(directory, 'scripts/deploy-release.ps1'))} -Stage Bootstrap -Resume } catch { Write-Host ('RETRY_ERROR=' + $_.Exception.Message) }` : ''}
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
test('PowerShell Resume cannot be used to bypass final stage controls', { skip: !pwshAvailable }, () => { const result = runScenario({ stage: 'Functions' }); assert.deepEqual(result.calls, []); assert.match(result.output, /solo se admite para Bootstrap/); });
