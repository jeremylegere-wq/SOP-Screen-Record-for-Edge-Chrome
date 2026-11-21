// Single place to bump the version. Usage: npm run version:set -- 1.2.0 [--date YYYY-MM-DD]
//
// Updates extension/manifest.json (the authoritative version), package.json, package-lock.json,
// and turns the "## Unreleased" section of CHANGELOG.md into "## 1.2.0 - <date>".
// It never runs git, tags or publishes anything.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const version = args.find((a) => !a.startsWith('--'));
const dateFlag = args.indexOf('--date');
const date = dateFlag > -1 ? args[dateFlag + 1] : new Date().toISOString().slice(0, 10);

function fail(msg) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) fail('give a version like 1.2.0 (MAJOR.MINOR.PATCH, digits only; browsers do not accept suffixes like -beta).');
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('--date must look like 2026-11-14.');

const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const write = (p, s) => writeFileSync(join(ROOT, p), s);

// CHANGELOG first, so we stop before touching anything if there is nothing to release.
const changelogPath = 'CHANGELOG.md';
if (!existsSync(join(ROOT, changelogPath))) fail('CHANGELOG.md not found.');
let changelog = read(changelogPath);
if (new RegExp(`^## ${version.replace(/\./g, '\\.')} - `, 'm').test(changelog)) fail(`CHANGELOG.md already has a section for ${version}.`);
const m = changelog.match(/^## Unreleased[ \t]*\r?\n([\s\S]*?)(?=^## |(?![\s\S]))/m);
if (!m || !m[1].replace(/<!--[\s\S]*?-->/g, '').trim()) fail('the "## Unreleased" section of CHANGELOG.md is empty. Describe what changed before releasing.');
changelog = changelog.replace(/^## Unreleased[ \t]*\r?\n/m, `## Unreleased\n\n## ${version} - ${date}\n`);
write(changelogPath, changelog);

// manifest.json: replace in place to keep the file's formatting.
let manifest = read('extension/manifest.json');
manifest = manifest.replace(/("version"\s*:\s*")[^"]+(")/, `$1${version}$2`);
write('extension/manifest.json', manifest);

// package.json / package-lock.json
for (const file of ['package.json', 'package-lock.json']) {
  if (!existsSync(join(ROOT, file))) continue;
  const json = JSON.parse(read(file));
  json.version = version;
  if (json.packages && json.packages['']) json.packages[''].version = version;
  write(file, JSON.stringify(json, null, 2) + '\n');
}

console.log(`Version set to ${version} (${date}).`);
console.log('Next: review the diff, commit, then tag v' + version + ' (see README, "Making a release").');
