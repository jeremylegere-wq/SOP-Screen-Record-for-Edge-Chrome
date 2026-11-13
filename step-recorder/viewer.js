// Step Recorder - guide viewer / editor / exporter.
let steps = [];
let title = 'New workflow';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function load() {
  const data = await chrome.storage.local.get(['steps', 'title']);
  steps = data.steps || [];
  title = data.title || 'New workflow';
  $('guideTitle').value = title;
  render();
}

const save = () => chrome.storage.local.set({ steps, title });

// ---- rendering (shared by the live editor and the HTML export) ---------
function ringHtml(s) {
  if (!s.rect || !s.vw || !s.vh) return '';
  const pad = 6, minSize = 32;
  let w = Math.max(s.rect.w + pad * 2, minSize);
  let h = Math.max(s.rect.h + pad * 2, minSize);
  const cx = s.rect.x + s.rect.w / 2;
  const cy = s.rect.y + s.rect.h / 2;
  const left = ((cx - w / 2) / s.vw) * 100;
  const top = ((cy - h / 2) / s.vh) * 100;
  return `<span class="ring" style="left:${left.toFixed(3)}%;top:${top.toFixed(3)}%;width:${((w / s.vw) * 100).toFixed(3)}%;height:${((h / s.vh) * 100).toFixed(3)}%"></span>`;
}

function stepHtml(s, i, editable) {
  const ce = (field) => (editable ? ` contenteditable="true" data-field="${field}"` : '');
  const shot = s.shot
    ? `<figure class="shot"><img alt="Screenshot for step ${i + 1}" src="${s.shot}">${ringHtml(s)}</figure>`
    : `<figure class="shot"><div class="noshot">No screenshot was captured for this step.</div></figure>`;
  const note = editable
    ? `<p class="note" data-placeholder="Add a note (optional)"${ce('note')}>${esc(s.note)}</p>`
    : s.note ? `<p class="note">${esc(s.note)}</p>` : '';
  let host = '';
  try { host = new URL(s.url).hostname; } catch (e) {}
  const controls = editable
    ? `<div class="controls">
         <button class="icon" data-action="up" ${i === 0 ? 'disabled' : ''} title="Move up">&uarr;</button>
         <button class="icon" data-action="down" ${i === steps.length - 1 ? 'disabled' : ''} title="Move down">&darr;</button>
         <button class="icon danger-text" data-action="delete" title="Delete step">Delete</button>
       </div>`
    : '';
  return `<section class="step" data-id="${esc(s.id)}">
    <div class="num">${i + 1}</div>
    <div class="body">
      <h2 class="title"${ce('title')}>${esc(s.title)}</h2>
      ${note}
      ${host ? `<p class="meta">${esc(host)}</p>` : ''}
      ${shot}
      ${controls}
    </div>
  </section>`;
}

function render() {
  const n = steps.length;
  $('count').textContent = `${n} step${n === 1 ? '' : 's'}`;
  $('steps').innerHTML = n
    ? steps.map((s, i) => stepHtml(s, i, true)).join('')
    : '<p class="empty">No steps yet. Click the Step Recorder icon in the toolbar and choose “Start recording”.</p>';
}

// ---- editing ----------------------------------------------------------
$('guideTitle').addEventListener('input', (e) => { title = e.target.value; save(); });

$('steps').addEventListener('focusout', (e) => {
  const field = e.target.dataset && e.target.dataset.field;
  if (!field) return;
  const id = e.target.closest('.step').dataset.id;
  const s = steps.find((x) => x.id === id);
  if (!s) return;
  s[field] = e.target.innerText.replace(/\n+$/, '').trim();
  save();
});

$('steps').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.dataset && e.target.dataset.field === 'title') { e.preventDefault(); e.target.blur(); }
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const stepEl = btn.closest('.step');
  const idx = stepEl ? steps.findIndex((x) => x.id === stepEl.dataset.id) : -1;

  switch (action) {
    case 'up': if (idx > 0) { [steps[idx - 1], steps[idx]] = [steps[idx], steps[idx - 1]]; await save(); render(); } break;
    case 'down': if (idx >= 0 && idx < steps.length - 1) { [steps[idx + 1], steps[idx]] = [steps[idx], steps[idx + 1]]; await save(); render(); } break;
    case 'delete': if (idx >= 0) { steps.splice(idx, 1); await save(); render(); } break;
    case 'export-html': exportHtml(); break;
    case 'export-json': download(`${slug()}.json`, JSON.stringify({ title, steps }, null, 2), 'application/json'); break;
    case 'copy-text': copyText(btn); break;
    case 'print': window.print(); break;
    case 'clear':
      if (confirm('Delete this guide and all its screenshots?')) {
        steps = []; title = 'New workflow';
        $('guideTitle').value = title;
        await save(); render();
      }
      break;
  }
});

// ---- export -----------------------------------------------------------
const slug = () => (title || 'guide').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'guide';

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportHtml() {
  const css = await (await fetch(chrome.runtime.getURL('viewer.css'))).text();
  const date = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>${css}</style></head>
<body class="export"><main class="wrap">
<h1>${esc(title)}</h1>
<p class="sub">${steps.length} step${steps.length === 1 ? '' : 's'} · ${esc(date)}</p>
${steps.map((s, i) => stepHtml(s, i, false)).join('\n')}
</main></body></html>`;
  download(`${slug()}.html`, html, 'text/html');
}

async function copyText(btn) {
  const text = `${title}\n\n` + steps.map((s, i) => `${i + 1}. ${s.title}${s.note ? `\n   ${s.note}` : ''}`).join('\n');
  await navigator.clipboard.writeText(text);
  const old = btn.textContent;
  btn.textContent = 'Copied';
  setTimeout(() => (btn.textContent = old), 1200);
}

load();
