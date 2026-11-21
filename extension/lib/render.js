/* Rendering helpers for the guide editor and the exported HTML/Markdown.
 * Pure string functions, so they run in the browser and under Node tests. */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./text.js') : root.StepText);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StepRender = api;
})(typeof self !== 'undefined' ? self : this, function (T) {
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Highlight box as percentages of the screenshot, or null when the position is unknown.
  function ringStyle(step) {
    if (!step.rect || !step.vw || !step.vh) return null;
    const pad = 6;
    const min = 32;
    const w = Math.max(step.rect.w + pad * 2, min);
    const h = Math.max(step.rect.h + pad * 2, min);
    const cx = step.rect.x + step.rect.w / 2;
    const cy = step.rect.y + step.rect.h / 2;
    const pct = (n) => Math.round(n * 1000) / 1000;
    return {
      left: pct(((cx - w / 2) / step.vw) * 100),
      top: pct(((cy - h / 2) / step.vh) * 100),
      width: pct((w / step.vw) * 100),
      height: pct((h / step.vh) * 100)
    };
  }

  function ringHtml(step) {
    const r = ringStyle(step);
    if (!r) return '';
    return `<span class="ring" style="left:${r.left}%;top:${r.top}%;width:${r.width}%;height:${r.height}%"></span>`;
  }

  /* opts: { editable, shot (data URL or null), total } */
  function stepHtml(step, i, opts = {}) {
    const { editable = false, shot = null, total = 0 } = opts;
    const ce = (field) => (editable ? ` contenteditable="plaintext-only" spellcheck="true" data-field="${field}"` : '');
    let figure = '';
    if (shot) {
      figure = `<figure class="shot"><img alt="Screenshot for step ${i + 1}" src="${shot}">${ringHtml(step)}</figure>`;
    } else if (editable && step.type !== 'text') {
      figure = '<p class="noshot">No screenshot for this step.</p>';
    }
    const note = editable
      ? `<p class="note" data-placeholder="Add a note (optional)"${ce('note')}>${esc(step.note)}</p>`
      : step.note ? `<p class="note">${esc(step.note)}</p>` : '';
    const host = step.type === 'text' ? '' : T.hostOf(step.url);
    const meta = host ? `<p class="meta">${esc(host)}</p>` : '';
    const controls = editable
      ? `<div class="controls">
          <button class="small" data-action="up" ${i === 0 ? 'disabled' : ''} title="Move this step up">↑ Up</button>
          <button class="small" data-action="down" ${i === total - 1 ? 'disabled' : ''} title="Move this step down">↓ Down</button>
          ${shot ? '<button class="small" data-action="drop-shot" title="Remove the screenshot, for example if it shows private information">Remove screenshot</button>' : ''}
          <button class="small danger" data-action="delete" title="Delete this step">Delete</button>
        </div>`
      : '';
    return `<section class="step" data-id="${esc(step.id)}">
  <div class="num" aria-hidden="true">${i + 1}</div>
  <div class="body">
    <h2 class="title"${ce('title')}>${esc(step.title)}</h2>
    ${note}
    ${figure}
    ${meta}
    ${controls}
  </div>
</section>`;
  }

  function exportHtml({ title, steps, shots = {}, css = '', dateText = '' }) {
    const n = steps.length;
    const body = steps.map((s, i) => stepHtml(s, i, { editable: false, shot: shots[s.id] || null, total: n })).join('\n');
    return `<!doctype html>
<html lang="en" class="export-root"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>${css}</style></head>
<body class="export"><main class="wrap">
<h1>${esc(title)}</h1>
<p class="sub">${n} step${n === 1 ? '' : 's'}${dateText ? ' · ' + esc(dateText) : ''}</p>
${body}
</main></body></html>`;
  }

  function toMarkdown(title, steps) {
    const lines = [`# ${T.clean(title) || 'Guide'}`, ''];
    steps.forEach((s, i) => {
      lines.push(`${i + 1}. **${T.clean(s.title)}**`);
      if (T.clean(s.note)) lines.push(`   ${T.clean(s.note)}`);
    });
    return lines.join('\n') + '\n';
  }

  return { esc, ringStyle, ringHtml, stepHtml, exportHtml, toMarkdown };
});
