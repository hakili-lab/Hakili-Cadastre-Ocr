/**
 * usePdfPreview.ts
 * Rend chaque page d'un PDF en image (data URL) côté client, pour l'aperçu avant envoi.
 * Rendu pur pdfjs-dist — n'a aucune influence sur le fichier réellement envoyé au backend.
 */
import { useEffect, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

// `workerPort` (un Worker déjà instancié) plutôt que `workerSrc` (une URL) : on a
// besoin que `pdfWorkerEntry.ts` s'exécute EN PREMIER dans le scope du Worker,
// pour y poser le polyfill `Promise.withResolvers` avant que pdfjs-dist ne
// l'utilise — voir le commentaire détaillé dans ce fichier.
const pdfWorker = new Worker(new URL('./pdfWorkerEntry.ts', import.meta.url), { type: 'module' });
// Le worker pdfjs peut échouer silencieusement (voir pdfWorkerEntry.ts) sans jamais
// rejeter la promesse de `getDocument()` côté thread principal — ces écouteurs sont
// le seul filet de sécurité qui rend un tel échec visible en console.
pdfWorker.addEventListener('error', (e) => console.error('[usePdfPreview] Erreur du worker pdfjs', e.message, e));
pdfWorker.addEventListener('messageerror', (e) => console.error('[usePdfPreview] messageerror du worker pdfjs', e));
pdfjsLib.GlobalWorkerOptions.workerPort = pdfWorker;

const PREVIEW_SCALE = 1.5;

interface UsePdfPreviewResult {
  /** Une data URL PNG par page, dans l'ordre du document. */
  pages: string[];
  isLoading: boolean;
  /** Message d'erreur lisible si le PDF n'a pas pu être lu/rendu. */
  error: string | null;
}

/** Rerend toutes les pages à chaque changement de `file` ; annule le rendu en cours si `file` change entre-temps. */
export function usePdfPreview(file: File | null): UsePdfPreviewResult {
  const [pages, setPages] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPages([]);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    (async () => {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const renderedPages: string[] = [];

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
          const page = await pdf.getPage(pageNumber);
          const viewport = page.getViewport({ scale: PREVIEW_SCALE });

          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error("Impossible d'obtenir le contexte 2D du canvas.");

          await page.render({ canvas, canvasContext: ctx, viewport }).promise;
          renderedPages.push(canvas.toDataURL('image/png'));
        }

        if (!cancelled) setPages(renderedPages);
      } catch (err) {
        // Le worker pdfjs peut échouer côté message (PDF corrompu, page illisible...) sans
        // que ce soit visible ailleurs — logué explicitement pour rester diagnosticable.
        console.error('[usePdfPreview] Échec du rendu du PDF', err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Impossible de lire ce PDF.');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [file]);

  return { pages, isLoading, error };
}
