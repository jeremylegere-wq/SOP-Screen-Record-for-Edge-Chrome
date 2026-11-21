import { test } from 'node:test';
import assert from 'node:assert/strict';
import G from '../../extension/lib/guide.js';
import S from '../../extension/lib/store.js';

const mk = (id) => G.newStep({ id, title: id });

test('createGuide starts empty with a dated default title', () => {
  const g = G.createGuide(Date.UTC(2026, 10, 14, 12));
  assert.equal(g.steps.length, 0);
  assert.match(g.title, /^New workflow – \d{1,2} Nov 2026$/);
  assert.ok(g.id);
});

test('moveStep swaps neighbours and ignores out-of-range moves', () => {
  const steps = [mk('a'), mk('b'), mk('c')];
  assert.deepEqual(G.moveStep(steps, 'b', -1).map((s) => s.id), ['b', 'a', 'c']);
  assert.deepEqual(G.moveStep(steps, 'b', 1).map((s) => s.id), ['a', 'c', 'b']);
  assert.deepEqual(G.moveStep(steps, 'a', -1).map((s) => s.id), ['a', 'b', 'c']);
  assert.deepEqual(G.moveStep(steps, 'c', 1).map((s) => s.id), ['a', 'b', 'c']);
  assert.deepEqual(G.moveStep(steps, 'nope', 1).map((s) => s.id), ['a', 'b', 'c']);
  assert.deepEqual(steps.map((s) => s.id), ['a', 'b', 'c'], 'input is not mutated');
});

test('removeStep + insertStep round-trips (used by Undo)', () => {
  const steps = [mk('a'), mk('b'), mk('c')];
  const { steps: after, removed, index } = G.removeStep(steps, 'b');
  assert.deepEqual(after.map((s) => s.id), ['a', 'c']);
  assert.equal(removed.id, 'b');
  assert.equal(index, 1);
  assert.deepEqual(G.insertStep(after, removed, index).map((s) => s.id), ['a', 'b', 'c']);
  assert.equal(G.removeStep(steps, 'zzz').removed, null);
});

test('library index is newest-first and de-duplicated', () => {
  let idx = [];
  idx = G.upsertIndex(idx, { id: '1', updated: 10, title: 'one', count: 1 });
  idx = G.upsertIndex(idx, { id: '2', updated: 20, title: 'two', count: 1 });
  idx = G.upsertIndex(idx, { id: '1', updated: 30, title: 'one!', count: 2 });
  assert.deepEqual(idx.map((x) => x.id), ['1', '2']);
  assert.equal(idx[0].title, 'one!');
  assert.deepEqual(G.removeFromIndex(idx, '1').map((x) => x.id), ['2']);
});

// ---- store, against an in-memory stand-in for chrome.storage.local ----
function fakeArea() {
  const data = new Map();
  return {
    data,
    async get(keys) {
      const list = keys == null ? [...data.keys()] : Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const k of list) if (data.has(k)) out[k] = structuredClone(data.get(k));
      return out;
    },
    async set(obj) { for (const [k, v] of Object.entries(obj)) data.set(k, structuredClone(v)); },
    async remove(keys) { for (const k of [].concat(keys)) data.delete(k); }
  };
}

test('store: settings default, merge and persist', async () => {
  const store = S.makeStore(fakeArea());
  assert.deepEqual(await store.getSettings(), { blurSensitive: true, hideTypedText: false, showToolbar: true });
  await store.setSettings({ hideTypedText: true });
  assert.equal((await store.getSettings()).hideTypedText, true);
  assert.equal((await store.getSettings()).blurSensitive, true);
});

test('store: save, list, load shots and delete a guide', async () => {
  const area = fakeArea();
  const store = S.makeStore(area);
  const g = G.createGuide();
  const s1 = G.newStep({ title: 'one', hasShot: true });
  const s2 = G.newStep({ title: 'two', hasShot: false });
  g.steps.push(s1, s2);
  await area.set({ [`shot:${s1.id}`]: 'data:image/jpeg;base64,AAA' });
  await store.saveGuide(g);

  const index = await store.getIndex();
  assert.equal(index.length, 1);
  assert.equal(index[0].count, 2);
  assert.equal((await store.loadGuide(g.id)).steps.length, 2);
  assert.deepEqual(await store.loadShots([s1.id, s2.id]), { [s1.id]: 'data:image/jpeg;base64,AAA' });

  await store.deleteGuide(g.id);
  assert.equal(await store.loadGuide(g.id), null);
  assert.deepEqual(await store.getIndex(), []);
  assert.equal(area.data.has(`shot:${s1.id}`), false, 'screenshots are removed with the guide');
});

test('store: saveGuide writes the guide before doing anything asynchronous', async () => {
  // Pages that are closing only get to send what they start in the same tick.
  const area = fakeArea();
  const store = S.makeStore(area);
  const g = G.createGuide();
  g.steps.push(G.newStep({ title: 'late edit' }));
  store.saveGuide(g); // deliberately not awaited
  assert.ok(area.data.has(`guide:${g.id}`), 'guide written synchronously');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal((await store.getIndex())[0].count, 1);
});

test('store: syncIndex repairs a stale library entry', async () => {
  const area = fakeArea();
  const store = S.makeStore(area);
  const g = G.createGuide();
  await store.saveGuide(g);
  g.steps.push(G.newStep({ title: 'x' }));
  g.title = 'Renamed';
  await area.set({ [`guide:${g.id}`]: g }); // guide saved, index not (page closed mid-save)
  await store.syncIndex(g);
  const [entry] = await store.getIndex();
  assert.equal(entry.count, 1);
  assert.equal(entry.title, 'Renamed');
});

test('store: purgeTrash drops screenshots of deleted steps', async () => {
  const area = fakeArea();
  const store = S.makeStore(area);
  const g = G.createGuide();
  g.trash = ['gone'];
  await area.set({ 'shot:gone': 'x', 'shot:kept': 'y' });
  await store.saveGuide(g);
  await store.purgeTrash(g);
  assert.equal(area.data.has('shot:gone'), false);
  assert.equal(area.data.has('shot:kept'), true);
  assert.deepEqual((await store.loadGuide(g.id)).trash, []);
});
