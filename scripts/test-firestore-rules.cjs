const { existsSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const windows = process.platform === 'win32';
const env = { ...process.env };
const javaName = windows ? 'java.exe' : 'java';

// Change only this child process environment, never the user's system PATH.
const javaHomes = [
  env.JAVA_HOME,
  ...(windows ? [
    path.join(env.ProgramFiles || 'C:\\Program Files', 'Android', 'Android Studio', 'jbr'),
  ] : []),
].filter(Boolean);
const javaHome = javaHomes.find(directory => existsSync(path.join(directory, 'bin', javaName)));
if (javaHome) {
  env.JAVA_HOME = javaHome;
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH';
  env[pathKey] = `${path.join(javaHome, 'bin')}${path.delimiter}${env[pathKey] || ''}`;
}
const java = spawnSync('java', ['-version'], { env, encoding: 'utf8', windowsHide: true });
if (java.error || java.status !== 0) {
  console.error('Firestore rules tests require Java 21. Install a JDK or set JAVA_HOME to an existing installation.');
  process.exit(1);
}

let firebaseCli;
try {
  firebaseCli = require.resolve('firebase-tools/lib/bin/firebase.js');
} catch {
  if (windows && env.APPDATA) {
    const globalCli = path.join(env.APPDATA, 'npm', 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js');
    if (existsSync(globalCli)) firebaseCli = globalCli;
  }
}
if (!firebaseCli && windows) {
  // Other Node installations can expose a different global package directory.
  const found = spawnSync('where.exe', ['firebase.cmd'], { encoding: 'utf8', windowsHide: true });
  for (const command of (found.stdout || '').trim().split(/\r?\n/)) {
    const candidate = path.join(path.dirname(command), 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js');
    if (existsSync(candidate)) { firebaseCli = candidate; break; }
  }
}
if (!firebaseCli && windows) {
  console.error('Firebase CLI was not found. Install it with npm install -g firebase-tools, then retry npm run test:rules.');
  process.exit(1);
}

env.FIREBASE_EMULATORS_PATH ||= path.join(os.tmpdir(), 'slot-diff-firestore-emulators');
const args = [
  'emulators:exec', '--only', 'firestore', '--project', 'demo-slot-diff-auth-tests',
  '--config', 'firebase.emulators.json', 'node --test tests/firestore.rules.test.cjs',
];
const child = spawn(firebaseCli ? process.execPath : 'firebase', firebaseCli ? [firebaseCli, ...args] : args, {
  cwd: root, env, stdio: 'inherit', windowsHide: true,
});
child.on('error', error => {
  console.error(`Unable to start the local Firebase CLI: ${error.message}`);
  process.exitCode = 1;
});
child.on('exit', code => { process.exitCode = code ?? 1; });
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
