const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const test=require('node:test');
const ts=require('typescript');
const {wrapBootstrap,maintenanceRules,zipFiles}=require('../../scripts/prepare-coordinated-release.cjs');
const {exportedFunctionNames}=require('../scripts/deploy-filter.cjs');
const root=path.resolve(__dirname,'../..');

test('every callable is protected, including anonymous and old mobile contracts',()=>{
  const source=fs.readFileSync(path.join(root,'functions/src/index.ts'),'utf8');
  const file=ts.createSourceFile('index.ts',source,99,true);
  let inspected=0;
  for(const statement of file.statements){
    if(!ts.isVariableStatement(statement))continue;
    for(const declaration of statement.declarationList.declarations){
      const call=declaration.initializer;
      if(!call||!ts.isCallExpression(call)||call.expression.getText(file)!=='onCall')continue;
      const name=declaration.name.getText(file);
      assert.match(call.arguments[1].getText(file),new RegExp(`^guardCallable\\(db, "${name}",`));inspected++;
    }
  }
  assert.ok(inspected>40);
  const portal=fs.readFileSync(path.resolve(root,'../app_focus_club/functions/src/index.ts'),'utf8');
  assert.match(portal,/guardCallable\(db, "deleteOwnAccount"/);
});

test('all background entrypoints pause durably except the authenticated recovery dispatcher',()=>{
  const source=fs.readFileSync(path.join(root,'functions/src/index.ts'),'utf8');
  const file=ts.createSourceFile('index.ts',source,99,true);
  const required=[];
  let dispatcher='';
  for(const statement of file.statements){
    if(!ts.isVariableStatement(statement))continue;
    for(const declaration of statement.declarationList.declarations){
      const call=declaration.initializer;
      if(!call||!ts.isCallExpression(call)||!/^on(Document\w+|Schedule)$/.test(call.expression.getText(file)))continue;
      const name=declaration.name.getText(file);
      if(name==='onReleaseDeferredEventWritten'){
        dispatcher=call.arguments[1].getText(file);assert.match(dispatcher,/^createReleaseRecoveryHandler/);
      }else{
        required.push(name);assert.match(call.arguments[1].getText(file),new RegExp(`^guardBackground\\(db, "${name}",`));
      }
    }
  }
  for(const name of required)assert.ok(new RegExp(`\\b${name}\\b`).test(dispatcher),`${name} must be recoverable after maintenance`);
});

test('bootstrap preserves original handler logic and adds only leases and pausing',()=>{
  const input='import { onCall } from "firebase-functions/v2/https";\nconst db = getFirestore();\nexport const createAppointment = onCall<Booking>({region:"europe-west1"}, async (request) => { return economicRule(request.data); });';
  const output=wrapBootstrap(input);
  assert.match(output,/return economicRule\(request.data\)/);
  assert.match(output,/guardCallable\(db, "createAppointment"/);
  assert.doesNotMatch(output,/guardBackground/,'a callable-only package must not gain unused imports');
  assert.match(output,/focus_phase: "bootstrap"/);
  assert.match(output,/ReleaseCallableRequest<Booking>/);
});

test('bootstrap rules preserve reads and deny every direct write while closed',()=>{
  const source="service cloud.firestore { match /databases/{database}/documents { match /appointments/{id} { allow read: if true; allow update, delete: if isAdmin(); } } }";
  const result=maintenanceRules(source);
  assert.match(result,/allow read: if true;/);assert.match(result,/allow update, delete: if releaseIsOpen\(\) && \(isAdmin\(\)\);/);
  assert.match(result,/system_controls\/release/);assert.throws(()=>maintenanceRules(result),/ya contiene mantenimiento/);
});

test('invalid zip cannot create any source artifact',()=>{
  assert.throws(()=>zipFiles(Buffer.alloc(40)));
  assert.throws(()=>zipFiles(Buffer.from('not a zip')));
});

test('filtered release stages enforce maximum five functions and never use unfiltered deployment',()=>{
  const script=fs.readFileSync(path.join(root,'scripts/deploy-release.ps1'),'utf8');
  assert.match(script,/\$inicioFocus \+= 5/);assert.match(script,/\$inicioFocus \+ 4/);
  assert.match(script,/--only \$filtroFocus/);assert.match(script,/functions:portal:deleteOwnAccount/);
  assert.doesNotMatch(script,/firebase deploy[^\r\n]*--only ['"]?functions['"]?(?:\s|$)/);
  const names=exportedFunctionNames(fs.readFileSync(path.join(root,'functions/src/index.ts'),'utf8'));
  assert.ok(names.includes('onReleaseDeferredEventWritten'));
  assert.equal(new Set(names).size,names.length);
});

test('operator tools refuse missing project and review inputs before obtaining any credential',()=>{
  for(const [file,args]of [
    ['release-controls.cjs',['enable-automatic-refunds']],
    ['reconcile-slot-occupancy.cjs',['--mode','apply']],
    ['prepare-coordinated-release.cjs',['--project','another-project','--offline']],
  ]){
    const result=spawnSync(process.execPath,[path.join(root,'scripts',file),...args],{encoding:'utf8',timeout:10000});
    assert.notEqual(result.status,0);assert.doesNotMatch(result.stderr,/MetadataLookup|invalid_grant|access_token/);
  }
});

test('a stranded lease cannot be removed only because time passed',()=>{
  const source=fs.readFileSync(path.join(root,'scripts/release-controls.cjs'),'utf8');
  assert.match(source,/releaseOperationState=\\?"handler_finished/);
  assert.match(source,/No existe prueba de finalización/);
  assert.doesNotMatch(source,/delete.*leaseUntil/);
});
