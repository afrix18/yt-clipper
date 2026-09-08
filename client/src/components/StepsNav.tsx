import type { Step } from '../types';

const STEPS: { id: Step; n: number; label: string }[] = [
  { id: 'video', n: 1, label: 'Video' },
  { id: 'moments', n: 2, label: 'Momen' },
  { id: 'clips', n: 3, label: 'Klip Saya' },
  { id: 'publish', n: 4, label: 'Publikasi' },
];

interface StepsNavProps {
  step: Step;
  onGo: (s: Step) => void;
  momentsCount: number;
  clipsCount: number;
}

export function StepsNav({ step, onGo, momentsCount, clipsCount }: StepsNavProps) {
  const activeIdx = STEPS.findIndex(s => s.id === step);
  return (
    <nav className="steps-nav" aria-label="Langkah">
      {STEPS.map((s) => {
        const badge = s.id === 'moments' && momentsCount > 0
          ? ` (${momentsCount})`
          : s.id === 'clips' && clipsCount > 0
            ? ` (${clipsCount})`
            : '';
        return (
          <button
            key={s.id}
            type="button"
            className={`step-item ${s.id === step ? 'active' : ''} ${STEPS.findIndex(x => x.id === s.id) < activeIdx ? 'done' : ''}`}
            onClick={() => onGo(s.id)}
          >
            <span className="step-num">{s.n}</span>
            <span className="step-label">{s.label}{badge}</span>
          </button>
        );
      })}
    </nav>
  );
}
