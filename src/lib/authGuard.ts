import { supabase } from './supabaseClient';

export async function requireSessionOrRedirect(redirectTo: string) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    window.location.href = `/alpha-access?redirect=${encodeURIComponent(redirectTo)}`;
    return null;
  }
  return data.session;
}
