// Step Recorder - content script.
// Watches clicks, typing and dropdown changes while a recording is running and shows
// a small floating toolbar (top frame only). Needs lib/text.js loaded first.
(() => {
  if (window.__stepRecorderLoaded) return;
  window.__stepRecorderLoaded = true;

  const T = self.StepText;
  const isTop = window === window.top;
  let dead = false; // set when the extension is reloaded/removed while this page stays open

  let rec = { active: false, paused: false };
  let settings = { blurSensitive: true, hideTypedText: false, showToolbar: true };
  const recording = () => !dead && !!(rec.active && !rec.paused);

  // ---- state ------------------------------------------------------------
  function guard(fn) {
    try { return fn(); } catch (e) { dead = true; return undefined; }
  }

  guard(() => {
    chrome.storage.local.get(['rec', 'settings']).then((r) => {
      rec = r.rec || rec;
      settings = { ...settings, ...(r.settings || {}) };
      updateToolbar();
    }).catch(() => {});
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.rec) rec = changes.rec.newValue || { active: false, paused: false };
      if (changes.settings) settings = { ...settings, ...(changes.settings.newValue || {}) };
      updateToolbar();
    });
  });

  function sendBg(message) {
    guard(() => chrome.runtime.sendMessage(message).catch(() => {}));
  }

  // ---- floating toolbar ---------------------------------------------------
  let host = null;
  let shadowRoot = null;
  const els = {};
  const CORNERS = ['br', 'bl', 'tl', 'tr'];
  let corner = 0;
  let lastCount = -1;
  let flashTimer = null;

  const TOOLBAR_CSS = `
    :host { all: initial; }
    .bar { position: fixed; z-index: 2147483647; display: flex; align-items: center; gap: 8px;
      padding: 8px 10px; border-radius: 999px; background: #1f1f1f; color: #fff;
      font: 13px/1 "Segoe UI", system-ui, sans-serif; box-shadow: 0 4px 18px rgba(0,0,0,.35); user-select: none; }
    .br { right: 16px; bottom: 16px; } .bl { left: 16px; bottom: 16px; }
    .tr { right: 16px; top: 16px; } .tl { left: 16px; top: 16px; }
    .dot { width: 10px; height: 10px; border-radius: 50%; background: #ff4d3d; animation: pulse 1.2s infinite; }
    .dot.paused { background: #f7b500; animation: none; }
    @keyframes pulse { 50% { opacity: .35; } }
    .label { font-weight: 600; } .count { opacity: .75; }
    .flash { color: #7ee787; font-weight: 600; display: none; }
    button { font: inherit; color: #fff; background: #3a3a3a; border: 0; border-radius: 999px; padding: 6px 12px; cursor: pointer; }
    button:hover { background: #4a4a4a; }
    button.stop { background: #d92d20; } button.stop:hover { background: #b42318; }
    button.move { padding: 6px 8px; background: transparent; opacity: .7; }
    button:focus-visible { outline: 2px solid #8ab4f8; outline-offset: 1px; }
  `;

  function ensureToolbar() {
    if (host || !isTop) return;
    if (!document.documentElement) {
      document.addEventListener('DOMContentLoaded', updateToolbar, { once: true });
      return;
    }
    host = document.createElement('div');
    host.id = '__step-recorder-ui';
    shadowRoot = host.attachShadow({ mode: 'closed' });
    shadowRoot.innerHTML = `<style>${TOOLBAR_CSS}</style>
      <div class="bar br" role="region" aria-label="Step Recorder">
        <span class="dot"></span><span class="label">Recording</span><span class="count">0 steps</span>
        <span class="flash"></span>
        <button class="pause" type="button">Pause</button>
        <button class="stop" type="button">Stop</button>
        <button class="move" type="button" title="Move this toolbar" aria-label="Move toolbar">⇄</button>
      </div>`;
    const q = (s) => shadowRoot.querySelector(s);
    Object.assign(els, {
      bar: q('.bar'), dot: q('.dot'), label: q('.label'), count: q('.count'),
      flash: q('.flash'), pause: q('.pause'), stop: q('.stop'), move: q('.move')
    });
    els.pause.addEventListener('click', () => sendBg({ type: rec.paused ? 'resume' : 'pause' }));
    els.stop.addEventListener('click', () => sendBg({ type: 'stop' }));
    els.move.addEventListener('click', () => {
      corner = (corner + 1) % CORNERS.length;
      els.bar.className = `bar ${CORNERS[corner]}`;
    });
    document.documentElement.appendChild(host);
  }

  function flash(text) {
    els.flash.textContent = text;
    els.flash.style.display = 'inline';
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { els.flash.style.display = 'none'; }, 1400);
  }

  function updateToolbar() {
    if (!isTop) return;
    if (!(rec.active && settings.showToolbar)) {
      if (host) host.style.display = 'none';
      lastCount = -1;
      return;
    }
    ensureToolbar();
    if (!host) return;
    host.style.display = '';
    const n = rec.stepCount || 0;
    els.label.textContent = rec.paused ? 'Paused' : 'Recording';
    els.count.textContent = `${n} step${n === 1 ? '' : 's'}`;
    els.pause.textContent = rec.paused ? 'Resume' : 'Pause';
    els.dot.className = 'dot' + (rec.paused ? ' paused' : '');
    if (lastCount >= 0 && n > lastCount && !rec.paused) flash(`✓ Step ${n}`);
    lastCount = n;
  }

  // ---- screenshots: hide toolbar + blur private fields while the browser captures ----
  const blurred = [];
  guard(() => chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return;
    if (msg.type === 'prepareShot') {
      if (host) host.style.visibility = 'hidden';
      if (msg.blur) {
        document.querySelectorAll('input,textarea').forEach((el) => {
          if (el.value && T.isSensitiveField(describe(el))) {
            blurred.push([el, el.style.getPropertyValue('filter'), el.style.getPropertyPriority('filter')]);
            el.style.setProperty('filter', 'blur(6px)', 'important');
          }
        });
      }
      if (!isTop) return; // only the top frame answers; the others just apply the changes
      setTimeout(() => sendResponse({ ok: true }), 60); // let the page repaint
      return true;
    }
    if (msg.type === 'restoreShot') {
      if (host) host.style.visibility = 'visible';
      for (const [el, value, prio] of blurred.splice(0)) {
        if (value) el.style.setProperty('filter', value, prio); else el.style.removeProperty('filter');
      }
    }
  }));

  // ---- element helpers ----------------------------------------------------
  const CLICKABLE =
    'a,button,input,select,textarea,summary,label,[role="button"],[role="link"],[role="menuitem"],' +
    '[role="tab"],[role="checkbox"],[role="radio"],[role="option"],[role="switch"],[onclick],[tabindex]:not([tabindex="-1"])';

  function resolveTarget(node) {
    const el = node instanceof Element ? node : node && node.parentElement;
    if (!el) return null;
    const hit = el.closest(CLICKABLE);
    if (hit) return hit;
    // Custom widgets: accept the nearest ancestor that looks clickable.
    let cur = el;
    for (let i = 0; i < 5 && cur && cur !== document.documentElement; i++, cur = cur.parentElement) {
      if (getComputedStyle(cur).cursor === 'pointer') return cur;
    }
    return null;
  }

  const TEXT_TYPES = ['text', 'email', 'search', 'url', 'tel', 'password', 'number', 'date', 'time', 'datetime-local', 'month', 'week'];
  function isTextEntry(el) {
    if (!el || !el.tagName) return false;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName === 'INPUT') return TEXT_TYPES.includes((el.type || 'text').toLowerCase());
    return false;
  }

  function describe(el) {
    return {
      tag: el.tagName.toLowerCase(),
      type: el.type,
      role: el.getAttribute('role'),
      name: el.name,
      id: el.id,
      autocomplete: el.getAttribute('autocomplete') || ''
    };
  }

  function labelFor(el) {
    const aria = el.getAttribute('aria-label');
    if (T.clean(aria)) return T.trunc(aria);
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const t = by.split(/\s+/).map((id) => (document.getElementById(id) || {}).textContent || '').join(' ');
      if (T.clean(t)) return T.trunc(t);
    }
    if (el.labels && el.labels.length && T.clean(el.labels[0].textContent)) return T.trunc(el.labels[0].textContent);
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' && ['button', 'submit', 'reset'].includes(el.type)) return T.trunc(el.value);
    if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') {
      const txt = T.clean(el.innerText || el.textContent);
      if (txt) return T.trunc(txt);
    }
    const img = el.querySelector && el.querySelector('img[alt]');
    return T.trunc(el.getAttribute('title') || el.getAttribute('alt') || el.placeholder || (img && img.alt) || el.getAttribute('name') || el.id || '');
  }

  // Rectangle in top-window viewport coordinates, so it lines up with the screenshot.
  function geometry(el) {
    const r = el.getBoundingClientRect();
    let x = r.left;
    let y = r.top;
    let w = window;
    try {
      while (w !== w.top) {
        const frame = w.frameElement;
        if (!frame) return { rect: null, vw: 0, vh: 0 }; // cross-origin iframe: position unknown
        const fr = frame.getBoundingClientRect();
        x += fr.left; y += fr.top; w = w.parent;
      }
    } catch (e) {
      return { rect: null, vw: 0, vh: 0 };
    }
    return { rect: { x, y, w: r.width, h: r.height }, vw: w.innerWidth, vh: w.innerHeight };
  }

  function send(step) {
    sendBg({ type: 'step', step: { url: location.href, ...step } });
  }

  // True when an event came from our own toolbar.
  const fromUi = (e) => !!host && (e.target === host || (e.composedPath && e.composedPath().includes(host)));

  // ---- typing -----------------------------------------------------------
  const typed = new WeakMap();
  function recordTyped(el) {
    const value = el.value;
    if (!value || typed.get(el) === value) return;
    typed.set(el, value);
    const d = describe(el);
    const title = T.typeTitle(value, labelFor(el), { sensitive: T.isSensitiveField(d), hideValue: settings.hideTypedText });
    const g = geometry(el);
    send({ type: 'type', title, rect: g.rect, vw: g.vw, vh: g.vh });
  }

  // Rich-text boxes (contenteditable): compare text when focus leaves.
  const editableStart = new WeakMap();
  function flushEditable(el) {
    if (!el || !el.isContentEditable || !editableStart.has(el)) return;
    const now = T.clean(el.textContent);
    const before = T.clean(editableStart.get(el));
    editableStart.set(el, el.textContent);
    if (!now || now === before) return;
    const g = geometry(el);
    send({
      type: 'type',
      title: T.typeTitle(now, labelFor(el), { sensitive: false, hideValue: settings.hideTypedText }),
      rect: g.rect, vw: g.vw, vh: g.vh
    });
  }

  function flushPendingTyping() {
    const ae = document.activeElement;
    if (!ae) return;
    if (isTextEntry(ae)) recordTyped(ae); else flushEditable(ae);
  }

  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (el && el.isContentEditable && !isTextEntry(el)) editableStart.set(el, el.textContent);
  }, true);
  document.addEventListener('focusout', (e) => {
    if (recording() && e.target && e.target.isContentEditable && !isTextEntry(e.target)) flushEditable(e.target);
  }, true);

  document.addEventListener('change', (e) => {
    if (!recording() || !e.isTrusted) return;
    const el = e.target;
    if (!el || !el.tagName) return;
    if (el.tagName === 'SELECT') {
      const opt = el.selectedOptions && el.selectedOptions[0];
      const g = geometry(el);
      send({ type: 'select', title: T.selectTitle(opt ? opt.text : el.value, labelFor(el)), rect: g.rect, vw: g.vw, vh: g.vh });
    } else if (isTextEntry(el)) {
      recordTyped(el);
    }
  }, true);

  document.addEventListener('keydown', (e) => {
    if (!recording() || !e.isTrusted || e.key !== 'Enter') return;
    const el = e.target;
    if (!isTextEntry(el) || el.tagName === 'TEXTAREA') return;
    recordTyped(el); // the text comes before the Enter
    const g = geometry(el);
    send({ type: 'key', title: 'Press Enter', rect: g.rect, vw: g.vw, vh: g.vh });
  }, true);

  // ---- clicks -------------------------------------------------------------
  // Recorded on pointerdown so the screenshot shows the page before the click changes it.
  let lastPointer = 0;
  let last = { label: null, t: 0 };

  function handleActivation(node) {
    const el = resolveTarget(node);
    if (!el) return;
    if (isTextEntry(el) || el.isContentEditable) return;            // recorded when typing finishes
    if (el.tagName === 'SELECT' || el.tagName === 'OPTION') return; // recorded on change
    if (el.tagName === 'LABEL' && el.control && (isTextEntry(el.control) || el.control.tagName === 'SELECT')) return;

    const label = labelFor(el);
    const now = Date.now();
    if (last.label === label && now - last.t < 400) return;       // double events for one click
    last = { label, t: now };

    flushPendingTyping(); // text typed just before this click must come first
    const g = geometry(el);
    send({ type: 'click', title: T.clickTitle(T.kindOf(describe(el)), label), rect: g.rect, vw: g.vw, vh: g.vh });
  }

  document.addEventListener('pointerdown', (e) => {
    if (!recording() || !e.isTrusted || e.button !== 0 || fromUi(e)) return;
    lastPointer = Date.now();
    handleActivation(e.target);
  }, true);

  // Keyboard-activated clicks (Enter/Space on a button or link) have no pointerdown.
  document.addEventListener('click', (e) => {
    if (!recording() || !e.isTrusted || fromUi(e)) return;
    if (e.detail !== 0 || Date.now() - lastPointer < 800) return;
    handleActivation(e.target);
  }, true);
})();
