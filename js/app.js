/* =========================================================
   app.js — Init, XLSX, KPIs, contadores e orquestração
   - "Enviar p/ Sheets" envia SÓ os FORA DE LINHA (com dados extras)
   - "Enviar Log Completo" envia KPIs + registros filtrados
   ========================================================= */

const XLSX_PATH = "./dados/BASE VENDA E AVAR (1).xlsx";
const SHEET_NAME = "TB_VENDA E AVARIA";

const AppState = {
  rawRows: [],
  filteredRows: [],
  sheetsStatusMap: {},
  sheetsOnline: false,
};

/* =========================================================
   Datas (serial Excel → "jan/24")
   ========================================================= */
function excelSerialToDate(serial) {
  const n = Number(serial);
  if (isNaN(n)) return null;
  const ms = Math.round((n - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return isNaN(d.getTime()) ? null : d;
}

function formatMesLabel(v) {
  if (v === null || v === undefined) return "";
  const MESES = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];

  if (typeof v === "number") {
    const d = excelSerialToDate(v);
    if (!d) return String(v);
    return MESES[d.getUTCMonth()] + "/" + String(d.getUTCFullYear()).slice(-2);
  }
  const s = String(v).trim();
  if (/^\d{4,6}(\.\d+)?$/.test(s)) {
    const d = excelSerialToDate(parseFloat(s));
    if (!d) return s;
    return MESES[d.getUTCMonth()] + "/" + String(d.getUTCFullYear()).slice(-2);
  }
  return s;
}

/* =========================================================
   Parsers
   ========================================================= */
function parseMoney(v) {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return v;
  let s = String(v).trim();
  if (!s || s === "-" || /^R\$\s*-?$/.test(s)) return 0;
  s = s.replace(/R\$\s*/gi, "").replace(/\s/g, "");
  const neg = /^-/.test(s);
  s = s.replace(/-/g, "").replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : (neg ? -n : n);
}
function parsePercent(v) {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return v;
  const s = String(v).trim().replace("%", "").replace(/\s/g, "");
  if (!s) return 0;
  const n = parseFloat(s.replace(",", "."));
  return isNaN(n) ? 0 : n;
}
function parseIntQtd(v) {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Math.round(v);
  const n = parseInt(String(v).replace(/[^\d-]/g, ""), 10);
  return isNaN(n) ? 0 : n;
}
function normalizeKey(k) { return String(k || "").trim().toUpperCase(); }

function normalizeRow(obj) {
  const get = (name) => {
    const target = normalizeKey(name);
    const keys = Object.keys(obj);
    for (let i = 0; i < keys.length; i++) {
      if (normalizeKey(keys[i]) === target) return obj[keys[i]];
    }
    for (let i = 0; i < keys.length; i++) {
      if (normalizeKey(keys[i]).replace(/\s+/g, "") === target.replace(/\s+/g, "")) {
        return obj[keys[i]];
      }
    }
    return "";
  };

  return {
    Operacao: String(get("Operação") || "").trim().toUpperCase(),
    Mes: formatMesLabel(get("Mês")),
    PRODUTOS: String(get("PRODUTOS") || "").trim(),
    Codigo: String(get("Código") || "").trim(),
    CATEGORIAN2: String(get("CATEGORIAN2") || "").trim(),
    CATEGORIAN3: String(get("CATEGORIAN3") || "").trim(),
    CATEGORIAN4: String(get("CATEGORIAN4") || "").trim(),
    FORN: String(get("FORN") || "").trim(),
    Embalagem: String(get("Embalagem") || "").trim(),
    QTD: parseIntQtd(get("QTD")),
    TotValor: parseMoney(get("Tot Valor")),
    DescontoFixo: parseMoney(get("Desconto Fixo")),
    CustoBrutoUN: parseMoney(get("Custo Bruto UN")),
    PrecoUN: parseMoney(get("Preço un")),
    Lucro: parseMoney(get("Lucro")),
    PercMarg: parsePercent(get("%Marg")),
    STATUS_ORIG: String(get("STATUS") || "").trim().toUpperCase(),
    STATUS_SHEETS: "",
  };
}

/* =========================================================
   XLSX
   ========================================================= */
async function loadXLSX() {
  showLoading(true);
  try {
    const resp = await fetch(XLSX_PATH);
    if (!resp.ok) throw new Error("Arquivo não encontrado");
    const buf = await resp.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheet = wb.Sheets[SHEET_NAME];
    if (!sheet) throw new Error('Aba "' + SHEET_NAME + '" não encontrada');
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: true });
    AppState.rawRows = rows.map(normalizeRow).filter(function (r) {
      return r.Operacao && (r.Codigo || r.PRODUTOS);
    });
    const alertEl = document.getElementById("fallbackAlert");
    if (alertEl) alertEl.classList.add("hidden");
  } catch (err) {
    console.warn("Falha XLSX:", err);
    AppState.rawRows = FALLBACK_DATA.map(normalizeRow);
    const alertEl = document.getElementById("fallbackAlert");
    if (alertEl) alertEl.classList.remove("hidden");
  } finally {
    showLoading(false);
  }
}

