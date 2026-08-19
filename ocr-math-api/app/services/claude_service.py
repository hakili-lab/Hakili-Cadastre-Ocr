"""
claude_service.py
Logique d'appel à l'API Anthropic pour la transcription OCR de mathématiques manuscrites.
Reprend fidèlement la logique du script ocr_math_claude.py original.
"""

import json
import logging
import re
from functools import lru_cache

import anthropic
from pydantic import ValidationError

from app.config import get_settings
from app.models.schemas import OCRResult

logger = logging.getLogger(__name__)


@lru_cache
def _get_client() -> anthropic.AsyncAnthropic:
    """
    Client Anthropic asynchrone, réutilisé entre tous les appels (connexions HTTP
    gardées en keep-alive) au lieu d'en recréer un à chaque page transcrite.
    """
    settings = get_settings()
    return anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
SYSTEM_PROMPT = (
    "Tu es un expert OCR spécialisé dans l'analyse de documents manuscrits : copies de "
    "mathématiques, papiers administratifs et documents comptables (tableaux, formulaires, "
    "relevés). Produis une transcription structurée en Markdown, formules en LaTeX ($...$ ou "
    "$$...$$).\n\n"
    "RATURES : ignore complètement ratures, gribouillages, taches d'encre, calculs biffés, "
    "notes illisibles ou barrées. Ne transcris que le contenu final propre et lisible ; si une "
    "formule est partiellement raturée, transcris la partie visible et baisse la confiance.\n\n"
    "FORMAT : Markdown standard (gras **...**, listes) ; LaTeX inline $...$ (ex: $f(x)=x^2$), "
    "display $$...$$ ; pas de blocs ```markdown, texte brut uniquement.\n\n"
    "CONTENU INCERTAIN : entoure de ==...== tout contenu dont tu doutes de la lecture exacte, "
    "même un seul caractère — chiffre, lettre, symbole, mot ou expression entière, y compris "
    "À L'INTÉRIEUR d'une formule $...$. N'utilise PAS ce marqueur pour une rature (ignorée, pas "
    "transcrite) ni pour une phrase entière sans raison précise. Ex : \"Le ==résultat== est "
    "$x = ==3==$\", \"$a^{==n==}$\".\n\n"
    "TABLEAUX : un bloc par ligne de données, jamais un bloc pour tout le tableau. Chaque "
    "bloc-ligne répète l'en-tête + séparateur (|---|---|) suivis de sa seule ligne de données, "
    "avec son propre id, label (\"Tableau - Ligne N\"), bbox (limitée à cette ligne) et "
    "confidence. N'ajoute PAS de colonne confiance toi-même (ajoutée automatiquement par le "
    "système) — ne transcris que les colonnes réellement présentes.\n\n"
    "ANNOTATION EN COULEUR DIFFÉRENTE — UNIQUEMENT pour les tableaux de papiers "
    "administratifs/comptables (jamais pour les tableaux d'exercices de mathématiques) : si une "
    "cellule porte, en plus du texte d'origine, une écriture manuscrite dans une couleur "
    "nettement différente (souvent rouge vs. texte d'origine noir/bleu), parfois débordant de "
    "la cellule — ce n'est ni une incertitude (==...==) ni une rature, le texte est lisible et "
    "doit être conservé. Ajoute alors une colonne supplémentaire \"Annotation\" à la fin de CE "
    "tableau (cellule vide sur les lignes sans annotation), et transcris la cellule d'origine "
    "SANS cette écriture — ne les mélange jamais dans la même cellule. N'ajoute cette colonne "
    "que si au moins une ligne du tableau en a besoin.\n\n"
    "Pour chaque bloc : 1) markdown valide (LaTeX pour les formules) ; 2) bbox en PIXELS "
    "ABSOLUS entiers (x_min, y_min, x_max, y_max), origine en haut à gauche, x vers la droite, "
    "y vers le bas — dimensions exactes données dans le message utilisateur, n'estime jamais de "
    "fraction toi-même ; 3) confidence 0-100 ; 4) final_warning si des zones sont douteuses.\n\n"
    "Réponds UNIQUEMENT avec un objet JSON valide, sans texte avant ou après, au format :\n"
    "{\n"
    '  "blocks": [\n'
    "    {\n"
    '      "id": 1,\n'
    '      "label": "Exercice 1 - Question a",\n'
    '      "markdown": "**a)** Résoudre graphiquement $f(x) = 1$. On obtient ==environ== $x = ==3==$",\n'
    '      "bbox": { "x_min": 48, "y_min": 131, "x_max": 912, "y_max": 327 },\n'
    '      "confidence": 95\n'
    "    },\n"
    "    {\n"
    '      "id": 2,\n'
    '      "label": "Tableau - Ligne 1",\n'
    '      "markdown": "| Élève | Note | Annotation |\\n|---|---|---|\\n| Awa | 15 | |",\n'
    '      "bbox": { "x_min": 60, "y_min": 400, "x_max": 700, "y_max": 440 },\n'
    '      "confidence": 90\n'
    "    },\n"
    "    {\n"
    '      "id": 3,\n'
    '      "label": "Tableau - Ligne 2",\n'
    '      "markdown": "| Élève | Note | Annotation |\\n|---|---|---|\\n| ==Boubacar== | 12 | Vu, à corriger |",\n'
    '      "bbox": { "x_min": 60, "y_min": 440, "x_max": 700, "y_max": 480 },\n'
    '      "confidence": 70\n'
    "    }\n"
    "  ],\n"
    '  "final_warning": "La zone en bas à droite est floue ; les indices de sommation sont incertains."\n'
    "}"
)

