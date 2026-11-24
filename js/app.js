import { ME, setMe, formatMoney } from './logic.js';
import * as store from './store.js';
import { connect, disconnect, getStatus, newCode, onStatus, startSync, cleanUrl } from './sync.js';
import * as views from './ui/views.js';
import { openSheet, sheetOpen, closeSheets } from './ui/sheets.js';
import { icon, toast, confirmDialog } from './ui/util.js';

// Which person is this phone? Stored per device (never synced), so two phones can see the same data from each side.
try {
  const savedMe = localStorage.getItem('splits-me');
  if (savedMe && store.getRecord('people', savedMe)) setMe(savedMe);
} catch { /* ignore */ }

const ui = { tab: 'groups', nav: [], hideSettled: false };
const root = document.getElementById('app');
const TABS = [['groups', 'Groups', 'users'], ['friends', 'Friends', 'user'], ['activity', 'Activity', 'activity'], ['account', 'Account', 'account']];
const ROOT_VIEWS = { groups: views.groupsView, friends: views.friendsView, activity: views.activityView, account: views.accountView };
const DETAIL_VIEWS = { group: views.groupView, friend: views.friendView, expense: views.expenseView, settlement: views.settlementView, search: views.searchView };

function screen() {
  const top = ui.nav[ui.nav.length - 1];
  return top ? DETAIL_VIEWS[top.view]?.(top.id) : ROOT_VIEWS[ui.tab](ui);
}

let lastKey = '';
let queued = false;
export function render() {
  const key = ui.tab + '/' + ui.nav.map((n) => n.view + n.id).join('/');
  const y = key === lastKey ? window.scrollY : 0;
  let s = screen();
  let missing = false;
  if (!s) {
    missing = true;
    s = { bar: `<div class="topbar"><button class="iconbtn" data-act="back" aria-label="Back">${icon('back')}</button></div>`, body: '<div class="content"><div class="empty"><b>Not found</b>This item no longer exists.</div></div>' };
  }
  const tabs = ui.nav.length ? '' : `<nav class="tabs">${TABS.map(([id, label, ic]) => `<button class="tab ${ui.tab === id ? 'active' : ''}" data-act="tab" data-tab="${id}">${icon(ic)}<span>${label}</span></button>`).join('')}</nav>`;
  const cur = ui.nav.at(-1);
  const ctx = cur?.view === 'group' ? ` data-group="${cur.id}"` : cur?.view === 'friend' ? ` data-friend="${cur.id}"` : '';
  const fab = s.fab ? `<button class="fab" data-act="sheet" data-sheet="expense"${ctx}>${icon('receipt', 24)} Add expense</button>` : '';
  root.innerHTML = s.bar + s.body + fab + tabs;
  window.scrollTo(0, y);
  lastKey = key;
  if (ui.nav.at(-1)?.view === 'search') bindSearch();
  if (missing) history.back(); // the item was deleted (here or on another device): leave its page
}

const scheduleRender = () => {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; render(); });
};

function bindSearch() {
  const box = document.getElementById('searchBox');
  const out = document.getElementById('searchResults');
  box.addEventListener('input', () => { out.innerHTML = views.searchResults(box.value); });
  box.focus();
}

function push(view) {
  ui.nav.push(view);
  history.pushState({ d: ui.nav.length }, '');
  render();
}

// ---- history: the Android back button / browser back walks up the view stack ----
history.replaceState({ d: -1 }, '');
history.pushState({ d: 0 }, '');
window.addEventListener('popstate', (e) => {
  if (sheetOpen()) { // back closes the sheet and stays on the same view
    closeSheets();
    history.pushState({ d: ui.nav.length }, '');
    return;
  }
  const d = e.state?.d ?? 0;
  if (d < 0) { history.back(); return; } // already at the root: let the app/browser leave
  ui.nav.length = Math.min(ui.nav.length, d);
  render();
});

