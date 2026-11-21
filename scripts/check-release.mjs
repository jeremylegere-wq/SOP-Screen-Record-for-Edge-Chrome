// Checks that every place holding the version agrees, and (given a tag) that it is releasable.
//
//   node scripts/check-release.mjs                 versions agree across manifest/package/lock
//   node scripts/check-release.mjs v1.2.0          ...and the tag matches, and CHANGELOG has notes for it
//   node scripts/check-release.mjs v1.2.0 --notes dist/release-notes.md   also writes the notes
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const tag = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--notes');
const notesFlag = args.indexOf('--notes');
const notesPath = notesFlag > -1 ? args[notesFlag + 1] : null;

const problems = [];
const readJson = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

const manifestVersion = readJson('extension/manifest.json').version;
const pkg = readJson('package.json');
const versions = { 'extension/manifest.json': manifestVersion, 'package.json': pkg.version };
if (existsSync(join(ROOT, 'package-lock.json'))) {
  const lock = readJson('package-lock.json');
  versions['package-lock.json'] = lock.version;
  if (lock.packages && lock.packages[''] && lock.packages[''].version !== lock.version) {
    versions['package-lock.json (packages[""])'] = lock.packages[''].version;
  }
}
if (new Set(Object.values(versions)).size !== 1) {
  problems.push('Version mismatch. Run "npm run version:set -- X.Y.Z" to sync them:\n' +
    Object.entries(versions).map(([f, v]) => `    ${f}: ${v}`).join('\n'));
}
if (!/^\d+\.\d+\.\d+$/.test(manifestVersion)) {
  problems.push(`Manifest version "${manifestVersion}" must be MAJOR.MINOR.PATCH (digits only).`);
}

let notes = '';
if (tag) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
    problems.push(`Tag "${tag}" must look like v1.2.0 (v + MAJOR.MINOR.PATCH, no suffix).`);
  } else if (tag.slice(1) !== manifestVersion) {
    problems.push(`Tag ${tag} does not match the extension version ${manifestVersion}. Fix the version or the tag.`);
  }
  const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8').replace(/\r\n/g, '\n');
  const version = tag.replace(/^v/, '');
  const re = new RegExp(`^## ${version.replace(/\./g, '\\.')} - .*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm');
  const m = changelog.match(re);
  notes = m ? m[1].trim() : '';
  if (!notes) problems.push(`CHANGELOG.md has no notes under "## ${version} - <date>".`);
}

if (problems.length) {
  console.error(problems.map((p) => `✗ ${p}`).join('\n'));
  process.exit(1);
}

if (notesPath) {
  mkdirSync(dirname(join(ROOT, notesPath)), { recursive: true });
  writeFileSync(join(ROOT, notesPath), notes + '\n');
}
console.log(`✓ Versions agree (${manifestVersion})${tag ? `, tag ${tag} is valid and has release notes` : ''}.`);
