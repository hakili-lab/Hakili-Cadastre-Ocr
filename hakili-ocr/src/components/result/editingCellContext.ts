/**
 * components/result/editingCellContext.ts
 * Les deux contextes React de l'édition de cellule de tableau — voir le
 * commentaire ci-dessous pour le détail du découplage. Dans leur propre
 * fichier (pas de composant ici) pour que `TableRow.tsx` reste 100% exports
 * de composants, ce que Fast Refresh exige.
 */
import { createContext } from 'react';
import type { KeyboardEvent } from 'react';

/*
 * Deux contextes séparés pour que "suis-je en édition ?" (rare, seulement au
 * début/fin d'édition) et "quelle est la valeur tapée ?" (à chaque frappe) restent
 * DÉCOUPLÉS du parsing Markdown/KaTeX des lignes de tableau :
 * - EditingCellContext : quelle cellule (blockId+colonne) est en édition, si aucune
 *   n'est éditée sa valeur est `null`. Change seulement au double-clic / à la
 *   validation/l'annulation.
 * - CellDraftContext : la valeur en cours de frappe + handlers. Change à CHAQUE
 *   frappe, mais seul le <CellEditor> de la cellule active le consomme — les autres
 *   cellules ne dépendent que d'EditingCellContext, donc ne sont jamais concernées
 *   par les frappes dans une autre cellule.
 * Sans ce découplage, il faudrait passer editingColumn/cellDraft en props jusqu'à
 * la ligne de tableau, ce qui forcerait sa mémoïsation (useMemo du <ReactMarkdown>,
 * KaTeX compris) à se recalculer à chaque frappe/changement d'édition — exactement
 * le bug qu'on corrige ici (une frappe dans une cellule ne doit rien changer
 * ailleurs, ni sur les autres cellules de sa ligne, ni sur les autres lignes).
 * Dans leur propre fichier (pas de composant ici) pour que TableRow.tsx puisse
 * rester 100% composants — c'est ce que Fast Refresh exige pour fonctionner.
 */
/** Quelle cellule (blockId + colonne) est en édition, ou `null` si aucune. */
export type EditingTarget = { blockId: number; column: number } | null;
export const EditingCellContext = createContext<EditingTarget>(null);

/** La valeur en cours de frappe + les handlers du champ actif — consommé uniquement par le `<CellEditor>` de la cellule en édition. */
export type CellDraftContextValue = {
  cellDraft: string;
  onSetCellDraft: (value: string) => void;
  onCellKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  onCellBlur: () => void;
};
export const CellDraftContext = createContext<CellDraftContextValue | null>(null);