// ---- theme ----
function applyTheme() {
  const t = store.getState().settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

// ---- actions ----
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const d = t.dataset;
  switch (d.act) {
    case 'tab': ui.tab = d.tab; render(); window.scrollTo(0, 0); break;
    case 'open': push({ view: d.view, id: d.id }); break;
    case 'back': history.back(); break;
    case 'sheet': openSheet(d.sheet, { id: d.id, groupId: d.group, friendId: d.friend }); break;
    case 'toggle-settled': ui.hideSettled = !ui.hideSettled; toast(ui.hideSettled ? 'Hiding settled groups' : 'Showing all groups'); render(); break;
    case 'theme': store.setSettings({ theme: d.v }); break;
    case 'delete-expense':
      if (await confirmDialog('Delete this expense?')) { store.removeRecord('expenses', d.id); toast('Expense deleted'); }
      break;
    case 'delete-settlement':
      if (await confirmDialog('Delete this payment?')) { store.removeRecord('settlements', d.id); toast('Payment deleted'); }
      break;
    case 'sync-create': case 'sync-join': {
      const url = document.getElementById('syncUrl').value;
      const codeEl = document.getElementById('syncCode');
      if (d.act === 'sync-create' && !codeEl.value.trim()) codeEl.value = newCode();
      try {
        await connect(d.act === 'sync-create' ? 'create' : 'join', url, codeEl.value);
        toast(d.act === 'sync-create' ? 'Shared space created' : 'Joined shared space');
        render();
      } catch (err) { toast(err.message || 'Could not connect'); }
      break;
    }
    case 'sync-off':
      if (await confirmDialog('Stop syncing on this device? Your data stays here.', 'Disconnect')) { disconnect(); render(); }
      break;
    case 'export': exportBackup(); break;
    case 'import': document.getElementById('importFile').click(); break;
  }
});

document.addEventListener('submit', (e) => {
  if (e.target.id === 'profileForm') {
    e.preventDefault();
    const name = document.getElementById('meName').value.trim() || 'You';
    const currency = document.getElementById('currency').value.trim() || '₹';
    store.setSettings({ currency });
    store.put('people', { id: ME, name });
    toast('Saved');
  } else if (e.target.id === 'syncForm') {
    e.preventDefault();
  }
});

document.addEventListener('change', async (e) => {
  if (e.target.id === 'meSel') {
    const id = e.target.value;
    try { localStorage.setItem('splits-me', id); } catch { /* ignore */ }
    setMe(id);
    store.people().filter((p) => p.id !== id && p.name === 'You').forEach((p) => store.put('people', { id: p.id, name: 'Partner' }));
    ui.nav.length = 0;
    toast('This phone now sees things as ' + (store.getRecord('people', id)?.name || 'you'));
    render();
    return;
  }
  if (e.target.id !== 'importFile') return;
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!(await confirmDialog('Replace everything on this device with this backup?', 'Restore'))) return;
    store.importBackup(data);
    toast('Backup restored');
  } catch { toast('That file is not a valid backup'); }
});

async function exportBackup() {
  const json = JSON.stringify({ app: 'splitwise-clone', version: 2, exportedAt: new Date().toISOString(), ...store.snapshot() }, null, 2);
  const file = new File([json], `expenses-backup-${new Date().toISOString().slice(0, 10)}.json`, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return; }
  } catch (err) { if (err.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('Backup downloaded');
}

// ---- boot ----
store.subscribe((source) => {
  if (source === 'settings') applyTheme();
  scheduleRender();
});
onStatus((s) => {
  const label = document.getElementById('syncStatus');
  if (label) label.textContent = views.syncLabel[s];
  const dot = document.getElementById('syncDot');
  if (dot) dot.className = `status-dot ${s}`;
});
applyTheme();
render();
startSync();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});

// Handy for debugging in the browser console.
window.__app = { ui, store, formatMoney, getStatus, cleanUrl };