def build_user_prompt(image_width: int, image_height: int) -> str:
    return (
        f"Document manuscrit (mathématiques, administratif ou comptable), {image_width}x"
        f"{image_height} pixels EXACTEMENT — utilise ces dimensions pour les bbox en pixels "
        f"absolus, n'estime jamais de fraction toi-même. Renvoie UNIQUEMENT le JSON demandé, "
        f"sans balises markdown ni explications, contenu en Markdown avec LaTeX ($...$/$$...$$) "
        f"si le document en contient. Si un tableau administratif/comptable a une écriture en "
        f"couleur différente sur une cellule, ajoute-lui une colonne \"Annotation\" dédiée — ne "
        f"la mélange jamais à la cellule d'origine."
    )

def extract_json_from_markdown(text: str) -> str:
    """Nettoie une réponse potentiellement enveloppée dans des balises markdown ```json ... ```."""
    pattern = r"```(?:json)?\s*(.*?)\s*```"
    match = re.search(pattern, text, re.DOTALL)
    if match:
        return match.group(1).strip()
    return text.strip()


def inject_confidence_column(markdown: str, confidence: int) -> str:
    """
    Ajoute une première colonne "Confiance" à un bloc-tableau, à partir du score de
    confiance du bloc lui-même (source de vérité unique — pas laissé à Claude de le
    retranscrire, pour éviter toute incohérence avec la couleur affichée sur la bbox).
    Ne touche pas au markdown si ce n'est pas un tableau (toutes les lignes non vides
    doivent commencer par '|').
    """
    lines = markdown.split("\n")
    content_lines = [line for line in lines if line.strip()]
    if len(content_lines) < 2 or not all(line.strip().startswith("|") for line in content_lines):
        return markdown

    def insert_first_cell(line: str, cell_content: str) -> str:
        rest = line.strip()[1:]
        return f"| {cell_content} |{rest}"

    new_lines = []
    row_index = 0
    for line in lines:
        if not line.strip():
            new_lines.append(line)
            continue
        if row_index == 0:
            new_lines.append(insert_first_cell(line, "Confiance"))
        elif row_index == 1:
            new_lines.append(insert_first_cell(line, "---"))
        else:
            new_lines.append(insert_first_cell(line, f"{confidence}%"))
        row_index += 1

    return "\n".join(new_lines)


def describe_anthropic_error(exc: anthropic.APIError) -> str:
    """
    Message destiné à l'utilisateur final pour une erreur API Anthropic. Cas
    particulier détecté explicitement : crédit insuffisant sur le compte
    Anthropic (400 invalid_request_error "credit balance is too low"), qui
    renverrait sinon le JSON brut (illisible, non actionnable) tel quel à
    l'utilisateur.
    """
    if getattr(exc, "status_code", None) == 400 and "credit balance" in str(exc).lower():
        return (
            "Le service de transcription est temporairement indisponible : crédits "
            "insuffisants sur le compte Anthropic. Contactez l'administrateur pour "
            "recharger le compte."
        )
    return str(exc)


