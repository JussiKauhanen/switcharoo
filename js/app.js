import { pack, unpack, toFrames, Assembler, MAX_FRAMES, fmtBytes, toB64, fromB64, textToBytes, bytesToText } from './codec.js';
import { Player } from './qr.js';
import { startScanner, listCameras } from './scanner.js';
import * as history from './history.js';

const $ = (s) => document.querySelector(s);
const textarea = $('#text');
const canvas = $('#qr');
const video = $('#video');

const store = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

// ---------------------------------------------------------------- toast
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------------------------------------------------------------- tabs
let tab = 'send';
function setTab(name) {
  tab = name;
  document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === name));
  $('#send').hidden = name !== 'send';
  $('#receive').hidden = name !== 'receive';
  if (name === 'receive') {
    stopSending();
    startCamera();
  } else {
    stopCamera();
  }
}
document.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => b.dataset.tab !== tab && setTab(b.dataset.tab)));

// ---------------------------------------------------------------- send
const FPS = [2, 4, 8];
let fps = +store.get('switcharoo.fps', 4) || 4;
let player = null;
let wakeLock = null;

async function send(item, { save = true } = {}) {
  const { payload, packed } = await pack(item);
  const frames = toFrames(payload);
  if (frames.length > MAX_FRAMES) {
    toast(`Too big: ${fmtBytes(packed)} after compression (max ~80 KB)`);
    return;
  }
  if (save) {
    history.add({ dir: 'sent', kind: item.kind, name: item.name, mime: item.mime, size: item.bytes.length, b64: toB64(item.bytes) });
    renderHistory();
  }
  if (tab !== 'send') setTab('send');
  showQR(item, frames, packed);
}

function showQR(item, frames, packed) {
  stopSending();
  const many = frames.length > 1;
  $('#drop').classList.add('has-qr');
  $('#drop .idle').hidden = true;
  canvas.hidden = false;
  $('#compose').hidden = true;
  $('#showing').hidden = false;
  $('#rotate').hidden = !many;
  $('#out-title').textContent = item.kind === 'text' ? 'Text snippet' : item.name;
  const size = item.bytes.length;
  $('#out-meta').textContent = [
    fmtBytes(size),
    packed < size && `compressed to ${fmtBytes(packed)}`,
    `${frames.length} code${many ? 's' : ''}`,
  ].filter(Boolean).join(' · ');
  $('#out-hint').textContent = many
    ? 'Codes rotate. Keep the other camera on it until the bar fills.'
    : 'Scan it with Switcharoo on the other device.';
  $('#speed').textContent = `${fps} / s`;
  player = new Player(canvas, frames, (i, n) => ($('#out-frame').textContent = `${i + 1} / ${n}`), fps);
  navigator.wakeLock?.request('screen').then((l) => (wakeLock = l), () => {});
}

function stopSending() {
  player?.stop();
  player = null;
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  $('#drop').classList.remove('has-qr');
  $('#drop .idle').hidden = false;
  canvas.hidden = true;
  $('#compose').hidden = false;
  $('#showing').hidden = true;
}

function sendText(text) {
  if (!text.trim()) {
    toast('Type or paste something first');
    textarea.focus();
    return;
  }
  textarea.value = '';
  send({ kind: 'text', name: '', mime: 'text/plain', bytes: textToBytes(text) });
}

async function sendFile(file) {
  if (file.size > 2 * 1024 * 1024) {
    toast('Files over 2 MB are too big for QR');
    return;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  send({ kind: 'file', name: file.name || 'file', mime: file.type, bytes });
}

$('#go').onclick = () => sendText(textarea.value);
$('#done').onclick = stopSending;
$('#speed').onclick = () => {
  fps = FPS[(FPS.indexOf(fps) + 1) % FPS.length];
  store.set('switcharoo.fps', fps);
  $('#speed').textContent = `${fps} / s`;
  player?.setFps(fps);
};

textarea.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendText(textarea.value);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && player) stopSending();
});

// file picker + drag & drop
const drop = $('#drop');
const fileInput = $('#file');
const pick = () => !player && fileInput.click();
drop.onclick = pick;
drop.onkeydown = (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), pick());
fileInput.onchange = () => {
  if (fileInput.files[0]) sendFile(fileInput.files[0]);
  fileInput.value = '';
};
document.addEventListener('dragover', (e) => {
  e.preventDefault();
  drop.classList.add('over');
});
document.addEventListener('dragleave', (e) => !e.relatedTarget && drop.classList.remove('over'));
document.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const file = e.dataTransfer.files[0];
  if (file) sendFile(file);
});

