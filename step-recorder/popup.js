const $ = (id) => document.getElementById(id);
const send = (type) => chrome.runtime.sendMessage({ type });

async function render() {
  const { rec, steps } = await chrome.storage.local.get(['rec', 'steps']);
  const active = !!(rec && rec.active);
  const paused = !!(rec && rec.paused);
  const n = (steps || []).length;

  $('idle').hidden = active;
  $('live').hidden = !active;
  $('dot').className = 'dot' + (active ? (paused ? ' paused' : ' rec') : '');
  $('pause').textContent = paused ? 'Resume' : 'Pause';
  $('open').hidden = !(n > 0);

  if (active) {
    $('status').textContent = `${paused ? 'Paused' : 'Recording'} · ${n} step${n === 1 ? '' : 's'}`;
  } else {
    $('status').textContent = n > 0 ? `Not recording · last guide has ${n} step${n === 1 ? '' : 's'}` : 'Not recording';
  }
}

$('start').onclick = async () => { await send('start'); window.close(); };
$('stop').onclick = async () => { await send('stop'); window.close(); };
$('pause').onclick = async () => {
  const { rec } = await chrome.storage.local.get('rec');
  await send(rec && rec.paused ? 'resume' : 'pause');
  render();
};
$('discard').onclick = async () => {
  if (confirm('Discard this recording?')) { await send('discard'); render(); }
};
$('open').onclick = () => { chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html') }); window.close(); };

chrome.storage.onChanged.addListener(render);
render();
