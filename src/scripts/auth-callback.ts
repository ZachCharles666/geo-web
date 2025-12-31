import { supabase } from "../lib/supabaseClient";

const RETURN_TO_KEY = "geo_return_to";

function isSafeInternalPath(p: string | null): p is string {
  return !!p && p.startsWith("/");
}

function getFallbackPath(): string {
  // ✅ 优先：如果是从站内页面点过来的，尝试回到 referrer 的路径
  try {
    if (document.referrer) {
      const r = new URL(document.referrer);
      if (r.origin === window.location.origin) {
        const candidate = r.pathname + r.search;
        if (isSafeInternalPath(candidate)) return candidate;
      }
    }
  } catch {}

  // ✅ 最稳兜底：把 callback 当“非入口页”，回到 en
  return "/en";
}

function getReturnToOrFallback(): string {
  try {
    const v = localStorage.getItem(RETURN_TO_KEY);
    if (v) localStorage.removeItem(RETURN_TO_KEY);
    if (isSafeInternalPath(v)) return v;
  } catch {}

  return getFallbackPath();
}

async function main() {
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    window.location.replace(getReturnToOrFallback());
    return;
  }

  setTimeout(async () => {
    const { data: d2 } = await supabase.auth.getSession();
    if (d2.session) window.location.replace(getReturnToOrFallback());
    else window.location.replace("/alpha-access");
  }, 400);
}

main().catch((e) => {
  console.error("[auth-callback] fatal:", e);
  window.location.replace("/alpha-access");
});
