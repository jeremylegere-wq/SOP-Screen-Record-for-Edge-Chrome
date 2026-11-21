/* Pure guide/step helpers. No chrome.* access, so they can run under Node tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StepGuide = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function uid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function defaultTitle(ts = Date.now()) {
    const d = new Date(ts);
    return `New workflow – ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  }

  function createGuide(ts = Date.now()) {
    return { id: uid(), title: defaultTitle(ts), created: ts, updated: ts, steps: [], trash: [] };
  }

  function newStep(partial = {}, ts = Date.now()) {
    return { id: uid(), ts, type: 'click', title: '', note: '', hasShot: false, ...partial };
  }

  // Move a step by delta positions (-1 up, +1 down). Returns a new array.
  function moveStep(steps, id, delta) {
    const i = steps.findIndex((s) => s.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= steps.length) return steps.slice();
    const out = steps.slice();
    [out[i], out[j]] = [out[j], out[i]];
    return out;
  }

  function removeStep(steps, id) {
    const index = steps.findIndex((s) => s.id === id);
    if (index < 0) return { steps: steps.slice(), removed: null, index: -1 };
    const out = steps.slice();
    const [removed] = out.splice(index, 1);
    return { steps: out, removed, index };
  }

  function insertStep(steps, step, index) {
    const out = steps.slice();
    out.splice(Math.max(0, Math.min(index, out.length)), 0, step);
    return out;
  }

  function summarize(g) {
    return { id: g.id, title: g.title, created: g.created, updated: g.updated, count: g.steps.length };
  }

  // Newest-updated first.
  function upsertIndex(index, summary) {
    return index.filter((x) => x.id !== summary.id).concat(summary).sort((a, b) => b.updated - a.updated);
  }

  function removeFromIndex(index, id) {
    return index.filter((x) => x.id !== id);
  }

  return { uid, defaultTitle, createGuide, newStep, moveStep, removeStep, insertStep, summarize, upsertIndex, removeFromIndex };
});
