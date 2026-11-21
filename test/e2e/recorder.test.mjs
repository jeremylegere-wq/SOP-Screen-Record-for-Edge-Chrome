// End-to-end check: loads the real extension (the extension/ folder) into Chromium,
// records a scripted workflow with trusted mouse/keyboard input, then exercises the guide editor.
//
// Browser: set STEP_RECORDER_CHROMIUM=/path/to/chrome to use a specific binary; otherwise the
// Chromium installed by "npx playwright install chromium" is used.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const EXT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'extension');

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Demo shop</title>
<style>body{font:16px sans-serif;margin:24px} label{display:block;margin:8px 0} .pointer{cursor:pointer;padding:6px;border:1px solid #999;display:inline-block}</style></head>
<body>
<h1>Demo shop</h1>
<p id="blank">Some plain text that is not interactive.</p>
<nav><a href="#pricing">Pricing</a></nav>
<form id="f" onsubmit="return false">
  <label for="email">Email address</label><input id="email" name="email" type="text">
  <label for="pw">Password</label><input id="pw" name="pw" type="password">
  <label for="country">Country</label>
  <select id="country" name="country"><option>Australia</option><option>Canada</option><option>Denmark</option></select>
  <label><input id="remember" type="checkbox"> Remember me</label>
  <button type="button" id="search" onclick="document.getElementById('result').textContent='searched'">Search</button>
</form>
<div id="menu" role="button" tabindex="0" aria-label="Open menu" class="pointer">☰</div>
<p id="result"></p>
</body></html>`;

let server, baseUrl, userDir, context, sw, extensionId, page;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const swEval = (fn, arg) => sw.evaluate(fn, arg);
const recState = () => swEval(() => chrome.storage.local.get('rec').then((r) => r.rec));

async function waitForSteps(n, timeout = 20000) {
  const end = Date.now() + timeout;
  let last = -1;
  while (Date.now() < end) {
    last = (await recState()).stepCount || 0;
    if (last >= n) return;
    await sleep(150);
  }
  assert.fail(`expected ${n} steps within ${timeout}ms, have ${last}`);
}

before(async () => {
  server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/`;

  userDir = mkdtempSync(join(tmpdir(), 'sr-e2e-'));
  const executablePath = process.env.STEP_RECORDER_CHROMIUM || undefined;
  context = await chromium.launchPersistentContext(userDir, {
    ...(executablePath ? { executablePath } : { channel: 'chromium' }),
    headless: true,
    viewport: { width: 1000, height: 700 },
    args: ['--no-sandbox', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
  });
  sw = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker', { timeout: 20000 }));
  extensionId = new URL(sw.url()).host;
});

after(async () => {
  if (context) await context.close();
  if (server) server.close();
  if (userDir) rmSync(userDir, { recursive: true, force: true });
});

describe('recording a workflow', () => {
  test('popup shows the idle state with a Start button and a warning on browser pages', async () => {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.waitForSelector('#start');
    assert.equal(await popup.locator('#start').isVisible(), true);
    assert.equal(await popup.locator('#live').isVisible(), false);
    assert.equal(await popup.locator('#blocked').isVisible(), true, 'extension pages are not recordable');
    await popup.close();
  });

  test('records clicks, typing, Enter, dropdown and checkbox as ordered steps', async () => {
    page = await context.newPage();
    await page.goto(baseUrl);
    await page.bringToFront();

    await swEval(() => self.startRecording());
    await waitForSteps(1);
    assert.equal((await recState()).active, true);

    // The on-page toolbar is injected.
    await page.waitForSelector('#__step-recorder-ui', { state: 'attached' });

    await page.click('text=Pricing');                       // link
    await page.click('#email');                             // text field: not a step by itself
    await page.keyboard.type('jane@example.com');
    await page.click('#search');                            // typing is flushed before this click
    await page.click('#pw');
    await page.keyboard.type('hunter2');
    await page.keyboard.press('Enter');                     // password value, then Enter
    await page.focus('#country');
    await page.keyboard.press('ArrowDown');                 // real change event on the select
    await page.click('#remember');                          // checkbox
    await page.click('#blank');                             // plain text: ignored
    await page.click('#menu');                              // custom role="button"
    await waitForSteps(9);

    // Pause: nothing is recorded; resume: recording continues.
    await swEval(() => self.setPaused(true));
    await page.click('#menu');
    await sleep(1500);
    assert.equal((await recState()).stepCount, 9, 'no step while paused');
    await swEval(() => self.setPaused(false));
    await page.click('#menu');
    await waitForSteps(10);
  });

  test('stopping opens the saved guide with the expected steps', async () => {
    const opened = context.waitForEvent('page');
    await swEval(() => self.stopRecording());
    const viewer = await opened;
    await viewer.waitForSelector('.step');

    const titles = await viewer.locator('.step .title').allInnerTexts();
    assert.deepEqual(titles, [
      'Go to 127.0.0.1',
      'Click "Pricing" link',
      'Type "jane@example.com" in "Email address"',
      'Click "Search" button',
      'Enter the value for "Password" (hidden)',
      'Press Enter',
      'Select "Canada" in "Country"',
      'Click "Remember me" checkbox',
      'Click "Open menu" button',
      'Click "Open menu" button'
    ]);
    assert.ok(!(await viewer.content()).includes('hunter2'), 'password never appears in the guide');

    // Every step has a screenshot; click-type steps have a highlight ring.
    assert.equal(await viewer.locator('.step .shot img').count(), 10, 'a screenshot per step');
    assert.ok((await viewer.locator('.step .ring').count()) >= 8, 'highlight rings drawn');
    assert.equal((await recState()).active, false);

    // The page was left clean: toolbar hidden after stop, no leftover blur.
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('pw')).filter), 'none');
    assert.equal(await page.evaluate(() => document.getElementById('__step-recorder-ui').style.display), 'none');

    globalThis.__viewerUrl = viewer.url();
    await viewer.close();
  });
});

