/* =========================================================
   pivot-render.js — Camada de renderização do Pivot
   - Cabeçalho da tabela (com ordenação)
   - Corpo da tabela (com checkboxes e badge de status)
   - Rodapé de totais
   - Paginação
   - Barra de seleção
   - Ação aplicarForaDeLinha (envia dados extras ao Sheets)
   ========================================================= */

const Pivot = (() => {
  const PAGE_SIZE = 20;
  let currentPage = 1;
  let selectedKeys = new Set();
  let isApplying = false;

  const {
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
  } = PivotCore;

  /* =========================================================
     Render principal
     ========================================================= */
  function render(rows) {
    if (Array.isArray(rows)) {
      state.currentRows = rows;
      currentPage = 1;
    } else if (!Array.isArray(state.currentRows)) {
      state.currentRows = [];
    }

    state.groups = groupRows(state.currentRows);

    if (selectedKeys.size) {
      const keysSet = new Set();
      for (let i = 0; i < state.groups.length; i++) keysSet.add(state.groups[i]._key);
      selectedKeys = new Set([...selectedKeys].filter(k => keysSet.has(k)));
    }

    renderHeader();
    renderBody();
  }

  function refreshStatusOnly() {
    renderBody();
  }

  /* =========================================================
     Cabeçalho
     ========================================================= */
  function renderHeader() {
    const thead = document.getElementById("pivotThead");
    if (!thead) return;

    const arrow = (key) => {
      if (state.sortState.key !== key) return "";
      return state.sortState.dir === 1 ? " ▲" : " ▼";
    };

    let h1 = `<tr>
      <th rowspan="2" class="sticky-col" style="width:32px">
        <input type="checkbox" id="selectAllVisible" title="Selecionar página" />
      </th>
      <th rowspan="2" class="sticky-col2 sortable" data-sort="PRODUTOS">Produto${arrow("PRODUTOS")}</th>
      <th rowspan="2" class="sortable" data-sort="Codigo">Código${arrow("Codigo")}</th>
      <th rowspan="2" class="sortable" data-sort="CATEGORIAN2">Cat2${arrow("CATEGORIAN2")}</th>
      <th rowspan="2" class="sortable" data-sort="CATEGORIAN3">Cat3${arrow("CATEGORIAN3")}</th>
      <th rowspan="2" class="sortable" data-sort="CATEGORIAN4">Cat4${arrow("CATEGORIAN4")}</th>
      <th rowspan="2" class="sortable" data-sort="FORN">Forn${arrow("FORN")}</th>
      <th rowspan="2" class="sortable" data-sort="STATUS_SHEETS">Status${arrow("STATUS_SHEETS")}</th>
      <th colspan="${METRICS.length}" class="op-venda">VENDA</th>
      <th colspan="${METRICS.length}" class="op-perda">PERDA</th>
      <th rowspan="2" style="width:90px">Ações</th>
    </tr>`;

    let h2 = `<tr>`;
    METRICS.forEach(m => {
      h2 += `<th class="sub-venda sortable" data-sort="VENDA:${m.key}">${m.label}${arrow("VENDA:" + m.key)}</th>`;
    });
    METRICS.forEach(m => {
      h2 += `<th class="sub-perda sortable" data-sort="PERDA:${m.key}">${m.label}${arrow("PERDA:" + m.key)}</th>`;
    });
    h2 += `</tr>`;

    thead.innerHTML = h1 + h2;

    thead.onclick = (e) => {
      const th = e.target.closest(".sortable");
      if (!th) return;
      const key = th.dataset.sort;
      if (!key) return;
      if (state.sortState.key === key) state.sortState.dir = -state.sortState.dir;
      else state.sortState = { key, dir: 1 };
      renderHeader();
      renderBody();
    };

    const chk = document.getElementById("selectAllVisible");
    if (chk) {
      chk.onchange = (e) => {
        const pageItems = getPageItems();
        if (e.target.checked) pageItems.forEach(g => selectedKeys.add(g._key));
        else pageItems.forEach(g => selectedKeys.delete(g._key));
        document.querySelectorAll("#pivotTbody .row-check").forEach(c => {
          c.checked = selectedKeys.has(c.dataset.key);
        });
        updateSelectionUI();
      };
    }
  }

  function getPageItems() {
    const sorted = applySort(state.groups);
    const start = (currentPage - 1) * PAGE_SIZE;
    return sorted.slice(start, start + PAGE_SIZE);
  }

  /* =========================================================
     Corpo da tabela
     ========================================================= */
  function renderBody() {
    const tbody = document.getElementById("pivotTbody");
    const tfoot = document.getElementById("pivotTfoot");
    if (!tbody) return;

    const sorted = applySort(state.groups);
    const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;

    const start = (currentPage - 1) * PAGE_SIZE;
    const pageItems = sorted.slice(start, start + PAGE_SIZE);

    const htmlParts = [];
    for (let i = 0; i < pageItems.length; i++) {
      const g = pageItems[i];
      const status = g.STATUS_SHEETS || "";
      const isFora = status === "FORA DE LINHA";
      const rowClass = isFora ? "row-fora-linha" : "";
      const checked = selectedKeys.has(g._key) ? "checked" : "";
      const keyAttr = escapeAttr(g._key);

      htmlParts.push(`<tr class="${rowClass}" data-key="${keyAttr}">`);
      htmlParts.push(`<td class="sticky-col"><input type="checkbox" class="row-check" data-key="${keyAttr}" ${checked} /></td>`);
      htmlParts.push(`<td class="sticky-col2">${isFora ? '<span class="dot-green">●</span> ' : ""}${escapeHtml(g.PRODUTOS)}</td>`);
      htmlParts.push(`<td>${escapeHtml(g.Codigo)}</td>`);
      htmlParts.push(`<td>${escapeHtml(g.CATEGORIAN2)}</td>`);
      htmlParts.push(`<td>${escapeHtml(g.CATEGORIAN3)}</td>`);
      htmlParts.push(`<td>${escapeHtml(g.CATEGORIAN4)}</td>`);
      htmlParts.push(`<td>${escapeHtml(g.FORN)}</td>`);
      htmlParts.push(`<td>${renderStatusBadge(status)}</td>`);

      for (const op of ["VENDA", "PERDA"]) {
        for (const m of METRICS) {
          const v = aggregate(g, op, m);
          htmlParts.push(`<td class="num ${op === "PERDA" ? "perda-cell" : ""}">${fmtVal(v, m)}</td>`);
        }
      }
      htmlParts.push(`<td><button class="btn-mini btn-fora" data-key="${keyAttr}">Fora</button></td>`);
      htmlParts.push(`</tr>`);
    }

    tbody.innerHTML = htmlParts.length
      ? htmlParts.join("")
      : `<tr><td colspan="24" class="empty">Nenhum registro</td></tr>`;

    tbody.onchange = (e) => {
      const chk = e.target.closest(".row-check");
      if (!chk) return;
      const k = chk.dataset.key;
      if (chk.checked) selectedKeys.add(k);
      else selectedKeys.delete(k);
      updateSelectionUI();
    };

    tbody.onclick = async (e) => {
      const btn = e.target.closest(".btn-fora");
      if (!btn) return;
      e.stopPropagation();
      await aplicarForaDeLinha([btn.dataset.key], { skipConfirm: true });
    };

    renderFooter(sorted, tfoot);
    renderPagination(sorted.length, totalPages);
    updateSelectionUI();
  }

  /* =========================================================
     Rodapé de totais
     ========================================================= */
  function renderFooter(sorted, tfoot) {
    if (!tfoot) return;
    const totals = { VENDA: {}, PERDA: {} };
    METRICS.forEach(m => {
      totals.VENDA[m.key] = { sum: 0, count: 0 };
      totals.PERDA[m.key] = { sum: 0, count: 0 };
    });

    const s = sorted || [];
    for (let i = 0; i < s.length; i++) {
      const g = s[i];
      for (const op of ["VENDA", "PERDA"]) {
        for (const m of METRICS) {
          const v = aggregate(g, op, m);
          totals[op][m.key].sum += v;
          totals[op][m.key].count += 1;
        }
      }
    }

    const parts = [`<tr><td colspan="8" class="sticky-col footer-label">TOTAIS (${s.length} produtos)</td>`];
    for (const op of ["VENDA", "PERDA"]) {
      for (const m of METRICS) {
        const t = totals[op][m.key];
        const val = m.agg === "avg" ? (t.count ? t.sum / t.count : 0) : t.sum;
        parts.push(`<td class="num footer-val ${op === "PERDA" ? "perda-cell" : ""}">${fmtVal(val, m)}</td>`);
      }
    }
    parts.push(`<td></td></tr>`);
    tfoot.innerHTML = parts.join("");
  }

  /* =========================================================
     Paginação
     ========================================================= */
  function renderPagination(total, totalPages) {
    let bar = document.getElementById("paginationBar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "paginationBar";
      bar.className = "pagination-bar";
      const section = document.querySelector(".table-section");
      if (section) section.appendChild(bar);
    }
    const start = total === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
    const end = Math.min(currentPage * PAGE_SIZE, total);

    bar.innerHTML = `
      <div class="pagination-info">Mostrando <strong>${start}-${end}</strong> de <strong>${total}</strong> produtos</div>
      <div class="pagination-controls">
        <button class="btn btn-ghost" id="pgFirst" ${currentPage === 1 ? "disabled" : ""}>«</button>
        <button class="btn btn-ghost" id="pgPrev"  ${currentPage === 1 ? "disabled" : ""}>‹ Anterior</button>
        <span class="pg-current">Página ${currentPage} de ${totalPages}</span>
        <button class="btn btn-ghost" id="pgNext"  ${currentPage === totalPages ? "disabled" : ""}>Próxima ›</button>
        <button class="btn btn-ghost" id="pgLast"  ${currentPage === totalPages ? "disabled" : ""}>»</button>
      </div>
    `;

    document.getElementById("pgFirst").onclick = () => { currentPage = 1; renderBody(); };
    document.getElementById("pgPrev").onclick  = () => { currentPage = Math.max(1, currentPage - 1); renderBody(); };
    document.getElementById("pgNext").onclick  = () => { currentPage = Math.min(totalPages, currentPage + 1); renderBody(); };
    document.getElementById("pgLast").onclick  = () => { currentPage = totalPages; renderBody(); };
  }

  /* =========================================================
     Barra de seleção
     ========================================================= */
  function updateSelectionUI() {
    const count = selectedKeys.size;
    let bar = document.getElementById("selectionBar");
    const section = document.querySelector(".table-section");

    if (!bar && section) {
      bar = document.createElement("div");
      bar.id = "selectionBar";
      bar.className = "selection-bar hidden";
      section.insertBefore(bar, section.querySelector(".table-wrapper"));
    }
    if (!bar) return;

    if (count === 0) {
      bar.classList.add("hidden");
      bar.innerHTML = "";
      return;
    }

    bar.classList.remove("hidden");
    bar.innerHTML = `
      <div class="selection-info"><strong>${count}</strong> produto(s) selecionado(s)</div>
      <div class="selection-actions">
        <button class="btn btn-success" id="btnApplySelected">✓ Marcar FORA DE LINHA (${count})</button>
        <button class="btn btn-ghost" id="btnClearSelection">Limpar seleção</button>
      </div>
    `;

    document.getElementById("btnApplySelected").onclick = async () => {
      await aplicarForaDeLinha([...selectedKeys], { skipConfirm: false });
    };
    document.getElementById("btnClearSelection").onclick = () => {
      selectedKeys.clear();
      renderBody();
    };
  }

  /* =========================================================
     APLICAR FORA DE LINHA — envia dados extras ao Sheets
     ========================================================= */
  async function aplicarForaDeLinha(keys, opts = {}) {
    if (isApplying) return;
    const keysArr = Array.isArray(keys) ? keys : [];
    if (!keysArr.length) return;

    const { skipConfirm = false } = opts;
    isApplying = true;

    try {
      /* 1) Coleta códigos a partir dos groups */
      const keysSet = new Set(keysArr);
      const codigos = [];
      for (let i = 0; i < state.groups.length; i++) {
        const g = state.groups[i];
        if (keysSet.has(g._key) && g.Codigo) codigos.push(String(g.Codigo).trim());
      }
      if (!codigos.length) {
        for (const k of keysArr) {
          const parts = String(k).split("||");
          if (parts[1]) codigos.push(parts[1]);
        }
      }
      const codigosUnicos = [...new Set(codigos.filter(Boolean))];
      if (!codigosUnicos.length) {
        showToast("Nenhum código válido.", "warn");
        return;
      }

      /* 2) Confirmação — modal HTML (não bloqueia) */
      if (!skipConfirm) {
        const ok = await confirmModalHTML(
          `Marcar ${codigosUnicos.length} código(s) como FORA DE LINHA?`,
          "Isso atualiza a coluna STATUS no Google Sheets."
        );
        if (!ok) return;
      }

      /* 3) Atualiza em memória */
      const codigosSet = new Set(codigosUnicos);
      if (!AppState.sheetsStatusMap) AppState.sheetsStatusMap = {};
      for (const cod of codigosUnicos) AppState.sheetsStatusMap[cod] = "FORA DE LINHA";

      for (let i = 0; i < state.groups.length; i++) {
        if (codigosSet.has(String(state.groups[i].Codigo).trim())) {
          state.groups[i].STATUS_SHEETS = "FORA DE LINHA";
        }
      }
      if (Array.isArray(AppState.rawRows)) {
        for (let i = 0; i < AppState.rawRows.length; i++) {
          const r = AppState.rawRows[i];
          if (r && codigosSet.has(String(r.Codigo).trim())) r.STATUS_SHEETS = "FORA DE LINHA";
        }
      }
      if (Array.isArray(AppState.filteredRows)) {
        for (let i = 0; i < AppState.filteredRows.length; i++) {
          const r = AppState.filteredRows[i];
          if (r && codigosSet.has(String(r.Codigo).trim())) r.STATUS_SHEETS = "FORA DE LINHA";
        }
      }

      /* 4) Cache do Sheets */
      try {
        const cacheKey = "vendaAvaria_sheetsCache";
        const cached = Storage.load(cacheKey) || { ts: Date.now(), map: {} };
        for (const cod of codigosUnicos) cached.map[cod] = "FORA DE LINHA";
        cached.ts = Date.now();
        Storage.save(cacheKey, cached);
      } catch (_) {}

      /* 5) Limpa seleção + re-render */
      selectedKeys.clear();
      refreshStatusOnly();

      /* 6) Header stats */
      if (typeof window.updateHeaderStatsOnly === "function") {
        try { window.updateHeaderStatsOnly(); } catch (_) {}
      }

      /* 7) MONTA DADOS EXTRAS POR CÓDIGO
            — varre rawRows, filteredRows e groups para garantir
              que PRODUTO/CATEGORIA/GRUPO/FORNECEDOR sempre vão.
      */
      const dadosPorCodigo = {};
      const codigosSetAux = new Set(codigosUnicos);

      function coletarDados(r) {
        if (!r || !r.Codigo) return;
        const cod = String(r.Codigo).trim();
        if (!codigosSetAux.has(cod)) return;

        const cur = dadosPorCodigo[cod] || {};
        dadosPorCodigo[cod] = {
          PRODUTOS:    r.PRODUTOS    || cur.PRODUTOS    || "",
          CATEGORIAN2: r.CATEGORIAN2 || cur.CATEGORIAN2 || "",
          CATEGORIAN3: r.CATEGORIAN3 || cur.CATEGORIAN3 || "",
          CATEGORIAN4: r.CATEGORIAN4 || cur.CATEGORIAN4 || "",
          FORN:        r.FORN        || cur.FORN        || "",
        };
      }

      if (Array.isArray(AppState.rawRows))      AppState.rawRows.forEach(coletarDados);
      if (Array.isArray(AppState.filteredRows)) AppState.filteredRows.forEach(coletarDados);
      state.groups.forEach(coletarDados);

      /* Garante entrada para todo código (mesmo que vazia) */
      codigosUnicos.forEach(cod => {
        if (!dadosPorCodigo[cod]) {
          dadosPorCodigo[cod] = {
            PRODUTOS: "", CATEGORIAN2: "", CATEGORIAN3: "", CATEGORIAN4: "", FORN: "",
          };
        }
      });

      /* 8) Envio ao Sheets — FIRE AND FORGET, mas agora COM dados */
      if (window.APPS_SCRIPT_URL) {
        marcarForaDeLinhaSheets(codigosUnicos, dadosPorCodigo)
          .then(ok => {
            if (ok) showToast(`✅ ${codigosUnicos.length} produto(s) marcado(s).`, "ok");
            else    showToast(`⚠️ Marcação local feita. Envio ao Sheets falhou.`, "warn");
          })
          .catch(() => showToast(`⚠️ Marcação local feita.`, "warn"));
      } else {
        showToast(`✅ ${codigosUnicos.length} produto(s) marcado(s) localmente.`, "ok");
      }

      /* 9) Undo toast (desfaz a marcação local) */
      showUndoToast(codigosUnicos, () => {
        const set = new Set(codigosUnicos);
        for (const cod of codigosUnicos) {
          if (AppState.sheetsStatusMap) delete AppState.sheetsStatusMap[cod];
        }
        for (let i = 0; i < state.groups.length; i++) {
          if (set.has(String(state.groups[i].Codigo).trim())) state.groups[i].STATUS_SHEETS = "";
        }
        if (Array.isArray(AppState.rawRows)) {
          for (let i = 0; i < AppState.rawRows.length; i++) {
            const r = AppState.rawRows[i];
            if (r && set.has(String(r.Codigo).trim())) r.STATUS_SHEETS = "";
          }
        }
        if (Array.isArray(AppState.filteredRows)) {
          for (let i = 0; i < AppState.filteredRows.length; i++) {
            const r = AppState.filteredRows[i];
            if (r && set.has(String(r.Codigo).trim())) r.STATUS_SHEETS = "";
          }
        }
        refreshStatusOnly();
        if (typeof window.updateHeaderStatsOnly === "function") {
          try { window.updateHeaderStatsOnly(); } catch (_) {}
        }
      });
    } catch (err) {
      console.error("Erro:", err);
      showToast("❌ Erro ao marcar.", "error");
    } finally {
      isApplying = false;
    }
  }

  function resetSelection() { selectedKeys.clear(); }

  return { render, resetSelection };
})();