import type { Session } from "@supabase/supabase-js";
import { supabase } from "../supabase";

export async function isActiveAppSession(session: Session | null) {
  if (!session?.user?.id) return false;

  const { data, error } = await supabase
    .from("app_user_profiles")
    .select("is_active")
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (error) return false;
  return data?.is_active === true;
}
