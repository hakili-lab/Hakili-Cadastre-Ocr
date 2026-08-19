/**
 * correctionsApi.ts
 * Envoie une correction (image croppée + texte avant/après + description de
 * l'erreur) au backend, pour constituer le jeu de données de corrections.
 */
import { fetchApi } from './apiClient';

/** Instantané figé par `useCorrectionCapture` + description d'erreur saisie dans `CorrectionModal`. */
export interface SubmitCorrectionParams {
  image: Blob;
  blockLabel: string;
  confidence: number;
  originalMarkdown: string;
  correctedMarkdown: string;
  errorDescription: string;
}

interface CorrectionResponse {
  id: string;
}

/** POST /corrections (multipart) : renvoie l'id de la ligne créée en base côté backend. */
export async function submitCorrection(params: SubmitCorrectionParams): Promise<string> {
  const formData = new FormData();
  formData.append('image', params.image, 'correction.png');
  formData.append('block_label', params.blockLabel);
  formData.append('confidence', String(params.confidence));
  formData.append('original_markdown', params.originalMarkdown);
  formData.append('corrected_markdown', params.correctedMarkdown);
  formData.append('error_description', params.errorDescription);

  const data = await fetchApi<CorrectionResponse>('/corrections', { method: 'POST', body: formData });
  return data.id;
}
