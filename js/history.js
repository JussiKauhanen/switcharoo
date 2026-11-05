// Transfer history in localStorage (this browser only).
// entry: { id, t, dir: 'sent' | 'received', kind, name, mime, size, b64 }

const KEY = 'switcharoo.history.v1';
const MAX = 50;

const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function list() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || [];
  } catch {
    return [];
  }
}

function save(items) {
  // Drop the oldest entries until it fits the storage quota.
  while (true) {
    try {
      localStorage.setItem(KEY, JSON.stringify(items));
      return;
    } catch {
      if (!items.length) return;
      items.pop();
    }
  }
}

export function add(entry) {
  const item = { id: uid(), t: Date.now(), ...entry };
  save([item, ...list()].slice(0, MAX));
  return item;
}

export function remove(id) {
  save(list().filter((it) => it.id !== id));
}

export function get(id) {
  return list().find((it) => it.id === id);
}

export function clear() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
