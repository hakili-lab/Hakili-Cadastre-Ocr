/**
 * components/result/dragContext.ts
 * Les deux contextes React du drag de bbox sur l'image annotée — même
 * découplage "rare vs haute fréquence" que `editingCellContext.ts`, voir le
 * commentaire ci-dessous. Dans leur propre fichier pour que `BlockOverlay.tsx`
 * reste 100% exports de composants (Fast Refresh).
 */
import { createContext } from 'react';

/*
 * Même découplage que EditingCellContext/CellDraftContext (voir
 * editingCellContext.ts) appliqué au drag d'une bbox sur l'image :
 * - DraggingBlockContext : quel bloc est en cours de déplacement (`null`
 *   sinon). Change seulement au début/à la fin d'un drag, donc rarement —
 *   chaque <BlockOverlay> peut s'y abonner sans risque de re-render en rafale.
 * - DragOffsetContext : le delta normalisé (dx, dy) courant, mis à jour à
 *   CHAQUE pointermove. Seul le sous-composant du bloc activement déplacé
 *   (monté conditionnellement, cf. BlockOverlay.tsx) s'y abonne — les autres
 *   boîtes ne dépendent que de DraggingBlockContext, donc un pointermove
 *   pendant un drag ne re-rend jamais les boîtes voisines.
 * Dans leur propre fichier (pas de composant ici) pour que BlockOverlay.tsx
 * puisse rester 100% composants — Fast Refresh l'exige.
 */
/** L'id du bloc en cours de déplacement, ou `null` si aucun drag n'est en cours. */
export type DraggingBlockId = number | null;
export const DraggingBlockContext = createContext<DraggingBlockId>(null);

/** Delta normalisé [0,1] courant du drag actif — consommé uniquement par la boîte en cours de déplacement. */
export type DragOffset = { dx: number; dy: number };
export const NO_DRAG_OFFSET: DragOffset = { dx: 0, dy: 0 };
export const DragOffsetContext = createContext<DragOffset>(NO_DRAG_OFFSET);
