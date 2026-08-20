/**
 * components/UploadScreen.tsx
 * Écran 1/4 : point d'entrée drag-and-drop / sélecteur de fichier. Valide le
 * type et la taille côté client (miroir des mêmes limites côté backend,
 * `image_utils.py`) avant de dispatcher `SET_IMAGE`, qui bascule vers l'écran
 * d'aperçu (`PreviewScreen`) — jamais directement vers l'envoi.
 */
import { useCallback, useState } from 'react';
import { useApp } from '../context/AppContext';

const VALID_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg'];
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_PDF_SIZE = 500 * 1024 * 1024;

export default function UploadScreen() {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center px-6 py-8 sm:px-8 sm:py-12">
      <div className="w-full max-w-2xl flex flex-col gap-8 sm:gap-12">
        <div className="flex flex-col gap-2 text-center">
          <h1 className="font-display font-normal text-3xl leading-tight text-ink">
            Déposez une page.
          </h1>
          <p className="font-sans text-base text-ink-muted">
            Vous récupérez un texte propre.
          </p>
        </div>

        <UploadZone />

        <div className="flex flex-col gap-2">
          <div className="flex justify-center gap-2">
            {['MANUSCRIT', 'TABLEAUX', 'FORMULES'].map((label, i) => (
              <span
                key={label}
                className="inline-block font-sans font-medium text-[11px] tracking-[0.08em] text-ink-muted border border-line-control rounded-xs px-3 py-1 animate-tag-float"
                style={{ animationDelay: `${i * 0.35}s` }}
              >
                {label}
              </span>
            ))}
          </div>
          <div className="h-px bg-line w-full" />
        </div>
      </div>
    </div>
  );
}

/** Zone de dépôt/sélection : validation client-side puis `dispatch(SET_IMAGE)` ; affiche l'erreur inline plutôt qu'une alerte modale. */
function UploadZone() {
  const { dispatch } = useApp();
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const processFile = useCallback((file: File) => {
    const isPdf = file.type === 'application/pdf';
    const isImage = VALID_IMAGE_TYPES.includes(file.type);

    if (!isImage && !isPdf) {
      setError('Veuillez sélectionner une image (PNG, JPEG) ou un PDF.');
      return;
    }

    const maxSize = isPdf ? MAX_PDF_SIZE : MAX_IMAGE_SIZE;
    if (file.size > maxSize) {
      const sizeMo = Math.round(file.size / (1024 * 1024));
      const limitMo = isPdf ? '500' : '5';
      setError(
        `Ce ${isPdf ? 'PDF' : 'fichier'} fait ${sizeMo} Mo. La limite est de ${limitMo} Mo${isPdf ? ' — essayez de le scinder.' : '.'}`
      );
      return;
    }

    setError(null);
    const previewUrl = isImage ? URL.createObjectURL(file) : '';
    dispatch({ type: 'SET_IMAGE', file, previewUrl });
  }, [dispatch]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) processFile(files[0]);
  }, [processFile]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) processFile(files[0]);
    e.target.value = '';
  }, [processFile]);

  const hasError = error !== null;
  const iconColor = hasError
    ? 'var(--color-ink-subtle)'
    : isDragging
      ? 'var(--color-action)'
      : 'var(--color-ink-subtle)';

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        min-h-80 rounded-md flex items-center justify-center p-6 sm:p-8 box-border
        transition-colors duration-200
        ${hasError
          ? 'border-2 border-conf-low bg-surface trame-cahier'
          : isDragging
            ? 'border-2 border-action bg-action-soft'
            : 'border-2 border-dashed border-line-strong bg-surface trame-cahier'
        }
      `}
    >
      <input
        type="file"
        accept="image/png,image/jpeg,image/jpg,application/pdf"
        onChange={handleFileInput}
        className="hidden"
        id="file-input"
      />

      <label htmlFor="file-input" className="cursor-pointer flex flex-col items-center gap-4 text-center">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke={iconColor} strokeWidth={1.5}>
          <path d="M10 4h14l6 6v24a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
          <path d="M24 4v6h6" />
          <line x1="12" y1="20" x2="26" y2="20" />
          <line x1="12" y1="25" x2="26" y2="25" />
          <line x1="12" y1="30" x2="20" y2="30" />
        </svg>

        <p className="font-display font-normal text-xl leading-tight text-ink">
          {isDragging ? 'Déposez le fichier ici' : 'Glissez votre document ici'}
        </p>

        {hasError ? (
          <div className="flex items-start gap-1.5 text-left">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-conf-low)" strokeWidth={2} className="shrink-0 mt-0.5">
              <path d="M12 3 2 20h20L12 3z" strokeLinejoin="round" />
              <line x1="12" y1="10" x2="12" y2="14" />
              <circle cx="12" cy="17" r="0.8" fill="var(--color-conf-low)" stroke="none" />
            </svg>
            <p className="font-sans text-sm leading-tight text-ink">{error}</p>
          </div>
        ) : (
          <p className="font-sans text-sm text-ink-muted">
            PNG, JPEG ou PDF · 5 Mo max, 500 Mo pour un PDF
          </p>
        )}

        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            document.getElementById('file-input')?.click();
          }}
          className="h-10 px-4 rounded-sm border border-line-control bg-transparent text-ink font-sans font-medium text-base cursor-pointer"
        >
          Choisir un fichier
        </button>
      </label>
    </div>
  );
}
