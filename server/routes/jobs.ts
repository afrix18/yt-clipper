import { Router, Request, Response } from 'express';
import { getJob, listJobs } from '../lib/jobs';

export const jobsRouter = Router();

// ── GET /api/jobs?ids=a,b — daftar job (atau subset) ──
jobsRouter.get('/api/jobs', (req: Request, res: Response) => {
  const rawIds = req.query.ids as unknown as string | undefined;
  const ids = typeof rawIds === 'string' && rawIds
    ? (rawIds as string).split(',').map((s) => s.trim()).filter(Boolean)
    : undefined;
  res.json({ jobs: listJobs(ids) });
});

// ── GET /api/jobs/:id — status 1 job ──
jobsRouter.get('/api/jobs/:id', (req: Request, res: Response) => {
  const job = getJob(req.params.id as unknown as string);
  if (!job) return res.status(404).json({ error: 'Job tidak ditemukan' });
  res.json({ job });
});
