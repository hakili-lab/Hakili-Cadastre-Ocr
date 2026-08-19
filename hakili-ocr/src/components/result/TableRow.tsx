/**
 * components/result/TableRow.tsx
 * Rendu par ligne/par cellule d'un bloc-tableau, avec mémoïsation individuelle
 * de chaque cellule (`TableDataCell`) pour qu'éditer/sélectionner une cellule
 * ou une ligne ne re-rende/reparse-KaTeX jamais les autres — voir les
 * commentaires détaillés sur chaque export ci-dessous.
 */
import { memo, useContext, useMemo } from 'react';
import type { MutableRefObject, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { remarkHighlightMark } from 'remark-highlight-mark';
import { remarkRehypeOptions, preprocessMathHighlights } from '../../utils/markdownHighlight';
import { getConfidenceColor } from '../../utils/confidenceColors';
import { getRowCellTexts } from '../../utils/tableMarkdown';
import { EditingCellContext, CellDraftContext } from './editingCellContext';
import type { TranscriptionBlock } from '../../types';

// Colonne 0 = "Confiance", injectée automatiquement côté backend à partir de
// block.confidence : jamais éditable (source de vérité unique, cf.
// inject_confidence_column côté API).
const CONFIDENCE_COLUMN = 0;

/** Neutralise le `<p>` que `react-markdown` enveloppe autour d'une cellule — on veut le texte inline, pas un paragraphe bloc. */
const PassthroughFragment = ({ children }: { children?: ReactNode }) => <>{children}</>;

/** Le champ actif d'édition de cellule ; lit `CellDraftContext`, ne se rend que quand ce contexte est non-null. */
function CellEditor() {
  const draft = useContext(CellDraftContext);
  if (!draft) return null;
  return (
    <input
      type="text"
      value={draft.cellDraft}
      onChange={(e) => draft.onSetCellDraft(e.target.value)}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={draft.onCellKeyDown}
      onBlur={draft.onCellBlur}
      autoFocus
      // size=1 neutralise la largeur intrinsèque par défaut d'un <input>
      // (~20 caractères) : dans un tableau en table-layout auto, le navigateur
      // calcule la largeur de colonne à partir de cette taille intrinsèque AVANT
      // d'appliquer le CSS width:100%, donc sans ça, passer en édition élargit
      // toute la colonne (et donc tout le tableau) au lieu de rester dans la
      // largeur existante.
      size={1}
      // h-full + block : un <input> est display:inline-block par défaut et se
      // dimensionne sur la métrique de police du navigateur, pas sur la hauteur
      // réelle de la cellule (souvent plus grande à cause du rendu KaTeX d'une
      // formule) — sans ça, passer en édition faisait rétrécir la ligne.
      className="block w-full h-full border-0 bg-transparent p-0 m-0 text-inherit outline-none [font:inherit] animate-edit-fade"
    />
  );
}

type TableDataCellProps = {
  blockId: number;
  column: number;
  cellText: string;
  onDoubleClick: (blockId: number, column: number) => void;
};

/**
 * Chaque cellule mémoïse SON PROPRE rendu Markdown/KaTeX, sur cellText (la valeur
 * brute de CETTE cellule) uniquement — pas sur la ligne ni le bloc entier. Valider
 * l'édition change block.markdown, donc `cellText` pour LA cellule éditée, mais les
 * `cellText` des AUTRES colonnes de la même ligne restent des chaînes identiques :
 * leur useMemo interne ne recalcule rien, React ne touche pas leur DOM. C'est cette
 * granularité par cellule (et pas seulement par ligne) qui garantit qu'éditer une
 * cellule ne fait "bouger" ni les autres cellules de sa ligne ni les autres lignes.
 * isEditingThisCell vient d'EditingCellContext (pas d'une prop figée par un memo
 * parent), ce qui permet à la cellule de réagir seule au double-clic.
 */
const TableDataCell = memo(function TableDataCell({ blockId, column, cellText, onDoubleClick }: TableDataCellProps) {
  const editingTarget = useContext(EditingCellContext);
  const isEditingThisCell = editingTarget?.blockId === blockId && editingTarget.column === column;

  const rendered = useMemo(
    () => (
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkHighlightMark]}
        remarkRehypeOptions={remarkRehypeOptions}
        rehypePlugins={[rehypeKatex]}
        components={{ p: PassthroughFragment }}
      >
        {preprocessMathHighlights(cellText)}
      </ReactMarkdown>
    ),
    [cellText]
  );

  if (isEditingThisCell) {
    return <td onDoubleClick={(e) => e.stopPropagation()}><CellEditor /></td>;
  }

  return (
    <td onDoubleClick={() => onDoubleClick(blockId, column)}>
      <span className="animate-edit-fade">{rendered}</span>
    </td>
  );
});

type TableDataRowProps = {
  block: TranscriptionBlock;
  isSelected: boolean;
  onRowClick: (blockId: number) => void;
  onCellDoubleClick: (blockId: number, column: number) => void;
  blockRefs: MutableRefObject<Map<number, HTMLElement>>;
  /** Numéro de la page source (1 pour une image simple) — calculé côté frontend, jamais dans block.markdown. */
  pageNumber: number;
  /** Position de cette ligne dans SON groupe de tableau (repart à 1 à chaque nouveau tableau) — idem, jamais dans block.markdown. */
  rowNumber: number;
};

/**
 * Chaque ligne mémoïsée (React.memo) construit directement ses <td> à partir des
 * valeurs de cellules déjà découpées (getRowCellTexts, simple split de chaîne, pas
 * de Markdown/KaTeX ici) — plus besoin de faire parser toute la ligne comme un
 * mini-tableau GFM par <ReactMarkdown> : c'est TableDataCell, plus haut, qui
 * mémoïse individuellement le rendu KaTeX de chaque cellule sur sa propre valeur.
 * Confiance/Page/Ligne (colonnes 0 à 2 à l'écran) sont rendues à part, en texte
 * brut non éditable : Page/Ligne n'ont pas d'index de colonne réel dans
 * cellTexts (calculées côté frontend, absentes de block.markdown), donc le reste
 * des cellules garde son index RÉEL (column = i + 1) pour que l'édition par
 * cellule (onCellDoubleClick) continue de cibler la bonne colonne du markdown.
 */
export const TableDataRow = memo(function TableDataRow({
  block,
  isSelected,
  onRowClick,
  onCellDoubleClick,
  blockRefs,
  pageNumber,
  rowNumber,
}: TableDataRowProps) {
  const color = getConfidenceColor(block.confidence);
  const cellTexts = getRowCellTexts(block.markdown);

  return (
    <tr
      ref={(el) => { if (el) blockRefs.current.set(block.id, el); }}
      onClick={() => onRowClick(block.id)}
      style={{ cursor: 'pointer', color, backgroundColor: isSelected ? `${color}14` : undefined }}
    >
      <td>{cellTexts[CONFIDENCE_COLUMN]}</td>
      <td>{pageNumber}</td>
      <td>{rowNumber}</td>
      {cellTexts.slice(CONFIDENCE_COLUMN + 1).map((cellText, i) => {
        const column = i + CONFIDENCE_COLUMN + 1;
        return (
          <TableDataCell
            key={column}
            blockId={block.id}
            column={column}
            cellText={cellText}
            onDoubleClick={onCellDoubleClick}
          />
        );
      })}
    </tr>
  );
});
