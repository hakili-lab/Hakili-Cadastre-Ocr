/**
 * components/LoadingScreen.tsx
 * Écran 3/4 : anneau de progression + ligne de statut + barre, avec deux
 * variantes selon que `progress` (page par page, PDF uniquement) est
 * disponible ou non — voir `ProgressRing`/`ProgressBar` plus bas pour le
 * détail de chaque variante. Gère aussi l'état d'erreur final (échec réseau
 * ou backend), avec un bouton pour revenir à l'écran de dépôt.
 */
import { useEffect, useState } from 'react';
import { TranscribeError, type TranscriptionProgress } from '../hooks/useTranscribe';
import { useApp } from '../context/AppContext';

interface LoadingScreenProps {
  isError: boolean;
  error: TranscribeError | null;
  /** Progression réelle page par page — fournie uniquement pour un PDF multi-pages. */
  progress: TranscriptionProgress | null;
}

// Étapes illustratives affichées en rotation — pas un vrai suivi du backend
// (la progression réelle, quand elle existe, s'affiche au centre de l'anneau).
const STEPS = [
  'Lecture des écritures…',
  'Repérage des tableaux…',
  'Vérification des formules…',
  'Mise en forme du texte…',
];

const STEP_INTERVAL_MS = 2500;
const STEP_FADE_MS = 300;

const RING_SIZE = 120;
const RING_STROKE = 6;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const BAR_WIDTH = 280;

