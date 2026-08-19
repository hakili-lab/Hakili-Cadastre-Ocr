/**
 * utils/exportSanitize.ts
 * Nettoyage commun appliqué avant tout export (PDF/Excel) : supprime les
 * marqueurs `==...==` ("contenu incertain", cf. `utils/markdownHighlight.ts`)
 * de chaque bloc — ils n'ont de sens que dans l'interface interactive (rendu
 * <mark>/colorbox), pas dans un fichier téléchargé, qui doit rester du texte
 * propre et entièrement noir.
 */
import type { ExportPage } from '../types';
import { stripUncertainMarkers } from './markdownHighlight';

export function sanitizeExportPages(pages: ExportPage[]): ExportPage[] {
  return pages.map((page) => ({
    ...page,
    blocks: page.blocks.map((block) => ({ ...block, markdown: stripUncertainMarkers(block.markdown) })),
  }));
}
