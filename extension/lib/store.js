/* Storage layer. Takes a chrome.storage-style area so tests can pass an in-memory fake.
 *
 * Keys:
 *   settings            user settings
 *   rec                 current recording state
 *   guides              index: [{id,title,created,updated,count}] newest first
 *   guide:<id>          one guide (steps without screenshots)
 *   shot:<stepId>       one screenshot (data URL) - kept apart so saving text edits stays fast
 */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./guide.js') : root.StepGuide);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StepStore = api;
})(typeof self !== 'undefined' ? self : this, function (G) {
  const DEFAULT_SETTINGS = { blurSensitive: true, hideTypedText: false, showToolbar: true };
  const guideKey = (id) => `guide:${id}`;
  const shotKey = (id) => `shot:${id}`;

  function makeStore(area) {
    const store = {
      async getSettings() {
        const { settings } = await area.get('settings');
        return { ...DEFAULT_SETTINGS, ...(settings || {}) };
      },
      async setSettings(patch) {
        const next = { ...(await store.getSettings()), ...patch };
        await area.set({ settings: next });
        return next;
      },
      async getRec() {
        const { rec } = await area.get('rec');
        return rec || { active: false, paused: false };
      },
      async getIndex() {
        const { guides } = await area.get('guides');
        return guides || [];
      },
      async loadGuide(id) {
        const k = guideKey(id);
        const got = await area.get(k);
        return got[k] || null;
      },
      // Save a guide and refresh its entry in the library index.
      // The guide itself is written first, in the same tick the call is made, so a save started
      // while a page is closing still reaches storage. The index is brought up to date after that
      // (and re-synced by the library view if the page closed before it finished).
      async saveGuide(guide) {
        guide.updated = Date.now();
        const written = area.set({ [guideKey(guide.id)]: guide });
        const index = G.upsertIndex(await store.getIndex(), G.summarize(guide));
        await written;
        await area.set({ guides: index });
        return guide;
      },
      // Make the library index entry match the stored guide (title, step count) without touching `updated`.
      async syncIndex(guide) {
        const index = await store.getIndex();
        const entry = index.find((x) => x.id === guide.id);
        if (entry && entry.title === guide.title && entry.count === guide.steps.length) return;
        await area.set({ guides: G.upsertIndex(index, G.summarize(guide)) });
      },
      async loadShots(ids) {
        if (!ids.length) return {};
        const got = await area.get(ids.map(shotKey));
        const out = {};
        for (const id of ids) if (got[shotKey(id)]) out[id] = got[shotKey(id)];
        return out;
      },
      async loadShot(id) {
        return (await store.loadShots([id]))[id] || null;
      },
      async deleteShot(id) {
        await area.remove(shotKey(id));
      },
      // Remove screenshots of steps that were deleted (kept briefly so Undo works).
      async purgeTrash(guide) {
        if (!guide.trash || !guide.trash.length) return;
        await area.remove(guide.trash.map(shotKey));
        guide.trash = [];
        await area.set({ [guideKey(guide.id)]: guide });
      },
      async deleteGuide(id) {
        const guide = await store.loadGuide(id);
        const keys = [guideKey(id)];
        if (guide) {
          for (const s of guide.steps) keys.push(shotKey(s.id));
          for (const t of guide.trash || []) keys.push(shotKey(t));
        }
        await area.remove(keys);
        await area.set({ guides: G.removeFromIndex(await store.getIndex(), id) });
      }
    };
    return store;
  }

  return { makeStore, DEFAULT_SETTINGS, guideKey, shotKey };
});