describe('guide editor and library', () => {
  let viewer;
  before(async () => {
    viewer = await context.newPage();
    await viewer.goto(globalThis.__viewerUrl);
    await viewer.waitForSelector('.step');
  });

  test('editing a title persists across reloads', async () => {
    const title = viewer.locator('.step .title').nth(1);
    await title.click();
    await viewer.keyboard.press('Control+A');
    await viewer.keyboard.type('Open the pricing page');
    await viewer.keyboard.press('Enter');
    await viewer.waitForFunction(() => document.getElementById('saved').textContent.includes('Saved'));
    await viewer.reload();
    await viewer.waitForSelector('.step');
    assert.equal(await viewer.locator('.step .title').nth(1).innerText(), 'Open the pricing page');
  });

  test('delete a step, then Undo restores it in place', async () => {
    await viewer.locator('.step').nth(2).getByRole('button', { name: 'Delete', exact: true }).click();
    assert.equal(await viewer.locator('.step').count(), 9);
    await viewer.getByRole('button', { name: 'Undo' }).click();
    assert.equal(await viewer.locator('.step').count(), 10);
    assert.equal(await viewer.locator('.step .title').nth(2).innerText(), 'Type "jane@example.com" in "Email address"');
  });

  test('move a step down and add a text step', async () => {
    await viewer.locator('.step').nth(0).getByRole('button', { name: /Down/ }).click();
    assert.equal(await viewer.locator('.step .title').nth(0).innerText(), 'Open the pricing page');
    await viewer.locator('.insert button').nth(0).click();
    assert.equal(await viewer.locator('.step').count(), 11);
    assert.equal(await viewer.locator('.step .title').nth(1).innerText(), 'New step');
  });

  test('leaving the page right after an edit still saves it', async () => {
    // Edit and navigate away immediately, well inside the 250 ms save delay.
    await viewer.locator('.step .title').nth(1).click();
    await viewer.keyboard.press('Control+A');
    await viewer.keyboard.type('Wait for the page to load');
    await viewer.keyboard.press('Enter');
    await viewer.goto(`chrome-extension://${extensionId}/viewer.html`);
    await viewer.waitForSelector('.card');
    assert.match(await viewer.locator('.card .sub').innerText(), /11 steps/);
    await viewer.locator('.card').getByRole('button', { name: 'Open' }).click();
    await viewer.waitForSelector('.step');
    assert.equal(await viewer.locator('.step .title').nth(1).innerText(), 'Wait for the page to load');
  });

  test('HTML export is a standalone read-only page with screenshots', async () => {
    const [download] = await Promise.all([
      viewer.waitForEvent('download'),
      viewer.getByRole('button', { name: /Download guide/ }).click()
    ]);
    const html = readFileSync(await download.path(), 'utf8');
    assert.ok(html.startsWith('<!doctype html>'));
    assert.ok(html.includes('Click &quot;Search&quot; button'), 'step titles are present (HTML-escaped)');
    assert.ok(html.includes('Open the pricing page'), 'edited title is exported');
    assert.ok((html.match(/<img /g) || []).length >= 10);
    assert.ok(!html.includes('contenteditable="'), 'no editable fields in the export');
    assert.ok(!html.includes('data-action'), 'no editor buttons in the export');
    assert.ok(!html.includes('hunter2'));
    assert.ok(!/<script/i.test(html), 'export contains no scripts');
  });

  test('library lists the guide; deleting it removes it and its screenshots', async () => {
    await viewer.goto(`chrome-extension://${extensionId}/viewer.html`);
    await viewer.waitForSelector('.card');
    assert.equal(await viewer.locator('.card').count(), 1);
    assert.match(await viewer.locator('.card .sub').innerText(), /11 steps/);

    viewer.once('dialog', (d) => d.accept());
    await viewer.locator('.card').getByRole('button', { name: 'Delete' }).click();
    await viewer.waitForSelector('#libraryEmpty', { state: 'visible' });

    const leftovers = await swEval(async () => Object.keys(await chrome.storage.local.get(null)).filter((k) => k.startsWith('shot:') || k.startsWith('guide:')));
    assert.deepEqual(leftovers, [], 'no orphaned guide or screenshot data');
  });
});

describe('edge cases', () => {
  test('stopping with nothing recorded shows a helpful message and saves nothing', async () => {
    const p = await context.newPage();
    await p.goto('about:blank');
    await p.bringToFront();
    await swEval(() => self.startRecording()); // about:blank is not recordable, so no "open" step
    const opened = context.waitForEvent('page');
    await swEval(() => self.stopRecording());
    const viewer = await opened;
    await viewer.waitForSelector('#emptyBanner', { state: 'visible' });
    assert.deepEqual(await swEval(() => chrome.storage.local.get('guides').then((r) => r.guides || [])), []);
  });

  test('discarding a recording removes everything it captured', async () => {
    const p = await context.newPage();
    await p.goto(baseUrl);
    await p.bringToFront();
    await swEval(() => self.startRecording());
    await waitForSteps(1);
    await swEval(() => self.discardRecording());
    assert.equal((await recState()).active, false);
    const keys = await swEval(async () => Object.keys(await chrome.storage.local.get(null)).filter((k) => k.startsWith('shot:') || k.startsWith('guide:')));
    assert.deepEqual(keys, []);
  });
});
