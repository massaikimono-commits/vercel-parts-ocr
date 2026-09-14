// Diagnostic-only route. Never expose binding values or environment contents.
// @ts-ignore Cloudflare Workers provides this virtual module at runtime.
import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

export async function GET() {
  const runtimeEnv = env as Record<string, unknown>;

  return Response.json(
    {
      runtime: "cloudflare",
      hasSupabaseUrl: Boolean(runtimeEnv.NEXT_PUBLIC_SUPABASE_URL),
      hasSupabasePublishableKey: Boolean(
        runtimeEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      ),
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
