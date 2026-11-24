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
  ['#0b6e8a', '#0a2a3a'], ['#1d8a6f', '#0d3d3a'], ['#8a4bd5', '#3a1f6b'],
  ['#e0652a', '#7a2b0f'], ['#2c7be5', '#12356b'], ['#c2417d', '#5e1a3d'],
];
export function hash(str) {
  let h = 0;
  for (const ch of String(str)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}
export function artStyle(key) {
  const [a, b] = COLORS[hash(key) % COLORS.length];
  return `background:linear-gradient(145deg,${a},${b})`;
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