/* =========================================================
   Google Sheets CSV (status/logística)
   ========================================================= */
const SHEETS_CSV_URL =
  "https://docs.google.com/spreadsheets/d/1NyoJgH67fGPiKk9-ZDR1Gl17V0TulFBnFo2FPFv8jLs/export?format=csv&gid=0";

async function loadSheetsStatus(force) {
  force = !!force;
  const CACHE_KEY = "vendaAvaria_sheetsCache";
  const TTL = 5 * 60 * 1000;
  const now = Date.now();

  if (!force) {
    const cached = Storage.load(CACHE_KEY);
    if (cached && now - cached.ts < TTL) {
      applySheetsMap(cached.map);
      setSheetsBadge(true);
      return;
    }
  }

  try {
    const resp = await fetch(SHEETS_CSV_URL);
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const text = await resp.text();
    const lines = text.split(/\r?\n/).filter(function (l) { return l.trim(); });
    if (!lines.length) throw new Error("CSV vazio");

    const header = lines[0].split(",").map(function (s) { return s.trim().toUpperCase(); });
    const idxCodigo = header.findIndex(function (h) {
      return h.includes("CODIGO") || h.includes("CÓDIGO");
    });
    const idxStatus = header.findIndex(function (h) {
      return h.includes("STATUS");
    });
    const map = {};

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      const cod = (cols[idxCodigo] || "").trim();
      const st = (cols[idxStatus] || "").trim().toUpperCase();
      if (cod) map[cod] = st;
    }
    applySheetsMap(map);
    Storage.save(CACHE_KEY, { ts: now, map: map });
    setSheetsBadge(true);
  } catch (err) {
    console.warn("Sheets indisponível:", err);
    setSheetsBadge(false);
    applySheetsMap({});
  }
}

function parseCSVLine(line) {
  const out = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === "," && !inQ) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

function applySheetsMap(map) {
  AppState.sheetsStatusMap = map || {};
  const rows = AppState.rawRows;
  for (let i = 0; i < rows.length; i++) {
    rows[i].STATUS_SHEETS = map[rows[i].Codigo] || "";
  }
  AppState.sheetsOnline = Object.keys(map).length > 0;
}

function setSheetsBadge(online) {
  const el = document.getElementById("sheetsBadge");
  if (!el) return;
  el.textContent = online ? "Sheets: Online" : "Sheets: Offline";
  el.className = online ? "badge badge-success" : "badge badge-gray";
}

/* =========================================================
   KPIs
   ========================================================= */
function renderKPIs(rows) {
  let totalVendas = 0, totalPerdas = 0, qtdTotal = 0, lucroTotal = 0;
  let lucroSomaPerc = 0, countPerc = 0, vendasCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.Operacao === "VENDA") {
      totalVendas += r.TotValor;
      lucroSomaPerc += r.PercMarg;
      countPerc++;
      vendasCount++;
    }
    if (r.Operacao === "PERDA") totalPerdas += Math.abs(r.TotValor);
    qtdTotal += r.QTD;
    lucroTotal += r.Lucro;
  }

  const percPerda = totalVendas > 0 ? (totalPerdas / totalVendas) * 100 : 0;
  const ticketMedio = vendasCount ? totalVendas / vendasCount : 0;
  const margMedia = countPerc ? lucroSomaPerc / countPerc : 0;

  const fmt = function (n) { return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); };
  const fmtNum = function (n) { return n.toLocaleString("pt-BR"); };

  const kVendas = document.getElementById("kpiVendas");
  const kPerdas = document.getElementById("kpiPerdas");
  const kPercPerda = document.getElementById("kpiPercPerda");
  const kQtd = document.getElementById("kpiQtd");
  const kTicket = document.getElementById("kpiTicket");
  const kLucro = document.getElementById("kpiLucro");

  if (kVendas) kVendas.textContent = fmt(totalVendas);
  if (kPerdas) kPerdas.textContent = fmt(totalPerdas);
  if (kPercPerda) kPercPerda.textContent = percPerda.toFixed(2) + "%";
  if (kQtd) kQtd.textContent = fmtNum(qtdTotal);
  if (kTicket) kTicket.textContent = fmt(ticketMedio);
  if (kLucro) kLucro.textContent = fmt(lucroTotal) + " / " + margMedia.toFixed(1) + "%";
}