// paste: button reads the clipboard, ⌘/Ctrl+V anywhere outside the textarea sends
$('#paste').onclick = async () => {
  try {
    if (navigator.clipboard?.read) {
      for (const ci of await navigator.clipboard.read()) {
        const img = ci.types.find((t) => t.startsWith('image/'));
        if (img) return sendFile(new File([await ci.getType(img)], `pasted.${img.split('/')[1]}`, { type: img }));
        if (ci.types.includes('text/plain')) return sendText(await (await ci.getType('text/plain')).text());
      }
    } else {
      return sendText(await navigator.clipboard.readText());
    }
    toast('Clipboard is empty');
  } catch {
    textarea.focus();
    toast('Press ⌘V / Ctrl+V to paste');
  }
};
document.addEventListener('paste', (e) => {
  if (e.target === textarea) return;
  const file = e.clipboardData.files[0];
  const text = e.clipboardData.getData('text/plain');
  if (file) sendFile(file);
  else if (text) sendText(text);
  else return;
  e.preventDefault();
});

// ---------------------------------------------------------------- receive
const asm = new Assembler();
let scanner = null;
let starting = 0;
let progressTimer;

const setStatus = (msg) => ($('#rx-status').textContent = msg);

async function startCamera(deviceId) {
  stopCamera();
  const token = ++starting;
  $('#cam-start').hidden = true;
  setStatus('Starting camera…');
  try {
    const s = await startScanner(video, onCode, deviceId);
    if (token !== starting || tab !== 'receive') return s.stop();
    scanner = s;
    setStatus('Point the camera at the QR on the other device.');
    $('#cam-switch').hidden = (await listCameras()).length < 2;
  } catch (err) {
    if (token !== starting) return;
    $('#cam-start').hidden = false;
    setStatus(
      err.name === 'NotAllowedError'
        ? 'Camera access is blocked. Allow it for this site and try again.'
        : `Camera unavailable: ${err.message || err.name}`,
    );
  }
}

function stopCamera() {
  starting++;
  scanner?.stop();
  scanner = null;
}

async function onCode(text) {
  const p = asm.push(text);
  if (!p) return;

  const bar = $('.progress');
  bar.hidden = false;
  $('#bar').style.width = `${(p.got / p.total) * 100}%`;
  clearTimeout(progressTimer);
  if (p.total > 1) setStatus(`Receiving… ${p.got} / ${p.total}`);
  if (!p.done) return;

  const id = asm.id;
  const payload = asm.result();
  asm.reset();
  progressTimer = setTimeout(() => (bar.hidden = true), 1200);

  try {
    const item = await unpack(payload);
    const saved = history.add({
      dir: 'received', kind: item.kind, name: item.name, mime: item.mime,
      size: item.bytes.length, b64: toB64(item.bytes),
    });
    renderHistory(saved.id);
    navigator.vibrate?.(60);
    toast(item.kind === 'text' ? 'Text received' : `Received ${item.name}`);
    setStatus('Got it. Ready for the next one.');
  } catch {
    asm.finished.delete(id);
    setStatus('That code could not be read. Try again.');
  }
}

$('#cam-start').onclick = () => startCamera();
$('#cam-switch').onclick = async () => {
  const cams = await listCameras();
  const i = cams.findIndex((c) => c.deviceId === scanner?.deviceId);
  startCamera(cams[(i + 1) % cams.length].deviceId);
};

document.addEventListener('visibilitychange', () => {
  if (tab !== 'receive') return;
  if (document.hidden) stopCamera();
  else startCamera();
});

// ---------------------------------------------------------------- history
const ICONS = {
  copy: '<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M15 9V6.5A2.5 2.5 0 0 0 12.5 4h-6A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 6.5 15H9"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  qr: '<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><path d="M14 14h2.5v2.5M20 14v6h-3M14 19v1"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
};

