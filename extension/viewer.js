// Step Recorder - guide library and editor.
const $ = (id) => document.getElementById(id);
const store = StepStore.makeStore(chrome.storage.local);
const G = StepGuide;
const R = StepRender;

let guide = null;
let shots = {}; // step id -> screenshot data URL (kept in memory so Undo works)

// ---- small UI helpers --------------------------------------------------------
let toastTimer = null;
function toast(text, actionLabel, onAction, ms = 7000) {
  $('toastText').textContent = text;
  const btn = $('toastAction');
  btn.hidden = !actionLabel;
  btn.textContent = actionLabel || '';
  btn.onclick = () => { hideToast(); if (onAction) onAction(); };
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, ms);
}
function hideToast() { $('toast').hidden = true; }

let savedTimer = null;
let saveTimer = null;
let dirty = false;

async function saveNow() {
  clearTimeout(saveTimer);
  if (!dirty || !guide) return;
  dirty = false;
  await store.saveGuide(guide);
  $('saved').textContent = 'Saved ✓';
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => { $('saved').textContent = ''; }, 2000);
}

// Edits are saved shortly after the last change, and always when the tab is hidden or closed.
function save() {
  dirty = true;
  $('saved').textContent = 'Saving…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 250);
}
window.addEventListener('pagehide', saveNow);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });

const fmtDate = (ts) => new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

// ---- library -------------------------------------------------------------------
async function showLibrary() {
  document.title = 'Step Recorder - Guides';
  $('editorView').hidden = true;
  $('libraryView').hidden = false;
  $('emptyBanner').hidden = !new URLSearchParams(location.search).has('empty');

  const index = await store.getIndex();
  $('libraryEmpty').hidden = index.length > 0;
  const cards = $('cards');
  cards.textContent = '';
  for (const entry of index) {
    const g = await store.loadGuide(entry.id);
    if (!g) continue; // stale index entry
    await store.syncIndex(g);
    entry.title = g.title;
    entry.count = g.steps.length;
    const first = g.steps.find((s) => s.hasShot);
    const shot = first ? await store.loadShot(first.id) : null;

    const card = document.createElement('article');
    card.className = 'card';
    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    if (shot) {
      const img = document.createElement('img');
      img.src = shot;
      img.alt = '';
      thumb.append(img);
    } else {
      thumb.textContent = 'No preview';
    }
    const info = document.createElement('div');
    info.className = 'info';
    const h = document.createElement('h3');
    h.textContent = entry.title;
    const sub = document.createElement('p');
    sub.className = 'sub';
    sub.textContent = `${entry.count} step${entry.count === 1 ? '' : 's'} · ${fmtDate(entry.updated)}`;
    info.append(h, sub);

    const row = document.createElement('div');
    row.className = 'row';
    const open = document.createElement('button');
    open.className = 'primary small';
    open.textContent = 'Open';
    open.onclick = () => { location.href = `viewer.html?id=${encodeURIComponent(entry.id)}`; };
    const del = document.createElement('button');
    del.className = 'small danger';
    del.textContent = 'Delete';
    del.onclick = async () => {
      if (!confirm(`Delete "${entry.title}"? This can't be undone.`)) return;
      await store.deleteGuide(entry.id);
      showLibrary();
    };
    row.append(open, del);
    card.append(thumb, info, row);
    cards.append(card);
  }
}

// ---- editor --------------------------------------------------------------------
async function showEditor(g) {
  guide = g;
  await store.purgeTrash(guide); // permanently drop screenshots of steps deleted in an earlier session
  shots = await store.loadShots(guide.steps.filter((s) => s.hasShot).map((s) => s.id));
  $('libraryView').hidden = true;
  $('editorView').hidden = false;
  $('guideTitle').value = guide.title;
  document.title = `${guide.title} - Step Recorder`;
  renderSteps();
}

function insertButton(afterId) {
  return `<div class="insert"><button class="small" data-action="add-text" data-after="${R.esc(afterId)}">＋ Add a text step here</button></div>`;
}

function renderSteps() {
  const steps = guide.steps;
  const html = steps.length
    ? steps.map((s, i) => R.stepHtml(s, i, { editable: true, shot: shots[s.id] || null, total: steps.length }) + insertButton(s.id)).join('')
    : `<div class="empty"><p><strong>This guide has no steps.</strong></p>
         <p><button class="small" data-action="add-text" data-after="">＋ Add a text step</button></p></div>`;
  $('steps').innerHTML = html;
}

