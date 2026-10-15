// Browser storage is optional (private browsing / quota restrictions).
export function readLocal(key, fallback = null) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
export function writeLocal(key, value) {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* In-memory state remains usable. */ }
}

export function changeJournal(month) {
  let stored;
  try { stored = JSON.parse(readLocal(`kabinet.changes.${month}`, '{}')); } catch { stored = {}; }
  return {
    shifts: new Set(Array.isArray(stored?.shifts) ? stored.shifts : []),
    banquets: new Set(Array.isArray(stored?.banquets) ? stored.banquets : [])
  };
}
export function recordChange(month, kind, day) {
  const changes = changeJournal(month);
  changes[kind].add(day);
  writeLocal(`kabinet.changes.${month}`, JSON.stringify({ shifts: [...changes.shifts], banquets: [...changes.banquets] }));
}

// Prevent another editor or month from replacing the context of an in-flight write.
let busy = false;
export function withBusy(task) {
  return async function(...args) {
    if (busy) return;
    busy = true;
    const controls = [...document.querySelectorAll('button, input, select, textarea')];
    const wasDisabled = controls.map(node => node.disabled);
    controls.forEach(node => { node.disabled = true; });
    document.documentElement.dataset.saving = 'true';
    const block = event => { event.preventDefault(); event.stopImmediatePropagation(); };
    document.addEventListener('click', block, true);
    document.addEventListener('keydown', block, true);
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    try { return await task.apply(this, args); }
    finally {
      document.removeEventListener('click', block, true);
      document.removeEventListener('keydown', block, true);
      window.removeEventListener('beforeunload', warn);
      controls.forEach((node, index) => { if (node.isConnected) node.disabled = wasDisabled[index]; });
      delete document.documentElement.dataset.saving;
      busy = false;
    }
  };
}
