// Runs while the app is open: counts time in the app, keeps the reminder time zone in step with the
// device, and (Android app with the optional plugin) reports time spent in other Bible apps.
import { get, post, put, LS, token } from '../../core/api.js';
import { state } from '../../core/ui.js';

export function start() {
  let appSession = null;
  const beat = async () => {
    if (document.visibilityState !== 'visible' || !token.get()) return;
    try { appSession = (await post('api/tracker/app', { id: appSession })).id; } catch { /* offline */ }
  };
  const onVisible = () => { if (document.visibilityState === 'visible') { beat(); syncExternalUsage(); } };

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (tz && state.settings?.['tracker.timezone'] !== tz && state.settings?.['tracker.timezone_auto']) {
    put('api/settings', { 'tracker.timezone': tz }).catch(() => {});
    state.settings['tracker.timezone'] = tz;
  }
  beat(); syncExternalUsage();
  const timer = setInterval(beat, 60000);
  document.addEventListener('visibilitychange', onVisible);
  return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
}

async function syncExternalUsage() {
  const BU = window.Capacitor?.Plugins?.BibleUsage;
  const apps = state.settings?.['tracker.external_apps'] || [];
  if (!BU || !apps.length) return;
  try {
    if (!(await BU.hasPermission()).granted) return;
    const since = +(LS.get('tolle.usageSince') || Date.now() - 6 * 3600e3);
    const now = Date.now();
    const r = await BU.usage({ packages: apps.map((a) => a.package), since });
    for (const u of r.apps || []) {
      if (u.minutes < 1) continue;
      const name = apps.find((a) => a.package === u.package)?.name || u.package;
      await post('api/tracker/external', { app: name, minutes: Math.round(u.minutes) });
    }
    LS.set('tolle.usageSince', String(now));
  } catch { /* permission revoked or plugin missing */ }
}
