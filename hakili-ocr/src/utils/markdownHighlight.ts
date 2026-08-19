/**
 * utils/markdownHighlight.ts
 * Rend le marqueur `==...==` du backend ("contenu incertain") en surbrillance
 * visuelle, dans les deux contextes où il peut apparaître : hors formule (via
 * le plugin remark `remarkRehypeOptions`) et à l'intérieur d'une formule
 * $...$/$$...$$ (via `preprocessMathHighlights`, un pré-traitement texte
 * distinct — voir pourquoi ci-dessous). Jamais appliqué à `editDraft`/`cellDraft` :
 * l'édition doit toujours montrer le Markdown/LaTeX brut.
 */
import type { Handler } from 'mdast-util-to-hast';

/*
 * ==mot== -> <mark>. Utilise remark-highlight-mark (extension de syntaxe micromark, au même
 * niveau que gras ou barré) et PAS une recherche/remplacement post-parsing sur les noeuds
 * texte : ces derniers échouent dès que le contenu contient une formule $...$, car remark-math
 * a déjà découpé le texte en plusieurs noeuds avant qu'une regex texte puisse voir les deux
 * '==' ensemble. Ceci ne couvre que les == EN DEHORS d'une formule : à l'intérieur d'un
 * $...$/$$...$$, remark-math traite tout le contenu comme un bloc opaque (le LaTeX ne doit pas
 * être ré-interprété comme du Markdown), donc remark-highlight-mark ne voit jamais les ==
 * qui y sont placés — voir preprocessMathHighlights ci-dessous pour ce cas.
 */
const uncertainMarkHandler: Handler = (state, node) => ({
  type: 'element',
  tagName: 'mark',
  properties: { className: ['ocr-uncertain'] },
  children: state.all(node),
});

/** À passer en `remarkRehypeOptions` à `<ReactMarkdown>` pour activer le rendu `==...==` → `<mark>` hors formule. */
export const remarkRehypeOptions = {
  handlers: { highlight: uncertainMarkHandler },
};

/*
 * ==incertain== À L'INTÉRIEUR d'une formule ($...$ ou $$...$$) : remark-highlight-mark ne peut
 * pas les convertir (voir commentaire ci-dessus), donc les == restent littéraux dans le code
 * envoyé à KaTeX, qui les affiche comme deux signes '=' collés. On les convertit nous-mêmes,
 * avant le parsing Markdown, en \colorbox{...}{...} — une commande LaTeX que KaTeX rend
 * nativement — pour obtenir un surlignage visuel équivalent au <mark> utilisé hors formule.
 * Ne touche jamais editDraft/cellDraft (la source affichée en édition doit rester le vrai
 * Markdown/LaTeX brut, pas cette version transformée pour l'affichage).
 */
const UNCERTAIN_KATEX_BG = '#FDE3B8';

/** Convertit les `==...==` trouvés à l'intérieur d'une seule expression LaTeX en `\colorbox{...}{...}`. */
function highlightUncertainInMathSource(mathSource: string): string {
  return mathSource.replace(/==(.+?)==/g, `\\colorbox{${UNCERTAIN_KATEX_BG}}{$1}`);
}

/** Pré-traite le Markdown brut avant `<ReactMarkdown>` : repère chaque span $...$/$$...$$ et y applique `highlightUncertainInMathSource`. */
export function preprocessMathHighlights(markdown: string): string {
  return markdown.replace(
    /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g,
    (_match, display: string | undefined, inline: string | undefined) =>
      display !== undefined
        ? `$$${highlightUncertainInMathSource(display)}$$`
        : `$${highlightUncertainInMathSource(inline as string)}$`
  );
}

/*
 * Pour les exports (PDF/Excel, cf. `utils/exportSanitize.ts`) : le marqueur `==...==`
 * n'a aucun sens hors de l'app (pas de rendu <mark>/colorbox possible dans un fichier
 * Excel, et le PDF exporté doit rester tout en noir, cf. CLAUDE.md). On le supprime
 * donc entièrement en ne gardant que le contenu qu'il entourait — un simple remplacement
 * global suffit ici (contrairement à `preprocessMathHighlights`) car on ne cherche pas à
 * distinguer l'intérieur d'une formule du reste : dans les deux cas le résultat voulu est
 * le même, ne garder que le texte intérieur.
 */
export function stripUncertainMarkers(markdown: string): string {
  return markdown.replace(/==(.+?)==/g, '$1');
}
