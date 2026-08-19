/**
 * components/PreviewScreen.tsx
 * Écran 2/4 : aperçu avant envoi, avec rotation optionnelle par 90° avant de
 * transcrire. Pour un PDF, chaque page peut avoir sa propre rotation
 * (`rotations: Record<pageIndex, RotationAngle>`, état local — pas dans
 * `AppState`). La rotation n'affecte l'aperçu que visuellement (CSS
 * `transform`) ; `applyRotation` (`utils/fileTransform.ts`) ne réécrit le
 * fichier réel qu'au clic sur "Transcrire le document".
 */
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, SyntheticEvent } from 'react';
import { useApp } from '../context/AppContext';
import { usePdfPreview } from '../hooks/usePdfPreview';
import { applyRotation, type RotationAngle } from '../utils/fileTransform';

const PREVIEW_HEIGHT = 680;

type RotationScope = 'current' | 'all';

export default function PreviewScreen() {
  const { state, dispatch } = useApp();
  const { uploadedImage, imagePreviewUrl } = state;

  const isPdf = uploadedImage?.type === 'application/pdf';
  const { pages: pdfPages, isLoading: isPdfLoading, error: pdfError } = usePdfPreview(
    isPdf ? uploadedImage : null
  );

  const [rotations, setRotations] = useState<Record<number, RotationAngle>>({});
  const [pageIndex, setPageIndex] = useState(0);
  const [rotationScope, setRotationScope] = useState<RotationScope>('current');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const rotation = rotations[pageIndex] ?? 0;
  const currentSrc = isPdf ? pdfPages[pageIndex] : imagePreviewUrl;
  const isRotated = rotation === 90 || rotation === 270;

  const canGoPrev = isPdf && pageIndex > 0;
  const canGoNext = isPdf && pageIndex < pdfPages.length - 1;

  // Mesure de l'espace disponible (la boîte moins son padding) en JS plutôt qu'en
  // CSS pur : un pourcentage en max-height ne peut référencer que la hauteur du
  // conteneur, jamais sa largeur — insuffisant pour une image pivotée à 90°/270°,
  // où c'est justement la largeur du conteneur qui doit borner sa hauteur avant
  // rotation (les axes sont inversés visuellement par le transform, pas par la
  // boîte CSS). Mesurer en pixels réels permet un calcul d'échelle correct dans
  // les deux cas, et garantit que l'image ne dépasse jamais la boîte.
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  // La taille naturelle porte la src pour laquelle elle a été mesurée : évite de
  // dépendre d'un `useEffect(() => setNaturalSize(null), [currentSrc])` séparé
  // pour "l'oublier" au changement de src, qui entrait en course avec l'`onLoad`
  // ci-dessous (rien ne garantit qu'un effet se déclenche avant/après un
  // événement DOM comme `load` — quand l'effet perdait la course, il écrasait la
  // vraie valeur tout juste posée par `onLoad`, laissant l'image invisible en
  // permanence malgré un chargement réussi).
  const [naturalSize, setNaturalSize] = useState<{ src: string; width: number; height: number } | null>(null);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleImageLoad = (e: SyntheticEvent<HTMLImageElement>) => {
    setNaturalSize({
      src: currentSrc ?? '',
      width: e.currentTarget.naturalWidth,
      height: e.currentTarget.naturalHeight,
    });
  };

  const naturalSizeForCurrentSrc = naturalSize?.src === currentSrc ? naturalSize : null;

  let imageStyle: CSSProperties = { visibility: 'hidden' };
  if (naturalSizeForCurrentSrc && stageSize.width > 0 && stageSize.height > 0) {
    const availWidth = isRotated ? stageSize.height : stageSize.width;
    const availHeight = isRotated ? stageSize.width : stageSize.height;
    const scale = Math.min(availWidth / naturalSizeForCurrentSrc.width, availHeight / naturalSizeForCurrentSrc.height);
    imageStyle = {
      width: naturalSizeForCurrentSrc.width * scale,
      height: naturalSizeForCurrentSrc.height * scale,
      transform: `rotate(${rotation}deg)`,
      transition: 'transform 0.2s ease, width 0.2s ease, height 0.2s ease',
    };
  }

  if (!uploadedImage) return null;

  /** Pivote la page courante de +90°, ou toutes les pages si `rotationScope === 'all'` (PDF multi-pages uniquement). */
  const handleRotate = () => {
    if (isPdf && rotationScope === 'all') {
      setRotations((prev) => {
        const next: Record<number, RotationAngle> = { ...prev };
        for (let i = 0; i < pdfPages.length; i++) {
          next[i] = (((prev[i] ?? 0) + 90) % 360) as RotationAngle;
        }
        return next;
      });
      return;
    }
    setRotations((prev) => ({
      ...prev,
      [pageIndex]: (((prev[pageIndex] ?? 0) + 90) % 360) as RotationAngle,
    }));
  };

  /** Applique la rotation au fichier réel puis dispatch `CONFIRM_UPLOAD` — bascule vers l'écran de chargement. */
  const handleConfirm = async () => {
    setIsSubmitting(true);
    try {
      const finalFile = await applyRotation(
        uploadedImage,
        isPdf ? rotations : rotation,
        Boolean(isPdf)
      );
      dispatch({
        type: 'CONFIRM_UPLOAD',
        file: finalFile,
        previewUrl: isPdf ? pdfPages[0] : undefined,
      });
    } catch {
      setIsSubmitting(false);
      alert("Impossible d'appliquer la rotation à ce fichier. Réessayez ou envoyez-le sans rotation.");
    }
  };

  const fileLabel =
    isPdf && pdfPages.length > 0
      ? `${uploadedImage.name} · ${pdfPages.length} pages`
      : uploadedImage.name;

  return (
    <div className="w-full h-full bg-surface-sunken trame-points flex flex-col items-center justify-center gap-6 sm:gap-8 p-6 sm:p-8 overflow-auto">
      <span className="font-sans text-sm text-ink-muted">{fileLabel}</span>

      <div
        className="relative w-full max-w-xl bg-surface rounded-sm shadow-raise overflow-hidden"
        style={{ height: PREVIEW_HEIGHT }}
      >
        {isPdf && isPdfLoading && (
          <p className="text-ink-muted text-sm absolute inset-0 flex items-center justify-center">Chargement de l'aperçu du PDF...</p>
        )}

        {isPdf && pdfError && (
          <p className="text-conf-low text-sm px-6 text-center absolute inset-0 flex items-center justify-center">{pdfError}</p>
        )}

        <div ref={stageRef} className="absolute inset-4 flex items-center justify-center">
          {currentSrc && (
            <img src={currentSrc} alt="Aperçu du document" onLoad={handleImageLoad} style={imageStyle} />
          )}
        </div>
      </div>

      {/* Sélecteur de portée + rotation/navigation + envoi : sur une seule ligne pour laisser plus de hauteur à l'aperçu */}
      <div className="flex items-center justify-center gap-3 flex-wrap shrink-0">
        {isPdf && pdfPages.length > 1 && (
          <div className="inline-flex bg-surface border border-line-strong rounded-full p-0.75 shadow-raise">
            <button
              type="button"
              onClick={() => setRotationScope('current')}
              className={`h-7 px-3.5 flex items-center rounded-full font-sans font-medium text-sm cursor-pointer border-0 ${
                rotationScope === 'current' ? 'bg-action-soft text-action' : 'bg-transparent text-ink-muted'
              }`}
            >
              Cette page
            </button>
            <button
              type="button"
              onClick={() => setRotationScope('all')}
              className={`h-7 px-3.5 flex items-center rounded-full font-sans font-medium text-sm cursor-pointer border-0 ${
                rotationScope === 'all' ? 'bg-action-soft text-action' : 'bg-transparent text-ink-muted'
              }`}
            >
              Toutes les pages
            </button>
          </div>
        )}

        <div className="flex items-center gap-1 bg-surface rounded-full shadow-float p-1.5">
          <button
            type="button"
            onClick={handleRotate}
            title="Pivoter de 90°"
            className="h-8 w-8 flex items-center justify-center rounded-sm cursor-pointer bg-transparent border-0"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-ink-secondary)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-3-6.7" />
              <path d="M21 4v4h-4" />
            </svg>
          </button>

          {isPdf && pdfPages.length > 1 && (
            <>
              <span className="w-px h-5 bg-line mx-1" />
              <button
                type="button"
                onClick={() => setPageIndex((p) => p - 1)}
                disabled={!canGoPrev}
                className="flex items-center justify-center cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed bg-transparent border-0 px-2"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-ink-secondary)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
              <span className="font-mono text-sm text-ink-secondary">
                {pageIndex + 1} / {pdfPages.length}
              </span>
              <button
                type="button"
                onClick={() => setPageIndex((p) => p + 1)}
                disabled={!canGoNext}
                className="flex items-center justify-center cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed bg-transparent border-0 px-2"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-ink-secondary)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </button>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={handleConfirm}
          disabled={isSubmitting || (isPdf && isPdfLoading)}
          className="h-12 px-6 rounded-sm border-0 bg-action text-surface font-sans font-medium text-base cursor-pointer disabled:opacity-50"
        >
          {isSubmitting ? 'Préparation...' : 'Transcrire le document'}
        </button>
      </div>
    </div>
  );
}
