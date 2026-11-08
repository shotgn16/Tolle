// Layout check for phones and tablets: every screen at several sizes, light and dark.
// Fails if anything is wider than the screen or the top bar is taller than it should be.
//
//   node tests/device/layout.mjs [screenshot-dir]
import { createRequire } from 'node:module';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium, devices } = createRequire(import.meta.url)('playwright');
const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '../../tolle/app/web');
const SHOTS = process.argv[2];
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const ORIGIN = 'https://tolle.test';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

const SIZES = [
  ['android', { ...devices['Pixel 7'] }],
  ['iphone-se', { ...devices['iPhone SE'] }],
  ['iphone', { ...devices['iPhone 15'] }],
  ['ipad', { ...devices['iPad (gen 7)'] }],
  ['ipad-landscape', { ...devices['iPad (gen 7) landscape'] }],
  ['android-small', { ...devices['Galaxy S9+'] }],
];
const ROUTES = ['#/', '#/bible', '#/tracker', '#/notes', '#/research', '#/insights', '#/builder', '#/calling', '#/tasks',
  '#/settings?tab=ai', '#/settings?tab=sources', '#/settings?tab=notify', '#/settings?tab=reading', '#/settings?tab=bible',
  '#/settings?tab=features', '#/settings?tab=instructions', '#/settings?tab=account', '#/settings?tab=about'];

const browser = await chromium.launch();
let problems = 0;
for (const [name, dev] of SIZES) {
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ ...dev, colorScheme: scheme });
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.origin !== ORIGIN) return route.fulfill({ status: 404, body: '' });
      const p = join(WEB, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname));
      if (!existsSync(p)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ body: readFileSync(p), headers: { 'content-type': TYPES[extname(p)] || 'application/octet-stream' } });
    });
    await ctx.addInitScript(() => { localStorage.setItem('tolle.mode', 'device'); });
    const page = await ctx.newPage();
    await page.goto(`${ORIGIN}/index.html#/`);
    await page.waitForSelector('.page-head', { timeout: 20000 });
    // A long model name, like the one in the bug report.
    await page.evaluate(async () => { const api = await import('/core/api.js'); await api.put('api/settings', { 'ai.provider': 'gemini', 'ai.model': 'gemini-3.1-flash-lite-preview' }); });
    for (const route of ROUTES) {
      await page.goto(`${ORIGIN}/index.html${route}`);
      await page.waitForSelector('.page-head', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(500);
      const r = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const wide = [];
        for (const el of document.querySelectorAll('body *')) {
          const b = el.getBoundingClientRect();
          if (!b.width || getComputedStyle(el).position === 'fixed' && b.right <= vw + 1) continue;
          // ignore things inside a container that scrolls sideways on purpose
          let p = el.parentElement, scrolls = false;
          while (p && p !== document.body) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') { scrolls = true; break; } p = p.parentElement; }
          if (!scrolls && b.right > vw + 1) wide.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''} (${Math.round(b.right)}px)`);
        }
        const top = document.querySelector('.topbar');
        const tb = top && getComputedStyle(top).display !== 'none' ? Math.round(top.getBoundingClientRect().height) : 0;
        return { scroll: document.documentElement.scrollWidth, vw, wide: wide.slice(0, 6), topbar: tb };
      });
      const bad = r.scroll > r.vw + 1 || r.wide.length || r.topbar > 72;
      if (bad) {
        problems += 1;
        console.log(`✗ ${name}/${scheme} ${route}: page ${r.scroll}px on a ${r.vw}px screen, top bar ${r.topbar}px${r.wide.length ? `\n    too wide: ${r.wide.join(', ')}` : ''}`);
      }
      if (SHOTS && scheme === 'dark') await page.screenshot({ path: `${SHOTS}/${name}-${route.replace(/[#/?=&]+/g, '_')}.png` });
    }
    await ctx.close();
  }
}
// A phone that draws under the status bar and home indicator (Android edge-to-edge, iPhone notch).
{
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url());
    const p = join(WEB, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname));
    if (u.origin !== ORIGIN || !existsSync(p)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ body: readFileSync(p), headers: { 'content-type': TYPES[extname(p)] || 'application/octet-stream' } });
  });
  await ctx.addInitScript(() => {
    localStorage.setItem('tolle.mode', 'device');
  });
  const page = await ctx.newPage();
  await page.goto(`${ORIGIN}/index.html#/`);
  await page.waitForSelector('.page-head', { timeout: 20000 });
  await page.addStyleTag({ content: ':root { --safe-area-inset-top: 48px; --safe-area-inset-bottom: 30px; }' });
  await page.click('#menu-btn');
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => ({
    brand: document.querySelector('.sidebar .brand').getBoundingClientRect().top,
    menu: document.querySelector('.topbar .icon-btn').getBoundingClientRect().top,
    tabIcons: Math.max(...[...document.querySelectorAll('.tabbar a, .tabbar button')].map((a) => a.getBoundingClientRect().bottom)),
    h: innerHeight,
  }));
  const fine = r.brand >= 48 && r.menu >= 48 && r.tabIcons <= r.h - 30;
  if (!fine) problems += 1;
  console.log(`${fine ? '✓' : '✗'} status bar and home indicator kept clear (menu header at ${Math.round(r.brand)}px, top bar at ${Math.round(r.menu)}px, bottom icons end ${Math.round(r.h - r.tabIcons)}px above the edge)`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/edge-to-edge-menu.png` });
  await ctx.close();
}

await browser.close();
console.log(problems ? `\n${problems} layout problem(s)` : 'Layout OK on every screen and size');
process.exit(problems ? 1 : 0);
