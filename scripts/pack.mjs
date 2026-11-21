// Builds a deterministic extension zip: same source -> byte-identical zip on any OS.
// Usage: node scripts/pack.mjs [--out dist]
//   - sorted file order, fixed timestamps, fixed permissions, no extra metadata
//   - zip format written by hand (no dependencies)
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXT_DIR = join(ROOT, 'extension');
const IGNORE = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);
const TEXT_EXT = /\.(js|json|html|css|md|txt|svg)$/i;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Recursively list files under dir as posix-style relative paths, sorted bytewise. */
export function listFiles(dir, base = '') {
  const out = [];
  for (const entry of readdirSync(join(dir, base), { withFileTypes: true })) {
    if (IGNORE.has(entry.name)) continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(dir, rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** files: [{ name, data: Buffer }] in the order they should appear. Returns a Buffer. */
export function buildZip(files) {
  const DOS_TIME = 0; // 00:00:00
  const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const compressed = deflateRawSync(data, { level: 9 });
    const useDeflate = compressed.length < data.length;
    const body = useDeflate ? compressed : data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // made by: unix, v2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(((0o100644 << 16) >>> 0), 38); // regular file, rw-r--r--
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

/** Reads extension/ and returns { version, zip, files }. */
export function buildExtension() {
  const manifest = JSON.parse(readFileSync(join(EXT_DIR, 'manifest.json'), 'utf8'));
  const names = listFiles(EXT_DIR);
  const files = names.map((name) => {
    const data = readFileSync(join(EXT_DIR, ...name.split('/')));
    if (TEXT_EXT.test(name) && data.includes(13)) {
      throw new Error(`${name} contains CR characters. Check line endings (.gitattributes / core.autocrlf) so builds stay reproducible.`);
    }
    return { name, data };
  });
  return { version: manifest.version, files, zip: buildZip(files) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outFlag = process.argv.indexOf('--out');
  const outDir = join(ROOT, outFlag > -1 ? process.argv[outFlag + 1] : 'dist');
  const { version, zip, files } = buildExtension();
  const zipName = `step-recorder-v${version}.zip`;
  const sha = createHash('sha256').update(zip).digest('hex');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, zipName), zip);
  writeFileSync(join(outDir, `${zipName}.sha256`), `${sha}  ${zipName}\n`);
  console.log(`Built dist/${zipName}: ${files.length} files, ${zip.length} bytes`);
  console.log(`sha256 ${sha}`);
}