def _is_blank_table_row_block(markdown: str) -> bool:
    """
    Un bloc-ligne de tableau (convention "un bloc par ligne" du prompt : toutes ses
    lignes non vides commencent par '|', même définition que isTableBlockMarkdown côté
    frontend dans tableMarkdown.ts) est considéré vide s'il n'a pas de 3e ligne (la
    ligne de données, après en-tête + séparateur) ou si celle-ci ne contient, une fois
    les '|' retirés, aucun caractère non-blanc (toutes les cellules sont vides).
    Renvoie False pour un bloc non-tableau (n'importe quel autre contenu à 1 ou 2
    lignes ne doit pas être traité comme une ligne de tableau vide).
    """
    lines = [line.strip() for line in markdown.split("\n") if line.strip()]
    if len(lines) < 2 or not all(line.startswith("|") for line in lines):
        return False
    if len(lines) < 3:
        return True
    data_line = lines[2]
    return not data_line.replace("|", "").strip()


def parse_claude_response(text: str, image_width: int, image_height: int) -> OCRResult:
    """
    Extrait le JSON renvoyé par Claude (bbox en pixels absolus), convertit chaque bbox
    en fraction 0-1 par rapport à la taille EXACTE de l'image envoyée (pas la taille
    originale, pas une taille "paddée" par Claude), puis valide via Pydantic.
    """
    cleaned = extract_json_from_markdown(text)

    try:
        raw_data = json.loads(cleaned)

    except json.JSONDecodeError as exc:
        logger.error("Échec du parsing JSON. Réponse brute de Claude : %s", text)
        raise ValueError("La réponse de Claude n'est pas un JSON valide.") from exc

    blocks = raw_data.get("blocks", [])
    kept_blocks = []
    for block in blocks:
        if _is_blank_table_row_block(block.get("markdown", "")):
            logger.warning(
                "Bloc-ligne de tableau vide (id=%s, label=%r) détecté et supprimé "
                "avant envoi au frontend.", block.get("id"), block.get("label"),
            )
            continue
        kept_blocks.append(block)
    raw_data["blocks"] = kept_blocks

    for block in raw_data["blocks"]:
        bbox = block.get("bbox", {})
        for key, denom in (("x_min", image_width), ("x_max", image_width),
                            ("y_min", image_height), ("y_max", image_height)):
            if key in bbox:
                bbox[key] = max(0.0, min(1.0, bbox[key] / denom))

        if "markdown" in block and "confidence" in block:
            block["markdown"] = inject_confidence_column(block["markdown"], block["confidence"])

    try:
        return OCRResult.model_validate(raw_data)
    except ValidationError as exc:
        logger.error("Le JSON de Claude ne respecte pas le schéma attendu : %s", exc)
        raise ValueError(
            "La réponse de Claude ne respecte pas le format attendu (schéma invalide)."
        ) from exc


async def call_anthropic_ocr(image_b64: str, media_type: str, image_width: int, image_height: int) -> OCRResult:
    """
    Envoie l'image (déjà en base64, déjà redimensionnée à image_width x image_height)
    à l'API Anthropic et retourne un OCRResult validé.
    Appel asynchrone (AsyncAnthropic) : ne bloque pas l'event loop FastAPI, ce qui permet
    de traiter plusieurs pages en parallèle (asyncio.gather) côté appelant.
    """
    settings = get_settings()
    settings.validate()

    client = _get_client()

    try:
        message = await client.messages.create(
            model=settings.MODEL,
            max_tokens=settings.MAX_TOKENS,
            system=SYSTEM_PROMPT,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": image_b64,
                            },
                        },
                        {
                            "type": "text",
                            "text": build_user_prompt(image_width, image_height),
                        },
                    ],
                }
            ],
        )
    except anthropic.APIError as exc:
        logger.exception("Erreur lors de l'appel à l'API Anthropic")
        raise

    if message.stop_reason == "max_tokens":
        logger.error(
            "Réponse Claude tronquée (max_tokens=%d atteint). Augmentez MAX_TOKENS.",
            settings.MAX_TOKENS,
        )
        raise ValueError(
            "La réponse de Claude a été coupée avant la fin (limite de tokens atteinte). "
            "Augmentez MAX_TOKENS dans la configuration."
        )

    response_text = "".join(
        block.text for block in message.content if block.type == "text"
    )

    return parse_claude_response(response_text, image_width, image_height)