/* =========================================================
   Header stats (Total / Feitos / Pendentes)
   ========================================================= */
function updateHeaderStatsOnly() {
  const codigos = new Set();
  const codigosFeitos = new Set();

  const rows = (AppState.filteredRows && AppState.filteredRows.length)
    ? AppState.filteredRows : AppState.rawRows;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.Codigo) continue;
    codigos.add(r.Codigo);
    const st = AppState.sheetsStatusMap[r.Codigo] || r.STATUS_SHEETS || "";
    if (st === "FORA DE LINHA") codigosFeitos.add(r.Codigo);
  }

  const total = codigos.size;
  const feitos = codigosFeitos.size;
  const pendentes = total - feitos;

  const elT = document.getElementById("statTotal");
  const elF = document.getElementById("statFeitos");
  const elP = document.getElementById("statPendentes");
  if (elT) elT.textContent = total.toLocaleString("pt-BR");
  if (elF) elF.textContent = feitos.toLocaleString("pt-BR");
  if (elP) elP.textContent = pendentes.toLocaleString("pt-BR");
}

function renderHeaderStats() { updateHeaderStatsOnly(); }

/* =========================================================
   Pipeline
   ========================================================= */
function applyFiltersAndRender() {
  const filtered = Filters.apply(AppState.rawRows);
  AppState.filteredRows = filtered;

  renderKPIs(filtered);
  renderHeaderStats();
  Pivot.render(filtered);

  const rc = document.getElementById("resultCount");
  if (rc) rc.textContent = filtered.length.toLocaleString("pt-BR") + " registros encontrados";

  try {
    Storage.saveSnapshot({
      filtros: Filters.getCurrentFilters(),
      kpis: {},
      registros: filtered,
    });
  } catch (_) {}
}

function showLoading(show) {
  const sk = document.getElementById("loadingSkeleton");
  const tb = document.getElementById("pivotTable");
  if (sk) sk.classList.toggle("hidden", !show);
  if (tb) tb.classList.toggle("hidden", show);
}

/* =========================================================
   Exportações
   ========================================================= */
function exportCSV() {
  if (!AppState.filteredRows.length) return alert("Nada para exportar.");
  const headers = [
    "Operação","Mês","PRODUTOS","Código","CATEGORIAN2","CATEGORIAN3",
    "CATEGORIAN4","FORN","Embalagem","QTD","Tot Valor","Desconto Fixo",
    "Custo Bruto UN","Preço un","Lucro","%Marg","STATUS"
  ];
  const rows = AppState.filteredRows.map(function (r) {
    return [
      r.Operacao, r.Mes, r.PRODUTOS, r.Codigo, r.CATEGORIAN2, r.CATEGORIAN3,
      r.CATEGORIAN4, r.FORN, r.Embalagem, r.QTD, r.TotValor, r.DescontoFixo,
      r.CustoBrutoUN, r.PrecoUN, r.Lucro, r.PercMarg, r.STATUS_SHEETS || ""
    ];
  });
  const csv = [headers].concat(rows)
    .map(function (line) {
      return line.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(",");
    }).join("\n");
  Storage.downloadBlob(
    new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }),
    "relatorio_vendas_avarias.csv"
  );
  Storage.saveHistorico(Filters.getCurrentFilters(), AppState.filteredRows.length);
}

