const { spawnSync } = require('node:child_process');
const { fs, path, root, hash } = require('./release-common.cjs');

function privatePath(file) {
  if (process.platform !== 'win32' || !file || !process.env.LOCALAPPDATA) {
    throw new Error('El respaldo requiere Windows y una ruta bajo LocalAppData.');
  }
  const privateRoot = fs.realpathSync(process.env.LOCALAPPDATA).toLowerCase() + path.sep;
  const repository = fs.realpathSync(root).toLowerCase() + path.sep;
  const destination = path.join(fs.realpathSync(path.dirname(path.resolve(file))), path.basename(file));
  const lower = destination.toLowerCase();
  if (!lower.startsWith(privateRoot) || lower.startsWith(repository) || path.basename(destination).includes(':')) {
    throw new Error('El respaldo y el informe deben quedar fuera del repositorio, bajo LocalAppData.');
  }
  return destination;
}

function protect(input, decrypt = false) {
  const command = [
    '$ErrorActionPreference = "Stop"',
    'Add-Type -AssemblyName System.Security',
    '[Console]::InputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)',
    '$scope = [Security.Cryptography.DataProtectionScope]::CurrentUser',
    '$bytes = [Convert]::FromBase64String([Console]::In.ReadToEnd())',
    decrypt
      ? '$result = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, $scope)'
      : '$result = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, $scope)',
    '[Console]::Write([Convert]::ToBase64String($result))',
  ].join('; ');
  const executable = path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const result = spawnSync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
    input: input.toString('base64'), encoding: 'utf8', windowsHide: true, timeout: 10_000,
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(SYSTEMROOT|WINDIR|LOCALAPPDATA|USERPROFILE|TEMP|TMP|PATH)$/i.test(key))),
  });
  if (result.status !== 0 || !/^[A-Za-z0-9+/]+=*$/.test(result.stdout ?? '')) throw new Error('No se pudo verificar el respaldo cifrado local.');
  return Buffer.from(result.stdout, 'base64');
}

function writeBackup(file, backup) {
  const destination = privatePath(file);
  const plain = Buffer.from(JSON.stringify(backup), 'utf8');
  const encrypted = protect(plain);
  if (!protect(encrypted, true).equals(plain)) throw new Error('El respaldo no supera la prueba de recuperación.');
  const fd = fs.openSync(destination, 'wx');
  try { fs.writeFileSync(fd, encrypted); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  return { path: destination, sha256: hash(encrypted) };
}
function readBackup(file) {
  const destination = privatePath(file);
  if (fs.realpathSync(destination).toLowerCase() !== destination.toLowerCase()) throw new Error('Ruta de respaldo redirigida.');
  return JSON.parse(protect(fs.readFileSync(destination), true).toString('utf8'));
}

module.exports = { privatePath, writeBackup, readBackup };
