/**
 * utils/confidenceColors.ts
 * Couleurs dérivées du score de confiance (0-100) d'un bloc, sur 3 paliers
 * (≥60 fiable, ≥30 à vérifier, sinon incertain) — utilisées à la fois pour le
 * texte des blocs (`ContentPanel`) et les boîtes sur l'image (`BlockOverlay`).
 */

/** Couleur de texte pleine, pour le rendu Markdown d'un bloc. */
export function getConfidenceColor(confidence: number): string {
  if (confidence >= 60) return '#2f7d3a';
  if (confidence >= 30) return '#9a5a00';
  return '#b3261e';
}

/** Bordure discrète (alpha fixe) pour les boîtes de bloc sur l'image. */
export function getConfidenceBorder(confidence: number): string {
  if (confidence >= 60) return 'rgba(47,125,58,0.45)';
  if (confidence >= 30) return 'rgba(154,90,0,0.45)';
  return 'rgba(179,38,30,0.45)';
}

/** Fond très transparent pour les boîtes de bloc — plus opaque quand le bloc est sélectionné. */
export function getConfidenceBoxBg(confidence: number, isSelected: boolean): string {
  const alpha = isSelected ? 0.12 : 0.03;
  if (confidence >= 60) return `rgba(47,125,58,${alpha})`;
  if (confidence >= 30) return `rgba(154,90,0,${alpha})`;
  return `rgba(179,38,30,${alpha})`;
}
