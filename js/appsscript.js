/* =========================================================
   appsscript.js — Integração com Google Sheets via Apps Script
   URL já configurada. Diagnóstico completo + envio de dados extras.
   ========================================================= */

// ✅ SUA URL JÁ CONFIGURADA
const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbwIAqSTyJ0keYGOXiCDiBCDkB32sU0dfEvp0q0xaP_soPf5PD_Ba0BQAGsepgVYGWhx/exec";

window.APPS_SCRIPT_URL = APPS_SCRIPT_URL;

const MAX_REGISTROS_POR_ENVIO = 500;

/* =========================================================
   Helper: POST com diagnóstico completo
   ========================================================= */
async function postComTimeout(url, payload, timeoutMs) {
  if (!url) {
    return { ok: false, reason: "URL_VAZIA", error: "APPS_SCRIPT_URL não configurada" };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || 30000);

  try {
    const resp = await fetch(url, {
      method: "POST",
      mode: "cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
      redirect: "follow",
    });
    clearTimeout(timer);

    const text = await resp.text();

    // Detecta HTML (página de erro do Google)
    if (text.trim().startsWith("<") || text.trim().startsWith("<!")) {
      console.error("[appsscript] Apps Script retornou HTML (não JSON):", text.substring(0, 300));
      return {
        ok: false,
        reason: "HTML_ERROR",
        error: "Apps Script retornou HTML — provavelmente não autorizado ou despublicado",
        html: text.substring(0, 500),
      };
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      console.warn("[appsscript] Resposta não é JSON:", text.substring(0, 300));
      return { ok: false, reason: "NOT_JSON", error: "Resposta não é JSON", raw: text.substring(0, 300) };
    }

    if (parsed.ok === false) {
      console.warn("[appsscript] Apps Script retornou erro:", parsed.error);
      return { ok: false, reason: "API_ERROR", error: parsed.error, data: parsed };
    }

    return { ok: true, data: parsed };

  } catch (err) {
    clearTimeout(timer);

    if (err.name === "AbortError") {
      console.info("[appsscript] Timeout " + (timeoutMs || 30000) + "ms — envio em background");
      return { ok: false, reason: "TIMEOUT", abort: true };
    }

    if (err.name === "TypeError" && /failed to fetch/i.test(err.message)) {
      console.error(
        "[appsscript] ❌ CORS bloqueou a resposta.\n" +
        "Republique o Apps Script como 'Qualquer pessoa'.\n" +
        "URL: " + url
      );
      return {
        ok: false,
        reason: "CORS",
        error: "CORS — republique o Apps Script com acesso 'Qualquer pessoa'"
      };
    }

    console.error("[appsscript] fetch falhou:", err.name, err.message);
    return { ok: false, reason: "FETCH_ERROR", error: err.name + ": " + err.message };
  }
}

/* =========================================================
   Enviar LOG COMPLETO (LOG_CONSULTAS + REGISTROS)
   ========================================================= */
async function enviarParaSheets(payload) {
  if (!APPS_SCRIPT_URL) {
    console.warn("[appsscript] APPS_SCRIPT_URL vazia — envio ignorado.");
    alert("⚠️ APPS_SCRIPT_URL não configurada em js/appsscript.js");
    return false;
  }
  if (!payload || !payload.registros || payload.registros.length === 0) {
    console.warn("[appsscript] payload vazio — não envia log.");
    return false;
  }

  const registros = payload.registros;
  const total = registros.length;

  if (total <= MAX_REGISTROS_POR_ENVIO) {
    const res = await postComTimeout(APPS_SCRIPT_URL, { acao: "log", ...payload }, 30000);
    if (!res.ok && res.reason === "CORS") {
      alert(
        "❌ Erro de CORS.\n\n" +
        "Republique o Apps Script:\n" +
        "Implantar → Gerenciar implantações → lápis → Nova versão → Qualquer pessoa."
      );
      return false;
    }
    return res.ok;
  }

  // Chunking
  console.log("[appsscript] Enviando " + total + " registros em chunks de " + MAX_REGISTROS_POR_ENVIO);

  let enviados = 0;
  for (let i = 0; i < total; i += MAX_REGISTROS_POR_ENVIO) {
    const chunk = registros.slice(i, i + MAX_REGISTROS_POR_ENVIO);
    const chunkPayload = { ...payload, registros: chunk };

    console.log(
      "[appsscript] Chunk " + (Math.floor(i / MAX_REGISTROS_POR_ENVIO) + 1) +
      "/" + Math.ceil(total / MAX_REGISTROS_POR_ENVIO) +
      " (" + chunk.length + " registros)"
    );

    const res = await postComTimeout(APPS_SCRIPT_URL, { acao: "log", ...chunkPayload }, 30000);
    if (res.ok || res.abort) enviados += chunk.length;

    if (i + MAX_REGISTROS_POR_ENVIO < total) {
      await new Promise(function (r) { setTimeout(r, 300); });
    }
  }

  console.log("[appsscript] Concluído: " + enviados + "/" + total);
  return enviados === total;
}

