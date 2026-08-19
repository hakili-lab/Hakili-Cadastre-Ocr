/**
 * utils/geometry.ts
 * Conversion et translation de bbox pour le drag d'un bloc sur l'image.
 * Fonctions pures, sans dépendance React : le hook d'interaction (`useBlockDrag`)
 * ne fait qu'appeler ces fonctions à partir de coordonnées écran (pixels).
 */
import type { BoundingBox } from '../types';

/**
 * Convertit un déplacement en pixels écran en fraction normalisée [0,1],
 * à l'échelle du conteneur qui sert de référentiel de positionnement des
 * boîtes (le wrapper `relative` autour de l'image, pas l'écran entier) —
 * la même échelle que BoundingBox, qui est toujours relative à la taille de
 * rendu de l'image affichée, jamais à ses pixels natifs.
 */
export function pixelDeltaToNormalized(
  deltaXPx: number,
  deltaYPx: number,
  containerWidthPx: number,
  containerHeightPx: number
): { dx: number; dy: number } {
  return {
    dx: containerWidthPx > 0 ? deltaXPx / containerWidthPx : 0,
    dy: containerHeightPx > 0 ? deltaYPx / containerHeightPx : 0,
  };
}

/**
 * Translate une bbox de (dx, dy) normalisés en conservant sa largeur/hauteur.
 * Le delta appliqué sur chaque axe est réduit au maximum possible si la
 * translation demandée pousserait un bord hors du cadre [0,1] — la boîte
 * s'arrête donc net au bord de l'image plutôt que de se faire tronquer
 * (jamais de redimensionnement involontaire en butée).
 */
export function translateBBox(bbox: BoundingBox, dx: number, dy: number): BoundingBox {
  const width = bbox.x_max - bbox.x_min;
  const height = bbox.y_max - bbox.y_min;

  const clampedDx = clampAxisDelta(dx, bbox.x_min, bbox.x_max);
  const clampedDy = clampAxisDelta(dy, bbox.y_min, bbox.y_max);

  const x_min = bbox.x_min + clampedDx;
  const y_min = bbox.y_min + clampedDy;

  return { x_min, y_min, x_max: x_min + width, y_max: y_min + height };
}

/** Borne un delta pour que [min+delta, max+delta] reste dans [0, 1]. */
function clampAxisDelta(delta: number, min: number, max: number): number {
  const minAllowed = -min;
  const maxAllowed = 1 - max;
  return Math.min(maxAllowed, Math.max(minAllowed, delta));
}
