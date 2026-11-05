// QR rendering (vendor/qrcode.js exposes a global `qrcode`).

export function drawQR(canvas, text, ecc = 'M') {
  const q = qrcode(0, ecc);
  q.addData(text, 'Alphanumeric');
  q.make();

  const n = q.getModuleCount();
  const quiet = 4;
  const scale = Math.max(4, Math.ceil(640 / (n + quiet * 2)));
  const size = (n + quiet * 2) * scale;

  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#0f172a';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (q.isDark(r, c)) ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
    }
  }
}

// Shows one static code, or cycles through frames when there are several.
export class Player {
  constructor(canvas, frames, onFrame, fps = 4) {
    this.canvas = canvas;
    this.frames = frames;
    this.onFrame = onFrame;
    this.i = 0;
    this.show();
    if (frames.length > 1) this.setFps(fps);
  }

  show() {
    drawQR(this.canvas, this.frames[this.i], this.frames.length > 1 ? 'L' : 'M');
    this.onFrame?.(this.i, this.frames.length);
  }

  setFps(fps) {
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.i = (this.i + 1) % this.frames.length;
      this.show();
    }, 1000 / fps);
  }

  stop() {
    clearInterval(this.timer);
  }
}
