// @ts-check
/**
 * serverless/lead-collect.js —— SCF Web函数版本（Node 18 + ESM）
 * - 本地执行: node serverless/lead-collect.js
 * - 上云部署: 腾讯云 SCF → Web函数，入口函数 main(req,res)
 * - 功能: 表单提交 → 推送企业微信 / Telegram
 */

import http from "http";
import { pathToFileURL } from "url";
import "dotenv/config"; // 自动加载 .env

/** @typedef {{id:string, name:string, wechat_qr:string}} Owner */
/** @typedef {{[k:string]:string}} StringDict */
/** @typedef {import("http").IncomingMessage} IncomingMessage */
/** @typedef {import("http").ServerResponse} ServerResponse */

// === 顾问信息 ===
const OWNERS = /** @type {Owner[]} */ ([
  { id: "consult1", name: "GEO顾问", wechat_qr: "/assets/qr/qr1.png" },
]);

// === 环境变量 ===
const QYWX_WEBHOOK_URL =
  process.env.QYWX_WEBHOOK || process.env.QYWX_WEBHOOK_URL || "";

console.log("[ENV] QYWX_WEBHOOK present =", !!QYWX_WEBHOOK_URL);

const TG_ENABLED =
  process.env.TG_ENABLED === "1" &&
  !!process.env.TG_BOT_TOKEN &&
  !!process.env.TG_CHAT_ID;

// === HTTP Header ===
const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, X-Requested-With, Accept, X-Internal-Auth",
  Vary: "Origin",
};

// === 工具函数 ===
let cursor = 0;
/** @returns {Owner} */
function assignOwner() {
  const o = OWNERS[cursor % OWNERS.length];
  cursor++;
  return o;
}

/** @param {string|undefined|null} s @param {number} n */
function trunc(s, n) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

/** @param {string=} s */
function md(s = "") {
  return s
    .replace(/\*/g, "\\*")
    .replace(/_/g, "\\_")
    .replace(/`/g, "\\`")
    .replace(/\|/g, "\\|")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * @param {string} url
 * @param {RequestInit} [init]
 * @param {number} [ms]
 */
async function fetchWithTimeout(url, init = {}, ms = 5000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** @param {string} textMD */
async function pushToQYWX(textMD) {
  if (!QYWX_WEBHOOK_URL) {
    console.warn("QYWX_WEBHOOK 缺失, skip QYWX push");
    return false;
  }
  try {
    const r = await fetchWithTimeout(
      QYWX_WEBHOOK_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          msgtype: "markdown",
          markdown: { content: textMD },
        }),
      },
      6000
    );
    const t = await r.text().catch(() => "");
    console.log("[QYWX]", r.status, t || "(no body)");
    return r.ok;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("QYWX push skipped:", msg);
  }
}

console.log("TG env check:", process.env.TG_ENABLED, !!process.env.TG_BOT_TOKEN, !!process.env.TG_CHAT_ID);

/** @param {string} text */
async function pushToTG(text) {
  if (!TG_ENABLED) {
    console.warn("TG not enabled, skip TG push");
    return;
  }
  try {
    const url = `https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/sendMessage`;
    await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: process.env.TG_CHAT_ID, text }),
      },
      5000
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("TG push skipped:", msg);
  }
}

/**
 * @param {ServerResponse} res
 * @param {number} status
 * @param {any} [data]
 */
function send(res, status, data) {
  res.statusCode = status;
  for (const [k, v] of Object.entries(JSON_HEADERS)) res.setHeader(k, v);
  res.end(data ? JSON.stringify(data) : "");
}

// ============================================================
// ✅ 主函数（ESM 导出形式）
// ============================================================

