import * as fs from 'fs';
import * as path from 'path';
import { SERVER_DIR } from './paths';
import { generateId } from './proc';

// Job persisten: render/detect berjalan di background server, sehingga
// extension side panel boleh ditutup kapan pun — progres + hasil tetap
// bisa diambil lagi lewat GET /api/jobs/:id setelah panel dibuka ulang.

export type JobKind = 'clip' | 'detect' | 'batch';
export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'interrupted';

export interface Job {
  id: string;
  kind: JobKind;
  label: string;
  status: JobStatus;
  percent: number;
  stage: string;
  result?: unknown;
  error?: string;
  childIds?: string[];
  createdAt: string;
  updatedAt: string;
}

const JOBS_FILE = path.join(SERVER_DIR, 'jobs.json');
const MAX_JOBS = 50;

function loadAll(): Job[] {
  if (!fs.existsSync(JOBS_FILE)) return [];
  try {
    const arr = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8')) as Job[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveAll(jobs: Job[]): void {
  try {
    fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs.slice(0, MAX_JOBS), null, 2));
  } catch { /* ignore */ }
}

export function createJob(kind: JobKind, label: string, childIds?: string[]): Job {
  const now = new Date().toISOString();
  const job: Job = {
    id: generateId(),
    kind,
    label: String(label || kind).slice(0, 120),
    status: 'queued',
    percent: 0,
    stage: 'Menunggu antrean...',
    childIds,
    createdAt: now,
    updatedAt: now,
  };
  const jobs = loadAll();
  jobs.unshift(job);
  saveAll(jobs);
  return job;
}

export function updateJob(id: string, patch: Partial<Pick<Job, 'status' | 'percent' | 'stage' | 'result' | 'error'>>): Job | null {
  const jobs = loadAll();
  const job = jobs.find((j) => j.id === id);
  if (!job) return null;
  if (patch.status !== undefined) job.status = patch.status;
  if (patch.percent !== undefined) job.percent = Math.max(0, Math.min(100, Math.round(patch.percent)));
  if (patch.stage !== undefined) job.stage = String(patch.stage);
  if (patch.result !== undefined) job.result = patch.result;
  if (patch.error !== undefined) job.error = String(patch.error);
  job.updatedAt = new Date().toISOString();
  saveAll(jobs);
  return job;
}

export function getJob(id: string): Job | null {
  return loadAll().find((j) => j.id === id) || null;
}

export function listJobs(ids?: string[]): Job[] {
  const jobs = loadAll();
  if (ids && ids.length > 0) {
    const set = new Set(ids);
    return jobs.filter((j) => set.has(j.id));
  }
  return jobs;
}

/** Tandai job yang yatim (server restart saat running) agar tidak gantung. */
export function markOrphanedJobs(): number {
  const jobs = loadAll();
  let n = 0;
  for (const j of jobs) {
    if (j.status === 'queued' || j.status === 'running') {
      j.status = 'interrupted';
      j.stage = 'Terputus (server restart). Ulangi tugas ini.';
      j.updatedAt = new Date().toISOString();
      n++;
    }
  }
  if (n > 0) saveAll(jobs);
  return n;
}

export function progressReporter(jobId: string): (percent: number, stage: string) => void {
  return (percent: number, stage: string) => {
    try {
      updateJob(jobId, { status: 'running', percent, stage });
    } catch { /* ignore */ }
  };
}
