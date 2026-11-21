// Step Recorder - service worker.
// All state lives in chrome.storage.local (the worker can be stopped at any time).
importScripts('lib/text.js', 'lib/guide.js', 'lib/store.js');

const G = self.StepGuide;
const T = self.StepText;
const store = self.StepStore.makeStore(chrome.storage.local);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isWebUrl = (u) => /^https?:/i.test(u || '');

// ---- toolbar badge ------------------------------------------------------
function applyBadge(rec) {
  if (!rec || !rec.active) {
    chrome.action.setBadgeText({ text: '' });
    chrome.action.setTitle({ title: 'Step Recorder' });
  } else if (rec.paused) {
    chrome.action.setBadgeText({ text: 'II' });
    chrome.action.setBadgeBackgroundColor({ color: '#6b7280' });
    chrome.action.setTitle({ title: 'Step Recorder - paused' });
  } else {
    chrome.action.setBadgeText({ text: rec.stepCount ? String(rec.stepCount) : 'REC' });
    chrome.action.setBadgeBackgroundColor({ color: '#d92d20' });
    chrome.action.setTitle({ title: `Step Recorder - recording (${rec.stepCount || 0} steps)` });
  }
}

// ---- one-at-a-time queue keeps steps in the order they happened ----------
let queue = Promise.resolve();
function enqueue(fn) {
  queue = queue.then(fn).catch((e) => console.error('[Step Recorder]', e));
  return queue;
}

// ---- screenshots --------------------------------------------------------
// Browsers allow roughly two captureVisibleTab calls per second.
let lastCapture = 0;
async function takeShot(tab) {
  const wait = 540 - (Date.now() - lastCapture);
  if (wait > 0) await sleep(wait);
  const settings = await store.getSettings();
  // Ask the page to hide our toolbar and blur private fields. Never wait long for an answer.
  const tell = (m) => Promise.race([chrome.tabs.sendMessage(tab.id, m), sleep(500)]).catch(() => {});
  await tell({ type: 'prepareShot', blur: settings.blurSensitive });
  let shot = null;
  for (let i = 0; i < 2 && !shot; i++) {
    try {
      lastCapture = Date.now();
      shot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 70 });
    } catch (e) {
      await sleep(600);
    }
  }
  await tell({ type: 'restoreShot' });
  return shot;
}

async function addStep(guideId, partial, shot) {
  const guide = await store.loadGuide(guideId);
  if (!guide) return;
  const step = G.newStep({ ...partial, hasShot: !!shot });
  guide.steps.push(step);
  guide.updated = Date.now();
  const rec = await store.getRec();
  rec.stepCount = guide.steps.length;
  const items = { [`guide:${guide.id}`]: guide, rec };
  if (shot) items[`shot:${step.id}`] = shot;
  await chrome.storage.local.set(items);
  applyBadge(rec);
}

// ---- recording lifecycle -----------------------------------------------
async function injectIntoOpenTabs() {
  // Tabs that were open before the extension was installed have no content script yet.
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs
      .filter((t) => t.id && isWebUrl(t.url))
      .map((t) =>
        chrome.scripting
          .executeScript({ target: { tabId: t.id, allFrames: true }, files: ['lib/text.js', 'content.js'] })
          .catch(() => {})
      )
  );
}

async function startRecording() {
  if ((await store.getRec()).active) return;
  const guide = G.createGuide();
  const rec = { active: true, paused: false, guideId: guide.id, startedAt: Date.now(), stepCount: 0 };
  await chrome.storage.local.set({ rec, [`guide:${guide.id}`]: guide });
  applyBadge(rec);
  await injectIntoOpenTabs();

  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab && isWebUrl(tab.url)) {
    await enqueue(async () => {
      const shot = await takeShot(tab);
      await addStep(guide.id, { type: 'open', title: T.openTitle(tab.url), url: tab.url, rect: null }, shot);
    });
  }
}

async function setPaused(paused) {
  const rec = await store.getRec();
  if (!rec.active) return;
  rec.paused = paused;
  await chrome.storage.local.set({ rec });
  applyBadge(rec);
}

// Ends the recording and saves the guide to the library. Returns the guide id or null.
async function finishRecording() {
  const rec = await store.getRec();
  if (!rec.active) return null;
  await queue; // let a pending screenshot finish
  await chrome.storage.local.set({ rec: { active: false, paused: false } });
  applyBadge(null);
  const guide = await store.loadGuide(rec.guideId);
  if (!guide || !guide.steps.length) {
    if (guide) await store.deleteGuide(guide.id);
    return null;
  }
  await store.saveGuide(guide);
  return guide.id;
}

async function stopRecording() {
  const id = await finishRecording();
  const url = chrome.runtime.getURL(id ? `viewer.html?id=${encodeURIComponent(id)}` : 'viewer.html?empty=1');
  await chrome.tabs.create({ url });
}

async function discardRecording() {
  const rec = await store.getRec();
  if (!rec.active) return;
  await queue;
  await chrome.storage.local.set({ rec: { active: false, paused: false } });
  applyBadge(null);
  await store.deleteGuide(rec.guideId);
}

// ---- messages from content scripts, popup and viewer -----------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg && msg.type) {
    case 'step': {
      const tab = sender.tab;
      enqueue(async () => {
        const rec = await store.getRec();
        if (!rec.active || rec.paused) return;
        const shot = tab && tab.active ? await takeShot(tab) : null;
        await addStep(rec.guideId, { ...msg.step, url: (tab && tab.url) || msg.step.url, pageTitle: (tab && tab.title) || '' }, shot);
      });
      sendResponse({ ok: true });
      return;
    }
    case 'start': startRecording().then(() => sendResponse({ ok: true })); return true;
    case 'stop': stopRecording().then(() => sendResponse({ ok: true })); return true;
    case 'pause': setPaused(true).then(() => sendResponse({ ok: true })); return true;
    case 'resume': setPaused(false).then(() => sendResponse({ ok: true })); return true;
    case 'discard': discardRecording().then(() => sendResponse({ ok: true })); return true;
  }
});

// ---- keyboard shortcuts --------------------------------------------------
chrome.commands.onCommand.addListener(async (command) => {
  const rec = await store.getRec();
  if (command === 'toggle-recording') {
    if (rec.active) await stopRecording(); else await startRecording();
  } else if (command === 'toggle-pause' && rec.active) {
    await setPaused(!rec.paused);
  }
});

// ---- install / startup ---------------------------------------------------
chrome.runtime.onInstalled.addListener(async (details) => {
  applyBadge(await store.getRec());
  if (details.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
});

// If the browser was closed mid-recording, save what was captured instead of silently recording on.
chrome.runtime.onStartup.addListener(async () => {
  if ((await store.getRec()).active) await finishRecording();
  applyBadge(await store.getRec());
});
