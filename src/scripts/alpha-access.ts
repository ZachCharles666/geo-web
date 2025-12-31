import { supabase } from "../lib/supabaseClient";

console.log("[alpha-access] script executed");
(window as any).__alphaAccessLoaded = true;


const statusEl = document.getElementById("status") as HTMLElement | null;

function setStatus(msg: string) {
  if (statusEl) statusEl.textContent = msg;
}

async function signIn(provider: "google" | "azure") {
  try {
    setStatus("Redirecting...");

    const params = new URLSearchParams(window.location.search);
    const redirect = params.get("redirect") || "/rewrite";

    // ✅ 本地优先走 window.location.origin，避免 PUBLIC_SITE_URL 配错导致乱跳
    const siteUrl = window.location.origin;

    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${siteUrl}/auth/callback?redirect=${encodeURIComponent(
          redirect
        )}`,
      },
    });

    if (error) setStatus(error.message);
  } catch (e: any) {
    setStatus(e?.message || String(e));
  }
}

document.getElementById("btn-google")?.addEventListener("click", () => {
  void signIn("google");
});

document.getElementById("btn-ms")?.addEventListener("click", () => {
  void signIn("azure");
});
