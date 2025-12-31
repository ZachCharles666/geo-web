import { supabase as supabaseImported } from "../lib/supabaseClient";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

type Tier = "free" | "alpha_base" | "alpha_pro";

const RETURN_TO_KEY = "geo_return_to";
const UPGRADE_URL = "/alpha"; // 可改：/alpha-access /pricing 等

const GEO_API_BASE =
  (import.meta as any).env?.PUBLIC_GEO_API_BASE ||
  (import.meta as any).env?.PUBLIC_SCORE_API ||
  "http://127.0.0.1:8001";

async function fetchMonthlyQuota(accessToken: string) {
  const res = await fetch(`${GEO_API_BASE}/api/quota/me`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    // 不用 include，避免你之前遇到的 CORS credentials 限制
    credentials: "omit",
  });

  const data = await res.json().catch(() => null);
  return { ok: res.ok, data };
}

// ===== 运行期统一 supabase 单例（避免多实例竞争）=====
function getSupabase() {
  if (typeof window !== "undefined") {
    const w = window as any;
    if (w.__GEO_SUPABASE__) return w.__GEO_SUPABASE__;
    // 将本模块 import 的 supabase 挂到全局，供其他页面复用
    w.__GEO_SUPABASE__ = supabaseImported;
  }
  return supabaseImported;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}

function getReturnTo(): string {
  return window.location.pathname + window.location.search;
}

function setReturnTo() {
  try {
    localStorage.setItem(RETURN_TO_KEY, getReturnTo());
  } catch (e) {
    console.warn("[auth] cannot write localStorage:", e);
  }
}