/* =========================================================
   Marcar FORA DE LINHA (envia códigos + dados extras)
   ========================================================= */
async function marcarForaDeLinhaSheets(codigos, dadosPorCodigo) {
  if (!APPS_SCRIPT_URL) {
    console.warn("[appsscript] URL vazia — marcação local apenas.");
    return false;
  }
  if (!codigos || !codigos.length) {
    console.warn("[appsscript] marcarForaDeLinha: nenhum código");
    return false;
  }

  console.log(
    "[appsscript] Enviando " + codigos.length +
    " código(s) FORA DE LINHA:",
    codigos.slice(0, 20).join(", ") + (codigos.length > 20 ? "..." : "")
  );

  const res = await postComTimeout(APPS_SCRIPT_URL, {
    acao: "foraDeLinha",
    codigos: codigos,
    dados: dadosPorCodigo || {}, // ✅ PRODUTO, CATEGORIA, GRUPO, FORN
    timestamp: new Date().toISOString(),
  }, 20000);

  if (res.ok) {
    console.log("[appsscript] ✅ Apps Script respondeu:", res.data);
    return true;
  }

  if (res.reason === "CORS") {
    alert(
      "❌ Erro de CORS ao enviar FORA DE LINHA.\n\n" +
      "O Apps Script precisa estar publicado com:\n" +
      "• Executar como: Eu\n" +
      "• Acesso: Qualquer pessoa\n\n" +
      "Depois de alterar o Code.gs, SEMPRE faça:\n" +
      "Implantar → Gerenciar implantações → lápis (✏️) → Nova versão → Implantar"
    );
    return false;
  }

  if (res.reason === "HTML_ERROR") {
    alert(
      "❌ Apps Script retornou HTML (não JSON).\n\n" +
      "Isso geralmente significa:\n" +
      "1. Você não autorizou o script (abra /exec no navegador e clique 'Autorizar')\n" +
      "2. A URL está errada (use /exec, não /dev)\n" +
      "3. A conta que acessa o site não tem permissão na planilha"
    );
    return false;
  }

  if (res.reason === "API_ERROR") {
    alert("⚠️ Apps Script respondeu com erro:\n\n" + res.error);
    return false;
  }

  if (res.reason === "TIMEOUT") {
    console.info("[appsscript] Timeout — envio em background");
    return true;
  }

  return false;
}

/* =========================================================
   Health check (para debug)
   ========================================================= */
async function testarConexaoSheets() {
  if (!APPS_SCRIPT_URL) return { ok: false, reason: "URL_VAZIA" };
  try {
    const resp = await fetch(APPS_SCRIPT_URL);
    const text = await resp.text();
    if (text.trim().startsWith("<")) {
      return { ok: false, reason: "HTML", raw: text.substring(0, 300) };
    }
    return { ok: true, data: JSON.parse(text) };
  } catch (err) {
    return { ok: false, reason: err.name, error: err.message };
  }
}

window.testarConexaoSheets = testarConexaoSheets;