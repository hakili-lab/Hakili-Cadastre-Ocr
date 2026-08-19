/**
 * hooks/useTranscribe.ts
 * Point d'entrée réseau pour lancer une transcription et en suivre l'état,
 * normalisant les deux flux backend (image synchrone vs PDF asynchrone par
 * job) derrière une seule forme de retour (`UseTranscriptionResult`) — voir
 * `useTranscription` plus bas. Inclut aussi un mode mock (`USE_MOCK`) pour
 * développer l'UI sans backend ni clé API Anthropic.
 */
import { useCallback, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type {
  ApiResponse,
  TranscriptionResult,
  PDFTranscriptionResult,
  TranscriptionPayload,
  PdfJobStartResponse,
  PdfJobStatusResponse,
} from '../types';
import { fetchApi, TranscribeError } from '../services/apiClient';

export { TranscribeError };

const USE_MOCK = false // Mettre à true pour utiliser les données factices ci-dessous
const MOCK_DELAY_MS = 3000;
const PDF_POLL_INTERVAL_MS = 8000;

// === MOCK DATA (mode démo, sans backend) ===
const MOCK_RESULT: TranscriptionResult = {
  blocks: [
    {
      id: 1,
      label: 'Exercice 1 - Énoncé',
      markdown: '**Soit** $f$ la fonction définie sur $\\mathbb{R}$ et dont la courbe est donnée ci-dessous :',
      bbox: { x_min: 0.05, y_min: 0.05, x_max: 0.95, y_max: 0.12 },
      confidence: 96,
    },
    {
      id: 2,
      label: 'Exercice 1a',
      markdown: '**a)** Résoudre graphiquement $f(x) = 1$',
      bbox: { x_min: 0.05, y_min: 0.45, x_max: 0.55, y_max: 0.52 },
      confidence: 92,
    },
  ],
  final_warning: 'Transcription partiellement fiable. Vérifiez les blocs marqués en rouge (confidence < 70%).',
};

const MOCK_PDF_RESULT: PDFTranscriptionResult = {
  pages: [
    { page_number: 1, image_b64: '', media_type: 'image/png', width: 800, height: 1100, ocr: MOCK_RESULT },
    {
      page_number: 2,
      image_b64: '',
      media_type: 'image/png',
      width: 800,
      height: 1100,
      ocr: {
        blocks: [
          {
            id: 1,
            label: 'Exercice 4',
            markdown: '$$\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1$$',
            bbox: { x_min: 0.1, y_min: 0.1, x_max: 0.5, y_max: 0.2 },
            confidence: 94,
          },
        ],
        final_warning: undefined,
      },
    },
  ],
  final_warning: undefined,
};

/** Simule une transcription (image ou PDF) avec un délai fixe, pour le mode `USE_MOCK`. */
function mockTranscribe(isPdf: boolean): Promise<TranscriptionPayload> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(isPdf ? MOCK_PDF_RESULT : MOCK_RESULT), MOCK_DELAY_MS);
  });
}

// === Appels réels ===

/** POST /transcribe : transcription synchrone d'une image simple, résultat direct. */
async function transcribeImage(file: File): Promise<TranscriptionResult> {
  const formData = new FormData();
  formData.append('file', file);

  const data = await fetchApi<ApiResponse>('/transcribe', { method: 'POST', body: formData });
  if (!data.success) {
    throw new TranscribeError('Le backend a retourné success=false sans détail.', 200, false);
  }
  if (data.result.final_warning === null) data.result.final_warning = undefined;
  return data.result;
}

/** POST /transcribe/pdf/start : démarre le job côté backend et retourne immédiatement son `job_id`. */
async function startPdfJob(file: File): Promise<PdfJobStartResponse> {
  const formData = new FormData();
  formData.append('file', file);
  return fetchApi<PdfJobStartResponse>('/transcribe/pdf/start', { method: 'POST', body: formData });
}

