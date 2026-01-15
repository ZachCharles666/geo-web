// @ts-check
/**
 * serverless/waitlist-collect.js —— Cloudflare Worker (module syntax)
 * - Deploy: wrangler deploy
 * - Local dev: wrangler dev
 */

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Requested-With, Accept",
  Vary: "Origin",
};

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

/** @param {Record<string, string>} env @param {string} text */
async function pushToTG(env, text) {
  const enabled =
    env.WAITLIST_TG_ENABLED === "1" &&
    !!env.WAITLIST_TG_BOT_TOKEN &&
    !!env.WAITLIST_TG_CHAT_ID;
  if (!enabled) {
    console.warn("WAITLIST TG not enabled, skip TG push");
    return;
  }
  try {
    const url = `https://api.telegram.org/bot${env.WAITLIST_TG_BOT_TOKEN}/sendMessage`;
    await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: env.WAITLIST_TG_CHAT_ID, text }),
      },
      5000
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("WAITLIST TG push skipped:", msg);
  }
}

/**
 * @param {ResponseInit["status"]} status
 * @param {any} [data]
 */
function send(status, data) {
  return new Response(data ? JSON.stringify(data) : "", {
    status,
    headers: JSON_HEADERS,
  });
}

export default {
  async fetch(request, env) {
    const method = request.method.toUpperCase();
    if (method === "OPTIONS") return send(204, null);
    if (method !== "POST") {
      return send(405, { ok: false, success: false, error: "method_not_allowed" });
    }

    const ct = request.headers.get("content-type") || "";
    let params = {};
    try {
      if (ct.includes("application/json")) {
        params = await request.json();
      } else {
        const raw = await request.text();
        params = Object.fromEntries(new URLSearchParams(raw));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("parse body error:", msg);
    }

    const email = String(params.email || "-");
    const role = String(params.role || "-");
    const website = String(params.website || "-");
    const note = String(params.note || "-");
    const source = String(params.source || "waitlist");
    const pageUrl = String(params.page_url || "-");
    const referrer = String(params.referrer || "-");
    const duplicate = params.duplicate ? "yes" : "no";
    const now = new Date();

    await pushToTG(
      env,
      `【GEO-Max】Waitlist ${duplicate === "yes" ? "duplicate" : "new"}\n` +
        `email: ${email}\n` +
        `role: ${role}\n` +
        `website: ${website}\n` +
        `note: ${note}\n` +
        `source: ${source}\n` +
        `page: ${pageUrl}\n` +
        `ref: ${referrer}\n` +
        `time: ${now.toLocaleString()}`
    );

    return send(200, { ok: true, success: true });
  },
};
