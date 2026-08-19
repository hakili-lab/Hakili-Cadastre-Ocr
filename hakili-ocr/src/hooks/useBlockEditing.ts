/**
 * hooks/useBlockEditing.ts
 * État d'édition en place d'un bloc simple (hors tableau) sur l'écran
 * Résultat — extrait de `ResultScreen.tsx` au même titre que `useCellEditing`
 * (édition de cellule) et `useCorrectionCapture` (collecte de correction),
 * qu'il appelle via `onConfirm` après une validation qui a changé le texte.
 */
import { useState } from 'react';
import type React from 'react';
import type { AppAction, TranscriptionBlock } from '../types';

type UseBlockEditingOptions = {
  blocks: TranscriptionBlock[];
  dispatch: React.Dispatch<AppAction>;
  /** Appelé après une validation qui a réellement modifié le markdown du bloc. */
  onConfirm: (block: TranscriptionBlock, newMarkdown: string) => void;
};

/** Double-clic sur un bloc → édition sur place (textarea) → Valider/Annuler. */
export function useBlockEditing({ blocks, dispatch, onConfirm }: UseBlockEditingOptions) {
  const [editingBlockId, setEditingBlockId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');

  // Double-clic sur un autre bloc pendant une édition en cours : abandonne le
  // brouillon non validé et bascule sur le nouveau bloc.
  const handleStartEditBlock = (block: TranscriptionBlock) => {
    setEditingBlockId(block.id);
    setEditDraft(block.markdown);
  };

  const handleCancelEditBlock = () => {
    setEditingBlockId(null);
    setEditDraft('');
  };

  const handleConfirmEditBlock = () => {
    if (editingBlockId !== null) {
      const block = blocks.find((b) => b.id === editingBlockId);
      dispatch({ type: 'UPDATE_BLOCK_MARKDOWN', blockId: editingBlockId, markdown: editDraft });
      if (block) onConfirm(block, editDraft);
    }
    setEditingBlockId(null);
    setEditDraft('');
  };

  return {
    editingBlockId,
    editDraft,
    setEditDraft,
    handleStartEditBlock,
    handleCancelEditBlock,
    handleConfirmEditBlock,
  };
}
