// Landing page: a QR + link that opens the app on whatever device scans it.
import { drawQR } from './qr.js';

const $ = (s) => document.querySelector(s);
const url = new URL('app.html', location.href).href;

drawQR($('#qr'), url, 'M', 'Byte');
$('#url').href = $('#open').href = url;
$('#url').textContent = url.replace(/^https?:\/\//, '');

$('#copy').onclick = async () => {
  const btn = $('#copy');
  try {
    await navigator.clipboard.writeText(url);
    btn.classList.add('done');
    setTimeout(() => btn.classList.remove('done'), 1200);
  } catch {
    getSelection().selectAllChildren($('#url'));
  }
};
