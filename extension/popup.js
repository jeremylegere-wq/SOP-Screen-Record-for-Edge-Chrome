const $ = (id) => document.getElementById(id);
const store = StepStore.makeStore(chrome.storage.local);
const send = (type) => chrome.runtime.sendMessage({ type });
const openTab = (path) => { chrome.tabs.create({ url: chrome.runtime.getURL(path) }); window.close(); };

async function render() {
  const [rec, index] = await Promise.all([store.getRec(), store.getIndex()]);
  const active = !!rec.active;
  const n = rec.stepCount || 0;

  $('idle').hidden = active;
  $('live').hidden = !active;
  $('dot').className = 'dot' + (active ? (rec.paused ? ' paused' : ' rec') : '');

  if (active) {
    $('liveStatus').textContent = `${rec.paused ? 'Paused' : 'Recording'} · ${n} step${n === 1 ? '' : 's'}`;
    $('pause').textContent = rec.paused ? 'Resume' : 'Pause';
    return;
  }

  // Warn about pages the browser doesn't let extensions touch (edge://, the store, new tab page...).
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  $('blocked').hidden = /^https?:/i.test((tab && tab.url) || '');

  $('recentWrap').hidden = index.length === 0;
  const list = $('recent');
  list.textContent = '';
  for (const g of index.slice(0, 3)) {
    const li = document.createElement('li');
    const open = document.createElement('button');
    open.className = 'open small';
    open.textContent = g.title;
    open.title = g.title;
    open.onclick = () => openTab(`viewer.html?id=${encodeURIComponent(g.id)}`);
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = `${g.count} step${g.count === 1 ? '' : 's'}`;
    li.append(open, count);
    list.append(li);
  }
}

$('start').onclick = async () => { await send('start'); window.close(); };
$('stop').onclick = async () => { await send('stop'); window.close(); };
$('pause').onclick = async () => {
  const rec = await store.getRec();
  await send(rec.paused ? 'resume' : 'pause');
};
$('discard').onclick = async () => {
  if (confirm('Discard this recording? The steps captured so far will be deleted.')) await send('discard');
};
$('all').onclick = () => openTab('viewer.html');

// Settings
const SETTING_IDS = ['blurSensitive', 'hideTypedText', 'showToolbar'];
store.getSettings().then((s) => SETTING_IDS.forEach((id) => { $(id).checked = !!s[id]; }));
SETTING_IDS.forEach((id) => { $(id).onchange = () => store.setSettings({ [id]: $(id).checked }); });

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.rec || changes.guides)) render();
});
render();
