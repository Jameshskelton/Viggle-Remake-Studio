import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { JobRecord } from "../lib/types.ts";

const dir = await mkdtemp(path.join(os.tmpdir(), "viggle-jobs-"));
process.env.DATA_DIR = dir;
const jobDir = path.join(dir, "jobs");
const { getJob, listJobs, outputUrlFor, runFinalization, saveJob } = await import("../lib/jobs.ts");

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

function job(id: string, createdAt: number, extra: Partial<JobRecord> = {}): JobRecord {
  return {
    id,
    kind: "render",
    mode: "swap",
    createdAt,
    status: "queued",
    error: null,
    assetId: "asset",
    start: 0,
    frames: 90,
    ...extra,
  };
}

test("round-trips a job without leaving temp files", async () => {
  const record = job("11111111-1111-4111-8111-111111111111", 1_000, { prompt: "hello" });
  await saveJob(record);
  assert.deepEqual(await getJob(record.id), record);

  const files = await readdir(jobDir);
  assert.ok(files.includes(`${record.id}.json`));
  assert.equal(files.some((file) => file.endsWith(".tmp")), false);
});

test("rejects path-like job ids", async () => {
  assert.equal(await getJob("../../etc/passwd"), null);
  assert.equal(await getJob("not-an-id"), null);
});

test("lists the newest jobs first and honours the limit", async () => {
  await saveJob(job("22222222-2222-4222-8222-222222222222", 10_000));
  await saveJob(job("33333333-3333-4333-8333-333333333333", 30_000));
  await saveJob(job("44444444-4444-4444-8444-444444444444", 20_000));

  assert.deepEqual((await listJobs(2)).map((entry) => entry.createdAt), [30_000, 20_000]);
  assert.deepEqual((await listJobs(3)).map((entry) => entry.createdAt), [30_000, 20_000, 10_000]);
  assert.equal((await listJobs(100)).length, 4);
});

test("prefers the archived result over the raw ComfyUI output", () => {
  assert.equal(
    outputUrlFor(job("55555555-5555-4555-8555-555555555555", 0, { resultAssetId: "asset-1", output: { filename: "v.mp4", subfolder: "", type: "output" } })),
    "/api/assets/asset-1/file",
  );
  assert.equal(
    outputUrlFor(job("66666666-6666-4666-8666-666666666666", 0, { output: { filename: "v.mp4", subfolder: "", type: "output" } })),
    "/api/jobs/66666666-6666-4666-8666-666666666666/output",
  );
  assert.equal(outputUrlFor(job("77777777-7777-4777-8777-777777777777", 0)), undefined);
});

test("runs a finalization once for concurrent readers and again afterwards", async () => {
  let calls = 0;
  const work = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
  };

  await Promise.all([
    runFinalization("shared", work),
    runFinalization("shared", work),
    runFinalization("shared", work),
  ]);
  assert.equal(calls, 1);

  await runFinalization("shared", work);
  assert.equal(calls, 2);
});
