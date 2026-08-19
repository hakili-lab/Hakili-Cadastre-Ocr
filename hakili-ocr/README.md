# Hakili OCR — Frontend

Client **React 19 + TypeScript + Vite** de Hakili OCR : upload d'une photo ou
d'un PDF de copie manuscrite de mathématiques, puis affichage du résultat
transcrit (Markdown/LaTeX) côte à côte avec l'image source annotée
(bounding boxes colorées par score de confiance), avec édition en place du
texte et repositionnement des boîtes.

Ce frontend ne fonctionne pas seul : il consomme l'API REST exposée par
[`ocr-math-api/`](../ocr-math-api/README.md) (FastAPI + Claude/Anthropic).
Les deux projets sont indépendants (pas de monorepo, pas de tooling
partagé) et doivent tourner simultanément en développement. Pour le détail
d'architecture complet (backend inclus) et l'historique des décisions de
conception, voir le [`CLAUDE.md`](../CLAUDE.md) à la racine du dépôt — ce
README est un point d'entrée pour un humain qui découvre le projet, pas un
duplicata de cette référence.

## ✅ Prérequis

- Node.js 20+ et npm
- Le backend `ocr-math-api` démarré sur `http://127.0.0.1:8000` (voir son
  propre README) — sans lui, l'app se charge mais aucune transcription
  n'est possible (sauf en mode mock, voir plus bas).

## 🚀 Installation et lancement

```bash
npm install
npm run dev        # serveur de dev Vite sur http://localhost:5173
```

Si le port 5173 est déjà pris, Vite bascule automatiquement sur 5174 — dans
ce cas, vérifier que ce port est bien autorisé par le CORS du backend
(`ocr-math-api/app/main.py`).

Autres scripts :

```bash
npm run build       # tsc -b && vite build — build de production dans dist/
npm run lint         # oxlint
npm run preview      # sert le build de production en local
```

Il n'y a pas de suite de tests automatisée (pas de Jest/Vitest configuré).
`test_table.mjs` à la racine du dépôt est un script manuel autonome (`node
test_table.mjs`, non branché à `package.json`) pour visualiser comment
`remark-gfm`/`remark-rehype` transforment un tableau Markdown en HTML —
utile pour déboguer `ContentPanel`/`TableRow.tsx` sans repasser par le
navigateur.

⚠️ **Configuration actuellement en dur** : l'URL du backend (`API_BASE` dans
`src/services/apiClient.ts`) est codée en dur sur `http://127.0.0.1:8000` —
il n'y a pas de variable d'environnement à ce jour. Voir `CLAUDE.md` § *Production
readiness* pour le plan de correction avant un déploiement réel.

## 🗂️ Structure du projet

```
src/
├── main.tsx                 — point d'entrée (monte App + AppProvider + QueryClientProvider)
├── App.tsx                  — routage des 4 écrans, header global
├── App.css / index.css      — styles globaux Tailwind v4 (config CSS-based, pas de tailwind.config.js)
├── assets/                  — images statiques importées par le bundler
├── context/                 — état global (AppState/AppAction) via useReducer, pas de router
├── types/                   — types TS miroir des schémas Pydantic du backend (à resynchroniser manuellement)
├── hooks/                   — logique état/réseau réutilisable (transcription, preview PDF, drag de bbox)
├── services/                — client HTTP partagé + appels API par domaine (corrections)
├── utils/                   — fonctions pures (parsing markdown/tableaux, géométrie, couleurs, crop image)
└── components/
    ├── UploadScreen.tsx     — écran 1 : dépôt/sélection de fichier
    ├── PreviewScreen.tsx    — écran 2 : rotation avant envoi
    ├── LoadingScreen.tsx    — écran 3 : progression (générique ou réelle pour un PDF)
    ├── ResultScreen.tsx     — écran 4 : orchestration (compose les panneaux ci-dessous)
    └── result/              — sous-composants et contexts propres à l'écran Résultat
```

