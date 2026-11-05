// Packing data into QR-sized frames and back.
//
// item  -> [meta json \n bytes] -> deflate (if smaller) -> base45 -> frames
// frame  = "SW1:<id>:<index>:<total>:<chunk>"
// Base45 keeps everything inside the QR "alphanumeric" charset, which packs
// ~30% more data per code than base64 in byte mode.

export const STATIC_MAX = 680; // payload chars that still fit one comfy QR
export const CHUNK = 300;      // payload chars per rotating frame (small = easy to scan)
export const MAX_FRAMES = 400; // ~80 KB after compression

const enc = new TextEncoder();
const dec = new TextDecoder();
const canZip = typeof CompressionStream === 'function';

const concat = (a, b) => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
};

const pipe = async (bytes, stream) =>
  new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());

// ---- base45 (RFC 9285) ----------------------------------------------------
const B45 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

export function toBase45(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 2) {
    if (i + 1 < bytes.length) {
      const n = bytes[i] * 256 + bytes[i + 1];
      s += B45[n % 45] + B45[((n / 45) | 0) % 45] + B45[(n / 2025) | 0];
    } else {
      const n = bytes[i];
      s += B45[n % 45] + B45[(n / 45) | 0];
    }
  }
  return s;
}

export function fromBase45(s) {
  const out = [];
  for (let i = 0; i < s.length; i += 3) {
    const v = [...s.slice(i, i + 3)].map((ch) => {
      const k = B45.indexOf(ch);
      if (k < 0) throw new Error('Bad base45');
      return k;
    });
    const n = v[0] + v[1] * 45 + (v.length > 2 ? v[2] * 2025 : 0);
    if (v.length > 2) out.push(n >> 8, n & 255);
    else out.push(n);
  }
  return Uint8Array.from(out);
}

// ---- base64 (for storage) ---------------------------------------------------
export function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function fromB64(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// ---- payload ------------------------------------------------------------------
// item: { kind: 'text' | 'file', name, mime, bytes }
export async function pack(item) {
  // Text has an empty meta line (keeps passwords tiny); files carry [name, mime].
  const meta = enc.encode((item.kind === 'text' ? '' : JSON.stringify([item.name || 'file', item.mime || ''])) + '\n');
  const raw = concat(meta, item.bytes);
  let flag = 0;
  let body = raw;
  if (canZip) {
    const z = await pipe(raw, new CompressionStream('deflate-raw'));
    if (z.length < raw.length) {
      flag = 1;
      body = z;
    }
  }
  return { payload: toBase45(concat(Uint8Array.of(flag), body)), raw: raw.length, packed: body.length + 1 };
}

export async function unpack(payload) {
  const all = fromBase45(payload);
  let body = all.subarray(1);
  if (all[0] === 1) body = await pipe(body, new DecompressionStream('deflate-raw'));
  const nl = body.indexOf(10);
  const bytes = body.slice(nl + 1);
  if (nl === 0) return { kind: 'text', name: '', mime: 'text/plain', bytes };
  const [name, mime] = JSON.parse(dec.decode(body.subarray(0, nl)));
  return { kind: 'file', name, mime, bytes };
}

export const textToBytes = (t) => enc.encode(t);
export const bytesToText = (b) => dec.decode(b);

// ---- frames -------------------------------------------------------------------
export function toFrames(payload) {
  const id = Math.random().toString(36).slice(2, 6).toUpperCase();
  const size = payload.length <= STATIC_MAX ? STATIC_MAX : CHUNK;
  const chunks = [];
  for (let i = 0; i < payload.length; i += size) chunks.push(payload.slice(i, i + size));
  if (!chunks.length) chunks.push('');
  return chunks.map((c, i) => `SW1:${id}:${i}:${chunks.length}:${c}`);
}

const FRAME = /^SW1:([0-9A-Z]+):(\d+):(\d+):([\s\S]*)$/;

export class Assembler {
  constructor() {
    this.finished = new Set();
    this.reset();
  }

  reset() {
    this.id = null;
    this.parts = [];
    this.got = 0;
  }

  // Returns null for foreign/duplicate-finished codes, else progress.
  push(text) {
    const m = FRAME.exec(text);
    if (!m) return null;
    const [, id, i, n, data] = m;
    if (this.finished.has(id)) return null;
    if (id !== this.id) {
      this.reset();
      this.id = id;
      this.parts = new Array(+n);
    }
    if (this.parts[i] === undefined) {
      this.parts[i] = data;
      this.got++;
    }
    const done = this.got === this.parts.length;
    if (done) this.finished.add(id);
    return { got: this.got, total: this.parts.length, done };
  }

  result() {
    return this.parts.join('');
  }
}

export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
