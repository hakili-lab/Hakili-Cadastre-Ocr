/**
 * cropImage.ts
 * Découpe la portion d'une image correspondant à la bbox normalisée d'un bloc,
 * pour alimenter la collecte de corrections (dataset image croppée + texte
 * avant/après). Prend la même source que l'overlay des bbox (imagePreviewUrl /
 * image_b64 de la page PDF courante) — donc mêmes garanties d'alignement, y
 * compris sa limite connue de non-mise-à-jour après rotation pour une image
 * simple.
 */
import type { BoundingBox } from '../types';

/** `fetch` + `createImageBitmap` + crop sur `<canvas>` — fonctionne aussi bien pour un `blob:` d'image simple qu'un `data:` de page PDF. */
export async function cropImageToBlob(imageSrc: string, bbox: BoundingBox): Promise<Blob> {
  const response = await fetch(imageSrc);
  const sourceBlob = await response.blob();
  const bitmap = await createImageBitmap(sourceBlob);

  const x = Math.round(bbox.x_min * bitmap.width);
  const y = Math.round(bbox.y_min * bitmap.height);
  const width = Math.max(1, Math.round((bbox.x_max - bbox.x_min) * bitmap.width));
  const height = Math.max(1, Math.round((bbox.y_max - bbox.y_min) * bitmap.height));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error("Impossible d'obtenir le contexte 2D du canvas.");
  ctx.drawImage(bitmap, x, y, width, height, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error("Échec du découpage de l'image.");
  return blob;
}
