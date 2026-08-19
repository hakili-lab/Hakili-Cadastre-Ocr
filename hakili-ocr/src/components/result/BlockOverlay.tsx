/**
 * components/result/BlockOverlay.tsx
 * Boîte bbox individuelle sur l'image annotée (écran Résultat) : rendu +
 * poignée de drag. Mémoïsée par `block.id` comme `TableDataCell`, pour la
 * même raison — déplacer une boîte ne doit jamais re-rendre ses voisines.
 */
import { memo, useContext } from 'react';
import type { BoundingBox, TranscriptionBlock } from '../../types';
import type { BlockPointerHandlers } from '../../hooks/useBlockDrag';
import { getConfidenceColor, getConfidenceBorder, getConfidenceBoxBg } from '../../utils/confidenceColors';
import { translateBBox } from '../../utils/geometry';
import { DraggingBlockContext, DragOffsetContext } from './dragContext';

/**
 * Le curseur natif `cursor: grab`/`grabbing` est dessiné par l'OS et peut
 * s'afficher en blanc selon le thème système — illisible sur les boîtes
 * claires de ce panneau. On force donc une main noire à contour blanc (donc
 * lisible sur fond clair ET foncé) via une image de curseur SVG inline,
 * plutôt que de dépendre du rendu du système.
 */
function handCursorDataUri(closed: boolean): string {
  const shapes = closed
    ? '<rect x="5.5" y="6" width="14" height="14" rx="5"/><rect x="4.5" y="10" width="3" height="6" rx="1.4"/>'
    : '<rect x="7" y="2" width="2.4" height="10" rx="1.2"/><rect x="9.8" y="1" width="2.4" height="11" rx="1.2"/>' +
      '<rect x="12.6" y="1" width="2.4" height="11" rx="1.2"/><rect x="15.4" y="2" width="2.4" height="10" rx="1.2"/>' +
      '<rect x="4.5" y="9" width="2.4" height="7" rx="1.2"/><rect x="5.5" y="9.5" width="14" height="10.5" rx="4"/>';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">` +
    `<g fill="black" stroke="white" stroke-width="1" stroke-linejoin="round">${shapes}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, ${closed ? 'grabbing' : 'grab'}`;
}

const GRAB_CURSOR = handCursorDataUri(false);
const GRABBING_CURSOR = handCursorDataUri(true);

type BlockOverlayProps = {
  block: TranscriptionBlock;
  isSelected: boolean;
  getPointerHandlers: (blockId: number) => BlockPointerHandlers;
  /** Délai (ms) de l'animation d'apparition au montage — figé, jamais mis à jour pendant un drag. */
  revealDelayMs?: number;
};

/**
 * Boîte overlay individuelle sur l'image annotée. Mémoïsée et keyed sur
 * block.id (comme TableDataRow/TableDataCell pour les tableaux) pour que
 * déplacer UNE boîte ne re-rende jamais les autres.
 *
 * Ne lit QUE DraggingBlockContext ici (change deux fois par drag : début et
 * fin — un re-render négligeable pour toutes les boîtes à ce moment-là,
 * même schéma que EditingCellContext pour les cellules de tableau).
 * DragOffsetContext, qui change à CHAQUE pointermove, n'est jamais lu ici :
 * il est délégué à <DraggingBlockBox>, monté uniquement pour LA boîte
 * activement déplacée — les autres ne s'y abonnent jamais.
 */
export const BlockOverlay = memo(function BlockOverlay({ block, isSelected, getPointerHandlers, revealDelayMs }: BlockOverlayProps) {
  const draggingBlockId = useContext(DraggingBlockContext);
  const handlers = getPointerHandlers(block.id);

  if (draggingBlockId === block.id) {
    return <DraggingBlockBox block={block} isSelected={isSelected} handlers={handlers} />;
  }
  return <BlockBoxVisual block={block} bbox={block.bbox} isSelected={isSelected} isDragging={false} handlers={handlers} revealDelayMs={revealDelayMs} />;
});

type DraggingBlockBoxProps = {
  block: TranscriptionBlock;
  isSelected: boolean;
  handlers: BlockPointerHandlers;
};

/** Seul composant abonné à DragOffsetContext — un seul existe à la fois. */
function DraggingBlockBox({ block, isSelected, handlers }: DraggingBlockBoxProps) {
  const offset = useContext(DragOffsetContext);
  const liveBBox = translateBBox(block.bbox, offset.dx, offset.dy);
  return <BlockBoxVisual block={block} bbox={liveBBox} isSelected={isSelected} isDragging handlers={handlers} />;
}

type BlockBoxVisualProps = {
  block: TranscriptionBlock;
  bbox: BoundingBox;
  isSelected: boolean;
  isDragging: boolean;
  handlers: BlockPointerHandlers;
  revealDelayMs?: number;
};

/** Rendu pur : bbox reçue explicitement en prop (statique ou live pendant un drag). */
function BlockBoxVisual({ block, bbox, isSelected, isDragging, handlers, revealDelayMs }: BlockBoxVisualProps) {
  const borderColor = getConfidenceBorder(block.confidence);
  const bgColor = getConfidenceBoxBg(block.confidence, isSelected);

  return (
    <div
      {...handlers}
      className={revealDelayMs !== undefined ? 'absolute select-none group animate-hk-reveal-box' : 'absolute select-none group'}
      style={{
        left: `${bbox.x_min * 100}%`,
        top: `${bbox.y_min * 100}%`,
        width: `${(bbox.x_max - bbox.x_min) * 100}%`,
        height: `${(bbox.y_max - bbox.y_min) * 100}%`,
        border: `1.5px solid ${borderColor}`,
        borderRadius: '6px',
        backgroundColor: bgColor,
        boxShadow: isSelected ? `0 0 0 2px ${borderColor}` : 'none',
        cursor: isDragging ? GRABBING_CURSOR : GRAB_CURSOR,
        touchAction: 'none', // le pointer capture gère le drag ; empêche le scroll tactile de le concurrencer
        zIndex: isDragging ? 10 : undefined,
        transition: isDragging ? 'none' : 'all 200ms', // pas de lissage CSS pendant un drag piloté frame par frame
        animationDelay: revealDelayMs !== undefined ? `${revealDelayMs}ms` : undefined,
      }}
    >
      {/* Tooltip au survol */}
      <div
        className="absolute -top-7 left-0 px-2 py-0.5 rounded text-[10px] font-semibold text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none"
        style={{ backgroundColor: getConfidenceColor(block.confidence) }}
      >
        {block.confidence}%
      </div>
    </div>
  );
}
