import { supabase as supabaseImported } from "/scripts/supabase-client.mjs";

const env = (typeof window !== "undefined" && window.__GEO_PUBLIC__) ? window.__GEO_PUBLIC__ : {};

const RETURN_TO_KEY = "geo_return_to";
const UPGRADE_URL = "/alpha";

const GEO_API_BASE_RAW = env.PUBLIC_GEO_API_BASE || env.PUBLIC_SCORE_API || "";
const GEO_API_BASE_FALLBACK = "http://127.0.0.1:8001";
const GEO_API_BASE = GEO_API_BASE_RAW || (env.PROD ? "" : GEO_API_BASE_FALLBACK);

if (!GEO_API_BASE && env.PROD) {
  console.error("[auth] GEO_API_BASE missing in production; quota fetch disabled.");
}

const QUOTA_MOCK_ENABLED = env.PUBLIC_QUOTA_MOCK === "1" && !env.PROD;
const QUOTA_MOCK = {
  tokens_limit: 200000,
  tokens_used: 4200,
  tokens_remaining: 195800,
};

function normalizeQuota(data) {
  if (!data || typeof data !== "object") return null;

  const hasTokens = (obj) =>
    obj &&
    (typeof obj.tokens_limit === "number" ||
      typeof obj.tokens_used === "number" ||
      typeof obj.tokens_remaining === "number");

  if (data.ok === true) {
    if (hasTokens(data.data)) return data.data;
    if (hasTokens(data)) return data;
  }

  if (hasTokens(data)) return data;
  return null;
}

async function fetchMonthlyQuota(accessToken) {
  if (QUOTA_MOCK_ENABLED) {
    return { ok: true, data: QUOTA_MOCK };
  }

  if (!GEO_API_BASE) {
    return { ok: false, data: null };
  }

  const res = await fetch(`${GEO_API_BASE}/api/quota/me`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    credentials: "omit",
  });

  const data = await res.json().catch(() => null);
  return { ok: res.ok, data };
}

function getSupabase() {
  if (typeof window !== "undefined") {
    const w = window;
    if (w.__GEO_SUPABASE__) return w.__GEO_SUPABASE__;
    w.__GEO_SUPABASE__ = supabaseImported;
  }
  return supabaseImported;
}

function el(tag, cls) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}

function getReturnTo() {
  return window.location.pathname + window.location.search;
}

function setReturnTo() {
  try {
    localStorage.setItem(RETURN_TO_KEY, getReturnTo());
  } catch (e) {
    console.warn("[auth] cannot write localStorage:", e);
  }
}

function withTimeout(p, ms, tag) {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error(`timeout:${tag}:${ms}ms`)), ms);
    p.then((v) => {
      window.clearTimeout(t);
      resolve(v);
    }).catch((e) => {
      window.clearTimeout(t);
      reject(e);
    });
  });
}

const TIER_CACHE_KEY_PREFIX = "geo_tier_cache::";
const tierInflight = new Map();

function readTierCache(userId) {
  try {
    const raw = sessionStorage.getItem(TIER_CACHE_KEY_PREFIX + userId);
    if (!raw) return null;
    if (raw === "free" || raw === "alpha_base" || raw === "alpha_pro") return raw;
    return null;
  } catch {
    return null;
  }
}

function writeTierCache(userId, tier) {
  try {
    sessionStorage.setItem(TIER_CACHE_KEY_PREFIX + userId, tier);
  } catch {
    return;
  }
}

async function getTier(userId) {
  const cached = readTierCache(userId);
  if (cached) return cached;

  if (tierInflight.has(userId)) return tierInflight.get(userId);

  const supabase = getSupabase();

  const p = (async () => {
    try {
      const req = supabase
        .from("profiles")
        .select("tier")
        .eq("id", userId)
        .single();

      const { data, error } = await withTimeout(req, 3000, "profiles.tier");

      if (error) {
        console.warn("[auth] profiles.tier load error:", error);
        return "free";
      }

      const tier = data?.tier ?? "free";
      const normalized =
        tier === "alpha_base" || tier === "alpha_pro" || tier === "free" ? tier : "free";

      writeTierCache(userId, normalized);
      return normalized;
    } catch (e) {
      console.warn("[auth] profiles.tier load fatal:", e);
      return "free";
    } finally {
      tierInflight.delete(userId);
    }
  })();

  tierInflight.set(userId, p);
  return p;
}

function tierLabel(tier) {
  if (tier === "alpha_base") return "Alpha";
  if (tier === "alpha_pro") return "Alpha Pro";
  return "Free";
}

function tierBadgeClass(tier) {
  switch (tier) {
    case "alpha_pro":
      return "inline-flex items-center rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 text-[11px] font-semibold text-purple-700";
    case "alpha_base":
      return "inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700";
    default:
      return "inline-flex items-center rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700";
  }
}

