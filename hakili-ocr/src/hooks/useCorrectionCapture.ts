/**
 * hooks/useCorrectionCapture.ts
 * Constitue le jeu de données de corrections (écran Résultat) : capture un
 * instantané bloc/bbox/image au moment où une édition de contenu est validée,
 * puis l'envoie via `POST /corrections` une fois la modale de description
 * d'erreur validée. Voir `useCorrectionCapture` plus bas.
 */
import { useCallback, useState } from 'react';
import type { BoundingBox, TranscriptionBlock } from '../types';
import { cropImageToBlob } from '../utils/cropImage';
import { submitCorrection } from '../services/correctionsApi';

/** Instantané figé au moment de la validation d'une édition — capturé avant l'ouverture de la modale. */
interface PendingCorrection {
  blockId: number;
  blockLabel: string;
  confidence: number;
  bbox: BoundingBox;
  imageSrc: string;
  originalMarkdown: string;
  correctedMarkdown: string;
}

type UseCorrectionCaptureOptions = {
  imagePreviewUrl: string | null;
};

/**
 * Capture un instantané complet (bloc/bbox/image source) au moment de la
 * confirmation d'une édition, pour que le crop (différé jusqu'à la validation de
 * la modale) reste correct même si l'utilisateur change de page PDF pendant que
 * la modale est ouverte. Ne se déclenche jamais sur un déplacement de bbox seul
 * (pas de paire texte avant/après à documenter) ni sur une validation sans
 * changement réel du texte.
 */
export function useCorrectionCapture({ imagePreviewUrl }: UseCorrectionCaptureOptions) {
  const [pendingCorrection, setPendingCorrection] = useState<PendingCorrection | null>(null);
  const [isSubmittingCorrection, setIsSubmittingCorrection] = useState(false);

  const captureCorrection = useCallback(
    (block: TranscriptionBlock, correctedMarkdown: string) => {
      if (!imagePreviewUrl || correctedMarkdown === block.markdown) return;
      setPendingCorrection({
        blockId: block.id,
        blockLabel: block.label,
        confidence: block.confidence,
        bbox: block.bbox,
        imageSrc: imagePreviewUrl,
        originalMarkdown: block.markdown,
        correctedMarkdown,
      });
    },
    [imagePreviewUrl]
  );

  const handleCancelCorrection = useCallback(() => setPendingCorrection(null), []);

  const handleSubmitCorrection = useCallback(
    async (errorDescription: string) => {
      if (!pendingCorrection) return;
      setIsSubmittingCorrection(true);
      try {
        const imageBlob = await cropImageToBlob(pendingCorrection.imageSrc, pendingCorrection.bbox);
        await submitCorrection({
          image: imageBlob,
          blockLabel: pendingCorrection.blockLabel,
          confidence: pendingCorrection.confidence,
          originalMarkdown: pendingCorrection.originalMarkdown,
          correctedMarkdown: pendingCorrection.correctedMarkdown,
          errorDescription,
        });
      } catch (err) {
        console.error("Échec de l'enregistrement de la correction :", err);
      } finally {
        setIsSubmittingCorrection(false);
        setPendingCorrection(null);
      }
    },
    [pendingCorrection]
  );

  return {
    pendingCorrection,
    isSubmittingCorrection,
    captureCorrection,
    handleCancelCorrection,
    handleSubmitCorrection,
  };
}
