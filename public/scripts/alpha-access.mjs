import { supabase } from "/scripts/supabase-client.mjs";

console.log("[alpha-access] script executed");
window.__alphaAccessLoaded = true;

const statusEl = document.getElementById("status");

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg;
}

async function signIn(provider) {
  try {
    setStatus("Redirecting...");

    const params = new URLSearchParams(window.location.search);
    const redirect = params.get("redirect") || "/rewrite";

    const siteUrl = window.location.origin;

    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${siteUrl}/auth/callback?redirect=${encodeURIComponent(redirect)}`,
      },
    });

    if (error) setStatus(error.message);
  } catch (e) {
    setStatus(e?.message || String(e));
  }
}

document.getElementById("btn-google")?.addEventListener("click", () => {
  void signIn("google");
});

document.getElementById("btn-ms")?.addEventListener("click", () => {
  void signIn("azure");
});
