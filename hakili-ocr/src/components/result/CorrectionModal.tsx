/**
 * components/result/CorrectionModal.tsx
 * Modale de collecte de la description d'erreur, affichée après validation
 * d'une correction de contenu — voir `useCorrectionCapture` pour ce qui la
 * déclenche et envoie son résultat.
 */
import { useState } from 'react';

interface CorrectionModalProps {
  onSubmit: (errorDescription: string) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

/**
 * Modale de collecte de l'erreur affichée après validation d'une correction de
 * contenu (bloc simple ou cellule de tableau). Le champ est obligatoire : le
 * bouton Valider reste désactivé tant qu'il est vide.
 */
export function CorrectionModal({ onSubmit, onCancel, isSubmitting }: CorrectionModalProps) {
  const [errorDescription, setErrorDescription] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 backdrop-blur-sm animate-edit-fade">
      <div className="w-full max-w-md rounded-md bg-surface p-5 shadow-float mx-4">
        <h3 className="font-display font-normal text-lg text-ink mb-1">Aidez-nous à nous améliorer</h3>
        <p className="font-sans text-sm text-ink-muted mb-3">
          Quelle était l'erreur dans la transcription d'origine ?
        </p>
        <textarea
          autoFocus
          value={errorDescription}
          onChange={(e) => setErrorDescription(e.target.value)}
          rows={3}
          placeholder="Ex : chiffre mal reconnu, symbole manquant..."
          className="w-full rounded-sm border border-line-control p-2 font-sans text-sm text-ink outline-none focus:border-action resize-none"
        />
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-8 px-3 rounded-sm border border-line-control bg-transparent font-sans text-xs text-ink cursor-pointer"
          >
            Ignorer
          </button>
          <button
            type="button"
            disabled={!errorDescription.trim() || isSubmitting}
            onClick={() => onSubmit(errorDescription.trim())}
            className="h-8 px-3 rounded-sm border-0 bg-action text-surface font-sans text-xs font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Envoi…' : 'Valider'}
          </button>
        </div>
      </div>
    </div>
  );
}
