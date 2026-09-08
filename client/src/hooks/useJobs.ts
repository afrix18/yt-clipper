import { useEffect, useState } from 'react';
import { fetchJobs } from '../lib/jobs';
import type { Job } from '../lib/jobs';
import { getTrackedJobIds, subscribeTracked } from '../lib/jobTracker';

/** Polling status tugas server. Hidup kembali otomatis setiap panel dibuka. */
export function useJobs(pollMs = 3000) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [trackedVersion, setTrackedVersion] = useState(0);

  useEffect(() => subscribeTracked(() => setTrackedVersion(v => v + 1)), []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const ids = getTrackedJobIds();
        const list = await fetchJobs(ids.length > 0 ? ids : undefined);
        if (!alive) return;
        // Bila ada yang dilacak, gabung: yang dilacak + 5 terbaru server.
        if (ids.length > 0) {
          const set = new Set(ids);
          const trackedJobs = list.filter(j => set.has(j.id));
          const recent = list.filter(j => !set.has(j.id)).slice(0, 5);
          setJobs([...trackedJobs, ...recent]);
        } else {
          setJobs(list.slice(0, 8));
        }
      } catch { /* server mungkin mati — banner cukup hilang */ }
    };
    load();
    const t = setInterval(load, pollMs);
    return () => { alive = false; clearInterval(t); };
  }, [pollMs, trackedVersion]);

  const active = jobs.filter(j => j.status === 'queued' || j.status === 'running');
  return { jobs, active };
}

export type JobsApi = ReturnType<typeof useJobs>;