function renderLoggedOut(root) {
  const supabase = getSupabase();
  root.innerHTML = "";

  const btn = el(
    "button",
    "inline-flex items-center justify-center rounded-full bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-indigo-700"
  );

  btn.type = "button";
  btn.textContent = "Sign in";

  btn.addEventListener("click", async () => {
    setReturnTo();

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin + "/auth/callback",
      },
    });

    if (error) console.error("[auth] signIn error:", error);
  });

  root.appendChild(btn);

  window.__GEO_USER_TIER__ = "free";
  window.__GEO_QUOTA__ = null;
}

async function renderLoggedIn(root, email, userId, session) {
  const supabase = getSupabase();
  root.innerHTML = "";

  const wrap = el("div", "flex items-center gap-2");

  const emailChip = el(
    "span",
    "hidden sm:inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700 shadow-sm"
  );
  emailChip.textContent = email;

  const tierBadge = el("span", tierBadgeClass("free"));
  tierBadge.textContent = "...";

  const quotaLine = el(
    "span",
    "hidden sm:inline-flex items-center text-[11px] text-gray-500"
  );
  quotaLine.id = "geo-quota-line";
  quotaLine.textContent = "Tokens this month: — / —";

  const upgrade = el(
    "a",
    "inline-flex items-center justify-center rounded-full bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-amber-600"
  );
  upgrade.href = UPGRADE_URL;
  upgrade.textContent = "Upgrade";
  upgrade.style.display = "none";

  const logout = el(
    "button",
    "inline-flex items-center justify-center rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 shadow-sm"
  );
  logout.type = "button";
  logout.textContent = "Sign out";
  logout.addEventListener("click", async () => {
    const { error } = await supabase.auth.signOut();
    if (error) console.error("[auth] signOut error:", error);
  });

  wrap.appendChild(emailChip);
  wrap.appendChild(tierBadge);
  wrap.appendChild(quotaLine);
  wrap.appendChild(upgrade);
  wrap.appendChild(logout);
  root.appendChild(wrap);

  const tier = await getTier(userId);

  tierBadge.className = tierBadgeClass(tier);
  tierBadge.textContent = tierLabel(tier);

  upgrade.style.display = tier === "free" ? "inline-flex" : "none";

  window.__GEO_USER_TIER__ = tier;

  async function getAccessTokenWithRetry(initialToken, attempts = 3, delayMs = 300) {
    if (initialToken) return initialToken;
    let token = initialToken || "";
    for (let i = 0; i < attempts; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      const { data } = await supabase.auth.getSession();
      token = data.session?.access_token || "";
      if (token) break;
    }
    return token || null;
  }

  (async () => {
    try {
      const accessToken = await getAccessTokenWithRetry(session.access_token);

      if (!accessToken) {
        quotaLine.style.display = "none";
        window.__GEO_QUOTA__ = null;
        return;
      }

      const res = await fetchMonthlyQuota(accessToken);
      const q = normalizeQuota(res.data);
      if (!res.ok || !q) {
        console.error("[auth] quota fetch failed:", res.data);
        quotaLine.style.display = "none";
        window.__GEO_QUOTA__ = null;
        return;
      }

      const remaining = q.tokens_remaining ?? null;
      const limit = q.tokens_limit ?? null;

      if (typeof remaining === "number" && typeof limit === "number") {
        quotaLine.textContent = `Tokens this month: ${remaining} / ${limit}`;
        window.__GEO_QUOTA__ = q;
      } else {
        quotaLine.style.display = "none";
        window.__GEO_QUOTA__ = q;
      }
    } catch (e) {
      quotaLine.style.display = "none";
      window.__GEO_QUOTA__ = null;
    }
  })();
}

async function renderBySession(root, session, seq, getSeq) {
  const isStale = () => seq !== getSeq();

  if (!session?.user) {
    if (isStale()) return;
    renderLoggedOut(root);
    return;
  }

  const user = session.user;
  const email = user.email || user.id;

  if (isStale()) return;
  await renderLoggedIn(root, email, user.id, session);
}

async function main() {
  const supabase = getSupabase();

  const w = window;
  if (w.__GEO_AUTH_BAR_INITED__) {
    // already initialized
  } else {
    w.__GEO_AUTH_BAR_INITED__ = true;
  }

  const root = document.getElementById("auth-bar");
  if (!root) return;

  let renderSeq = 0;
  const bumpSeq = () => ++renderSeq;
  const getSeq = () => renderSeq;

  const seq1 = bumpSeq();
  const { data, error } = await supabase.auth.getSession();
  if (error) console.error("[auth] getSession error:", error);
  await renderBySession(root, data.session, seq1, getSeq);

  if (!w.__GEO_AUTH_BAR_LISTENER__) {
    w.__GEO_AUTH_BAR_LISTENER__ = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        const seq = bumpSeq();
        await renderBySession(root, newSession, seq, getSeq);
      }
    );
  }
}

main().catch((e) => console.error("[auth-bar] fatal:", e));
