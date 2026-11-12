// Appearance: light/dark mode, the main colour and the AI-note colour (Settings → Appearance).
//
// The colours in css/theme.css are the defaults. Choosing another colour here builds matching light and
// dark versions of it (soft backgrounds, readable text) and layers them on top. The choice is also kept
// on this device so the app opens in the right colours straight away.
import { LS } from './api.js';

export const ACCENTS = [
  ['teal', 'Teal', '#0f766e'], ['blue', 'Blue', '#1d4ed8'], ['indigo', 'Indigo', '#4338ca'], ['green', 'Green', '#15803d'],
  ['olive', 'Olive', '#4d7c0f'], ['rose', 'Rose', '#be123c'], ['amber', 'Amber', '#b45309'], ['brown', 'Brown', '#8a5a2b'],
  ['slate', 'Slate', '#475569'],
];
export const AI_COLOURS = [
  ['purple', 'Purple', '#7c3aed'], ['blue', 'Blue', '#2563eb'], ['pink', 'Pink', '#be185d'], ['amber', 'Amber', '#b45309'],
  ['green', 'Green', '#047857'],
];
export const DEFAULTS = { mode: 'auto', accent: '#0f766e', ai: '#7c3aed' };

// ---------------------------------------------------------------- colour maths
const clamp = (x) => Math.max(0, Math.min(255, Math.round(x)));
function rgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const hex = ([r, g, b]) => `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`;
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);   // t = how much of b
function lum([r, g, b]) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export function contrast(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
export function hue([r, g, b]) {
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const d = max - min;
  if (!d) return null;   // grey
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}
/** Darken (or lighten) c towards `toward` until it reads well on `bg`. */
function readable(c, bg, toward, min = 4.5) {
  let out = c;
  for (let t = 0; t <= 1 && contrast(out, bg) < min; t += 0.05) out = mix(c, toward, t);
  return out;
}

const WHITE = [255, 255, 255]; const BLACK = [0, 0, 0];
const LIGHT_SURFACE = [255, 255, 255]; const DARK_SURFACE = [21, 25, 32]; const DARK_BG = [14, 17, 22];

/** The brand tokens (light and dark) for any colour. */
export function brandTokens(h) {
  const c = rgb(h) || rgb(DEFAULTS.accent);
  const light = readable(c, WHITE, BLACK, 4.5);
  const dark = readable(mix(c, WHITE, 0.32), DARK_SURFACE, WHITE, 4.5);
  return {
    light: { '--brand': hex(light), '--brand-ink': contrast(light, WHITE) >= 4.5 ? '#ffffff' : '#111111',
      '--brand-soft': hex(mix(c, LIGHT_SURFACE, 0.9)), '--brand-text': hex(readable(mix(c, BLACK, 0.15), WHITE, BLACK, 5.5)) },
    dark: { '--brand': hex(dark), '--brand-ink': hex(mix(c, BLACK, 0.82)),
      '--brand-soft': hex(mix(c, DARK_BG, 0.8)), '--brand-text': hex(readable(mix(c, WHITE, 0.45), DARK_SURFACE, WHITE, 6)) },
  };
}

/** The AI-note tokens (light and dark) for any colour. */
export function aiTokens(h) {
  const c = rgb(h) || rgb(DEFAULTS.ai);
  return {
    light: { '--ai': hex(readable(c, WHITE, BLACK, 4.5)), '--ai-bg': hex(mix(c, WHITE, 0.94)), '--ai-line': hex(mix(c, WHITE, 0.8)),
      '--ai-ink': hex(readable(mix(c, BLACK, 0.45), mix(c, WHITE, 0.94), BLACK, 7)), '--ai-soft': hex(mix(c, WHITE, 0.87)) },
    dark: { '--ai': hex(readable(mix(c, WHITE, 0.35), DARK_SURFACE, WHITE, 4.5)), '--ai-bg': hex(mix(c, DARK_BG, 0.86)),
      '--ai-line': hex(mix(c, DARK_BG, 0.66)), '--ai-ink': hex(mix(c, WHITE, 0.78)), '--ai-soft': hex(mix(c, DARK_BG, 0.76)) },
  };
}

/** True when the two colours are too alike to tell your notes from AI notes at a glance. */
export function tooClose(a, b) {
  const x = rgb(a); const y = rgb(b);
  if (!x || !y) return false;
  const hx = hue(x); const hy = hue(y);
  if (hx == null || hy == null) return false;
  const d = Math.abs(hx - hy);
  return Math.min(d, 360 - d) < 28;
}

// ---------------------------------------------------------------- applying it
const css = (vars) => Object.entries(vars).map(([k, v]) => `${k}: ${v};`).join(' ');

/** Apply a theme: { mode: 'auto'|'light'|'dark', accent: '#hex', ai: '#hex' }. */
export function applyTheme(t = {}) {
  const theme = { ...DEFAULTS, ...Object.fromEntries(Object.entries(t).filter(([, v]) => v)) };
  const root = document.documentElement;
  if (theme.mode === 'light' || theme.mode === 'dark') root.dataset.theme = theme.mode;
  else delete root.dataset.theme;

  let style = document.getElementById('tolle-theme');
  const custom = theme.accent.toLowerCase() !== DEFAULTS.accent || theme.ai.toLowerCase() !== DEFAULTS.ai;
  if (!custom) { style?.remove(); } else {
    const b = brandTokens(theme.accent); const a = aiTokens(theme.ai);
    const light = css({ ...b.light, ...a.light }); const dark = css({ ...b.dark, ...a.dark });
    if (!style) { style = document.createElement('style'); style.id = 'tolle-theme'; document.head.append(style); }
    style.textContent = `:root { ${light} }\n@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${dark} } }\n:root[data-theme="dark"] { ${dark} }`;
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', brandTokens(theme.accent).light['--brand']);
  try { LS.set('tolle.theme', JSON.stringify(theme)); } catch { /* private mode */ }
  return theme;
}

/** The theme from settings (falls back to the one remembered on this device). */
export const themeFromSettings = (s = {}) => ({ mode: s['ui.theme'], accent: s['ui.accent'], ai: s['ui.ai_colour'] });

/** At start-up, before settings load: the colours used last time on this device. */
export function applyRemembered() {
  try { const t = JSON.parse(LS.get('tolle.theme') || 'null'); if (t) applyTheme(t); } catch { /* ignore */ }
}
