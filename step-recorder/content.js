// Step Recorder - content script.
// Watches clicks, typing, dropdown changes and Enter presses while recording is on.
(() => {
  if (window.__stepRecorderLoaded) return;
  window.__stepRecorderLoaded = true;

  let recording = false;
  const setState = (rec) => { recording = !!(rec && rec.active && !rec.paused); };
  try {
    chrome.storage.local.get('rec').then((r) => setState(r.rec));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.rec) setState(changes.rec.newValue);
    });
  } catch (e) { /* extension context gone */ }

  // ---- helpers ----------------------------------------------------------
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const trunc = (s, n = 60) => { s = clean(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

  const CLICKABLE =
    'a,button,input,select,textarea,summary,label,[role="button"],[role="link"],[role="menuitem"],' +
    '[role="tab"],[role="checkbox"],[role="radio"],[role="option"],[role="switch"],[onclick],[tabindex]';

  function pickTarget(node) {
    const el = node instanceof Element ? node : node && node.parentElement;
    return el ? el.closest(CLICKABLE) || el : null;
  }

  const TEXT_TYPES = ['text', 'email', 'search', 'url', 'tel', 'password', 'number', 'date', 'time', 'datetime-local', 'month', 'week'];
  function isTextEntry(el) {
    if (!el || !el.tagName) return false;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName === 'INPUT') return TEXT_TYPES.includes((el.type || 'text').toLowerCase());
    return false;
  }

  function isSensitive(el) {
    const hint = `${el.name || ''} ${el.id || ''}`;
    return (
      el.type === 'password' ||
      /cc-|password/.test(el.autocomplete || '') ||
      /pass|pwd|secret|token|ssn|card|cvv|cvc/i.test(hint)
    );
  }

  function labelFor(el) {
    if (!el) return '';
    const aria = el.getAttribute('aria-label');
    if (clean(aria)) return trunc(aria);
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const t = by.split(/\s+/).map((id) => (document.getElementById(id) || {}).textContent || '').join(' ');
      if (clean(t)) return trunc(t);
    }
    if (el.labels && el.labels.length && clean(el.labels[0].textContent)) return trunc(el.labels[0].textContent);
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' && ['button', 'submit', 'reset'].includes(el.type)) return trunc(el.value);
    if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') {
      const txt = clean(el.innerText || el.textContent);
      if (txt) return trunc(txt);
    }
    const img = el.querySelector && el.querySelector('img[alt]');
    return trunc(el.getAttribute('title') || el.getAttribute('alt') || el.placeholder || (img && img.alt) || el.getAttribute('name') || el.id || '');
  }

  function kindOf(el) {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role');
    if (tag === 'a' || role === 'link') return 'link';
    if (tag === 'button' || role === 'button' || (tag === 'input' && ['button', 'submit', 'reset', 'image'].includes(el.type))) return 'button';
    if (tag === 'input' && el.type === 'checkbox' || role === 'checkbox' || role === 'switch') return 'checkbox';
    if (tag === 'input' && el.type === 'radio' || role === 'radio') return 'option';
    if (tag === 'select') return 'dropdown';
    if (role === 'tab') return 'tab';
    if (role === 'menuitem') return 'menu item';
    return '';
  }

  // Rectangle in top-window viewport coordinates (so it lines up with the screenshot).
  function geometry(el) {
    const r = el.getBoundingClientRect();
    let x = r.left, y = r.top, w = window;
    try {
      while (w !== w.top) {
        const fe = w.frameElement;
        if (!fe) return { rect: null, vw: 0, vh: 0 }; // cross-origin iframe: no reliable position
        const fr = fe.getBoundingClientRect();
        x += fr.left; y += fr.top; w = w.parent;
      }
    } catch (e) {
      return { rect: null, vw: 0, vh: 0 };
    }
    return { rect: { x, y, w: r.width, h: r.height }, vw: w.innerWidth, vh: w.innerHeight };
  }

  function send(step) {
    try {
      chrome.runtime.sendMessage({ type: 'step', step: { url: location.href, ...step } }).catch(() => {});
    } catch (e) {
      recording = false; // extension was reloaded; stop quietly
    }
  }

  function clickTitle(kind, label) {
    if (label && kind) return `Click "${label}" ${kind}`;
    if (label) return `Click "${label}"`;
    return kind ? `Click the ${kind}` : 'Click here';
  }

  // ---- click ------------------------------------------------------------
  let last = { label: null, t: 0 };
  document.addEventListener('click', (e) => {
    if (!recording || !e.isTrusted) return;
    const el = pickTarget(e.target);
    if (!el) return;
    if (isTextEntry(el)) return;                                 // recorded when typing finishes
    if (el.tagName === 'SELECT' || el.tagName === 'OPTION') return; // recorded on change
    if (el.tagName === 'LABEL' && el.control && isTextEntry(el.control)) return;

    const label = labelFor(el);
    const now = Date.now();
    if (last.label === label && now - last.t < 400) return;     // label + input double-fire
    last = { label, t: now };

    const g = geometry(el);
    send({ type: 'click', title: clickTitle(kindOf(el), label), rect: g.rect, vw: g.vw, vh: g.vh });
  }, true);

  // ---- typing -----------------------------------------------------------
  const typed = new WeakMap();
  function recordTyped(el) {
    const value = el.value;
    if (!value || typed.get(el) === value) return;
    typed.set(el, value);
    const label = labelFor(el);
    const where = label ? `"${label}"` : 'the field';
    const title = isSensitive(el)
      ? `Enter the value for ${where} (hidden)`
      : `Type "${trunc(value, 40)}" in ${where}`;
    const g = geometry(el);
    send({ type: 'type', title, rect: g.rect, vw: g.vw, vh: g.vh });
  }

  document.addEventListener('change', (e) => {
    if (!recording || !e.isTrusted) return;
    const el = e.target;
    if (!el || !el.tagName) return;
    if (el.tagName === 'SELECT') {
      const opt = el.selectedOptions && el.selectedOptions[0];
      const label = labelFor(el);
      const g = geometry(el);
      send({
        type: 'select',
        title: `Select "${trunc(opt ? opt.text : el.value, 40)}"${label ? ` in "${label}"` : ''}`,
        rect: g.rect, vw: g.vw, vh: g.vh
      });
    } else if (isTextEntry(el)) {
      recordTyped(el);
    }
  }, true);

  document.addEventListener('keydown', (e) => {
    if (!recording || !e.isTrusted || e.key !== 'Enter') return;
    const el = e.target;
    if (!isTextEntry(el) || el.tagName === 'TEXTAREA') return;
    recordTyped(el);                                              // make sure the text comes first
    const g = geometry(el);
    send({ type: 'key', title: 'Press Enter', rect: g.rect, vw: g.vw, vh: g.vh });
  }, true);
})();
