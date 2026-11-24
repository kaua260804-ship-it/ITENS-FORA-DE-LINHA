/* =========================================================
   pivot-core.js — Núcleo do Pivot
   - Definição de métricas
   - Agrupamento (com cache)
   - Agregação (sum/avg)
   - Ordenação
   - Formatação de valores
   - Helpers: escapeHtml, showToast, confirmModalHTML
   - Não renderiza nada (isso fica no pivot-render.js)
   ========================================================= */

const PivotCore = (() => {
  /* Estado compartilhado com pivot-render.js */
  const state = {
    currentRows: null,
    groups: [],
    groupsCacheKey: null,
    sortState: { key: null, dir: 1 },
  };

  const METRICS = [
    { key: "QTD",           label: "QTD",                   agg: "sum" },
    { key: "TotValor",      label: "Tot Valor",             agg: "sum", money: true },
    { key: "DescontoFixo",  label: "Desconto",              agg: "sum", money: true },
    { key: "CustoBrutoUN",  label: "Custo Médio",           agg: "avg", money: true },
    { key: "PrecoUN",       label: "Preço Médio",           agg: "avg", money: true },
    { key: "Lucro",         label: "Lucro",                 agg: "sum", money: true },
    { key: "PercMarg",      label: "%Marg (média simples)", agg: "avg", percent: true },
  ];

  /* =========================================================
     Agrupamento (com cache por referência)
     ========================================================= */
  function groupRows(rows) {
    if (rows === state.groupsCacheKey && Array.isArray(state.groups)) return state.groups;

    const safeRows = Array.isArray(rows) ? rows : [];
    const map = new Map();

    for (let i = 0; i < safeRows.length; i++) {
      const r = safeRows[i];
      if (!r) continue;
      const key =
        (r.PRODUTOS || "") + "||" + (r.Codigo || "") + "||" +
        (r.CATEGORIAN2 || "") + "||" + (r.CATEGORIAN3 || "") + "||" +
        (r.CATEGORIAN4 || "") + "||" + (r.FORN || "");

      let g = map.get(key);
      if (!g) {
        g = {
          _key: key,
          PRODUTOS: r.PRODUTOS || "",
          Codigo: r.Codigo || "",
          CATEGORIAN2: r.CATEGORIAN2 || "",
          CATEGORIAN3: r.CATEGORIAN3 || "",
          CATEGORIAN4: r.CATEGORIAN4 || "",
          FORN: r.FORN || "",
          STATUS_SHEETS: r.STATUS_SHEETS || "",
          VENDA: { sums: {}, counts: {} },
          PERDA: { sums: {}, counts: {} },
        };
        map.set(key, g);
      }

      const op = r.Operacao === "PERDA" ? "PERDA" : "VENDA";
      const bucket = g[op];
      for (let j = 0; j < METRICS.length; j++) {
        const m = METRICS[j];
        const v = Number(r[m.key]) || 0;
        bucket.sums[m.key]   = (bucket.sums[m.key] || 0)   + v;
        bucket.counts[m.key] = (bucket.counts[m.key] || 0) + 1;
      }
    }

    state.groups = Array.from(map.values());
    state.groupsCacheKey = rows;
    return state.groups;
  }

  function aggregate(group, op, metric) {
    if (!group || !group[op] || !metric) return 0;
    const bucket = group[op];
    if (metric.agg === "avg") {
      const c = bucket.counts[metric.key] || 0;
      return c ? (bucket.sums[metric.key] || 0) / c : 0;
    }
    return bucket.sums[metric.key] || 0;
  }

  function applySort(list) {
    const safeList = Array.isArray(list) ? list : [];
    if (!state.sortState.key) return safeList;

    const key = state.sortState.key;
    const dir = state.sortState.dir;
    const sorted = [...safeList];

    sorted.sort((a, b) => {
      if (["PRODUTOS","Codigo","CATEGORIAN2","CATEGORIAN3","CATEGORIAN4","FORN","STATUS_SHEETS"].includes(key)) {
        return dir * String(a[key] || "").localeCompare(String(b[key] || ""), "pt-BR");
      }
      const [op, mk] = key.split(":");
      const metric = METRICS.find(m => m.key === mk);
      if (!metric) return 0;
      return dir * (aggregate(a, op, metric) - aggregate(b, op, metric));
    });
    return sorted;
  }

  /* =========================================================
     Formatação
     ========================================================= */
  function fmtVal(v, metric) {
    if (metric.money)   return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    if (metric.percent) return v.toFixed(1) + "%";
    return v.toLocaleString("pt-BR");
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s).replace(/"/g, "&quot;"); }

  function renderStatusBadge(status) {
    if (!status) return `<span class="badge badge-gray">SEM STATUS</span>`;
    if (status === "FORA DE LINHA") return `<span class="badge badge-green">FORA DE LINHA</span>`;
    return `<span class="badge badge-blue">${escapeHtml(status)}</span>`;
  }

  /* =========================================================
     Toasts e modal de confirmação
     ========================================================= */
  function showToast(msg, type = "ok") {
    let t = document.getElementById("toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "toast";
      document.body.appendChild(t);
    }
    t.className = `toast toast-${type}`;
    t.textContent = msg;
    void t.offsetWidth;
    t.classList.add("show");
    clearTimeout(t._timeout);
    t._timeout = setTimeout(() => t.classList.remove("show"), 3500);
  }

  function confirmModalHTML(titulo, subtitulo) {
    return new Promise((resolve) => {
      let modal = document.getElementById("confirmModal");
      if (!modal) {
        modal = document.createElement("div");
        modal.id = "confirmModal";
        modal.className = "confirm-modal";
        document.body.appendChild(modal);
      }
      modal.innerHTML = `
        <div class="confirm-box">
          <h3>${escapeHtml(titulo)}</h3>
          <p>${escapeHtml(subtitulo || "")}</p>
          <div class="confirm-actions">
            <button class="btn btn-ghost" id="confirmCancel">Cancelar</button>
            <button class="btn btn-success" id="confirmOk">Confirmar</button>
          </div>
        </div>
      `;
      modal.classList.add("show");
      document.getElementById("confirmOk").onclick     = () => { modal.classList.remove("show"); resolve(true); };
      document.getElementById("confirmCancel").onclick = () => { modal.classList.remove("show"); resolve(false); };
    });
  }

  function showUndoToast(codigos, onUndo) {
    let t = document.getElementById("undoToast");
    if (!t) {
      t = document.createElement("div");
      t.id = "undoToast";
      t.className = "undo-toast";
      document.body.appendChild(t);
    }
    t.innerHTML = `
      <span>✅ ${codigos.length} marcado(s) como FORA DE LINHA.</span>
      <button id="undoBtn">Desfazer</button>
    `;
    t.classList.add("show");
    document.getElementById("undoBtn").onclick = () => {
      if (typeof onUndo === "function") onUndo();
      t.classList.remove("show");
    };
    clearTimeout(t._timeout);
    t._timeout = setTimeout(() => t.classList.remove("show"), 6000);
  }

  return {
    state,
    METRICS,
    groupRows,
    aggregate,
    applySort,
    fmtVal,
    escapeHtml,
    escapeAttr,
    renderStatusBadge,
    showToast,
    confirmModalHTML,
    showUndoToast,
  };
})();