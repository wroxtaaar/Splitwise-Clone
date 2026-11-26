// Self-updater (Android app only). Asks the native ApkUpdater plugin to compare the installed build with
// the latest GitHub release, then download + install it. In a browser everything quietly does nothing.
const BASE = 'https://github.com/wroxtaaar/splitwise-clone/releases/download/latest';
const plugin = () => {
  try { return window.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins?.ApkUpdater || null : null; } catch { return null; }
};
export const supported = () => Boolean(plugin());

/** → { installed, latest, sha256, newer } */
export async function check() {
  const p = plugin();
  if (!p) throw new Error('not supported');
  const r = await p.check({ url: `${BASE}/version.json?t=${Date.now()}` });
  return { ...r, newer: r.latest > r.installed };
}

/** Downloads and installs; the app restarts when Android finishes. Rejects with "needs_permission" the first time. */
export async function install(info) {
  const p = plugin();
  if (!p) throw new Error('not supported');
  return p.install({ url: `${BASE}/${info.apk || 'Expense.apk'}`, sha256: info.sha256 || '' });
}

export const explain = (e) => (String(e?.message || e).includes('needs_permission')
  ? 'Allow "Install unknown apps" for Expense on the screen that opened, then try again.'
  : `Update failed: ${e?.message || e}`);
