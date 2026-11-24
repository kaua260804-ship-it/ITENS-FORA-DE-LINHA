/* =========================================================
   filters.js — Filtros cascateados + autocomplete fuzzy
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

  /* ---------- Fuzzy match simples ---------- */
  function fuzzyMatch(text, query) {
    if (!query) return true;
    const t = text.toLowerCase();
    const q = query.toLowerCase();
    if (t.includes(q)) return true;
    // subsequência
    let i = 0;
    for (const ch of t) {
      if (ch === q[i]) i++;
      if (i === q.length) return true;
    }
    return false;
  }

  /* ---------- Popula um select ---------- */
  function populateSelect(el, values, currentValue) {
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
    return rows.filter(r => {
      if (selected.meses.length && !selected.meses.includes(r.Mes)) return false;
      if (selected.codigo && !r.Codigo.includes(selected.codigo)) return false;
      if (selected.produto && !fuzzyMatch(r.PRODUTOS, selected.produto)) return false;
      if (selected.cat2 && r.CATEGORIAN2 !== selected.cat2) return false;
      if (selected.cat3 && r.CATEGORIAN3 !== selected.cat3) return false;
      if (selected.cat4 && r.CATEGORIAN4 !== selected.cat4) return false;
      if (selected.forn && r.FORN !== selected.forn) return false;
      return true;
    });
  }

  /* ---------- Recálculo em cascata ---------- */
  function rebuildCascade() {
    // Base filtrada apenas por MÊS (para Cat2 depender só do mês)
    const byMes = allRows.filter(r =>
      !selected.meses.length || selected.meses.includes(r.Mes)
    );

    // CATEGORIAN2 depende de Mês
    const cat2Values = unique(byMes.map(r => r.CATEGORIAN2));
    if (selected.cat2 && !cat2Values.includes(selected.cat2)) selected.cat2 = "";
    populateSelect(document.getElementById("fCat2"), cat2Values, selected.cat2);

    // CATEGORIAN3 depende de Cat2 + Mês
    const byCat2 = byMes.filter(r => !selected.cat2 || r.CATEGORIAN2 === selected.cat2);
    const cat3Values = unique(byCat2.map(r => r.CATEGORIAN3));
    if (selected.cat3 && !cat3Values.includes(selected.cat3)) selected.cat3 = "";
    populateSelect(document.getElementById("fCat3"), cat3Values, selected.cat3);

    // CATEGORIAN4 depende de Cat3
    const byCat3 = byCat2.filter(r => !selected.cat3 || r.CATEGORIAN3 === selected.cat3);
    const cat4Values = unique(byCat3.map(r => r.CATEGORIAN4));
    if (selected.cat4 && !cat4Values.includes(selected.cat4)) selected.cat4 = "";
    populateSelect(document.getElementById("fCat4"), cat4Values, selected.cat4);

    // FORN depende de Cat4
    const byCat4 = byCat3.filter(r => !selected.cat4 || r.CATEGORIAN4 === selected.cat4);
    const fornValues = unique(byCat4.map(r => r.FORN));
    if (selected.forn && !fornValues.includes(selected.forn)) selected.forn = "";
    populateSelect(document.getElementById("fForn"), fornValues, selected.forn);
  }

  function unique(arr) {
    return [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }

  /* ---------- Autocomplete ---------- */
  function setupAutocomplete() {
    const input = document.getElementById("fProduto");
    const box = document.getElementById("produtoSuggestions");

    input.addEventListener("input", () => {
      const q = input.value.trim();
      selected.produto = q;
      if (!q) { box.classList.add("hidden"); onChange(); return; }

      const pool = unique(allRows
        .filter(r => fuzzyMatch(r.PRODUTOS, q))
        .map(r => r.PRODUTOS)).slice(0, 12);

      if (!pool.length) { box.classList.add("hidden"); return; }
      box.innerHTML = pool.map(p => `<div class="suggestion-item" data-val="${p}">${p}</div>`).join("");
      box.classList.remove("hidden");
    });

    box.addEventListener("click", (e) => {
      const item = e.target.closest(".suggestion-item");
      if (!item) return;
      input.value = item.dataset.val;
      selected.produto = item.dataset.val;
      box.classList.add("hidden");
      onChange();
    });

    document.addEventListener("click", (e) => {
      if (!e.target.closest(".autocomplete-wrap")) box.classList.add("hidden");
    });
  }

  /* ---------- Init ---------- */
  function init(rows, changeCb) {
    allRows = rows;
    onChange = changeCb;

    // MÊS (múltiplo)
    const meses = unique(rows.map(r => r.Mes));
    populateMultiSelect(document.getElementById("fMes"), meses, selected.meses);

    document.getElementById("fMes").addEventListener("change", (e) => {
      selected.meses = Array.from(e.target.selectedOptions).map(o => o.value);
      rebuildCascade();
      onChange();
    });

    document.getElementById("fCodigo").addEventListener("input", (e) => {
      selected.codigo = e.target.value.trim();
      onChange();
    });

    ["fCat2", "fCat3", "fCat4", "fForn"].forEach(id => {
      document.getElementById(id).addEventListener("change", (e) => {
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
    document.getElementById("fCodigo").value = "";
    document.getElementById("fProduto").value = "";
    Array.from(document.getElementById("fMes").options).forEach(o => (o.selected = false));
    rebuildCascade();
  }

  function getCurrentFilters() {
    return { ...selected };
  }

  return { init, apply, clear, getCurrentFilters };
})();