$('guideTitle').addEventListener('input', (e) => {
  guide.title = e.target.value;
  document.title = `${guide.title || 'Guide'} - Step Recorder`;
  save();
});

$('steps').addEventListener('focusout', (e) => {
  const field = e.target.dataset && e.target.dataset.field;
  if (!field) return;
  const step = guide.steps.find((s) => s.id === e.target.closest('.step').dataset.id);
  if (!step) return;
  const value = e.target.innerText.replace(/\n+$/, '').trim();
  if (step[field] === value) return;
  step[field] = value;
  save();
});

$('steps').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.dataset && e.target.dataset.field === 'title') { e.preventDefault(); e.target.blur(); }
});

// ---- actions -----------------------------------------------------------------
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const fileSlug = () => (guide.title || 'guide').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'guide';

async function exportHtml() {
  const [ui, view] = await Promise.all(['ui.css', 'viewer.css'].map((f) => fetch(chrome.runtime.getURL(f)).then((r) => r.text())));
  const html = R.exportHtml({ title: guide.title, steps: guide.steps, shots, css: ui + '\n' + view, dateText: fmtDate(Date.now()) });
  download(`${fileSlug()}.html`, html, 'text/html');
  toast('Guide downloaded. Open the file in any browser or send it to a colleague.');
}

function removeStepWithUndo(id, what) {
  const { steps, removed, index } = G.removeStep(guide.steps, id);
  if (!removed) return;
  guide.steps = steps;
  if (removed.hasShot) guide.trash.push(removed.id);
  save();
  renderSteps();
  toast(`${what} deleted.`, 'Undo', () => {
    guide.steps = G.insertStep(guide.steps, removed, index);
    guide.trash = guide.trash.filter((t) => t !== removed.id);
    save();
    renderSteps();
  });
}

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action], #back');
  if (!btn) return;
  if (btn.id === 'back') { location.href = 'viewer.html'; return; }
  const action = btn.dataset.action;
  const stepEl = btn.closest('.step');
  const id = stepEl ? stepEl.dataset.id : null;

  switch (action) {
    case 'up':
    case 'down':
      guide.steps = G.moveStep(guide.steps, id, action === 'up' ? -1 : 1);
      save();
      renderSteps();
      break;
    case 'delete':
      removeStepWithUndo(id, 'Step');
      break;
    case 'drop-shot': {
      const step = guide.steps.find((s) => s.id === id);
      if (!step) break;
      const saved = shots[id];
      step.hasShot = false;
      delete shots[id];
      guide.trash.push(id);
      save();
      renderSteps();
      toast('Screenshot removed.', 'Undo', () => {
        step.hasShot = true;
        shots[id] = saved;
        guide.trash = guide.trash.filter((t) => t !== id);
        save();
        renderSteps();
      });
      break;
    }
    case 'add-text': {
      const after = btn.dataset.after;
      const at = after ? guide.steps.findIndex((s) => s.id === after) + 1 : guide.steps.length;
      const step = G.newStep({ type: 'text', title: 'New step' });
      guide.steps = G.insertStep(guide.steps, step, at);
      save();
      renderSteps();
      const title = document.querySelector(`.step[data-id="${step.id}"] .title`);
      if (title) {
        title.focus();
        const sel = getSelection();
        sel.selectAllChildren(title);
      }
      break;
    }
    case 'export-html': await exportHtml(); break;
    case 'print': window.print(); break;
    case 'copy-md':
      await navigator.clipboard.writeText(R.toMarkdown(guide.title, guide.steps));
      toast('Copied to the clipboard.');
      break;
    case 'delete-guide':
      if (confirm(`Delete "${guide.title}" and all its screenshots? This can't be undone.`)) {
        clearTimeout(saveTimer);
        dirty = false; // don't re-create the guide we're deleting
        await store.deleteGuide(guide.id);
        location.href = 'viewer.html';
      }
      break;
  }
});

// ---- start -----------------------------------------------------------------
(async function init() {
  const id = new URLSearchParams(location.search).get('id');
  const g = id ? await store.loadGuide(id) : null;
  if (g) await showEditor(g); else await showLibrary();
})();
