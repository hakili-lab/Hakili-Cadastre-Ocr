/**
 * components/result/AnnotatedImagePanel.tsx
 * Colonne gauche de l'écran Résultat : image source + légende de confiance +
 * boîtes de blocs. Pose les providers `DraggingBlockContext`/`DragOffsetContext`
 * consommés par `BlockOverlay` — l'état de drag lui-même vit dans
 * `useBlockDrag`, instancié par `ResultScreen`.
 */
import type { RefObject } from 'react';
import type { TranscriptionBlock } from '../../types';
import type { BlockPointerHandlers } from '../../hooks/useBlockDrag';
import { BlockOverlay } from './BlockOverlay';
import { DraggingBlockContext, DragOffsetContext } from './dragContext';
import type { DraggingBlockId, DragOffset } from './dragContext';

type AnnotatedImagePanelProps = {
  isPdf: boolean;
  currentPageIndex: number;
  imagePreviewUrl: string | null;
  imageContainerRef: RefObject<HTMLDivElement | null>;
  blocks: TranscriptionBlock[];
  selectedBlockId: number | null;
  draggingBlockId: DraggingBlockId;
  dragOffset: DragOffset;
  getBlockPointerHandlers: (blockId: number) => BlockPointerHandlers;
};

/** Colonne gauche : image source + légende de confiance + boîtes de blocs (drag inclus). */
export function AnnotatedImagePanel({
  isPdf,
  currentPageIndex,
  imagePreviewUrl,
  imageContainerRef,
  blocks,
  selectedBlockId,
  draggingBlockId,
  dragOffset,
  getBlockPointerHandlers,
}: AnnotatedImagePanelProps) {
  return (
    <div className="flex-1 flex flex-col rounded-md bg-surface border border-line overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-line shrink-0">
        <h3 className="font-sans font-semibold text-lg text-ink">
          {isPdf ? `Copie annotée — Page ${currentPageIndex + 1}` : 'Copie annotée'}
        </h3>
        <div className="flex items-center gap-4 font-sans text-xs text-ink-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full inline-block" style={{ background: 'var(--color-conf-high)' }}></span>Fiable
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full inline-block" style={{ background: 'var(--color-conf-mid)' }}></span>À vérifier
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full inline-block" style={{ background: 'var(--color-conf-low)' }}></span>Incertain
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 relative bg-surface-sunken">
        {imagePreviewUrl && (
          <div ref={imageContainerRef} className="relative inline-block">
            <img
              src={imagePreviewUrl}
              alt={isPdf ? `Page ${currentPageIndex + 1}` : 'Copie annotée'}
              className="max-w-full rounded-sm shadow-raise"
              style={{ display: 'block' }}
            />
            <DraggingBlockContext.Provider value={draggingBlockId}>
              <DragOffsetContext.Provider value={dragOffset}>
                {blocks.map((block, i) => (
                  <BlockOverlay
                    key={block.id}
                    block={block}
                    isSelected={selectedBlockId === block.id}
                    getPointerHandlers={getBlockPointerHandlers}
                    revealDelayMs={Math.min(i, 10) * 40}
                  />
                ))}
              </DragOffsetContext.Provider>
            </DraggingBlockContext.Provider>
          </div>
        )}
      </div>
    </div>
  );
}
