/* =========================================================
   filters.js — Filtros cascateados + autocomplete fuzzy
   - Filtra em TEMPO REAL enquanto digita (com debounce)
   - Prioriza produtos que COMEÇAM com o termo
   - Depois os que CONTÊM o termo
   - Clique na sugestão continua funcionando (opcional)
   ========================================================= */

const Filters = (() => {
  let allRows = [];
  let onChange = () => {};
  let selected = {
    meses: [],
    codigo: "",
    produto: "",
    cat2: "",
    cat3: "",
    cat4: "",
    forn: "",
  };

  /* ---------- Debounce simples ---------- */
  function debounce(fn, wait) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  /* ---------- Normalização (acentos + caixa) ---------- */
  function norm(s) {
    return String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  /* ---------- Matching com priorização ----------
     Retorna score:
       0 = não bate
       1 = contém no meio
       2 = começa com alguma palavra
       3 = começa com o termo inteiro
  */
  function scoreMatch(text, query) {
    if (!query) return 3; // sem filtro → tudo "bate"
    const t = norm(text);
    const q = norm(query);
    if (!t) return 0;

    if (t.startsWith(q)) return 3;

    // começa com alguma palavra (ex: "cafe pilao" começa em "pilao")
    const words = t.split(/\s+/);
    for (const w of words) {
      if (w.startsWith(q)) return 2;
    }

    if (t.includes(q)) return 1;
    return 0;
  }

  /* ---------- Fuzzy simples (fallback p/ typos) ---------- */
  function fuzzyMatch(text, query) {
    if (!query) return true;
    const t = norm(text);
    const q = norm(query);
    if (t.includes(q)) return true;
    let i = 0;
    for (const ch of t) {
      if (ch === q[i]) i++;
      if (i === q.length) return true;
    }
    return false;
  }

  /* ---------- Popula select ---------- */
  function populateSelect(el, values, currentValue) {
    if (!el) return;
    el.innerHTML = "";
    const optAll = document.createElement("option");
    optAll.value = "";
    optAll.textContent = "Todos";
    el.appendChild(optAll);
    values.forEach(v => {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      el.appendChild(opt);
    });
    el.value = values.includes(currentValue) ? currentValue : "";
  }

  function populateMultiSelect(el, values, currentSelected) {
    if (!el) return;
    el.innerHTML = "";
    values.forEach(v => {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      if (currentSelected.includes(v)) opt.selected = true;
      el.appendChild(opt);
    });
  }

  /* ---------- Aplica todos os filtros ---------- */
  function apply(rows) {
    const q = selected.produto;

    return rows.filter(r => {
      if (selected.meses.length && !selected.meses.includes(r.Mes)) return false;
      if (selected.codigo && !String(r.Codigo).includes(selected.codigo)) return false;

      if (q) {
        // 1º passa pelo scoring; se score=0, tenta fuzzy (typo)
        const s = scoreMatch(r.PRODUTOS, q);
        if (s === 0 && !fuzzyMatch(r.PRODUTOS, q)) return false;
      }

      if (selected.cat2 && r.CATEGORIAN2 !== selected.cat2) return false;
      if (selected.cat3 && r.CATEGORIAN3 !== selected.cat3) return false;
      if (selected.cat4 && r.CATEGORIAN4 !== selected.cat4) return false;
      if (selected.forn && r.FORN !== selected.forn) return false;
      return true;
    });
  }

  /* ---------- Recálculo em cascata ---------- */
  function rebuildCascade() {
    const byMes = allRows.filter(r =>
      !selected.meses.length || selected.meses.includes(r.Mes)
    );

    const cat2Values = unique(byMes.map(r => r.CATEGORIAN2));
    if (selected.cat2 && !cat2Values.includes(selected.cat2)) selected.cat2 = "";
    populateSelect(document.getElementById("fCat2"), cat2Values, selected.cat2);

    const byCat2 = byMes.filter(r => !selected.cat2 || r.CATEGORIAN2 === selected.cat2);
    const cat3Values = unique(byCat2.map(r => r.CATEGORIAN3));
    if (selected.cat3 && !cat3Values.includes(selected.cat3)) selected.cat3 = "";
    populateSelect(document.getElementById("fCat3"), cat3Values, selected.cat3);

    const byCat3 = byCat2.filter(r => !selected.cat3 || r.CATEGORIAN3 === selected.cat3);
    const cat4Values = unique(byCat3.map(r => r.CATEGORIAN4));
    if (selected.cat4 && !cat4Values.includes(selected.cat4)) selected.cat4 = "";
    populateSelect(document.getElementById("fCat4"), cat4Values, selected.cat4);

    const byCat4 = byCat3.filter(r => !selected.cat4 || r.CATEGORIAN4 === selected.cat4);
    const fornValues = unique(byCat4.map(r => r.FORN));
    if (selected.forn && !fornValues.includes(selected.forn)) selected.forn = "";
    populateSelect(document.getElementById("fForn"), fornValues, selected.forn);
  }

  function unique(arr) {
    return [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }

  /* ---------- Autocomplete com priorização ---------- */
  function setupAutocomplete() {
    const input = document.getElementById("fProduto");
    const box = document.getElementById("produtoSuggestions");
    if (!input || !box) return;

    // dispara filtro na tabela em tempo real (com debounce)
    const onChangeDebounced = debounce(() => onChange(), 180);

    input.addEventListener("input", () => {
      const q = input.value.trim();
      selected.produto = q;

      // 1) atualiza tabela IMEDIATAMENTE (debounced)
      onChangeDebounced();

      // 2) atualiza dropdown de sugestões
      if (!q) { box.classList.add("hidden"); return; }

      // coleta produtos únicos com score
      const seen = new Set();
      const scored = [];
      for (let i = 0; i < allRows.length; i++) {
        const p = allRows[i].PRODUTOS;
        if (!p || seen.has(p)) continue;
        const s = scoreMatch(p, q);
        if (s > 0) {
          seen.add(p);
          scored.push({ p, s });
        }
      }
      // fallback fuzzy só se nada bateu por score
      if (scored.length === 0) {
        for (let i = 0; i < allRows.length; i++) {
          const p = allRows[i].PRODUTOS;
          if (!p || seen.has(p)) continue;
          if (fuzzyMatch(p, q)) {
            seen.add(p);
            scored.push({ p, s: 0.5 });
          }
        }
      }

      // ordena: score desc, depois alfabético
      scored.sort((a, b) => b.s - a.s || a.p.localeCompare(b.p, "pt-BR"));
      const pool = scored.slice(0, 12).map(x => x.p);

      if (!pool.length) { box.classList.add("hidden"); return; }

      box.innerHTML = pool.map(p =>
        `<div class="suggestion-item" data-val="${escapeAttr(p)}">${escapeHtml(p)}</div>`
      ).join("");
      box.classList.remove("hidden");
    });

    // clique na sugestão: preenche e força filtro exato
    box.addEventListener("click", (e) => {
      const item = e.target.closest(".suggestion-item");
      if (!item) return;
      const val = item.dataset.val || item.textContent;
      input.value = val;
      selected.produto = val;
      box.classList.add("hidden");
      onChange();
    });

    // fecha ao clicar fora
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".autocomplete-wrap")) box.classList.add("hidden");
    });

    // ESC limpa
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        box.classList.add("hidden");
      }
      // Enter força filtro exato com o que está digitado
      if (e.key === "Enter") {
        box.classList.add("hidden");
        selected.produto = input.value.trim();
        onChange();
      }
    });
  }

  /* ---------- Init ---------- */
  function init(rows, changeCb) {
    allRows = rows;
    onChange = changeCb;

    const meses = unique(rows.map(r => r.Mes));
    const fMes = document.getElementById("fMes");
    populateMultiSelect(fMes, meses, selected.meses);

    if (fMes) {
      fMes.addEventListener("change", (e) => {
        selected.meses = Array.from(e.target.selectedOptions).map(o => o.value);
        rebuildCascade();
        onChange();
      });
    }

    const fCodigo = document.getElementById("fCodigo");
    if (fCodigo) {
      const debounced = debounce(() => onChange(), 180);
      fCodigo.addEventListener("input", (e) => {
        selected.codigo = e.target.value.trim();
        debounced();
      });
    }

    ["fCat2", "fCat3", "fCat4", "fForn"].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("change", (e) => {
        const key = { fCat2: "cat2", fCat3: "cat3", fCat4: "cat4", fForn: "forn" }[id];
        selected[key] = e.target.value;
        rebuildCascade();
        onChange();
      });
    });

    setupAutocomplete();
    rebuildCascade();
  }

  function clear() {
    selected = { meses: [], codigo: "", produto: "", cat2: "", cat3: "", cat4: "", forn: "" };
    const fCodigo = document.getElementById("fCodigo");
    const fProduto = document.getElementById("fProduto");
    const fMes = document.getElementById("fMes");
    if (fCodigo) fCodigo.value = "";
    if (fProduto) fProduto.value = "";
    if (fMes) Array.from(fMes.options).forEach(o => (o.selected = false));
    rebuildCascade();
  }

  function getCurrentFilters() {
    return { ...selected };
  }

  /* ---------- Helpers de escape ---------- */
  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s).replace(/"/g, "&quot;"); }

  return { init, apply, clear, getCurrentFilters };
})();