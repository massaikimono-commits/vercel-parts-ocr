export default {
  async fetch() {
    return new Response("ICB_RAW_WORKER_OK\n", {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "x-icb-diag": "raw-worker"
      }
    });
  }
};
