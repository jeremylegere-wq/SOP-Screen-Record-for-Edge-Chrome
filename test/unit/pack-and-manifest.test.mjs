import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildExtension, buildZip, crc32, listFiles } from '../../scripts/pack.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXT = join(ROOT, 'extension');
const manifest = JSON.parse(readFileSync(join(EXT, 'manifest.json'), 'utf8'));

/** Minimal zip reader: parses the central directory, inflates, and checks CRCs. */
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  assert.ok(eocd >= 0, 'end-of-central-directory record found');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let n = 0; n < count; n++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const lnlen = buf.readUInt16LE(lho + 26);
    const lelen = buf.readUInt16LE(lho + 28);
    const raw = buf.subarray(lho + 30 + lnlen + lelen, lho + 30 + lnlen + lelen + csize);
    const data = method === 8 ? inflateRawSync(raw) : raw;
    assert.equal(data.length, usize, `${name}: size`);
    assert.equal(crc32(data), crc, `${name}: crc`);
    out.set(name, data);
    p += 46 + nlen + elen + clen;
  }
  return out;
}

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('zip is valid and round-trips every extension file', () => {
  const { zip, files } = buildExtension();
  const entries = readZip(zip);
  assert.equal(entries.size, files.length);
  for (const f of files) assert.ok(entries.get(f.name).equals(f.data), `${f.name} identical after unzip`);
  assert.ok(entries.has('manifest.json'), 'manifest.json is at the zip root');
});

test('build is reproducible', () => {
  const a = createHash('sha256').update(buildExtension().zip).digest('hex');
  const b = createHash('sha256').update(buildExtension().zip).digest('hex');
  assert.equal(a, b);
});

test('buildZip output does not depend on timestamps', () => {
  const files = [{ name: 'a.txt', data: Buffer.from('hello hello hello') }];
  assert.ok(buildZip(files).equals(buildZip(files)));
});

test('zip contains only the extension folder, not tooling or tests', () => {
  const names = listFiles(EXT);
  for (const n of names) assert.ok(!/node_modules|test|scripts|\.github|package/.test(n.split('/')[0]), n);
  assert.ok(!names.some((n) => n.endsWith('.md')), 'no README inside the extension package');
});

test('manifest: every referenced file exists', () => {
  const refs = new Set();
  refs.add(manifest.background.service_worker);
  refs.add(manifest.action.default_popup);
  Object.values(manifest.icons).forEach((f) => refs.add(f));
  Object.values(manifest.action.default_icon).forEach((f) => refs.add(f));
  (manifest.content_scripts || []).forEach((cs) => [...(cs.js || []), ...(cs.css || [])].forEach((f) => refs.add(f)));
  for (const f of refs) assert.ok(existsSync(join(EXT, f)), `manifest references missing file: ${f}`);
});

test('manifest: Manifest V3, valid version, store-friendly description', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.ok(manifest.description.length <= 132, 'Edge Add-ons limit for the description');
  assert.ok(manifest.name.length <= 45);
});

test('manifest: permissions stay minimal', () => {
  assert.deepEqual([...manifest.permissions].sort(), ['scripting', 'storage', 'unlimitedStorage']);
  // chrome.tabs.captureVisibleTab (screenshots) requires <all_urls> or activeTab; activeTab would
  // not cover pages opened after recording starts. Content scripts stay limited to http(s).
  assert.deepEqual(manifest.host_permissions, ['<all_urls>']);
  for (const cs of manifest.content_scripts) assert.deepEqual(cs.matches, ['http://*/*', 'https://*/*']);
});

test('HTML pages only load scripts that exist, and none from the network', () => {
  for (const page of ['popup.html', 'viewer.html', 'welcome.html']) {
    const html = readFileSync(join(EXT, page), 'utf8');
    for (const m of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) {
      assert.ok(!/^https?:|^\/\//.test(m[1]), `${page}: remote script ${m[1]}`);
      assert.ok(existsSync(join(EXT, m[1])), `${page}: missing script ${m[1]}`);
    }
    for (const m of html.matchAll(/<link[^>]*href="([^"]+)"/g)) {
      assert.ok(existsSync(join(EXT, m[1])), `${page}: missing stylesheet ${m[1]}`);
    }
    assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>/.test(html), `${page}: inline scripts are blocked by extension CSP`);
  }
});

test('no remote code or network calls in extension scripts', () => {
  for (const f of listFiles(EXT).filter((n) => n.endsWith('.js'))) {
    const src = readFileSync(join(EXT, f), 'utf8');
    assert.ok(!/\beval\(|new Function\(|XMLHttpRequest|\bfetch\(\s*['"`]https?:/.test(src), `${f}: remote code / network access`);
  }
});
