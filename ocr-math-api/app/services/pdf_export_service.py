"""
pdf_export_service.py
Génère un vrai PDF (texte vectoriel, pas une capture d'écran rasterisée) à
partir du HTML déjà rendu côté frontend (React + KaTeX, cf.
`hakili-ocr/src/utils/exportPdf.tsx`) : ce module se contente d'envelopper ce
fragment dans un document HTML complet avec un template d'export dédié — feuille
de style print (@page, pagination par ligne de tableau, tout en noir, colonnes
qui passent à la ligne au lieu de tronquer) — puis appelle WeasyPrint, qui
convertit HTML/CSS en PDF nativement (pas de navigateur headless).

KaTeX ayant déjà transformé chaque formule en HTML/CSS statique côté frontend
avant l'envoi, WeasyPrint n'a besoin d'exécuter aucun JavaScript : il lui suffit
de la feuille de style katex.min.css (copiée localement dans app/static/katex/,
cf. son propre commentaire d'origine) pour positionner les glyphes correctement.
"""

from pathlib import Path

_STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
_KATEX_CSS_PATH = _STATIC_DIR / "katex" / "katex.min.css"

# Tout le texte est forcé en noir (`color: #000 !important`) : le surlignage
# jaune du contenu "incertain" (`.ocr-uncertain`, cf. markdownHighlight.ts côté
# frontend) n'a de sens que dans l'interface interactive, jamais dans un
# document exporté — et le marqueur `==...==` lui-même est de toute façon déjà
# retiré avant l'envoi (`utils/exportSanitize.ts`), donc `.ocr-uncertain`
# n'apparaît normalement plus du tout ; cette règle reste une protection en
# profondeur si un cas y échappait.
_EXPORT_TEMPLATE = """<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="{katex_css_href}">
<style>
  @page {{
    size: A4;
    margin: 16mm 12mm;
  }}
  * {{
    color: #000 !important;
  }}
  body {{
    background: #fff;
    font-family: "DejaVu Sans", "Helvetica", "Arial", sans-serif;
    font-size: 12px;
    line-height: 1.5;
  }}
  h2 {{
    font-size: 15px;
    font-weight: 600;
    margin: 1.2em 0 0.6em;
  }}
  h2:first-child {{
    margin-top: 0;
  }}
  mark {{
    background: transparent !important;
    text-decoration: none !important;
  }}
  table {{
    border-collapse: collapse;
    table-layout: auto;
    width: 100%;
    margin: 0.6em 0;
  }}
  /* Une ligne de tableau ne doit jamais être coupée entre deux pages ; si elle
     est plus haute qu'une page (cas extrême), WeasyPrint la coupe quand même
     plutôt que de la perdre. */
  tr {{
    break-inside: avoid;
    page-break-inside: avoid;
  }}
  th, td {{
    border: 1px solid #000;
    padding: 4px 6px;
    text-align: left;
    vertical-align: top;
    /* Les cellules longues passent à la ligne au lieu d'être tronquées —
       largeur de colonne dérivée du contenu (`table-layout: auto`), jamais
       fixe. */
    white-space: normal;
    overflow-wrap: anywhere;
    word-break: break-word;
  }}
  th {{
    background-color: #eee !important;
    font-weight: 600;
  }}
  .katex {{
    font-size: 1em;
  }}
  .block {{
    padding: 8px 12px;
    text-align: center;
  }}
  .table-wrap {{
    padding: 8px 0;
  }}
</style>
</head>
<body>
{content}
</body>
</html>
"""


def render_export_pdf(content_html: str) -> bytes:
    """
    Enveloppe `content_html` (fragment déjà rendu par React/KaTeX côté
    frontend) dans le template d'export et retourne les octets du PDF généré
    par WeasyPrint.

    Import de `weasyprint` différé jusqu'ici (plutôt qu'en haut du module) :
    sur Windows, l'import échoue tant que le runtime GTK3 (Pango/GObject)
    n'est pas installé sur la machine — un import au niveau module ferait
    planter le démarrage de toute l'API (les autres routes n'ont rien à voir
    avec WeasyPrint), au lieu de ne faire échouer que cet endpoint précis.
    """
    from weasyprint import HTML

    document = _EXPORT_TEMPLATE.format(
        katex_css_href=_KATEX_CSS_PATH.as_uri(),
        content=content_html,
    )
    return HTML(string=document).write_pdf()