function iconButton(name, label, onClick) {
  const b = document.createElement('button');
  b.className = 'icon';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[name]}</svg>`;
  b.onclick = onClick;
  return b;
}

const isTexty = (it) =>
  it.kind === 'text' ||
  /^text\/|json|xml|javascript|x-sh/.test(it.mime || '') ||
  /\.(txt|md|env|json|csv|log|ya?ml|toml|ini|conf|pem|key|pub)$/i.test(it.name || '');

function badge(it) {
  if (it.kind === 'text') return ['TXT', 'c-text'];
  const ext = (it.name.split('.').pop() || 'FILE').slice(0, 4).toUpperCase();
  const m = it.mime || '';
  if (m === 'application/pdf') return [ext, 'c-pdf'];
  if (m.startsWith('image/')) return [ext, 'c-img'];
  if (isTexty(it) || /word|document/.test(m)) return [ext, 'c-doc'];
  return [ext, 'c-other'];
}

function when(t) {
  const d = new Date(t);
  const today = d.toDateString() === new Date().toDateString();
  return d.toLocaleString(undefined, today
    ? { hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

async function copyItem(it, btn) {
  try {
    const bytes = fromB64(it.b64);
    if (isTexty(it)) {
      await navigator.clipboard.writeText(bytesToText(bytes));
    } else {
      await navigator.clipboard.write([new ClipboardItem({ [it.mime]: new Blob([bytes], { type: it.mime }) })]);
    }
    btn.innerHTML = `<svg viewBox="0 0 24 24">${ICONS.check}</svg>`;
    setTimeout(() => (btn.innerHTML = `<svg viewBox="0 0 24 24">${ICONS.copy}</svg>`), 1200);
    toast('Copied, ready to paste');
  } catch {
    toast('Copy is not allowed here, use download');
  }
}

function download(it) {
  const url = URL.createObjectURL(new Blob([fromB64(it.b64)], { type: it.mime || 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = it.name || 'switcharoo.txt';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function row(it) {
  const li = document.createElement('li');
  li.className = 'item';

  const [label, cls] = badge(it);
  const b = document.createElement('span');
  b.className = `badge ${cls}`;
  b.textContent = label;

  const info = document.createElement('div');
  info.className = 'info';
  const name = document.createElement('button');
  name.className = 'name';
  if (it.kind === 'text') {
    // Text is masked by default: it is usually a password.
    const preview = bytesToText(fromB64(it.b64)).split('\n')[0].slice(0, 120);
    let shown = false;
    name.classList.add('secret');
    name.textContent = '••••••••••';
    name.title = 'Click to reveal';
    name.onclick = () => {
      shown = !shown;
      name.textContent = shown ? preview || '(empty)' : '••••••••••';
      name.classList.toggle('secret', !shown);
    };
  } else {
    name.textContent = it.name;
    name.tabIndex = -1;
  }
  const meta = document.createElement('div');
  meta.className = 'meta';
  const sent = it.dir === 'sent';
  meta.innerHTML = `<b class="${sent ? 'out' : 'in'}">${sent ? '↑' : '↓'}<span class="word"> ${sent ? 'Sent' : 'Received'}</span></b> · ${fmtBytes(it.size)} · ${when(it.t)}`;
  info.append(name, meta);

  const actions = document.createElement('div');
  actions.className = 'actions';
  const canCopy = isTexty(it) || (it.mime === 'image/png' && 'ClipboardItem' in window);
  if (canCopy) actions.append(iconButton('copy', 'Copy', (e) => copyItem(it, e.currentTarget)));
  if (it.kind === 'file') actions.append(iconButton('download', 'Download', () => download(it)));
  actions.append(
    iconButton('qr', 'Show as QR', () => send({ kind: it.kind, name: it.name, mime: it.mime, bytes: fromB64(it.b64) }, { save: false })),
    iconButton('trash', 'Delete', () => {
      history.remove(it.id);
      renderHistory();
    }),
  );

  li.append(b, info, actions);
  return li;
}

function renderHistory(flashId) {
  const items = history.list();
  $('#list').replaceChildren(
    ...items.map((it) => {
      const li = row(it);
      if (it.id === flashId) li.classList.add('flash');
      return li;
    }),
  );
  $('#empty').hidden = items.length > 0;
  $('#clear').hidden = items.length === 0;
}

// two taps to clear, no dialogs
let clearArmed;
$('#clear').onclick = (e) => {
  if (clearArmed) {
    clearTimeout(clearArmed);
    clearArmed = null;
    e.target.textContent = 'Clear all';
    history.clear();
    renderHistory();
    return;
  }
  e.target.textContent = 'Tap again to clear';
  clearArmed = setTimeout(() => {
    clearArmed = null;
    e.target.textContent = 'Clear all';
  }, 3000);
};

renderHistory();
