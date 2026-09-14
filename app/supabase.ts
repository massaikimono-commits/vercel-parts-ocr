import { createClient } from "@supabase/supabase-js";

const isServerRuntime = typeof window === "undefined";

if (isServerRuntime) {
  console.error("CF_DIAG_A");
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

if (isServerRuntime) {
  console.error(
    "[cloudflare-env-presence]",
    JSON.stringify({
      hasSupabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      hasSupabasePublishableKey: Boolean(
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      ),
    }),
  );
  console.error("CF_DIAG_B");
}

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

if (isServerRuntime) {
  console.error("CF_DIAG_C");
}
