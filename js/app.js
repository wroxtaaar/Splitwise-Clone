import { ME, setMe, formatMoney } from './logic.js';
import * as store from './store.js';
import * as auth from './auth.js';
import * as sync from './sync.js';
import * as notif from './push.js';
import * as views from './ui/views.js';
import { openSheet, sheetOpen, closeSheets } from './ui/sheets.js';
import { icon, toast, confirmDialog } from './ui/util.js';

// mode: which full-screen state the app is in. Only 'app' shows the tabs and lists.
const ui = { tab: 'groups', nav: [], hideSettled: false, mode: 'splash' };
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
  if (ui.mode !== 'app') return;
  const key = ui.tab + '/' + ui.nav.map((n) => n.view + n.id).join('/');
  const y = key === lastKey ? window.scrollY : 0;
  let s = screen();
  let missing = false;
  if (!s) {
    missing = true;
    s = { bar: `<div class="topbar"><button class="iconbtn" data-act="back" aria-label="Back">${icon('back')}</button></div>`, body: '<div class="content"><div class="empty"><b>Not found</b>This item no longer exists.</div></div>' };
  }
  const cur = ui.nav.at(-1);
  // like Splitwise, the tab bar stays visible inside a group or a friend's page
  const tabs = cur && cur.view !== 'group' && cur.view !== 'friend' ? '' : `<nav class="tabs">${TABS.map(([id, label, ic]) => `<button class="tab ${ui.tab === id ? 'active' : ''}" data-act="tab" data-tab="${id}">${icon(ic)}<span>${label}</span></button>`).join('')}</nav>`;
  const ctx = cur?.view === 'group' ? ` data-group="${cur.id}"` : cur?.view === 'friend' ? ` data-friend="${cur.id}"` : '';
  const fab = s.fab ? `<button class="fab" data-act="sheet" data-sheet="expense"${ctx}>${icon('receipt', 24)} Add expense</button>` : '';
  root.innerHTML = s.bar + s.body + fab + tabs;
  window.scrollTo(0, y);
  lastKey = key;
  if (ui.nav.at(-1)?.view === 'search') bindSearch();
  if (missing) history.back(); // the item was deleted (here or on another device): leave its page
}

// Changes arriving from the other phone must not wipe what you are typing: wait until you stop.
const typing = () => root.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
function scheduleRender(source) {
  if (queued) return;
  queued = true;
  requestAnimationFrame(function run() {
    if (source === 'remote' && typing()) { setTimeout(() => requestAnimationFrame(run), 1000); return; }
    queued = false;
    render();
  });
}

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
  if (ui.mode !== 'app') return;
  if (sheetOpen()) { // back closes the sheet and stays on the same view
    closeSheets();
    history.pushState({ d: ui.nav.length }, '');
    return;
  }
  const d = e.state?.d ?? 0;
  if (d < 0) {
    // At the root of a tab. Friends / Activity / Account: Back goes Home (Groups) first; only Back on Home leaves the app.
    if (ui.tab !== 'groups') {
      ui.tab = 'groups';
      history.pushState({ d: 0 }, '');
      render();
      window.scrollTo(0, 0);
      return;
    }
    history.back();
    return;
  }
  ui.nav.length = Math.min(ui.nav.length, d);
  render();
});

