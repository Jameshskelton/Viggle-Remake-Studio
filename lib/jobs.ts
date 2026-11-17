import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { JOB_DIR } from "./config.ts";
import type { JobRecord } from "./types.ts";

export function jobFile(id: string) {
  return path.join(JOB_DIR, `${id}.json`);
}

export async function saveJob(job: JobRecord) {
  await mkdir(JOB_DIR, { recursive: true });
  const file = jobFile(job.id);
  const temp = path.join(/* turbopackIgnore: true */ JOB_DIR, `${job.id}.${randomUUID()}.tmp`);
  await writeFile(temp, JSON.stringify(job, null, 2));
  try {
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

export async function getJob(id: string): Promise<JobRecord | null> {
  if (!/^[a-f0-9-]{36}$/i.test(id) && !/^[a-f0-9]{8}$/i.test(id)) return null;
  try {
    return JSON.parse(await readFile(jobFile(id), "utf8")) as JobRecord;
  } catch {
    return null;
  }
}

export async function listJobs(limit = 60): Promise<JobRecord[]> {
  try {
    const files = await readdir(JOB_DIR);
    const jobs: JobRecord[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        jobs.push(JSON.parse(await readFile(path.join(JOB_DIR, file), "utf8")) as JobRecord);
      } catch {
        // skip unreadable records
      }
    }
    return jobs.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  } catch {
    return [];
  }
}

export function outputUrlFor(job: JobRecord) {
  if (job.resultAssetId) return `/api/assets/${job.resultAssetId}/file`;
  if (job.output) return `/api/jobs/${job.id}/output`;
  return undefined;
}

const finalizations = new Map<string, Promise<void>>();

export function runFinalization(id: string, work: () => Promise<void>) {
  const existing = finalizations.get(id);
  if (existing) return existing;
  const task = work().finally(() => finalizations.delete(id));
  finalizations.set(id, task);
  return task;
}
