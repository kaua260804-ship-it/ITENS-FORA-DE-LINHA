/* =========================================================
   storage.js — localStorage + downloads
   Snapshot salvo em requestIdleCallback (não trava clique)
   ========================================================= */

const Storage = (() => {
  const SNAPSHOT_KEY = "vendaAvaria_snapshot";
  const HIST_KEY = "vendaAvaria_historico";
  const MAX_HIST = 10;
  let pendingSnapshot = null;

  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { console.warn("Storage.save falhou:", key, e); return false; }
  }
  function load(key) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; }
    catch { return null; }
  }
  function remove(key) {
    try { localStorage.removeItem(key); return true; } catch { return false; }
  }

  function saveSnapshot(data) {
    pendingSnapshot = data;
    const run = () => {
      if (!pendingSnapshot) return;
      const d = pendingSnapshot;
      pendingSnapshot = null;
      try {
        const registros = Array.isArray(d.registros) ? d.registros : [];
        const lean = {
          ts: Date.now(),
          filtros: d.filtros || {},
          kpis: d.kpis || {},
          totalRegistros: registros.length,
          amostra: registros.slice(0, 50),
        };
        save(SNAPSHOT_KEY, lean);
      } catch (e) { console.warn("saveSnapshot falhou:", e); }
    };
    if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 1500 });
    else setTimeout(run, 100);
    return true;
  }

  function loadSnapshot() { return load(SNAPSHOT_KEY); }
  function saveHistorico(filtros, total) {
    try {
      const hist = load(HIST_KEY) || [];
      hist.unshift({ ts: new Date().toISOString(), filtros: filtros || {}, total: total || 0 });
      return save(HIST_KEY, hist.slice(0, MAX_HIST));
    } catch { return false; }
  }
  function loadHistorico() { return load(HIST_KEY) || []; }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return { save, load, remove, saveSnapshot, loadSnapshot, saveHistorico, loadHistorico, downloadBlob };
})();