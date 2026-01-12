import { supabase } from "/scripts/supabase-client.mjs";

const RETURN_TO_KEY = "geo_return_to";

function isSafeInternalPath(p) {
  return !!p && p.startsWith("/");
}

function getFallbackPath() {
  try {
    if (document.referrer) {
      const r = new URL(document.referrer);
      if (r.origin === window.location.origin) {
        const candidate = r.pathname + r.search;
        if (isSafeInternalPath(candidate)) return candidate;
      }
    }
  } catch {}

  return "/en";
}

function getReturnToOrFallback() {
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
