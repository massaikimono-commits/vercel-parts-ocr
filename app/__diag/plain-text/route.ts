export const dynamic = "force-dynamic";

export async function GET() {
  return new Response("ICB_PLAIN_TEXT_OK", {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
