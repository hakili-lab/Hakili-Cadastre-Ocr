/**
 * components/result/TranscriptExport.tsx
 * Rendu Markdown/LaTeX en lecture seule, hors-écran, dont le HTML sérialisé
 * (`.innerHTML`, cf. `utils/exportPdf.tsx`) est envoyé au backend pour
 * génération du PDF via WeasyPrint (app/services/pdf_export_service.py côté
 * ocr-math-api). Template d'export dédié, distinct de `ContentPanel.tsx` :
 * pas de contrôles d'édition, pas de mémoïsation par cellule (inutile hors
 * interaction), et surtout pas de classes utilitaires Tailwind — le HTML
 * sérialisé part sans sa feuille de style, seules les classes reconnues par
 * le template CSS du backend (`block`, `table-wrap`, et les sélecteurs
 * d'éléments bruts h2/table/th/td) ont un effet une fois côté serveur.
 * `pages` reçoit des blocs déjà nettoyés par `utils/exportSanitize.ts`
 * (marqueurs `==...==` retirés) : pas besoin ici du pipeline de surbrillance
 * `remark-highlight-mark`/`preprocessMathHighlights` utilisé par ContentPanel.
 */
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import type { ExportPage } from '../../types';
import {
  tableLines,
  parseTableRowCells,
  getRowCellTexts,
  groupBlocksForRender,
  insertPageAndRowColumns,
} from '../../utils/tableMarkdown';

type TranscriptExportProps = {
  /** Un jeu de blocs par page source, avec son numéro de page (une seule entrée pour une image simple). */
  pages: ExportPage[];
};

/** Un groupe de rendu pour une page donnée — mêmes clés que `groupBlocksForRender`, mais préfixées par page pour rester uniques une fois toutes les pages concaténées. */
export function TranscriptExport({ pages }: TranscriptExportProps) {
  return (
    <div>
      {pages.map(({ pageNumber, blocks }, pageIndex) => (
        <div key={pageIndex}>
          {pages.length > 1 && <h2>Page {pageNumber}</h2>}
          {groupBlocksForRender(blocks).map((group, groupIndex) => {
            if (group.kind === 'single') {
              const block = group.block;
              return (
                <div key={`${pageIndex}-${block.id}`} className="block">
                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                    {block.markdown}
                  </ReactMarkdown>
                </div>
              );
            }

            const groupBlocks = group.blocks;
            const [headerLine] = tableLines(groupBlocks[0].markdown);
            const headerCells = insertPageAndRowColumns(parseTableRowCells(headerLine), 'Page', 'Ligne');

            return (
              <div key={`${pageIndex}-table-${groupIndex}`} className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {headerCells.map((cellText, i) => (
                        <th key={i}>{cellText}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {groupBlocks.map((block, rowIndex) => {
                      const cellTexts = getRowCellTexts(block.markdown);
                      return (
                        <tr key={block.id}>
                          <td>{cellTexts[0]}</td>
                          <td>{pageNumber}</td>
                          <td>{rowIndex + 1}</td>
                          {cellTexts.slice(1).map((cellText, i) => (
                            <td key={i + 1}>
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm, remarkMath]}
                                rehypePlugins={[rehypeKatex]}
                                components={{ p: ({ children }) => <>{children}</> }}
                              >
                                {cellText}
                              </ReactMarkdown>
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