/** Promise 超时包装：避免 profiles 查询卡住导致 UI 永远 loading */
function withTimeout<T>(p: Promise<T>, ms: number, tag: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
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

// ===== tier 缓存（减少 profiles 读取 & 避免并发）=====
const TIER_CACHE_KEY_PREFIX = "geo_tier_cache::"; // sessionStorage
const tierInflight = new Map<string, Promise<Tier>>();

function readTierCache(userId: string): Tier | null {
  try {
    const raw = sessionStorage.getItem(TIER_CACHE_KEY_PREFIX + userId);
    if (!raw) return null;
    if (raw === "free" || raw === "alpha_base" || raw === "alpha_pro") return raw;
    return null;
  } catch {
    return null;
  }
}

function writeTierCache(userId: string, tier: Tier) {
  try {
    sessionStorage.setItem(TIER_CACHE_KEY_PREFIX + userId, tier);
  } catch {
    // ignore
  }
}

async function getTier(userId: string): Promise<Tier> {
  const cached = readTierCache(userId);
  if (cached) return cached;

  if (tierInflight.has(userId)) return tierInflight.get(userId)!;

  const supabase = getSupabase();

  const p = (async () => {
    try {
      const req = supabase
        .from("profiles")
        .select("tier")
        .eq("id", userId)
        .single();

      const { data, error } = await withTimeout(
        req as unknown as Promise<{ data: any; error: any }>,
        3000,
        "profiles.tier"
      );

      if (error) {
        console.warn("[auth] profiles.tier load error:", error);
        return "free" as Tier;
      }

      const tier = (data?.tier ?? "free") as Tier;
      const normalized: Tier =
        tier === "alpha_base" || tier === "alpha_pro" || tier === "free" ? tier : "free";

      writeTierCache(userId, normalized);
      return normalized;
    } catch (e) {
      console.warn("[auth] profiles.tier load fatal:", e);
      return "free" as Tier;
    } finally {
      tierInflight.delete(userId);
    }
  })();

  tierInflight.set(userId, p);
  return p;
}

/** 显示名映射：数据库 tier → 用户可读 */
function tierLabel(tier: Tier): string {
  if (tier === "alpha_base") return "Alpha";
  if (tier === "alpha_pro") return "Alpha Pro";
  return "Free";
}

/** 样式映射：不同 tier 的底色/边框/文字色（更符合“会员标签”预期） */
function tierBadgeClass(tier: Tier): string {
  switch (tier) {
    case "alpha_pro":
      return "inline-flex items-center rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 text-[11px] font-semibold text-purple-700";
    case "alpha_base":
      return "inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700";
    default:
      return "inline-flex items-center rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700";
  }
}

function renderLoggedOut(root: HTMLElement) {
  const supabase = getSupabase();
  root.innerHTML = "";

  const btn = el(
    "button",
    "inline-flex items-center justify-center rounded-full bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-indigo-700"
  ) as HTMLButtonElement;

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

  // 同步全局：free
  (window as any).__GEO_USER_TIER__ = "free";
  (window as any).__GEO_QUOTA__ = null;
}

async function renderLoggedIn(root: HTMLElement, email: string, userId: string) {
  const supabase = getSupabase();
  root.innerHTML = "";

  const wrap = el("div", "flex items-center gap-2");

  const emailChip = el(
    "span",
    "hidden sm:inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700 shadow-sm"
  );
  emailChip.textContent = email;

  const tierBadge = el("span", tierBadgeClass("free"));
  tierBadge.textContent = "…";

  // ✅ 新增：额度占位（先显示占位，随后异步更新）
  const quotaLine = el(
    "span",
    "hidden sm:inline-flex items-center text-[11px] text-gray-500"
  ) as HTMLSpanElement;
  quotaLine.id = "geo-quota-line";
  quotaLine.textContent = "Tokens this month: — / —";

  const upgrade = el(
    "a",
    "inline-flex items-center justify-center rounded-full bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-amber-600"
  ) as HTMLAnchorElement;
  upgrade.href = UPGRADE_URL;
  upgrade.textContent = "Upgrade";
  upgrade.style.display = "none";

  const logout = el(
    "button",
    "inline-flex items-center justify-center rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 shadow-sm"
  ) as HTMLButtonElement;
  logout.type = "button";
  logout.textContent = "Sign out";
  logout.addEventListener("click", async () => {
    const { error } = await supabase.auth.signOut();
    if (error) console.error("[auth] signOut error:", error);
  });

  wrap.appendChild(emailChip);
  wrap.appendChild(tierBadge);
  wrap.appendChild(quotaLine); // ✅ 放在 tier 后面最合适
  wrap.appendChild(upgrade);
  wrap.appendChild(logout);
  root.appendChild(wrap);

  // 异步拉 tier 并更新 badge（带超时+缓存，避免 UI 卡死）
  const tier = await getTier(userId);

  tierBadge.className = tierBadgeClass(tier);
  tierBadge.textContent = tierLabel(tier);

  upgrade.style.display = tier === "free" ? "inline-flex" : "none";

  // 同步全局：供 score/rewrite 只读
  (window as any).__GEO_USER_TIER__ = tier;

  // ✅ 异步拉取本月额度（不阻塞 tier 渲染）
  (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;

      if (!accessToken) {
        quotaLine.style.display = "none";
        (window as any).__GEO_QUOTA__ = null;
        return;
      }

      const res = await fetchMonthlyQuota(accessToken);
      if (!res.ok || !res.data?.ok) {
        quotaLine.style.display = "none";
        (window as any).__GEO_QUOTA__ = null;
        return;
      }

      const q = res.data;
      // 你后端建议返回：tokens_limit / tokens_used / tokens_remaining
      const remaining = q.tokens_remaining ?? null;
      const limit = q.tokens_limit ?? null;

      if (typeof remaining === "number" && typeof limit === "number") {
        quotaLine.textContent = `Tokens this month: ${remaining} / ${limit}`;
        (window as any).__GEO_QUOTA__ = q;
      } else {
        quotaLine.style.display = "none";
        (window as any).__GEO_QUOTA__ = q;
      }
    } catch (e) {
      quotaLine.style.display = "none";
      (window as any).__GEO_QUOTA__ = null;
    }
  })();
}

async function renderBySession(
  root: HTMLElement,
  session: Session | null,
  seq: number,
  getSeq: () => number
) {
  const isStale = () => seq !== getSeq();

  if (!session?.user) {
    if (isStale()) return;
    renderLoggedOut(root);
    return;
  }

  const user = session.user;
  const email = user.email || user.id;

  if (isStale()) return;
  await renderLoggedIn(root, email, user.id);
}

async function main() {
  const supabase = getSupabase();

  const w = window as any;
  if (w.__GEO_AUTH_BAR_INITED__) {
    // 已初始化则只做一次“刷新渲染”，避免重复注册 onAuthStateChange
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
      async (_event: AuthChangeEvent, newSession: Session | null) => {
        const seq = bumpSeq();
        await renderBySession(root, newSession, seq, getSeq);
      }
    );
  }
}

main().catch((e) => console.error("[auth-bar] fatal:", e));