/**
 * SCF Web函数入口(req,res)
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 */
export async function main(req, res) {
  const method = String(req.method || "GET").toUpperCase();

  if (method === "OPTIONS") return send(res, 204, null);
  if (method !== "POST")
    return send(res, 405, { ok: false, success: false, error: "method_not_allowed" });

  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  const raw = Buffer.concat(chunks).toString();
  const ct = String(req.headers["content-type"] || "").toLowerCase();

  /** @type {StringDict} */
  let params = {};

  try {
    if (ct.includes("application/json")) {
      params = JSON.parse(raw || "{}");
    } else if (ct.includes("application/x-www-form-urlencoded")) {
      params = Object.fromEntries(new URLSearchParams(raw));
    } else {
      params = Object.fromEntries(new URLSearchParams(raw));
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("parse body error:", msg);
  }

  const isInternal =
    !!req.headers["x-internal-auth"] &&
    req.headers["x-internal-auth"] === process.env.INTERNAL_TOKEN;

  // 🧱 蜜罐字段：有值就直接丢弃
  if (params.company_website || params.website) {
    return send(res, 204, { ok: false, success: false, spam: true });
  }

  // 🧱 提交时间戳防秒提（前端传 ts）
  const ts = Number(params.ts || params.timestamp || 0);
  if (!Number.isNaN(ts) && ts > 0) {
    const delta = Date.now() - ts;
    if (delta < 3000) {
      console.warn("suspicious fast submit:", delta, "ms");
      return send(res, 429, {
        ok: false,
        success: false,
        spam: true,
        error: "too_fast",
      });
    }
  }

  const now = new Date();
  const source = trunc(
    params.source || params.src || (isInternal ? "internal" : "contact"),
    40
  );
  const name = trunc(params.name, 60);
  const org = trunc(params.org, 120);
  const phone = trunc(params.phone, 60);
  const email = trunc(params.email, 120);
  const topic = trunc(params.topic, 60);
  const message = trunc(params.message, 2000);
  const referer = String(req.headers["referer"] || "");
  const ip = String(
    req.headers["x-forwarded-for"] || req.socket?.remoteAddress || ""
  );

  const assigned = assignOwner();

  // 中英文来源判断：
  // - web_form_zh 开头：视为中文表单
  // - 其他（web_form_en / contact / internal...）：视为英文或通用表单
  const isZh = source.startsWith("web_form_zh");
  // const isEn = source.startsWith("web_form_en"); // 如需单独用可保留

  const qyText =
    `**新线索**（${md(source)}）\n` +
    `> **姓名**：${md(name || "-")}\n` +
    `> **公司**：${md(org || "-")}\n` +
    `> **电话/微信**：${md(phone || "-")}\n` +
    `> **邮箱**：${md(email || "-")}\n` +
    `> **主题**：${md(topic || "-")}\n` +
    `> **需求**：${md(message || "-")}\n` +
    `> **顾问**：${md(assigned.name)}\n` +
    `> **来源**：${md(referer)}\n` +
    `> **IP**：${md(ip)}\n` +
    `> **时间**：${now.toLocaleString()}`;

  // ===== 分流逻辑 =====
  // zh：只用企业微信
  if (isZh) {
    await pushToQYWX(qyText);
  } else {
    // en / 通用：只用 Telegram
    await pushToTG(
      `【GEO-Max】New inquiry ${name || "-"} (${source})\n` +
        `${message || "-"}\n` +
        `${phone || "-"} | ${email || "-"} | ${org || "-"}\n` +
        `Owner: ${assigned.name}  ${now.toLocaleString()}`
    );
  }
  // ===== 分流结束 =====


  return send(res, 200, {
    ok: true,
    success: true,
    owner: assigned,
    qr: assigned.wechat_qr,
  });
}

// ============================================================
// ✅ 本地调试模式（跨平台可靠：Windows/macOS/Linux）
// ============================================================
try {
  const invokedAsEntry =
    typeof process !== "undefined" &&
    Array.isArray(process.argv) &&
    process.argv[1] &&
    import.meta &&
    import.meta.url &&
    import.meta.url === pathToFileURL(process.argv[1]).href;

  const forceLocal = process.env.FORCE_LOCAL === "1";

  if (invokedAsEntry || forceLocal) {
    const server = http.createServer((req, res) => main(req, res));
    const PORT = Number(process.env.PORT || 8787);
    server.listen(PORT, () => {
      console.log(`✅ Local test: http://localhost:${PORT}/lead-collect`);
    });
  }
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.warn("local-start guard error:", msg);
}
