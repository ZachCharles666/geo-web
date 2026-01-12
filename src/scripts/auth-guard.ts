import { supabase } from "../lib/supabaseClient";

// ✅ 复用同一 SupabaseClient，供页面内其它脚本（score/rewrite）取 token 用
(window as any).__GEO_SUPABASE__ = supabase;

const PUBLIC_PATHS = [
  "/terms",
  "/privacy",
  "/refund",
  "/pricing",
  "/about",
  "/help",
  "/changelog",
  "/contact",
];

function isPublicPath(pathname: string) {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (PUBLIC_PATHS.includes(normalized)) return true;
  if (normalized.startsWith("/en/") || normalized.startsWith("/zh/")) {
    const rest = normalized.replace(/^\/(en|zh)/, "");
    return PUBLIC_PATHS.includes(rest);
  }
  return false;
}

(async () => {
  if (isPublicPath(window.location.pathname)) return;
  const { data, error } = await supabase.auth.getSession();
  if (error) console.error("[auth-guard] getSession error:", error);

  const session = data.session;
  if (!session) {
    const redirect = window.location.pathname + window.location.search;
    window.location.href = `/alpha-access?redirect=${encodeURIComponent(redirect)}`;
  }
})();
