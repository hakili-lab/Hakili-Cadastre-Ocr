/**
 * utils/exportExcel.ts
 * Génère et télécharge un classeur Excel (.xlsx) de la transcription, une
 * feuille par page source (une seule feuille "Transcription" pour une image
 * simple). Respecte la structure réelle des données plutôt qu'un simple
 * listing à plat : les groupes de blocs-tableau (`groupBlocksForRender`,
 * comme dans `TranscriptExport.tsx`) redeviennent de vrais tableaux Excel
 * (en-tête + une ligne par bloc, via `getRowCellTexts`), les blocs simples
 * une ligne de texte libre. Le Markdown/LaTeX est écrit tel quel (source
 * brut) : Excel ne rend aucune formule, donc `$x^2$` reste littéralement
 * "$x^2$" dans la cellule — pas de tentative d'approximation.
 */
/*
 * `xlsx` (SheetJS) n'est PAS importé statiquement : c'est une lib volumineuse
 * qui, importée en haut de fichier, finissait dans le bundle JS principal et
 * était donc téléchargée par chaque visiteur dès le chargement de l'app, même
 * ceux qui n'exportent jamais en Excel. `await import('xlsx')` la charge en
 * lazy, uniquement quand `exportTranscriptionToExcel` est appelée (Vite la
 * sépare automatiquement dans son propre chunk).
 */
import type { ExportPage } from '../types';
import { groupBlocksForRender, tableLines, parseTableRowCells, getRowCellTexts, insertPageAndRowColumns } from './tableMarkdown';
import { sanitizeExportPages } from './exportSanitize';

/** Largeur de colonne (en caractères, unité native `xlsx`) - évite les colonnes par défaut trop étroites qui rendent le classeur illisible tel quel. */
const MIN_COL_WIDTH_CHARS = 12;
const MAX_COL_WIDTH_CHARS = 60;

/** Une largeur par colonne, dérivée du plus long contenu de chaque colonne sur toutes les lignes de la feuille. */
function computeColumnWidths(rows: string[][]): { wch: number }[] {
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const widths = new Array(columnCount).fill(MIN_COL_WIDTH_CHARS);
  for (const row of rows) {
    row.forEach((cell, i) => {
      // `cell` peut être `undefined` si le bloc-tableau source n'a pas de ligne
      // de données (getRowCellTexts renvoie [] -> insertPageAndRowColumns met
      // undefined en colonne Confiance) — même cas que celui déjà toléré
      // silencieusement à l'écran par TableRow.tsx (cellTexts[CONFIDENCE_COLUMN]).
      widths[i] = Math.max(widths[i], Math.min(MAX_COL_WIDTH_CHARS, (cell?.length ?? 0) + 2));
    });
  }
  return widths.map((wch) => ({ wch }));
}

const MAX_SHEET_NAME_LENGTH = 31;
// Caractères interdits par Excel dans un nom de feuille : \ / ? * [ ] :
const INVALID_SHEET_NAME_CHARS = /[\\/?*[\]:]/g;

function sanitizeSheetName(name: string): string {
  return name.replace(INVALID_SHEET_NAME_CHARS, ' ').slice(0, MAX_SHEET_NAME_LENGTH);
}

/**
 * Une feuille = une suite de lignes ; un groupe-tableau produit un en-tête +
 * ses lignes (avec les colonnes Page/Ligne insérées après Confiance — Ligne
 * repart à 1 à chaque nouveau groupe-tableau de la page), un bloc simple une
 * seule ligne à une colonne. Une ligne vide sépare chaque groupe.
 */
function blocksToRows(page: ExportPage): string[][] {
  const rows: string[][] = [];
  for (const group of groupBlocksForRender(page.blocks)) {
    if (group.kind === 'single') {
      rows.push([group.block.markdown]);
    } else {
      const [headerLine] = tableLines(group.blocks[0].markdown);
      rows.push(insertPageAndRowColumns(parseTableRowCells(headerLine), 'Page', 'Ligne'));
      group.blocks.forEach((block, rowIndex) => {
        const cells = getRowCellTexts(block.markdown);
        rows.push(insertPageAndRowColumns(cells, String(page.pageNumber), String(rowIndex + 1)));
      });
    }
    rows.push([]);
  }
  return rows.length > 0 ? rows : [[]];
}

/** `pages` : un jeu de blocs par page source, avec son numéro de page (une seule entrée pour une image simple, une par page pour un PDF). */
export async function exportTranscriptionToExcel(pages: ExportPage[], filename: string): Promise<void> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.utils.book_new();

  sanitizeExportPages(pages).forEach((page, index) => {
    const sheetName = sanitizeSheetName(pages.length > 1 ? `Page ${index + 1}` : 'Transcription');
    const rows = blocksToRows(page);
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    worksheet['!cols'] = computeColumnWidths(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  });

  XLSX.writeFile(workbook, filename);
}
