import assert from "node:assert/strict";
import fs from "node:fs";
import {
  commitCertificatePdfFinal,
  createCertificatePdfCompletionContract,
  createCertificatePdfRunOwnership,
} from "../app/certificate-pdf-single-owner-contract.js";

function harness() {
  const ownership = createCertificatePdfRunOwnership();
  const completion = createCertificatePdfCompletionContract(ownership);
  const events = { commits: 0, completed: 0, fallbacks: 0, errors: 0, ui: 0 };
  const commit = (runId) => commitCertificatePdfFinal({
    ownership,
    runId,
    patch: { registrationNumber: "なにわ 301 ひ 5561" },
    writePdf: () => { events.commits += 1; },
    clearQr: () => {},
    dispatch: () => {},
  });
  const settle = (runId, state) => {
    const accepted = completion.settle(runId, state);
    if (!accepted) return false;
    if (state === "completed") events.completed += 1;
    if (state === "fallback") events.fallbacks += 1;
    if (state === "error") events.errors += 1;
    events.ui += 1;
    return true;
  };
  return { ownership, completion, events, commit, settle };
}

// Strong parse: one FINAL commit and one completed terminal.
{
  const h = harness();
  const run = h.completion.beginRun();
  assert.ok(h.commit(run));
  assert.equal(h.settle(run, "completed"), true);
  assert.equal(h.commit(run), null);
  assert.deepEqual(h.events, { commits: 1, completed: 1, fallbacks: 0, errors: 0, ui: 1 });
  assert.equal(h.completion.state(run), "completed");
}

// Active claim rejection must terminate as an error instead of returning while processing.
{
  const h = harness();
  const run = h.completion.beginRun();
  assert.equal(h.ownership.claimCommit(run), true);
  assert.equal(h.commit(run), null);
  assert.equal(h.settle(run, "error"), true);
  assert.equal(h.completion.state(run), "error");
}

// A stale result is cancelled internally and cannot mutate the current run UI or commit.
{
  const h = harness();
  const stale = h.completion.beginRun();
  const active = h.completion.beginRun();
  assert.equal(h.completion.state(stale), "cancelled");
  assert.equal(h.commit(stale), null);
  assert.equal(h.settle(stale, "error"), false);
  assert.equal(h.events.ui, 0);
  assert.equal(h.completion.state(active), "processing");
  assert.ok(h.commit(active));
  assert.equal(h.settle(active, "completed"), true);
  assert.equal(h.events.commits, 1);
}

// Non-strong and parse-error paths each reach a controlled terminal.
{
  const weak = harness();
  const weakRun = weak.completion.beginRun();
  assert.equal(weak.settle(weakRun, "fallback"), true);
  assert.equal(weak.completion.state(weakRun), "fallback");
  const failed = harness();
  const failedRun = failed.completion.beginRun();
  assert.equal(failed.settle(failedRun, "error"), true);
  assert.equal(failed.completion.state(failedRun), "error");
}

// Fresh first and sequential second PDFs both complete without cross-run contamination.
{
  const h = harness();
  const first = h.completion.beginRun();
  assert.ok(h.commit(first));
  assert.equal(h.settle(first, "completed"), true);
  const second = h.completion.beginRun();
  assert.ok(h.commit(second));
  assert.equal(h.settle(second, "completed"), true);
  assert.equal(h.events.commits, 2);
  assert.equal(h.events.completed, 2);
  assert.equal(h.completion.state(first), "completed");
  assert.equal(h.completion.state(second), "completed");
}

// Unmount invalidation terminalizes the active run without authorizing a commit.
{
  const h = harness();
  const run = h.completion.beginRun();
  assert.equal(h.completion.invalidate(), run);
  assert.equal(h.completion.state(run), "cancelled");
  assert.equal(h.commit(run), null);
}

const structured = fs.readFileSync(new URL("../app/certificate-pdf-structured-reader-v3.jsx", import.meta.url), "utf8");
assert.match(structured, /const completion = createCertificatePdfCompletionContract\(ownership\)/);
assert.match(structured, /if \(!applyPatch\([\s\S]*?fallback\(runId, input,/);
assert.match(structured, /if \(!parsed\.strong\)[\s\S]*?fallback\(runId, input,/);
assert.match(structured, /catch \(error\)[\s\S]*?fallback\(runId, input,/);
assert.match(structured, /completion\.settle\(runId, "completed"\)/);
assert.match(structured, /completion\.invalidate\(\)/);

console.log("certificate PDF completion contract regression: PASS");