/**
 * Reflète `prefers-reduced-motion`, avec écoute des changements à chaud. Ne
 * couvre que la rotation du texte de statut (pilotée par `setInterval`) — les
 * animations CSS (anneau, barre) sont déjà neutralisées par la règle globale
 * `@media (prefers-reduced-motion: reduce)` dans `index.css`.
 */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  useEffect(() => {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

export default function LoadingScreen({ isError, error, progress }: LoadingScreenProps) {
  const { dispatch } = useApp();
  const reducedMotion = usePrefersReducedMotion();
  const hasRealProgress = progress !== null && progress.pagesTotal > 0;

  const [stepIndex, setStepIndex] = useState(0);
  const [isStepVisible, setIsStepVisible] = useState(true);

  // Rotation des textes d'étape toutes les STEP_INTERVAL_MS, avec un fondu
  // sortant/entrant de STEP_FADE_MS de chaque côté du changement de texte.
  // Le double requestAnimationFrame force un repaint avec opacity:0 avant de
  // repasser à 1, pour que la transition CSS se rejoue à chaque cycle.
  useEffect(() => {
    if (reducedMotion) return;
    const interval = setInterval(() => {
      setIsStepVisible(false);
      window.setTimeout(() => {
        setStepIndex((prev) => (prev + 1) % STEPS.length);
        requestAnimationFrame(() => requestAnimationFrame(() => setIsStepVisible(true)));
      }, STEP_FADE_MS);
    }, STEP_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [reducedMotion]);

  if (isError && error) {
    return (
      <div className="w-full h-full bg-surface-sunken trame-points flex flex-col items-center justify-center gap-6">
        <div className="h-16 w-16 rounded-full bg-conf-low-soft flex items-center justify-center">
          <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="var(--color-conf-low)" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        </div>

        <div className="text-center">
          <h2 className="font-display font-normal text-2xl text-ink mb-2">Une erreur est survenue</h2>
          <p className="font-sans text-base text-ink-muted max-w-md">{error.message}</p>
        </div>

        <button
          type="button"
          onClick={() => dispatch({ type: 'NAVIGATE', screen: 'upload' })}
          className="h-12 px-6 rounded-sm border-0 bg-action text-surface font-sans font-medium text-base cursor-pointer"
        >
          Réessayer
        </button>
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-surface-sunken trame-points flex flex-col items-center justify-center gap-6 p-8">
      <ProgressRing hasRealProgress={hasRealProgress} progress={progress} />

      <div className="h-5 flex items-center justify-center">
        <span
          className="font-sans text-[13px] text-ink-muted"
          style={{
            opacity: isStepVisible ? 1 : 0,
            transition: `opacity ${STEP_FADE_MS}ms var(--ease-out-hk)`,
          }}
        >
          {STEPS[stepIndex]}
        </span>
      </div>

      <ProgressBar hasRealProgress={hasRealProgress} progress={progress} />
    </div>
  );
}

type ProgressRingProps = {
  hasRealProgress: boolean;
  progress: TranscriptionProgress | null;
};

/*
 * PDF : arc plein qui se remplit proportionnellement aux pages traitées, avec
 * le compteur réel au centre. Image seule (pas de fraction pertinente) : arc
 * partiel qui tourne indéfiniment (spinner), icône document au centre à la
 * place du chiffre. Le ralenti CSS global (@media prefers-reduced-motion,
 * index.css) fige déjà l'un et l'autre sans logique supplémentaire ici.
 */
function ProgressRing({ hasRealProgress, progress }: ProgressRingProps) {
  const fraction = hasRealProgress && progress ? Math.min(progress.pagesDone / progress.pagesTotal, 1) : 0;
  const dashOffset = RING_CIRCUMFERENCE * (1 - fraction);

  return (
    <div className="relative shrink-0" style={{ width: RING_SIZE, height: RING_SIZE }}>
      <svg
        width={RING_SIZE}
        height={RING_SIZE}
        viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
        className={hasRealProgress ? undefined : 'animate-loading-ring-spin'}
        style={hasRealProgress ? { transform: 'rotate(-90deg)', transformOrigin: '50% 50%' } : undefined}
      >
        <circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS} fill="none" stroke="var(--color-line)" strokeWidth={RING_STROKE} />
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          stroke="var(--color-action)"
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          strokeDasharray={hasRealProgress ? RING_CIRCUMFERENCE : `${RING_CIRCUMFERENCE * 0.25} ${RING_CIRCUMFERENCE}`}
          strokeDashoffset={hasRealProgress ? dashOffset : 0}
          style={hasRealProgress ? { transition: 'stroke-dashoffset 500ms var(--ease-out-hk)' } : undefined}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        {hasRealProgress && progress ? (
          <span className="font-mono text-[18px] tabular-nums text-ink">
            {progress.pagesDone}/{progress.pagesTotal}
          </span>
        ) : (
          <svg width="24" height="24" viewBox="0 0 40 40" fill="none" stroke="var(--color-ink-muted)" strokeWidth={1.5}>
            <path d="M10 4h14l6 6v24a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
            <path d="M24 4v6h6" />
            <line x1="12" y1="20" x2="26" y2="20" />
            <line x1="12" y1="25" x2="26" y2="25" />
            <line x1="12" y1="30" x2="20" y2="30" />
          </svg>
        )}
      </div>
    </div>
  );
}

type ProgressBarProps = {
  hasRealProgress: boolean;
  progress: TranscriptionProgress | null;
};

/*
 * PDF : remplissage proportionnel, en phase avec l'anneau. Image seule :
 * remplissage indéterminé, un segment qui balaie la piste de gauche à droite
 * puis revient (cf. keyframes hk-loading-bar-sweep, index.css), en boucle
 * jusqu'à la fin réelle du traitement.
 */
function ProgressBar({ hasRealProgress, progress }: ProgressBarProps) {
  if (hasRealProgress && progress) {
    const fraction = Math.min(progress.pagesDone / progress.pagesTotal, 1);
    return (
      <div className="h-[3px] rounded-full overflow-hidden bg-line" style={{ width: BAR_WIDTH }}>
        <div
          className="h-full bg-action"
          style={{ width: `${Math.round(fraction * 100)}%`, transition: 'width 500ms var(--ease-out-hk)' }}
        />
      </div>
    );
  }

  return (
    <div className="relative h-[3px] rounded-full overflow-hidden bg-line" style={{ width: BAR_WIDTH }}>
      <div className="absolute inset-y-0 w-[30%] bg-action rounded-full animate-loading-bar-sweep" />
    </div>
  );
}
