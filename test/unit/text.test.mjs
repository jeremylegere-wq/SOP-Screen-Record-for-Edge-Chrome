import { test } from 'node:test';
import assert from 'node:assert/strict';
import T from '../../extension/lib/text.js';

test('clean collapses whitespace and tolerates null', () => {
  assert.equal(T.clean('  a \n\t b  '), 'a b');
  assert.equal(T.clean(null), '');
  assert.equal(T.clean(undefined), '');
});

test('trunc shortens with an ellipsis', () => {
  assert.equal(T.trunc('short', 10), 'short');
  const out = T.trunc('x'.repeat(100), 20);
  assert.equal(out.length, 20);
  assert.ok(out.endsWith('…'));
});

test('isSensitiveField flags passwords, card and secret-like fields', () => {
  assert.equal(T.isSensitiveField({ type: 'password' }), true);
  assert.equal(T.isSensitiveField({ type: 'text', name: 'user_password' }), true);
  assert.equal(T.isSensitiveField({ type: 'text', id: 'cvv' }), true);
  assert.equal(T.isSensitiveField({ type: 'text', autocomplete: 'cc-number' }), true);
  assert.equal(T.isSensitiveField({ type: 'text', autocomplete: 'one-time-code' }), true);
  assert.equal(T.isSensitiveField({ type: 'text', name: 'api_token' }), true);
  assert.equal(T.isSensitiveField({ type: 'text', name: 'ssn' }), true);
});

test('isSensitiveField leaves ordinary fields alone', () => {
  assert.equal(T.isSensitiveField({ type: 'text', name: 'email' }), false);
  assert.equal(T.isSensitiveField({ type: 'text', id: 'first-name' }), false);
  assert.equal(T.isSensitiveField({ type: 'search', name: 'q', autocomplete: 'off' }), false);
  assert.equal(T.isSensitiveField({ type: 'text', name: 'shipping' }), false); // contains "pin" but not as a word
  assert.equal(T.isSensitiveField(null), false);
});

test('kindOf names common controls', () => {
  assert.equal(T.kindOf({ tag: 'a' }), 'link');
  assert.equal(T.kindOf({ tag: 'button' }), 'button');
  assert.equal(T.kindOf({ tag: 'input', type: 'submit' }), 'button');
  assert.equal(T.kindOf({ tag: 'input', type: 'checkbox' }), 'checkbox');
  assert.equal(T.kindOf({ tag: 'div', role: 'switch' }), 'checkbox');
  assert.equal(T.kindOf({ tag: 'input', type: 'radio' }), 'option');
  assert.equal(T.kindOf({ tag: 'select' }), 'dropdown');
  assert.equal(T.kindOf({ tag: 'div', role: 'tab' }), 'tab');
  assert.equal(T.kindOf({ tag: 'div' }), '');
});

test('click titles read naturally', () => {
  assert.equal(T.clickTitle('button', 'Save'), 'Click "Save" button');
  assert.equal(T.clickTitle('', 'Home'), 'Click "Home"');
  assert.equal(T.clickTitle('link', ''), 'Click the link');
  assert.equal(T.clickTitle('', ''), 'Click here');
});

test('typed titles never leak sensitive values', () => {
  assert.equal(T.typeTitle('hello', 'Search'), 'Type "hello" in "Search"');
  assert.equal(T.typeTitle('hello', ''), 'Type "hello" in the field');
  assert.equal(T.typeTitle('hunter2', 'Password', { sensitive: true }), 'Enter the value for "Password" (hidden)');
  assert.equal(T.typeTitle('jane@example.com', 'Email', { hideValue: true }), 'Fill in "Email"');
  assert.ok(!T.typeTitle('hunter2', 'Password', { sensitive: true }).includes('hunter2'));
});

test('selectTitle and openTitle', () => {
  assert.equal(T.selectTitle('Queensland', 'State'), 'Select "Queensland" in "State"');
  assert.equal(T.selectTitle('Queensland', ''), 'Select "Queensland"');
  assert.equal(T.openTitle('https://example.com/a/b?c=1'), 'Go to example.com');
  assert.equal(T.openTitle('not a url'), 'Open the page');
});
