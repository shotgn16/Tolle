// Keeps track of which features are switched on (the server decides; see GET /api/features).
import ALL from '../features/index.js';

let enabled = null;

export function setEnabled(ids) { enabled = new Set(ids); }

export function activeFeatures() {
  return enabled ? ALL.filter((f) => enabled.has(f.id)) : ALL;
}