// ---- theme ----
function applyTheme() {
  const t = store.getState().settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

// ---- full-screen states ----
function showLogin(error = '', email = '') {
  ui.mode = 'login';
  closeSheets();
  root.innerHTML = views.loginScreen({ needServer: !auth.configured(), error, email, ...auth.server() });
  window.scrollTo(0, 0);
}
function showSplash(message, retry = false) {
  ui.mode = 'splash';
  root.innerHTML = views.splashScreen(message, { retry });
}
function showName() {
  ui.mode = 'name';
  root.innerHTML = views.nameScreen();
  document.getElementById('nameBox').focus();
}
function showApp() {
  ui.mode = 'app';
  ui.tab = 'groups';
  ui.nav = [];
  lastKey = '';
  render();
}

/** Signed in: load this user's data, sync, and show the app. */
async function enter(session) {
  setMe(session.user.id);
  store.init(session.user.id);
  applyTheme();
  if (store.getRecord('people', ME)) showApp(); // returning device: show cached data at once
  else showSplash('Setting up…');
  await sync.start();
  if (ui.mode === 'login') return; // the session was rejected while syncing
  if (!store.getRecord('people', ME)) {
    // First time on this phone and no name yet: only ask once we know the server doesn't already have one.
    if (sync.getStatus() !== 'connected') { showSplash(sync.statusText() || 'Could not reach the server.', true); return; }
    showName();
    return;
  }
  if (ui.mode !== 'app') showApp();
  startPush();
}

function startPush() {
  notif.start({
    onOpen: () => { // tapped a notification: show what's new
      if (ui.mode !== 'app') return;
      const depth = ui.nav.length;
      ui.tab = 'activity';
      ui.nav = [];
      render();
      if (depth) history.go(-depth);
      sync.syncNow();
    },
    onForeground: (n) => { toast(n.title || 'New activity'); sync.syncNow(); },
  });
}

function leaveToLogin(message) {
  sync.stop();
  auth.signOut();
  showLogin(message || '');
}
sync.onAuthLost(() => leaveToLogin('Your session expired. Please sign in again.'));

// ---- actions ----
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const d = t.dataset;
  switch (d.act) {
    case 'tab': { // leave any group/friend page, and unwind its history entries so Back still behaves
      const depth = ui.nav.length;
      ui.tab = d.tab;
      ui.nav = [];
      render();
      window.scrollTo(0, 0);
      if (depth) history.go(-depth);
      break;
    }
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
    case 'sync-now':
      toast('Syncing…');
      await sync.syncNow();
      toast(sync.statusText());
      break;
    case 'enable-push': startPush(); break;
    case 'sign-out':
      if (ui.mode !== 'app' || await confirmDialog('Sign out of this phone? Your data stays safe on the server.', 'Sign out')) { await notif.stop(); leaveToLogin(); }
      break;
    case 'retry-boot': { const s = auth.getSession(); if (s) { showSplash('Setting up…'); enter(s); } else showLogin(); break; }
    case 'export': exportBackup(); break;
    case 'import': document.getElementById('importFile').click(); break;
  }
});

const friendly = (err) => (err instanceof TypeError ? 'Can’t reach the server. Check your connection and the project URL.' : err.message || 'Something went wrong');

document.addEventListener('submit', async (e) => {
  const id = e.target.id;
  if (id === 'profileForm') {
    e.preventDefault();
    const name = document.getElementById('meName').value.trim() || 'Me';
    const currency = document.getElementById('currency').value.trim() || '₹';
    store.setSettings({ currency });
    store.put('people', { id: ME, name, isUser: true });
    toast('Saved');
  } else if (id === 'loginForm') {
    e.preventDefault();
    const email = document.getElementById('a_email').value.trim();
    const password = document.getElementById('a_pw').value;
    const btn = document.getElementById('loginBtn');
    try {
      if (!auth.configured()) {
        auth.setServer(document.getElementById('a_url')?.value, document.getElementById('a_key')?.value);
        if (!auth.configured()) throw new Error('Enter the project URL (https://…) and the anon key from Supabase → Project Settings → API.');
      }
      if (!email || !password) throw new Error('Enter your email and password.');
      btn.disabled = true;
      btn.textContent = 'Signing in…';
      await enter(await auth.signIn(email, password));
    } catch (err) {
      showLogin(friendly(err), email);
    }
  } else if (id === 'nameForm') {
    e.preventDefault();
    const name = document.getElementById('nameBox').value.trim();
    if (!name) { document.getElementById('nameBox').focus(); return; }
    store.put('people', { id: ME, name, isUser: true });
    showApp();
  }
});

document.addEventListener('change', async (e) => {
  if (e.target.id !== 'importFile') return;
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!(await confirmDialog('Replace everything on this device with this backup?', 'Restore'))) return;
    store.importBackup(data, ME);
    toast('Backup restored');
  } catch { toast('That file is not a valid backup'); }
});

async function exportBackup() {
  const json = JSON.stringify({ app: 'splits', version: 3, exportedAt: new Date().toISOString(), ...store.snapshot() }, null, 2);
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
  scheduleRender(source);
});
notif.onState((s) => {
  const el = document.getElementById('pushStatus');
  if (el) el.textContent = notif.label(s);
});
sync.onStatus((s) => {
  // update in place: re-rendering would wipe whatever is being typed
  const label = document.getElementById('syncStatus');
  if (label) label.textContent = sync.statusText(s);
  const dot = document.getElementById('syncDot');
  if (dot) dot.className = `status-dot ${s}`;
  const chip = document.getElementById('syncChip');
  if (chip) {
    const bad = s === 'offline' || s === 'error' || s === 'denied';
    chip.hidden = !bad;
    chip.textContent = s === 'offline' ? 'Offline' : s === 'denied' ? 'Not allowed' : 'Sync problem';
  }
});

applyTheme();
const session = auth.getSession();
if (auth.configured() && session) enter(session);
else showLogin();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});

// Handy for debugging in the browser console.
window.__app = { ui, store, sync, auth, notif, formatMoney };
