/* Pure text helpers shared by the content script and the tests.
 * No DOM or chrome.* access in here, so it can run under Node. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StepText = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

  const trunc = (s, n = 60) => {
    s = clean(s);
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  };

  // Field names/ids that suggest the value is a secret. Errs on the side of hiding.
  const SENSITIVE_RE = /pass(word|wd|code)?|pwd|secret|token|\bssn\b|card.?(num|no)|cc-?num|cvv|cvc|\botp\b|\bpin\b|iban|routing.?num|account.?num/i;

  function isSensitiveField(f) {
    if (!f) return false;
    const type = String(f.type || '').toLowerCase();
    if (type === 'password') return true;
    if (/(^|\s)(cc-|current-password|new-password|one-time-code)/.test(f.autocomplete || '')) return true;
    return SENSITIVE_RE.test(`${f.name || ''} ${f.id || ''}`);
  }

  // f: { tag, type, role }  ->  short noun used in step titles
  function kindOf(f) {
    const tag = String(f.tag || '').toLowerCase();
    const type = String(f.type || '').toLowerCase();
    const role = f.role || '';
    if (tag === 'a' || role === 'link') return 'link';
    if (tag === 'button' || role === 'button' || (tag === 'input' && ['button', 'submit', 'reset', 'image'].includes(type))) return 'button';
    if ((tag === 'input' && type === 'checkbox') || role === 'checkbox' || role === 'switch') return 'checkbox';
    if ((tag === 'input' && type === 'radio') || role === 'radio') return 'option';
    if (tag === 'select') return 'dropdown';
    if (role === 'tab') return 'tab';
    if (role === 'menuitem') return 'menu item';
    return '';
  }

  function clickTitle(kind, label) {
    label = clean(label);
    if (label && kind) return `Click "${label}" ${kind}`;
    if (label) return `Click "${label}"`;
    return kind ? `Click the ${kind}` : 'Click here';
  }

  // opts: { sensitive: bool, hideValue: bool }
  function typeTitle(value, label, opts = {}) {
    label = clean(label);
    const where = label ? `"${label}"` : 'the field';
    if (opts.sensitive) return `Enter the value for ${where} (hidden)`;
    if (opts.hideValue) return `Fill in ${where}`;
    return `Type "${trunc(value, 40)}" in ${where}`;
  }

  function selectTitle(optionText, label) {
    label = clean(label);
    return `Select "${trunc(optionText, 40)}"${label ? ` in "${label}"` : ''}`;
  }

  function hostOf(url) {
    try { return new URL(url).hostname; } catch (e) { return ''; }
  }

  function openTitle(url) {
    const h = hostOf(url);
    return h ? `Go to ${h}` : 'Open the page';
  }

  return { clean, trunc, isSensitiveField, kindOf, clickTitle, typeTitle, selectTitle, hostOf, openTitle };
});
