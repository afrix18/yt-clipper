export const parseTime = (t: string): number => {
  if (t.includes(':')) {
    const parts = t.split(':');
    const mins = parseInt(parts[0], 10);
    const secs = parseInt(parts[1] || '0', 10);
    if (isNaN(mins) || isNaN(secs)) return NaN;
    return mins * 60 + secs;
  }
  return parseFloat(t);
};

export const formatSec = (sec: number): string => {
  if (isNaN(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

export const formatDate = (iso: string): string => {
  const d = new Date(iso);
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

export const formatScheduleDisplay = (isoStr: string): string => {
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return isoStr;
  }
};

/** Format Date ke "YYYY-MM-DDTHH:mm" WAKTU LOKAL (untuk input datetime-local).
 * Jangan pakai toISOString (UTC) — menggeser jam sesuai zona waktu. */
export const toLocalInputValue = (d: Date): string => {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
