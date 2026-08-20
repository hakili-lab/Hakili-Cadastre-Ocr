/**
 * utils/pdfChunking.ts
 * Découpe un PDF en sous-PDF (copie structurelle des pages, aucun rendu de pixel — pdf-lib
 * uniquement) pour l'upload par morceaux des gros documents : voir `hooks/useTranscribe.ts`
 * côté envoi, et côté backend `POST /transcribe/pdf/start-chunked` + `POST
 * /transcribe/pdf/{job_id}/chunk` (`ocr-math-api/app/routers/transcription.py`). Le seul
 * rasteriseur reste PyMuPDF côté serveur, exactement comme pour un PDF envoyé en un seul
 * morceau — ce module ne rend jamais un pixel, il ne fait que recopier des pages entre
 * documents PDF. Motif nouveau dans le projet (`PDFDocument.create()` + `copyPages`/`addPage`)
 * mais même librairie que `fileTransform.ts` (qui, lui, mute un seul document déjà chargé pour
 * la rotation plutôt que d'en reconstruire de nouveaux).
 */
import { PDFDocument } from 'pdf-lib';

/**
 * Au-delà de ce nombre de pages, le PDF est envoyé par morceaux plutôt qu'en un seul POST —
 * voir le choix de flux dans `useTranscribe.ts`. Sous ce seuil, découper n'apporterait rien
 * (juste des allers-retours réseau en plus) : le flux `/pdf/start` classique reste inchangé.
 */
export const PDF_CHUNK_PAGE_COUNT_THRESHOLD = 30;

/**
 * Nombre de pages par morceau — nettement au-dessus d'`ANTHROPIC_CONCURRENCY` (6, backend
 * `claude_service.py`) pour qu'un morceau sature le sémaphore de traitement pendant que le
 * suivant est envoyé, sans être si gros que la rasterisation d'un morceau devienne elle-même
 * un goulot d'étranglement notable.
 */
export const PDF_CHUNK_SIZE_PAGES = 20;

/** Nombre de pages d'un PDF, sans rien rasteriser — ne lit que la structure du document. */
export async function getPdfPageCount(file: File): Promise<number> {
  const bytes = await file.arrayBuffer();
  const pdfDoc = await PDFDocument.load(bytes);
  return pdfDoc.getPageCount();
}

export interface PdfChunk {
  /** Position (0-based) de la première page de ce morceau dans le document d'origine. */
  startPageIndex: number;
  /** Nombre de pages contenues dans ce morceau. */
  pageCount: number;
  /** Le sous-PDF lui-même, prêt à être envoyé tel quel à `POST /pdf/{job_id}/chunk`. */
  blob: Blob;
}

/**
 * Découpe `file` en une suite de sous-PDF de `pagesPerChunk` pages maximum chacun — copie
 * structurelle des pages (`copyPages`/`addPage`), sans rendu de pixel. Les morceaux sont
 * produits dans l'ordre du document ; à charge de l'appelant de les envoyer dans cet ordre et
 * un par un (le backend numérote les pages lui-même à réception, dans l'ordre d'arrivée — voir
 * la note sur l'envoi strictement séquentiel dans `useTranscribe.ts` : aucun numéro d'ordre
 * n'est transmis, `startPageIndex` ici ne sert qu'à un éventuel affichage de progression
 * d'envoi côté client, pas à la numérotation finale des pages).
 */
export async function splitPdfIntoChunks(file: File, pagesPerChunk: number): Promise<PdfChunk[]> {
  const bytes = await file.arrayBuffer();
  const sourceDoc = await PDFDocument.load(bytes);
  const totalPages = sourceDoc.getPageCount();

  const chunks: PdfChunk[] = [];
  for (let startPageIndex = 0; startPageIndex < totalPages; startPageIndex += pagesPerChunk) {
    const pageCount = Math.min(pagesPerChunk, totalPages - startPageIndex);
    const pageIndices = Array.from({ length: pageCount }, (_, i) => startPageIndex + i);

    const chunkDoc = await PDFDocument.create();
    const copiedPages = await chunkDoc.copyPages(sourceDoc, pageIndices);
    copiedPages.forEach((page) => chunkDoc.addPage(page));

    const chunkBytes = await chunkDoc.save();
    chunks.push({
      startPageIndex,
      pageCount,
      blob: new Blob([chunkBytes as BlobPart], { type: 'application/pdf' }),
    });
  }

  return chunks;
}