/** GET /transcribe/pdf/status/{jobId} : un point de polling, appelé en boucle par `useQuery` ci-dessous. */
async function fetchPdfJobStatus(jobId: string): Promise<PdfJobStatusResponse> {
  return fetchApi<PdfJobStatusResponse>(`/transcribe/pdf/status/${jobId}`);
}

/** Progression réelle page par page d'un job PDF, telle qu'exposée par `UseTranscriptionResult.progress`. */
export interface TranscriptionProgress {
  pagesDone: number;
  pagesTotal: number;
}

/** Forme de retour normalisée de `useTranscription`, identique que le fichier envoyé soit une image ou un PDF. */
export interface UseTranscriptionResult {
  start: (file: File) => void;
  isPending: boolean;
  isError: boolean;
  error: TranscribeError | null;
  /** Progression réelle (page par page), uniquement disponible pour un PDF multi-pages. */
  progress: TranscriptionProgress | null;
  data: TranscriptionPayload | null;
}

/**
 * Point d'entrée unique pour lancer une transcription (image ou PDF) et suivre son état.
 * - Image : un seul appel, résultat direct.
 * - PDF : POST /pdf/start (retourne un job_id) puis polling de /pdf/status/{job_id}
 *   jusqu'à ce que le traitement (page par page côté backend) soit terminé.
 */
export function useTranscription(): UseTranscriptionResult {
  const [pdfJobId, setPdfJobId] = useState<string | null>(null);

  const imageMutation = useMutation<TranscriptionResult, TranscribeError, File>({
    mutationFn: (file) => (USE_MOCK ? (mockTranscribe(false) as Promise<TranscriptionResult>) : transcribeImage(file)),
  });

  const startPdfMutation = useMutation<PdfJobStartResponse, TranscribeError, File>({
    mutationFn: startPdfJob,
    onSuccess: (data) => setPdfJobId(data.job_id),
  });

  const statusQuery = useQuery<PdfJobStatusResponse, TranscribeError>({
    queryKey: ['pdf-job-status', pdfJobId],
    queryFn: () => fetchPdfJobStatus(pdfJobId as string),
    enabled: pdfJobId !== null && !USE_MOCK,
    refetchInterval: (query) => (query.state.data?.status === 'processing' ? PDF_POLL_INTERVAL_MS : false),
  });

  const [mockPdfResult, setMockPdfResult] = useState<PDFTranscriptionResult | null>(null);

  const start = useCallback((file: File) => {
    setPdfJobId(null);
    setMockPdfResult(null);
    imageMutation.reset();
    startPdfMutation.reset();

    const isPdf = file.type === 'application/pdf';
    if (isPdf && USE_MOCK) {
      mockTranscribe(true).then((result) => setMockPdfResult(result as PDFTranscriptionResult));
      return;
    }
    if (isPdf) {
      startPdfMutation.mutate(file);
    } else {
      imageMutation.mutate(file);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isPdfFlow = pdfJobId !== null || startPdfMutation.isPending || mockPdfResult !== null;

  if (isPdfFlow) {
    if (USE_MOCK) {
      return {
        start,
        isPending: mockPdfResult === null,
        isError: false,
        error: null,
        progress: null,
        data: mockPdfResult,
      };
    }

    const jobStatus = statusQuery.data;
    const jobFailed = jobStatus?.status === 'error';

    return {
      start,
      isPending: startPdfMutation.isPending || (pdfJobId !== null && (!jobStatus || jobStatus.status === 'processing')),
      isError: startPdfMutation.isError || jobFailed || statusQuery.isError,
      error:
        startPdfMutation.error ??
        (jobFailed
          ? new TranscribeError(jobStatus?.error || 'Erreur inconnue lors du traitement du PDF.', 500, true)
          : statusQuery.error ?? null),
      progress: jobStatus ? { pagesDone: jobStatus.pages_done, pagesTotal: jobStatus.pages_total } : null,
      data: jobStatus?.status === 'done' ? jobStatus.result ?? null : null,
    };
  }

  return {
    start,
    isPending: imageMutation.isPending,
    isError: imageMutation.isError,
    error: imageMutation.error,
    progress: null,
    data: imageMutation.data ?? null,
  };
}
