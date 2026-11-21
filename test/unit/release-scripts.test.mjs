import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let dir;

const run = (script, ...args) =>
  spawnSync(process.execPath, [join(dir, 'scripts', script), ...args], { cwd: dir, encoding: 'utf8' });

const CHANGELOG = (unreleased) => `# Changelog

## Unreleased
${unreleased}
## 0.9.0 - 2026-01-01

### Added
- Older thing
`;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'sr-release-'));
  mkdirSync(join(dir, 'scripts'));
  mkdirSync(join(dir, 'extension'));
  cpSync(join(REPO, 'scripts'), join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'extension', 'manifest.json'), '{\n  "manifest_version": 3,\n  "version": "0.9.0"\n}\n');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', version: '0.9.0' }, null, 2) + '\n');
  writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ name: 'x', version: '0.9.0', packages: { '': { name: 'x', version: '0.9.0' } } }, null, 2) + '\n');
  writeFileSync(join(dir, 'CHANGELOG.md'), CHANGELOG('\n### Added\n- Shiny new feature\n'));
});
after(() => rmSync(dir, { recursive: true, force: true }));

test('check-release passes when versions agree and no tag is given', () => {
  const r = run('check-release.mjs');
  assert.equal(r.status, 0, r.stderr);
});

test('check-release rejects a tag that does not match the version', () => {
  const r = run('check-release.mjs', 'v1.0.0');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /does not match/);
});

test('check-release rejects malformed tags', () => {
  for (const bad of ['1.0.0', 'v1.0', 'v1.0.0-beta.1', 'release-1']) {
    const r = run('check-release.mjs', bad);
    assert.notEqual(r.status, 0, bad);
    assert.match(r.stderr, /must look like v1\.2\.0/);
  }
});

test('set-version rejects bad versions', () => {
  for (const bad of ['', '1.0', '1.0.0-rc.1', 'v1.0.0']) {
    const r = bad ? run('set-version.mjs', bad) : run('set-version.mjs');
    assert.notEqual(r.status, 0, `"${bad}"`);
  }
});

test('set-version syncs every file and dates the changelog; check-release then accepts the tag', () => {
  const r = run('set-version.mjs', '1.0.0', '--date', '2026-11-20');
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(join(dir, 'extension', 'manifest.json'), 'utf8'), /"version": "1\.0\.0"/);
  assert.equal(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version, '1.0.0');
  const lock = JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8'));
  assert.equal(lock.version, '1.0.0');
  assert.equal(lock.packages[''].version, '1.0.0');
  const log = readFileSync(join(dir, 'CHANGELOG.md'), 'utf8');
  assert.match(log, /## Unreleased\n\n## 1\.0\.0 - 2026-11-20\n\n### Added\n- Shiny new feature/);

  const ok = run('check-release.mjs', 'v1.0.0', '--notes', 'dist/notes.md');
  assert.equal(ok.status, 0, ok.stderr);
  const notes = readFileSync(join(dir, 'dist', 'notes.md'), 'utf8');
  assert.match(notes, /Shiny new feature/);
  assert.doesNotMatch(notes, /Older thing/, 'notes contain only this version');
});

test('set-version refuses to release an empty Unreleased section or an existing version', () => {
  const again = run('set-version.mjs', '1.0.0');
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /already has a section/);
  const empty = run('set-version.mjs', '1.1.0');
  assert.notEqual(empty.status, 0);
  assert.match(empty.stderr, /empty/);
});

test('check-release flags a version mismatch between files', () => {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.1' }, null, 2) + '\n');
  const r = run('check-release.mjs');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Version mismatch/);
});
