const ALLOWED = new Set([
  "BOOT_1_EFFECT",
  "BOOT_2_MICROTASK",
  "BOOT_3_RAF",
  "BOOT_4_1S",
  "BOOT_5_3S",
  "BOOT_DOM_LOADING",
  "BOOT_DOM_LOGIN",
  "BOOT_DOM_HOME",
  "BOOT_JS_ERROR",
  "BOOT_UNHANDLED_REJECTION",
  "BOOT_RESOURCE_ERROR",
  "BOOT_PAGESHOW",
  "BOOT_PAGEHIDE",
  "BOOT_VIS_HIDDEN",
  "BOOT_VIS_VISIBLE",
]);

export async function POST(request: Request) {
  const step = (await request.text()).trim();
  if (!ALLOWED.has(step)) {
    return new Response(null, { status: 204 });
  }

  console.log(`[ICB_CLIENT_BOOT] ${step}`);
  return new Response(null, {
    status: 204,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
