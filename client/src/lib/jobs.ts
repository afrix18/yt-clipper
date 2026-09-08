import { API } from './api';

export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'interrupted';

export interface Job {
  id: string;
  kind: 'clip' | 'detect' | 'batch';
  label: string;
  status: JobStatus;
  percent: number;
  stage: string;
  result?: any;
  error?: string;
  childIds?: string[];
  createdAt: string;
  updatedAt: string;
}

async function postJson(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({} as any));
  if (!res.ok) {
    const err = new Error(data.error || 'Gagal memproses permintaan di server');
    (err as any).needsConfig = (data as any).needsConfig;
    throw err;
  }
  return data;
}

export async function startDetectJob(body: unknown): Promise<string> {
  const data = await postJson('/api/auto-detect', body);
  return data.jobId as string;
}

export async function startClipJob(body: unknown): Promise<string> {
  const data = await postJson('/api/clip', body);
  return data.jobId as string;
}

export async function startBatchJob(items: unknown[]): Promise<{ batchId: string; jobIds: string[] }> {
  const data = await postJson('/api/clip-batch', { items });
  return { batchId: data.batchId as string, jobIds: (data.jobIds || []) as string[] };
}

export async function fetchJobs(ids?: string[]): Promise<Job[]> {
  const qs = ids && ids.length > 0 ? `?ids=${encodeURIComponent(ids.join(','))}` : '';
  const res = await fetch(`${API}/api/jobs${qs}`);
  if (!res.ok) throw new Error('Gagal mengambil status tugas');
  const data = await res.json();
  return (data.jobs || []) as Job[];
}

export async function fetchJob(id: string): Promise<Job> {
  const res = await fetch(`${API}/api/jobs/${id}`);
  const data = await res.json().catch(() => ({} as any));
  if (!res.ok) throw new Error(data.error || 'Job tidak ditemukan');
  return data.job as Job;
}

/** Tunggu 1 job selesai via polling. Panggil onUpdate tiap status berubah. */
export async function waitForJob(
  id: string,
  onUpdate: (job: Job) => void,
  intervalMs = 2000,
): Promise<Job> {
  for (;;) {
    const job = await fetchJob(id);
    onUpdate(job);
    if (job.status === 'done') return job;
    if (job.status === 'error' || job.status === 'interrupted') {
      throw new Error(job.error || 'Tugas berhenti sebelum selesai');
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
