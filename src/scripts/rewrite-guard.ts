import { supabase } from "../lib/supabaseClient";

(async () => {
  const { data } = await supabase.auth.getSession();
  const session = data.session;

  // 未登录 → 回 alpha-access，并带 redirect 回来
  if (!session) {
    const redirect = window.location.pathname + window.location.search;
    window.location.href = `/alpha-access?redirect=${encodeURIComponent(redirect)}`;
    return;
  }

  // 已登录 → 展示邮箱（验收用）
  const el = document.getElementById("user-email");
  if (el) el.textContent = session.user.email ?? "(no email)";
})();
