import { formatMoney } from '../logic.js';
import { getState } from '../store.js';

const PATHS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  userPlus: '<circle cx="9" cy="8" r="4"/><path d="M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1"/><path d="M19 8v6M16 11h6"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20a7 7 0 0 1 14 0"/><circle cx="17.5" cy="9" r="2.5"/><path d="M18 14a5 5 0 0 1 4 5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  account: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3"/><path d="M6.5 18a6.5 6.5 0 0 1 11 0"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  swap: '<path d="M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4"/>',
  list: '<rect x="3" y="3" width="18" height="18"/><path d="M7 8h2M12 8h5M7 12h2M12 12h5M7 16h2M12 16h5"/>',
  home: '<path d="M3 11l9-8 9 8M5.5 9.5V21h5v-6h3v6h5V9.5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
  wifi: '<path d="M3 9.5a13 13 0 0 1 18 0M6 13a8.5 8.5 0 0 1 12 0M9 16.5a4 4 0 0 1 6 0"/><circle cx="12" cy="19.5" r="1"/>',
  cart: '<path d="M2 4h3l2.5 11h11L21 7H6.5"/><circle cx="9" cy="19.5" r="1.5"/><circle cx="17" cy="19.5" r="1.5"/>',
  fuel: '<rect x="5" y="3" width="9" height="18"/><path d="M7.5 6.5h4v4h-4zM14 9l3 1.5v6a1.5 1.5 0 0 0 3 0V9l-2-2"/>',
  car: '<path d="M3 15v-3l2-5h14l2 5v3zM3 15v3h3v-3M18 15v3h3v-3M6 12h12"/>',
  food: '<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 2-3 5-3 8h3v10"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
};
export const icon = (name, size = 24) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || ''}</svg>`;

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const money = (minor) => formatMoney(minor, getState().settings.currency);

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const at = (iso) => new Date(`${iso}T12:00:00`);
export const dayOf = (iso) => at(iso).getDate();
export const monthShort = (iso) => at(iso).toLocaleString('en', { month: 'short' });
export const monthLong = (iso) => at(iso).toLocaleString('en', { month: 'long', year: 'numeric' });
export const prettyDate = (iso) => at(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

const COLORS = [
  ['#021b2e', '#1f6486'], ['#14a085', '#9fd6c9'], ['#1ec2a0', '#8a58d0'], ['#7a2a1e', '#f26b21'], ['#2c3e91', '#6f8fe0'], ['#8a2d5b', '#d9759f'],
];
export function hash(str) {
  let h = 0;
  for (const ch of String(str)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}
export function artStyle(key) {
  const [a, b] = COLORS[hash(key) % COLORS.length];
  return `background:linear-gradient(150deg,${a} 58%,${b} 58%)`;
}
export const avatarStyle = (key) => `background:${COLORS[hash(key) % COLORS.length][0]}`;
export const initial = (name) => (String(name).trim()[0] || '?').toUpperCase();

let toastTimer;
export function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

/** Small promise-based confirm dialog (works the same in browsers and the Android WebView). */
export function confirmDialog(message, okLabel = 'Delete') {
  return new Promise((resolve) => {
    const layer = document.createElement('div');
    layer.className = 'overlay';
    layer.innerHTML = `<div class="dialog" role="dialog" aria-modal="true"><p>${esc(message)}</p><div class="btn-row"><button class="btn" data-v="0">Cancel</button><button class="btn solid" data-v="1">${esc(okLabel)}</button></div></div>`;
    layer.addEventListener('click', (e) => {
      const v = e.target.closest('[data-v]')?.dataset.v;
      if (v !== undefined || e.target === layer) { layer.remove(); resolve(v === '1'); }
    });
    document.body.appendChild(layer);
  });
}

/** Category look (icon + pastel tile), guessed from the description like Splitwise does. */
export function cat(text) {
  const t = String(text || '').toLowerCase();
  const pick = (icon, bg) => ({ icon, bg });
  if (/wifi|internet|broadband|recharge/.test(t)) return pick('wifi', '#c6e5f0');
  if (/electric|bijli|light bill|current/.test(t)) return pick('bolt', '#c6e5f0');
  if (/saman|grocer|kirana|sabzi|shop|mart|cart|fruit/.test(t)) return pick('cart', '#d6efdc');
  if (/dinner|lunch|food|restaurant|chai|mithayi|meal|snack|pizza/.test(t)) return pick('food', '#d6efdc');
  if (/petrol|diesel|fuel/.test(t)) return pick('fuel', '#f4cadb');
  if (/\bcar\b|cab|taxi|uber|auto|bus|train|flight/.test(t)) return pick('car', '#f4cadb');
  if (/rent|house|home|flat/.test(t)) return pick('home', '#e0d6f3');
  return pick('receipt', '#e5e6ee');
}
export const catTile = (text, size = 44, glyph = 26) => { const c = cat(text); return `<div class="tile" style="background:${c.bg};width:${size}px;height:${size}px">${icon(c.icon, glyph)}</div>`; };
