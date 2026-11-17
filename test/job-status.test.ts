import test from "node:test";
import assert from "node:assert/strict";
import { resolveJobStatus, type JobStatusInput } from "../lib/job-status.ts";
import type { HistoryEntry } from "../lib/comfy.ts";

const base: JobStatusInput = {
  storedStatus: "running",
  createdAt: 1_000,
  entry: null,
  running: false,
  pendingIndex: -1,
  historyError: false,
  queueError: false,
  now: 2_000,
};

function resolve(overrides: Partial<JobStatusInput>) {
  return resolveJobStatus({ ...base, ...overrides });
}

const success: HistoryEntry = {
  status: { status_str: "success", completed: true, messages: [] },
};

const failure: HistoryEntry = {
  status: {
    status_str: "error",
    completed: true,
    messages: [["execution_error", { node_type: "KSampler", exception_message: "boom" }]],
  },
};

test("retries when ComfyUI cannot be reached at all", () => {
  const result = resolve({ historyError: true, queueError: true });
  assert.deepEqual(result, { kind: "retry", error: "ComfyUI is not reachable." });
});

test("retries instead of failing when history is briefly unavailable", () => {
  assert.equal(resolve({ historyError: true }).kind, "retry");
});

test("does not retry while the queue still knows the job", () => {
  assert.deepEqual(resolve({ historyError: true, running: true }), {
    kind: "status",
    status: "running",
    error: null,
    queuePosition: null,
  });
  assert.deepEqual(resolve({ historyError: true, pendingIndex: 2 }), {
    kind: "status",
    status: "queued",
    error: null,
    queuePosition: 3,
  });
});

test("reports completed success and failure", () => {
  assert.deepEqual(resolve({ entry: success }), {
    kind: "status",
    status: "succeeded",
    error: null,
    queuePosition: null,
  });
  assert.deepEqual(resolve({ entry: failure }), {
    kind: "status",
    status: "failed",
    error: "KSampler: boom",
    queuePosition: null,
  });
});

test("marks a non-completed error entry as failed", () => {
  const entry: HistoryEntry = { status: { status_str: "error", completed: false } };
  const result = resolve({ entry });
  assert.equal(result.kind, "status");
  if (result.kind === "status") {
    assert.equal(result.status, "failed");
    assert.equal(result.error, "ComfyUI could not run this workflow.");
  }
});

test("uses the queue before the stored status", () => {
  assert.equal(resolve({ running: true, storedStatus: "queued" }).kind, "status");
  const running = resolve({ running: true, storedStatus: "queued" });
  assert.deepEqual(running, { kind: "status", status: "running", error: null, queuePosition: null });
});

test("keeps the stored status when the queue is unavailable", () => {
  const result = resolve({ queueError: true, storedStatus: "running" });
  assert.deepEqual(result, { kind: "status", status: "running", error: null, queuePosition: null });
});

test("a missing job is queued when new and failed when stale", () => {
  assert.deepEqual(resolve({ now: 10_000 }), {
    kind: "status",
    status: "queued",
    error: null,
    queuePosition: null,
  });
  const stale = resolve({ now: 40_000 });
  assert.equal(stale.kind, "status");
  if (stale.kind === "status") {
    assert.equal(stale.status, "failed");
    assert.match(stale.error ?? "", /no longer has this job/);
  }
});

test("an entry that is still present without queue state keeps the stored status", () => {
  const entry: HistoryEntry = { status: { status_str: "success", completed: false } };
  const result = resolve({ entry, storedStatus: "queued" });
  assert.deepEqual(result, { kind: "status", status: "queued", error: null, queuePosition: null });
});
