/**
 * hooks/useCellEditing.ts
 * État d'édition en place d'une cellule de tableau sur l'écran Résultat —
 * pendant du `useBlockEditing` (blocs simples), mais à la granularité de la
 * cellule puisque le backend émet un bloc par ligne de tableau. Alimente
 * `EditingCellContext`/`CellDraftContext` (result/editingCellContext.ts), le
 * découplage qui permet à `TableRow.tsx` de mémoïser chaque cellule indépendamment.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, MutableRefObject } from 'react';
import type React from 'react';
import type { AppAction, TranscriptionBlock } from '../types';
import type { EditingTarget, CellDraftContextValue } from '../components/result/editingCellContext';
import { tableLines, parseTableRowCells, withReplacedCell } from '../utils/tableMarkdown';

type UseCellEditingOptions = {
  /** Ref miroir (pas de state) : évite d'invalider les handlers mémoïsés à chaque changement de blocks. */
  blocksRef: MutableRefObject<TranscriptionBlock[]>;
  dispatch: React.Dispatch<AppAction>;
  /** Appelé après une validation qui a réellement modifié le markdown du bloc. */
  onConfirm: (block: TranscriptionBlock, newMarkdown: string) => void;
};

/**
 * Double-clic sur une cellule (pas la ligne entière — cf. TableRow.tsx pour la
 * granularité de mémoïsation que cet état alimente) → édition sur place.
 * `skipNextCellBlurRef` existe pour qu'Échap n'entraîne pas de revalidation
 * par le blur qui suit la fermeture du champ.
 */
export function useCellEditing({ blocksRef, dispatch, onConfirm }: UseCellEditingOptions) {
  const [editingCell, setEditingCell] = useState<EditingTarget>(null);
  const [cellDraft, setCellDraft] = useState('');
  const skipNextCellBlurRef = useRef(false);

  const editingCellRef = useRef(editingCell);
  editingCellRef.current = editingCell;
  const cellDraftRef = useRef(cellDraft);
  cellDraftRef.current = cellDraft;

  const handleStartEditCell = useCallback(
    (blockId: number, column: number) => {
      const rowBlock = blocksRef.current.find((b) => b.id === blockId);
      if (!rowBlock) return;
      const dataRow = tableLines(rowBlock.markdown)[2];
      const cells = parseTableRowCells(dataRow);
      setEditingCell({ blockId, column });
      setCellDraft(cells[column] ?? '');
    },
    [blocksRef]
  );

  const handleCancelEditCell = useCallback(() => {
    skipNextCellBlurRef.current = true;
    setEditingCell(null);
    setCellDraft('');
  }, []);

  const handleConfirmEditCell = useCallback(() => {
    const currentEditingCell = editingCellRef.current;
    if (currentEditingCell) {
      const block = blocksRef.current.find((b) => b.id === currentEditingCell.blockId);
      if (block) {
        const [header, separator, dataRow] = tableLines(block.markdown);
        const updatedRow = withReplacedCell(dataRow, currentEditingCell.column, cellDraftRef.current);
        const updatedMarkdown = [header, separator, updatedRow].join('\n');
        dispatch({
          type: 'UPDATE_BLOCK_MARKDOWN',
          blockId: currentEditingCell.blockId,
          markdown: updatedMarkdown,
        });
        onConfirm(block, updatedMarkdown);
      }
    }
    setEditingCell(null);
    setCellDraft('');
  }, [blocksRef, dispatch, onConfirm]);

  const handleCellBlur = useCallback(() => {
    if (skipNextCellBlurRef.current) {
      skipNextCellBlurRef.current = false;
      return;
    }
    handleConfirmEditCell();
  }, [handleConfirmEditCell]);

  const handleCellKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.currentTarget.blur();
      } else if (e.key === 'Escape') {
        handleCancelEditCell();
      }
    },
    [handleCancelEditCell]
  );

  // Valeur de CellDraftContext : change à chaque frappe (cellDraft), mais seul le
  // <CellEditor> de la cellule active la consomme (cf. result/TableRow.tsx) — les
  // autres cellules ne sont jamais notifiées.
  const cellDraftContextValue = useMemo<CellDraftContextValue>(
    () => ({ cellDraft, onSetCellDraft: setCellDraft, onCellKeyDown: handleCellKeyDown, onCellBlur: handleCellBlur }),
    [cellDraft, handleCellKeyDown, handleCellBlur]
  );

  return {
    editingCell,
    cellDraftContextValue,
    handleStartEditCell,
    handleCancelEditCell,
    handleConfirmEditCell,
  };
}