function exportXLSX() {
  if (!AppState.filteredRows.length) return alert("Nada para exportar.");
  const ws = XLSX.utils.json_to_sheet(AppState.filteredRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Relatorio");
  XLSX.writeFile(wb, "relatorio_vendas_avarias.xlsx");
  Storage.saveHistorico(Filters.getCurrentFilters(), AppState.filteredRows.length);
}

/* =========================================================
   ENVIO P/ SHEETS — SÓ OS FORA DE LINHA (com dados extras)
   ========================================================= */
async function sendToSheets() {
  const codigos = new Set();
  const dadosPorCodigo = {};

  const rows = AppState.filteredRows.length ? AppState.filteredRows : AppState.rawRows;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.Codigo) continue;
    const st = AppState.sheetsStatusMap[r.Codigo] || r.STATUS_SHEETS || "";
    if (st !== "FORA DE LINHA") continue;

    const cod = String(r.Codigo).trim();
    if (codigos.has(cod)) {
      const cur = dadosPorCodigo[cod];
      if (!cur.PRODUTOS    && r.PRODUTOS)    cur.PRODUTOS    = r.PRODUTOS;
      if (!cur.CATEGORIAN2 && r.CATEGORIAN2) cur.CATEGORIAN2 = r.CATEGORIAN2;
      if (!cur.CATEGORIAN3 && r.CATEGORIAN3) cur.CATEGORIAN3 = r.CATEGORIAN3;
      if (!cur.CATEGORIAN4 && r.CATEGORIAN4) cur.CATEGORIAN4 = r.CATEGORIAN4;
      if (!cur.FORN        && r.FORN)        cur.FORN        = r.FORN;
      continue;
    }
    codigos.add(cod);
    dadosPorCodigo[cod] = {
      PRODUTOS:    r.PRODUTOS    || "",
      CATEGORIAN2: r.CATEGORIAN2 || "",
      CATEGORIAN3: r.CATEGORIAN3 || "",
      CATEGORIAN4: r.CATEGORIAN4 || "",
      FORN:        r.FORN        || "",
    };
  }

  const codigosArr = [...codigos].filter(Boolean);

  if (!codigosArr.length) {
    alert(
      "⚠️ Nenhum produto com status FORA DE LINHA encontrado.\n\n" +
      "Marque produtos com o botão 'Fora' ou use o checkbox + 'Marcar FORA DE LINHA' antes de enviar."
    );
    return;
  }

  console.log(
    "[sendToSheets] Enviando " + codigosArr.length + " código(s) FORA DE LINHA:",
    codigosArr.slice(0, 20).join(", ") + (codigosArr.length > 20 ? "..." : "")
  );
  console.log("[sendToSheets] Dados extras:", dadosPorCodigo);

  const ok = await marcarForaDeLinhaSheets(codigosArr, dadosPorCodigo);

  if (ok) {
    alert(
      "✅ " + codigosArr.length + " produto(s) FORA DE LINHA enviado(s).\n\n" +
      "Verifique a aba STATUS na planilha.\n" +
      "Códigos novos são criados automaticamente com PRODUTO, CATEGORIA, GRUPO e FORNECEDOR preenchidos."
    );
  } else {
    alert("⚠️ Falha ao enviar. Veja o console.");
  }
}

/* =========================================================
   ENVIO DE LOG COMPLETO
   ========================================================= */
async function sendLogCompleto() {
  const n = AppState.filteredRows.length;
  if (n === 0) {
    alert("⚠️ Nenhum registro para enviar. Aplique filtros primeiro.");
    return;
  }

  let totalVendas = 0, totalPerdas = 0, qtdTotal = 0, lucroTotal = 0, vendasCount = 0;
  for (let i = 0; i < n; i++) {
    const r = AppState.filteredRows[i];
    if (r.Operacao === "VENDA") { totalVendas += r.TotValor; vendasCount++; }
    if (r.Operacao === "PERDA") totalPerdas += r.TotValor;
    qtdTotal += r.QTD;
    lucroTotal += r.Lucro;
  }
  const ticketMedio = vendasCount ? totalVendas / vendasCount : 0;

  const payload = {
    timestamp: new Date().toISOString(),
    usuario: "web-client",
    filtrosAplicados: Filters.getCurrentFilters(),
    kpis: {
      totalVendas: totalVendas,
      totalPerdas: totalPerdas,
      qtdTotal: qtdTotal,
      ticketMedio: ticketMedio,
      lucroTotal: lucroTotal,
    },
    registros: AppState.filteredRows,
  };

  console.log("[sendLogCompleto] Enviando " + n + " registros | Vendas: R$ " + totalVendas.toFixed(2));
  const ok = await enviarParaSheets(payload);

  if (ok) alert("✅ " + n + " registros enviados para LOG_CONSULTAS + REGISTROS.");
  else    alert("⚠️ Falha ao enviar. Verifique o console.");
}

/* =========================================================
   Tema
   ========================================================= */
