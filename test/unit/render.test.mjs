import { test } from 'node:test';
import assert from 'node:assert/strict';
import R from '../../extension/lib/render.js';

test('esc escapes HTML special characters', () => {
  assert.equal(R.esc(`<b a="1">'&</b>`), '&lt;b a=&quot;1&quot;&gt;&#39;&amp;&lt;/b&gt;');
  assert.equal(R.esc(null), '');
});

test('ringStyle centres a padded box as percentages of the viewport', () => {
  const r = R.ringStyle({ rect: { x: 100, y: 50, w: 200, h: 40 }, vw: 1000, vh: 500 });
  // padded size 212 x 52, centred on (200, 70)
  assert.deepEqual(r, { left: 9.4, top: 8.8, width: 21.2, height: 10.4 });
});

test('ringStyle enforces a minimum size and returns null without geometry', () => {
  const tiny = R.ringStyle({ rect: { x: 10, y: 10, w: 2, h: 2 }, vw: 100, vh: 100 });
  assert.equal(tiny.width, 32);
  assert.equal(R.ringStyle({ rect: null, vw: 100, vh: 100 }), null);
  assert.equal(R.ringStyle({ rect: { x: 0, y: 0, w: 1, h: 1 }, vw: 0, vh: 0 }), null);
});

test('stepHtml escapes user text and shows the highlight ring', () => {
  const step = { id: 's1', type: 'click', title: '<script>alert(1)</script>', note: 'a & b', url: 'https://example.com/x', rect: { x: 0, y: 0, w: 50, h: 50 }, vw: 500, vh: 500 };
  const html = R.stepHtml(step, 0, { editable: false, shot: 'data:image/jpeg;base64,AAA', total: 1 });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('a &amp; b'));
  assert.ok(html.includes('class="ring"'));
  assert.ok(html.includes('example.com'));
  assert.ok(!html.includes('contenteditable'), 'export is read-only');
  assert.ok(!html.includes('data-action'), 'export has no editor controls');
});

test('stepHtml editor mode has editable fields and disabled edge buttons', () => {
  const step = { id: 's1', type: 'click', title: 'Click "Save"', note: '', url: 'https://example.com' };
  const html = R.stepHtml(step, 0, { editable: true, shot: null, total: 1 });
  assert.ok(html.includes('contenteditable'));
  assert.match(html, /data-action="up" disabled/);
  assert.match(html, /data-action="down" disabled/);
  assert.ok(html.includes('No screenshot for this step.'));
});

test('text-only steps do not show a missing-screenshot message', () => {
  const html = R.stepHtml({ id: 't', type: 'text', title: 'Wait for the page', note: '' }, 0, { editable: true, shot: null, total: 1 });
  assert.ok(!html.includes('No screenshot'));
});

test('exportHtml is a complete standalone page', () => {
  const steps = [{ id: 'a', type: 'click', title: 'One', note: '', url: 'https://example.com' }, { id: 'b', type: 'click', title: 'Two', note: 'n', url: 'https://example.com' }];
  const html = R.exportHtml({ title: 'My <guide>', steps, shots: { a: 'data:image/jpeg;base64,AAA' }, css: 'body{}', dateText: '14 Nov 2026' });
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('<title>My &lt;guide&gt;</title>'));
  assert.ok(html.includes('2 steps · 14 Nov 2026'));
  assert.ok(html.includes('<style>body{}</style>'));
  assert.equal((html.match(/class="step"/g) || []).length, 2);
  assert.equal((html.match(/<img /g) || []).length, 1);
});

test('toMarkdown produces a numbered list with notes', () => {
  const md = R.toMarkdown('Onboarding', [
    { title: 'Go to example.com', note: '' },
    { title: 'Click "Sign in" button', note: 'Use your work account' }
  ]);
  assert.equal(md, '# Onboarding\n\n1. **Go to example.com**\n2. **Click "Sign in" button**\n   Use your work account\n');
});
