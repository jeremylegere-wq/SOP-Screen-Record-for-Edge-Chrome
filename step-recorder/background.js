// Step Recorder - service worker.
// Owns recording state, takes screenshots, and stores steps in chrome.storage.local.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- state helpers -------------------------------------------------------
async function getRec() {
  const { rec } = await chrome.storage.local.get('rec');
  return rec || { active: false, paused: false };
}
async function getSteps() {
  const { steps } = await chrome.storage.local.get('steps');
  return steps || [];
}

function applyBadge(rec) {
  if (!rec || !rec.active) {
    chrome.action.setBadgeText({ text: '' });
  } else if (rec.paused) {
    chrome.action.setBadgeText({ text: 'II' });
    chrome.action.setBadgeBackgroundColor({ color: '#6b7280' });
  } else {
    chrome.action.setBadgeText({ text: 'REC' });
    chrome.action.setBadgeBackgroundColor({ color: '#d92d20' });
  }
}

// ---- serial queue: keeps steps in the order they happened ----------------
let queue = Promise.resolve();
function enqueue(fn) {
  queue = queue.then(fn).catch((e) => console.error('[Step Recorder]', e));
  return queue;
}

// ---- screenshots (browser limits captureVisibleTab to ~2 calls/second) ----
let lastCapture = 0;
async function capture(windowId) {
  const wait = 540 - (Date.now() - lastCapture);
  if (wait > 0) await sleep(wait);
  for (let i = 0; i < 2; i++) {
    try {
      lastCapture = Date.now();
      return await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 60 });
    } catch (e) {
      await sleep(600);
    }
  }
  return null;
}

async function pushStep(step) {
  const steps = await getSteps();
  steps.push({ id: crypto.randomUUID(), ts: Date.now(), note: '', ...step });
  await chrome.storage.local.set({ steps });
}

// ---- recording lifecycle -------------------------------------------------
async function injectIntoOpenTabs() {
  // Pages that were already open before the extension loaded have no content script yet.
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs
      .filter((t) => t.id && t.url && /^https?:/.test(t.url))
      .map((t) =>
        chrome.scripting
          .executeScript({ target: { tabId: t.id, allFrames: true }, files: ['content.js'] })
          .catch(() => {})
      )
  );
}

async function start() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const rec = { active: true, paused: false, startedAt: Date.now() };
  await chrome.storage.local.set({ rec, steps: [], title: 'New workflow' });
  applyBadge(rec);
  await injectIntoOpenTabs();
  if (tab && tab.url && /^https?:/.test(tab.url)) {
    let host = tab.url;
    try { host = new URL(tab.url).hostname; } catch (e) {}
    const shot = await capture(tab.windowId);
    await enqueue(() =>
      pushStep({ type: 'open', title: `Go to ${host}`, url: tab.url, pageTitle: tab.title || '', shot, rect: null })
    );
  }
}

async function setPaused(paused) {
  const rec = await getRec();
  if (!rec.active) return;
  rec.paused = paused;
  await chrome.storage.local.set({ rec });
  applyBadge(rec);
}

async function stop() {
  const rec = await getRec();
  rec.active = false;
  rec.paused = false;
  await chrome.storage.local.set({ rec });
  applyBadge(rec);
  await queue; // let any pending screenshot finish
  await chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html') });
}

async function discard() {
  await chrome.storage.local.set({ rec: { active: false, paused: false }, steps: [], title: 'New workflow' });
  applyBadge({ active: false });
}

// ---- messages ------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg && msg.type) {
    case 'step': {
      const tab = sender.tab;
      enqueue(async () => {
        const rec = await getRec();
        if (!rec.active || rec.paused) return;
        const shot = tab && tab.active ? await capture(tab.windowId) : null;
        await pushStep({ ...msg.step, shot, pageTitle: (tab && tab.title) || '' });
      });
      sendResponse({ ok: true });
      return;
    }
    case 'start': start().then(() => sendResponse({ ok: true })); return true;
    case 'pause': setPaused(true).then(() => sendResponse({ ok: true })); return true;
    case 'resume': setPaused(false).then(() => sendResponse({ ok: true })); return true;
    case 'stop': stop().then(() => sendResponse({ ok: true })); return true;
    case 'discard': discard().then(() => sendResponse({ ok: true })); return true;
  }
});

// Keep the toolbar badge right after a browser restart / extension reload.
chrome.runtime.onStartup.addListener(async () => applyBadge(await getRec()));
chrome.runtime.onInstalled.addListener(async () => applyBadge(await getRec()));
