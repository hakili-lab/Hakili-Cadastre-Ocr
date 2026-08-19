/**
 * hooks/useBlockDrag.ts
 * State machine du glisser-déposer d'une boîte de bloc sur l'image annotée
 * (écran Résultat) — cf. `useBlockDrag` plus bas pour le détail d'implémentation.
 */
import { useCallback, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import type { BoundingBox } from '../types';
import { pixelDeltaToNormalized, translateBBox } from '../utils/geometry';
import { NO_DRAG_OFFSET } from '../components/result/dragContext';
import type { DragOffset } from '../components/result/dragContext';

/** En-deçà de cette distance (px), un pointerdown→pointerup est un clic, pas un drag. */
const DRAG_THRESHOLD_PX = 4;

type DragState = {
  blockId: number;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  originalBBox: BoundingBox;
  hasCrossedThreshold: boolean;
};

type UseBlockDragOptions = {
  /** Le conteneur `position: relative` dont la taille sert de référentiel aux % de bbox. */
  containerRef: RefObject<HTMLElement | null>;
  /** Lecture de la bbox actuelle d'un bloc (via une ref miroir côté appelant, pas de state ici). */
  getBBox: (blockId: number) => BoundingBox | undefined;
  /** Appelé une seule fois, au relâchement, si le seuil de drag a été franchi. */
  onDragEnd: (blockId: number, bbox: BoundingBox) => void;
  /** Appelé au relâchement si le seuil n'a PAS été franchi — comportement clic existant. */
  onClick: (blockId: number) => void;
};

/** Les 4 handlers Pointer Events à répandre sur chaque boîte draggable (cf. `getBlockPointerHandlers`). */
export type BlockPointerHandlers = {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
};

/**
 * State machine du drag, entièrement basée sur les Pointer Events (pas l'API
 * HTML5 Drag and Drop, pensée pour transférer des données entre zones de
 * dépôt, pas pour repositionner un élément au pixel près dans son conteneur).
 *
 * setPointerCapture (posé au pointerdown) fait que TOUS les événements
 * pointermove/pointerup suivants pour ce pointer sont routés vers l'élément
 * qui a démarré le drag, même si le curseur sort de ses limites — essentiel
 * ici car certaines bbox sont minuscules (un seul chiffre). Conséquence
 * pratique : onPointerMove/onPointerUp peuvent être posés identiquement sur
 * CHAQUE boîte (dragStateRef, partagé par le hook, fait foi), seul
 * onPointerDown a besoin de savoir quel blockId a été saisi.
 *
 * dragStateRef (une ref, pas un state) porte tout ce qui doit survivre entre
 * les frames sans déclencher de re-render à chaque pointermove — seul
 * `dragOffset` (le delta courant) est un state React, et il ne doit être lu
 * que via DragOffsetContext par le SEUL bloc en cours de déplacement (cf.
 * dragContext.ts) pour ne jamais re-render les boîtes voisines.
 */
export function useBlockDrag({ containerRef, getBBox, onDragEnd, onClick }: UseBlockDragOptions) {
  const [draggingBlockId, setDraggingBlockId] = useState<number | null>(null);
  const [dragOffset, setDragOffset] = useState<DragOffset>(NO_DRAG_OFFSET);
  const dragStateRef = useRef<DragState | null>(null);

  const handlePointerDown = useCallback(
    (blockId: number, e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0) return; // seul le clic principal démarre un drag
      const bbox = getBBox(blockId);
      if (!bbox) return;

      e.currentTarget.setPointerCapture(e.pointerId);
      dragStateRef.current = {
        blockId,
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        originalBBox: bbox,
        hasCrossedThreshold: false,
      };
    },
    [getBBox]
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const drag = dragStateRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;

      const deltaXPx = e.clientX - drag.startClientX;
      const deltaYPx = e.clientY - drag.startClientY;

      if (!drag.hasCrossedThreshold) {
        if (Math.hypot(deltaXPx, deltaYPx) < DRAG_THRESHOLD_PX) return;
        drag.hasCrossedThreshold = true;
        setDraggingBlockId(drag.blockId);
      }

      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      setDragOffset(pixelDeltaToNormalized(deltaXPx, deltaYPx, rect.width, rect.height));
    },
    [containerRef]
  );

  const endDrag = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const drag = dragStateRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;

      if (drag.hasCrossedThreshold) {
        const container = containerRef.current;
        if (container) {
          const rect = container.getBoundingClientRect();
          const deltaXPx = e.clientX - drag.startClientX;
          const deltaYPx = e.clientY - drag.startClientY;
          const { dx, dy } = pixelDeltaToNormalized(deltaXPx, deltaYPx, rect.width, rect.height);
          onDragEnd(drag.blockId, translateBBox(drag.originalBBox, dx, dy));
        }
      } else {
        onClick(drag.blockId);
      }

      dragStateRef.current = null;
      setDraggingBlockId(null);
      setDragOffset(NO_DRAG_OFFSET);
    },
    [containerRef, onDragEnd, onClick]
  );

  const handlePointerCancel = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const drag = dragStateRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    dragStateRef.current = null;
    setDraggingBlockId(null);
    setDragOffset(NO_DRAG_OFFSET);
  }, []);

  const getBlockPointerHandlers = useCallback(
    (blockId: number): BlockPointerHandlers => ({
      onPointerDown: (e) => handlePointerDown(blockId, e),
      onPointerMove: handlePointerMove,
      onPointerUp: endDrag,
      onPointerCancel: handlePointerCancel,
    }),
    [handlePointerDown, handlePointerMove, endDrag, handlePointerCancel]
  );

  return { draggingBlockId, dragOffset, getBlockPointerHandlers };
}