Le découpage suit une règle simple, appliquée de façon cohérente dans tout
le projet : un **hook** porte un sous-système d'état (ex. `useBlockDrag`,
`useCellEditing`), un **composant** porte un rendu (ex. `BlockOverlay`,
`TableRow`), et un **contexte** n'est introduit que pour éviter de faire
remonter une valeur qui changerait à haute fréquence à travers des
composants mémoïsés qu'elle invaliderait inutilement.

## 🧭 Flux de navigation

Quatre écrans (`upload` / `preview` / `loading` / `result`), pilotés par un
seul `useReducer` dans `context/AppContext.tsx` (`state.currentScreen`) —
pas de React Router, l'app ne gère qu'un seul flux linéaire :

```
upload --SET_IMAGE--> preview --CONFIRM_UPLOAD--> loading --SET_RESULT--> result
   ^                     |
   +----CANCEL_PREVIEW---+
```

`ResultScreen` gère en plus la navigation entre pages d'un PDF
(`SET_PAGE`) et les éditions en place (`UPDATE_BLOCK_MARKDOWN`,
`UPDATE_BLOCK_BBOX`), qui modifient un seul bloc dans `state` sans jamais
reparser tout le résultat.

## 🧩 Conventions à connaître avant de modifier `ResultScreen`

L'écran Résultat concentre la majorité de la complexité de l'app (édition
de blocs/cellules, glisser-déposer de bounding box, tableaux rendus ligne
par ligne). Quelques décisions structurantes, pour ne pas les redécouvrir
en débogant une régression de performance :

- **Contexte "rare" vs "haute fréquence" toujours séparé en deux**
  (`EditingCellContext`/`CellDraftContext` pour l'édition de cellule,
  `DraggingBlockContext`/`DragOffsetContext` pour le drag de bbox) : la
  valeur qui change à chaque frappe/`pointermove` est isolée dans son
  propre contexte, consommé uniquement par l'élément concerné, pour que les
  autres cellules/boîtes ne re-rendent jamais pendant une édition ou un
  drag.
- **Mémoïsation par élément, pas par liste** : `TableDataCell` (mémoïsé sur
  sa seule valeur de cellule) et `BlockOverlay` (mémoïsé, keyed sur
  `block.id`) rendent chacun indépendamment leur KaTeX/leur boîte — pas un
  seul `<ReactMarkdown>`/`.map()` partagé pour toute une ligne ou tout le
  tableau. Les handlers qui remontent vers `ResultScreen` doivent rester
  `useCallback`-stables (via des refs miroir type `blocksRef.current =
  blocks`) pour ne pas casser cette mémoïsation.
- **Édition toujours en Markdown/LaTeX brut**, jamais de rendu WYSIWYG —
  y compris pour une formule complexe (fraction, exposant), où ça produit
  un saut de mise en page visible à l'ouverture/fermeture de l'édition
  (compromis accepté, pas un bug).
- **`USE_MOCK`** (`src/hooks/useTranscribe.ts`) bascule toute l'app sur des
  fixtures locales (`MOCK_RESULT`/`MOCK_PDF_RESULT`), sans requête réseau —
  pratique pour développer l'UI sans backend ni clé API Anthropic. Il doit
  rester à `false` en usage normal.

## 📦 Dépendances principales

- `react` / `react-dom` (v19), `@tanstack/react-query` (mutations + polling)
- `react-markdown` + `remark-gfm` / `remark-math` / `remark-highlight-mark` +
  `rehype-katex` + `katex` — rendu Markdown/LaTeX avec surlignage `==...==`
- `pdfjs-dist` (preview PDF côté client) et `pdf-lib` (rotation de PDF avant envoi)
- `tailwindcss` v4 via `@tailwindcss/vite` (config CSS-based)
- `oxlint` — linting (pas de Prettier/ESLint configuré)

## 🔜 Prochaines étapes

Voir `CLAUDE.md` § *Known pending work* et § *Production readiness* à la
racine du dépôt pour la liste à jour (parallélisation du traitement PDF,
config d'URL/CORS par variable d'environnement, limite de concurrence sur
les appels Claude, etc.) — ce README n'en garde pas de copie pour éviter
qu'elle ne devienne obsolète.
