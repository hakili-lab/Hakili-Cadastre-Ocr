/**
 * components/result/ContentPanel.tsx
 * Colonne droite de l'écran Résultat : rendu Markdown/LaTeX des blocs, avec
 * édition en place. Voir le commentaire détaillé plus bas pour le
 * fonctionnement de l'édition par bloc simple vs par cellule de tableau.
 */
import type { MutableRefObject } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { remarkHighlightMark } from 'remark-highlight-mark';
import type { TranscriptionBlock } from '../../types';
import { remarkRehypeOptions, preprocessMathHighlights } from '../../utils/markdownHighlight';
import { getConfidenceColor } from '../../utils/confidenceColors';
import { tableLines, parseTableRowCells, groupBlocksForRender, insertPageAndRowColumns } from '../../utils/tableMarkdown';
import { TableDataRow } from './TableRow';

type ContentPanelProps = {
  blocks: TranscriptionBlock[];
  /** Numéro de la page source affichée (1 pour une image simple) — transmis aux lignes de tableau pour leur colonne "Page". */
  pageNumber: number;
  selectedBlockId: number | null;
  editingBlockId: number | null;
  editDraft: string;
  onEditDraftChange: (value: string) => void;
  onSelectBlock: (blockId: number) => void;
  onStartEditBlock: (block: TranscriptionBlock) => void;
  onConfirmEditBlock: () => void;
  onCancelEditBlock: () => void;
  onRowClick: (blockId: number) => void;
  onCellDoubleClick: (blockId: number, column: number) => void;
  blockRefs: MutableRefObject<Map<number, HTMLElement>>;
};

/**
 * Colonne droite : rendu Markdown/LaTeX des blocs, avec édition en place. Un
 * bloc simple s'édite en entier (textarea) ; un groupe de lignes de tableau
 * consécutives se rend comme un seul <table> visuel, mais chaque ligne reste un
 * <TableDataRow> indépendant et mémoïsé (cf. result/TableRow.tsx) — l'édition
 * par cellule est gérée à l'intérieur de ce composant via
 * EditingCellContext/CellDraftContext (posés par ResultScreen), pas par des
 * props qui invalideraient la mémoïsation par ligne/cellule.
 */
export function ContentPanel({
  blocks,
  pageNumber,
  selectedBlockId,
  editingBlockId,
  editDraft,
  onEditDraftChange,
  onSelectBlock,
  onStartEditBlock,
  onConfirmEditBlock,
  onCancelEditBlock,
  onRowClick,
  onCellDoubleClick,
  blockRefs,
}: ContentPanelProps) {
  return (
    <div className="flex-1 flex flex-col rounded-md bg-surface-page border border-line overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-line shrink-0">
        <h3 className="font-sans font-semibold text-lg text-ink">Contenu extrait</h3>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="space-y-0">
          {groupBlocksForRender(blocks).map((group, groupIndex) => {
            const revealStyle = { animationDelay: `${Math.min(groupIndex, 10) * 40}ms` };

            if (group.kind === 'single') {
              const block = group.block;
              const textColor = getConfidenceColor(block.confidence);
              const isSelected = selectedBlockId === block.id;
              const isBeingEdited = editingBlockId === block.id;

              return (
                <div
                  key={block.id}
                  ref={(el) => { if (el) blockRefs.current.set(block.id, el); }}
                  onClick={() => onSelectBlock(block.id)}
                  onDoubleClick={isBeingEdited ? undefined : () => onStartEditBlock(block)}
                  className={`animate-hk-reveal-block transition-all duration-300 rounded-md p-3 ${
                    isBeingEdited ? 'cursor-text text-left' : 'cursor-pointer text-center'
                  }`}
                  style={
                    isBeingEdited
                      ? revealStyle
                      : {
                          ...revealStyle,
                          color: textColor,
                          fontSize: '13px',
                          border: isSelected ? `0.5px solid ${textColor}40` : '0.5px solid transparent',
                          backgroundColor: isSelected ? `${textColor}08` : 'transparent',
                        }
                  }
                >
                  {isBeingEdited ? (
                    <div className="space-y-1.5 animate-edit-fade">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 font-sans text-xs font-medium text-action">
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                          </svg>
                          Modification du bloc
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onConfirmEditBlock(); }}
                            className="h-7 px-3 rounded-sm border-0 bg-action text-surface font-sans text-xs font-medium cursor-pointer"
                          >
                            Valider
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onCancelEditBlock(); }}
                            className="h-7 px-3 rounded-sm border border-line-control bg-transparent font-sans text-xs text-ink cursor-pointer"
                          >
                            Annuler
                          </button>
                        </div>
                      </div>
                      <textarea
                        value={editDraft}
                        onChange={(e) => onEditDraftChange(e.target.value)}
                        onDoubleClick={(e) => e.stopPropagation()}
                        autoFocus
                        spellCheck={false}
                        rows={Math.max(3, editDraft.split('\n').length)}
                        className="w-full border-0 bg-transparent p-0 m-0 font-mono text-sm leading-relaxed text-ink outline-none resize-y"
                      />
                    </div>
                  ) : (
                    <div className="markdown-content animate-edit-fade">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkMath, remarkHighlightMark]}
                        remarkRehypeOptions={remarkRehypeOptions}
                        rehypePlugins={[rehypeKatex]}
                      >
                        {preprocessMathHighlights(block.markdown)}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              );
            }

            // group.kind === 'table' : un seul tableau visuel pour toutes les lignes,
            // mais chaque ligne est un <TableDataRow> indépendant et mémoïsé (voir
            // result/TableRow.tsx) — plus de mapping fragile ligne→bloc par position
            // dans un Markdown combiné, chaque ligne connaît directement son propre bloc.
            const groupBlocks = group.blocks;
            const [headerLine] = tableLines(groupBlocks[0].markdown);
            const headerCells = insertPageAndRowColumns(parseTableRowCells(headerLine), 'Page', 'Ligne');

            return (
              <div key={`table-${groupBlocks[0].id}`} className="animate-hk-reveal-block p-3" style={revealStyle}>
                <div className="markdown-content">
                  <table>
                    <thead>
                      <tr>
                        {headerCells.map((cellText, i) => (
                          <th key={i}>{cellText}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {groupBlocks.map((block, rowIndex) => (
                        <TableDataRow
                          key={block.id}
                          block={block}
                          isSelected={selectedBlockId === block.id}
                          onRowClick={onRowClick}
                          onCellDoubleClick={onCellDoubleClick}
                          blockRefs={blockRefs}
                          pageNumber={pageNumber}
                          rowNumber={rowIndex + 1}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
