/**
 * hooks/useRowSelection.ts
 * Sélection d'une ligne de tableau (écran Résultat), débouncée pour ne pas
 * entrer en conflit avec le double-clic qui démarre l'édition d'une cellule
 * (`useCellEditing`) sur la même ligne — cf. `useRowSelection` plus bas.
 */
import { useCallback, useRef } from 'react';
import type React from 'react';
import type { AppAction } from '../types';

const ROW_CLICK_DEBOUNCE_MS = 300;

type UseRowSelectionOptions = {
  dispatch: React.Dispatch<AppAction>;
};

/**
 * Sélectionner une ligne de tableau au clic dispatche SELECT_BLOCK, qui re-rend/
 * met en évidence la ligne — si ça arrivait de façon synchrone entre les deux
 * clics d'un double-clic, le navigateur ne reconnaissait plus la séquence comme
 * un dblclick. Le clic est donc différé de ROW_CLICK_DEBOUNCE_MS, et
 * cancelPendingRowClick doit être appelé par le double-clic sur une cellule de
 * la même ligne (cf. useCellEditing) avant l'échéance.
 */
export function useRowSelection({ dispatch }: UseRowSelectionOptions) {
  const rowClickTimerRef = useRef<number | null>(null);

  const cancelPendingRowClick = useCallback(() => {
    if (rowClickTimerRef.current !== null) {
      window.clearTimeout(rowClickTimerRef.current);
      rowClickTimerRef.current = null;
    }
  }, []);

  const handleRowClick = useCallback(
    (blockId: number) => {
      cancelPendingRowClick();
      rowClickTimerRef.current = window.setTimeout(() => {
        dispatch({ type: 'SELECT_BLOCK', blockId });
        rowClickTimerRef.current = null;
      }, ROW_CLICK_DEBOUNCE_MS);
    },
    [cancelPendingRowClick, dispatch]
  );

  return { handleRowClick, cancelPendingRowClick };
}
