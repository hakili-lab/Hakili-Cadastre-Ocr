/**
 * utils/tableMarkdown.ts
 * Le backend émet un bloc par ligne de tableau (header + séparateur + une
 * seule ligne de données, répétés à l'identique dans chaque bloc). Ce module
 * fournit : le regroupement de blocs consécutifs en un seul tableau visuel
 * (`groupBlocksForRender`), et le découpage/recomposition cellule par cellule
 * d'une ligne (`parseTableRowCells`/`withReplacedCell`) pour l'édition par
 * cellule de `TableRow.tsx`.
 */
import type { TranscriptionBlock } from '../types';

/** Lignes non vides d'un bloc de tableau : `[header, séparateur, ligne de données]`. */
export function tableLines(markdown: string): string[] {
  return markdown
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Un bloc est une ligne de tableau si toutes ses lignes non vides commencent par `|`. */
export function isTableBlockMarkdown(markdown: string): boolean {
  const lines = tableLines(markdown);
  return lines.length >= 2 && lines.every((line) => line.startsWith('|'));
}

/**
 * Découpe consciente des formules LaTeX : un | à l'intérieur d'un span
 * $...$/$$...$$ (ex. $P(A|B)=0.5$, une probabilité conditionnelle, ou $|x|$, une
 * valeur absolue) n'est PAS un séparateur de colonne. Un simple `split('|')`
 * coupait la cellule en deux fragments avec un $ non apparié dans chacun — LaTeX
 * cassé à l'affichage, et un ==...== chevauchant la coupure se retrouvait détaché
 * de son contexte formule (affiché en texte brut au lieu d'être surligné). Un \
 * échappe le caractère suivant (\| pour un pipe littéral hors formule, comme en
 * Markdown standard ; ne casse rien pour \frac, \left, etc. dont la lettre qui
 * suit n'est de toute façon ni $ ni |).
 */
export function parseTableRowCells(rowLine: string): string[] {
  const trimmed = rowLine.trim();
  const inner = trimmed.startsWith('|') && trimmed.endsWith('|') ? trimmed.slice(1, -1) : trimmed;

  const cells: string[] = [];
  let current = '';
  let inMath = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '\\' && i + 1 < inner.length) {
      current += ch + inner[i + 1];
      i++;
      continue;
    }
    if (inner.startsWith('$$', i)) {
      inMath = !inMath;
      current += '$$';
      i++;
      continue;
    }
    if (ch === '$') {
      inMath = !inMath;
      current += ch;
      continue;
    }
    if (ch === '|' && !inMath) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

/**
 * Insère `page`/`row` juste après la colonne Confiance (toujours en position 0,
 * injectée côté backend — cf. `inject_confidence_column`). `page`/`row` sont
 * calculés côté frontend (numéro de page source, position dans le groupe de
 * tableau) et n'existent jamais dans `block.markdown` : ni `parseTableRowCells`
 * ni `getRowCellTexts` ne les connaissent, ils sont ajoutés uniquement à
 * l'affichage/l'export, jamais à la donnée éditable. Générique pour servir aussi
 * bien à la ligne d'en-tête (labels `'Page'`/`'Ligne'`) qu'aux lignes de données
 * (valeurs numériques).
 */
export function insertPageAndRowColumns<T>(cells: T[], page: T, row: T): T[] {
  return [cells[0], page, row, ...cells.slice(1)];
}

/** Recompose une ligne `| ... |` avec la cellule `column` remplacée par `newValue` — utilisé après validation d'une édition de cellule. */
export function withReplacedCell(rowLine: string, column: number, newValue: string): string {
  const cells = parseTableRowCells(rowLine);
  cells[column] = newValue;
  return `| ${cells.join(' | ')} |`;
}

/** Cellules de la ligne de données (3ᵉ ligne) d'un bloc-tableau — ce qu'affiche/édite `TableRow.tsx`. */
export function getRowCellTexts(markdown: string): string[] {
  const dataLine = tableLines(markdown)[2];
  return dataLine ? parseTableRowCells(dataLine) : [];
}

/** Un groupe de rendu : soit un bloc simple, soit une série de blocs-ligne consécutifs formant un tableau. */
export type RenderGroup =
  | { kind: 'single'; block: TranscriptionBlock }
  | { kind: 'table'; blocks: TranscriptionBlock[] };

/** Regroupe les blocs-tableau consécutifs pour qu'`ContentPanel` les rende comme un seul `<table>`. */
export function groupBlocksForRender(blocks: TranscriptionBlock[]): RenderGroup[] {
  const groups: RenderGroup[] = [];
  for (const block of blocks) {
    const last = groups[groups.length - 1];
    if (isTableBlockMarkdown(block.markdown)) {
      if (last?.kind === 'table') {
        last.blocks.push(block);
      } else {
        groups.push({ kind: 'table', blocks: [block] });
      }
    } else {
      groups.push({ kind: 'single', block });
    }
  }
  return groups;
}
