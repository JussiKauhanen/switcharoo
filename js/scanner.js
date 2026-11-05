// Camera + QR decoding.
// Uses the native BarcodeDetector when the browser has one (Chrome, Android),
// otherwise lazy-loads jsQR (Safari, Firefox).

let jsQRReady = null;
const loadJsQR = () =>
  (jsQRReady ??= new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = 'vendor/jsQR.js';
    s.onload = ok;
    s.onerror = () => fail(new Error('Could not load QR decoder'));
    document.head.append(s);
  }));

async function makeDetector() {
  try {
    if ('BarcodeDetector' in window) {
      const formats = await BarcodeDetector.getSupportedFormats();
      if (formats.includes('qr_code')) {
        const bd = new BarcodeDetector({ formats: ['qr_code'] });
        return async (video) => (await bd.detect(video)).map((c) => c.rawValue);
      }
    }
  } catch {
    /* fall through to jsQR */
  }

  await loadJsQR();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  let pass = 0;
  return async (video) => {
    // Decode the centre square. Alternate between a sharp pass (dense codes)
    // and a downscaled pass (averages out noisy/blurry webcam frames).
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const side = Math.min(vw, vh);
    const out = Math.min(side, pass++ % 2 ? 320 : 640);
    canvas.width = canvas.height = out;
    ctx.drawImage(video, (vw - side) / 2, (vh - side) / 2, side, side, 0, 0, out, out);
    const img = ctx.getImageData(0, 0, out, out);
    const code = jsQR(img.data, out, out, { inversionAttempts: 'dontInvert' });
    return code ? [code.data] : [];
  };
}

export async function listCameras() {
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === 'videoinput');
}

export async function startScanner(video, onText, deviceId) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera needs HTTPS and a modern browser');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: deviceId
      ? { deviceId: { exact: deviceId } }
      : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
  });

  video.srcObject = stream;
  await video.play();

  const track = stream.getVideoTracks()[0];
  const facing = track.getSettings().facingMode;
  video.classList.toggle('mirror', facing !== 'environment');

  const detect = await makeDetector();
  let running = true;

  const loop = async () => {
    if (!running) return;
    if (video.readyState >= 2 && video.videoWidth) {
      try {
        for (const text of await detect(video)) onText(text);
      } catch {
        /* a bad frame is fine, keep going */
      }
    }
    requestAnimationFrame(loop);
  };
  loop();

  return {
    deviceId: track.getSettings().deviceId,
    stop() {
      running = false;
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    },
  };
}
