import type { JobsApi } from '../hooks/useJobs';

/** Banner tugas server yang tetap berjalan walau panel sempat ditutup. */
export function JobsBanner({ jobsApi, onGoMoments, onGoClips }: {
  jobsApi: JobsApi;
  onGoMoments: () => void;
  onGoClips: () => void;
}) {
  const { active } = jobsApi;
  if (active.length === 0) return null;
  return (
    <div className="jobs-banner" role="status">
      {active.slice(0, 3).map(j => (
        <button
          key={j.id}
          type="button"
          className="jobs-banner-row"
          onClick={() => (j.kind === 'detect' ? onGoMoments() : onGoClips())}
          title="Lihat halaman terkait"
        >
          <span className="jobs-banner-label">{j.label}</span>
          <span className="jobs-banner-stage">{j.stage}</span>
          <span className="jobs-banner-pct">{j.percent}%</span>
          <span className="jobs-banner-bar"><span style={{ width: `${Math.max(4, j.percent)}%` }} /></span>
        </button>
      ))}
      {active.length > 3 && (
        <div className="jobs-banner-more">+{active.length - 3} tugas lain berjalan</div>
      )}
    </div>
  );
}