function initTheme() {
  const saved = Storage.load("vendaAvaria_theme") || "light";
  document.documentElement.setAttribute("data-theme", saved);
  const btn = document.getElementById("btnDarkMode");
  if (btn) btn.textContent = saved === "dark" ? "☀️" : "🌙";
  if (btn) {
    btn.addEventListener("click", function () {
      const cur = document.documentElement.getAttribute("data-theme");
      const next = cur === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      Storage.save("vendaAvaria_theme", next);
      btn.textContent = next === "dark" ? "☀️" : "🌙";
    });
  }
}

/* =========================================================
   INIT
   ========================================================= */
(async function init() {
  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  initTheme();

  const btnExportCSV    = document.getElementById("btnExportCSV");
  const btnExportXLSX   = document.getElementById("btnExportXLSX");
  const btnPrint        = document.getElementById("btnPrint");
  const btnRefreshSheets= document.getElementById("btnRefreshSheets");
  const btnSaveLocal    = document.getElementById("btnSaveLocal");
  const btnSendSheets   = document.getElementById("btnSendSheets");
  const btnSendLog      = document.getElementById("btnSendLog");
  const btnClearFilters = document.getElementById("btnClearFilters");

  if (btnExportCSV)  btnExportCSV.addEventListener("click", exportCSV);
  if (btnExportXLSX) btnExportXLSX.addEventListener("click", exportXLSX);
  if (btnPrint)      btnPrint.addEventListener("click", function () { window.print(); });
  if (btnRefreshSheets) btnRefreshSheets.addEventListener("click", async function () {
    await loadSheetsStatus(true);
    applyFiltersAndRender();
  });
  if (btnSaveLocal) btnSaveLocal.addEventListener("click", function () {
    Storage.saveSnapshot({
      filtros: Filters.getCurrentFilters(),
      kpis: {},
      registros: AppState.filteredRows,
    });
    exportXLSX();
  });
  if (btnSendSheets) btnSendSheets.addEventListener("click", sendToSheets);
  if (btnSendLog)    btnSendLog.addEventListener("click", sendLogCompleto);
  if (btnClearFilters) btnClearFilters.addEventListener("click", function () {
    Filters.clear();
    applyFiltersAndRender();
  });

  await loadSheetsStatus(false);
  await loadXLSX();

  const map = AppState.sheetsStatusMap;
  const rows = AppState.rawRows;
  for (let i = 0; i < rows.length; i++) {
    rows[i].STATUS_SHEETS = map[rows[i].Codigo] || "";
  }

  Filters.init(AppState.rawRows, applyFiltersAndRender);
  applyFiltersAndRender();

  window.updateHeaderStatsOnly = updateHeaderStatsOnly;
  window.applyFiltersAndRender = applyFiltersAndRender;
})();

/* =========================================================
   Fallback
   ========================================================= */
