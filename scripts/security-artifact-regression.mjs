import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';

// Exercise the actual 62-check harness in a source-only deployment artifact.
const root = process.cwd();
const artifact = fs.mkdtempSync(path.join(os.tmpdir(), 'icb-security-artifact-'));
try {
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const file of [...files, 'scripts/security-gitignore-policy.txt']) {
    const dest = path.join(artifact, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(root, file), dest);
  }
  const run = (vercel) => spawnSync(process.execPath, ['scripts/security-regression.mjs'], {
    cwd: artifact, encoding: 'utf8', env: { ...process.env, VERCEL: vercel },
  });
  const ignore = path.join(artifact, '.gitignore');
  const policy = fs.readFileSync(ignore, 'utf8');
  assert.equal(run('0').status, 0, 'repository policy passes');
  fs.unlinkSync(ignore);
  assert.equal(run('1').status, 0, 'Vercel missing gitignore still runs all assertions');
  assert.match(run('1').stdout, /All 62 security regression checks passed/);
  assert.notEqual(run('0').status, 0, 'missing local gitignore fails closed');
  fs.writeFileSync(ignore, policy + '\n# drift\n');
  assert.notEqual(run('1').status, 0, 'existing mismatched gitignore cannot use fallback');
  fs.unlinkSync(ignore);
  fs.writeFileSync(path.join(artifact, 'scripts/security-gitignore-policy.txt'), 'node_modules/\n');
  assert.notEqual(run('1').status, 0, 'unsafe artifact policy fails original secret assertion');
  fs.unlinkSync(path.join(artifact, 'scripts/security-gitignore-policy.txt'));
  assert.notEqual(run('1').status, 0, 'missing artifact policy fails closed');
  console.log('PASS 6 security artifact compatibility cases (62 security checks retained)');
} finally {
  fs.rmSync(artifact, { recursive: true, force: true });
}