const FALLBACK_DATA = [
  { "Operação":"VENDA","Mês":"Jan","PRODUTOS":"ARROZ TIO JOAO 5KG","Código":"1001","CATEGORIAN2":"ALIMENTOS","CATEGORIAN3":"GRÃOS","CATEGORIAN4":"ARROZ","FORN":"TIO JOAO","Embalagem":"5KG","QTD":10,"Tot Valor":"R$ 250,00","Desconto Fixo":"R$ 5,00","Custo Bruto UN":"R$ 20,00","Preço un":"R$ 25,00","Lucro":"R$ 50,00","%Marg":"20%","STATUS":"FORA DE LINHA" },
  { "Operação":"PERDA","Mês":"Jan","PRODUTOS":"ARROZ TIO JOAO 5KG","Código":"1001","CATEGORIAN2":"ALIMENTOS","CATEGORIAN3":"GRÃOS","CATEGORIAN4":"ARROZ","FORN":"TIO JOAO","Embalagem":"5KG","QTD":2,"Tot Valor":"R$ -50,00","Desconto Fixo":"R$ -","Custo Bruto UN":"R$ 20,00","Preço un":"R$ 25,00","Lucro":"R$ -40,00","%Marg":"-160%","STATUS":"FORA DE LINHA" },
  { "Operação":"VENDA","Mês":"Fev","PRODUTOS":"FEIJAO CAMIL 1KG","Código":"2002","CATEGORIAN2":"ALIMENTOS","CATEGORIAN3":"GRÃOS","CATEGORIAN4":"FEIJÃO","FORN":"CAMIL","Embalagem":"1KG","QTD":20,"Tot Valor":"R$ 160,00","Desconto Fixo":"R$ 2,00","Custo Bruto UN":"R$ 6,00","Preço un":"R$ 8,00","Lucro":"R$ 40,00","%Marg":"25%","STATUS":"" },
  { "Operação":"PERDA","Mês":"Fev","PRODUTOS":"FEIJAO CAMIL 1KG","Código":"2002","CATEGORIAN2":"ALIMENTOS","CATEGORIAN3":"GRÃOS","CATEGORIAN4":"FEIJÃO","FORN":"CAMIL","Embalagem":"1KG","QTD":1,"Tot Valor":"R$ -8,00","Desconto Fixo":"R$ -","Custo Bruto UN":"R$ 6,00","Preço un":"R$ 8,00","Lucro":"R$ -6,00","%Marg":"-75%","STATUS":"" },
  { "Operação":"VENDA","Mês":"Jan","PRODUTOS":"OLEO SOYA 900ML","Código":"3003","CATEGORIAN2":"ALIMENTOS","CATEGORIAN3":"ÓLEOS","CATEGORIAN4":"ÓLEO","FORN":"SOYA","Embalagem":"900ML","QTD":30,"Tot Valor":"R$ 210,00","Desconto Fixo":"R$ 0,00","Custo Bruto UN":"R$ 5,50","Preço un":"R$ 7,00","Lucro":"R$ 45,00","%Marg":"21,4%","STATUS":"FORA DE LINHA" },
  { "Operação":"VENDA","Mês":"Mar","PRODUTOS":"ACUCAR UNIAO 1KG","Código":"4004","CATEGORIAN2":"ALIMENTOS","CATEGORIAN3":"AÇÚCAR","CATEGORIAN4":"AÇÚCAR","FORN":"UNIAO","Embalagem":"1KG","QTD":15,"Tot Valor":"R$ 60,00","Desconto Fixo":"R$ 1,00","Custo Bruto UN":"R$ 3,00","Preço un":"R$ 4,00","Lucro":"R$ 15,00","%Marg":"25%","STATUS":"" },
  { "Operação":"PERDA","Mês":"Mar","PRODUTOS":"ACUCAR UNIAO 1KG","Código":"4004","CATEGORIAN2":"ALIMENTOS","CATEGORIAN3":"AÇÚCAR","CATEGORIAN4":"AÇÚCAR","FORN":"UNIAO","Embalagem":"1KG","QTD":1,"Tot Valor":"R$ -4,00","Desconto Fixo":"R$ -","Custo Bruto UN":"R$ 3,00","Preço un":"R$ 4,00","Lucro":"R$ -3,00","%Marg":"-75%","STATUS":"" },
  { "Operação":"VENDA","Mês":"Fev","PRODUTOS":"CAFE PILAO 500G","Código":"5005","CATEGORIAN2":"BEBIDAS","CATEGORIAN3":"CAFÉ","CATEGORIAN4":"CAFÉ","FORN":"PILAO","Embalagem":"500G","QTD":25,"Tot Valor":"R$ 375,00","Desconto Fixo":"R$ 3,00","Custo Bruto UN":"R$ 12,00","Preço un":"R$ 15,00","Lucro":"R$ 75,00","%Marg":"20%","STATUS":"FORA DE LINHA" },
  { "Operação":"PERDA","Mês":"Jan","PRODUTOS":"OLEO SOYA 900ML","Código":"3003","CATEGORIAN2":"ALIMENTOS","CATEGORIAN3":"ÓLEOS","CATEGORIAN4":"ÓLEO","FORN":"SOYA","Embalagem":"900ML","QTD":2,"Tot Valor":"R$ -14,00","Desconto Fixo":"R$ -","Custo Bruto UN":"R$ 5,50","Preço un":"R$ 7,00","Lucro":"R$ -11,00","%Marg":"-157%","STATUS":"FORA DE LINHA" },
  { "Operação":"VENDA","Mês":"Mar","PRODUTOS":"LEITE NINHO 380G","Código":"6006","CATEGORIAN2":"LATICINIOS","CATEGORIAN3":"LEITE","CATEGORIAN4":"LEITE EM PÓ","FORN":"NESTLE","Embalagem":"380G","QTD":12,"Tot Valor":"R$ 180,00","Desconto Fixo":"R$ 0,00","Custo Bruto UN":"R$ 12,00","Preço un":"R$ 15,00","Lucro":"R$ 36,00","%Marg":"20%","STATUS":"" },
];