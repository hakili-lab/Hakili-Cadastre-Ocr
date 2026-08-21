/**
 * context/AppContext.tsx
 * État global de l'application : un seul `useReducer` piloté par `AppAction`
 * (types/index.ts), exposé via `useApp()`. Tient lieu de "store" — pas de
 * Redux/Zustand, l'app n'a qu'un seul flux d'écrans linéaire (upload → preview
 * → loading → result) qui ne justifie pas plus.
 */
import React, { createContext, useContext, useReducer, type ReactNode } from 'react';
import type {
  AppState,
  AppAction,
  PDFTranscriptionResult,
  TranscriptionPayload,
} from '../types';

const initialState: AppState = {
  currentScreen: 'upload',
  uploadedImage: null,
  imagePreviewUrl: null,
  transcriptionResult: null,
  selectedBlockId: null,
  pdfResult: null,
  currentPageIndex: 0,
  pdfPagesTotal: null,
};

/** Distingue les deux formes de payload que `SET_RESULT` peut recevoir (image seule vs PDF multi-pages). */
function isPDFResult(payload: TranscriptionPayload): payload is PDFTranscriptionResult {
  return 'pages' in payload;
}

/**
 * Reducer applicatif. `UPDATE_BLOCK_MARKDOWN`/`UPDATE_BLOCK_BBOX` dupliquent la
 * même structure de mise à jour (met à jour `transcriptionResult.blocks` et,
 * si un PDF est chargé, la page courante dans `pdfResult.pages`) — assumé tel
 * quel plutôt que factorisé prématurément pour deux occurrences seulement.
 */
function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'NAVIGATE':
      return { ...state, currentScreen: action.screen };

    case 'SET_IMAGE':
      return {
        ...state,
        uploadedImage: action.file,
        imagePreviewUrl: action.previewUrl,
        currentScreen: 'preview',
        pdfResult: null,
        currentPageIndex: 0,
        pdfPagesTotal: null,
      };

    case 'CONFIRM_UPLOAD':
      return {
        ...state,
        uploadedImage: action.file,
        imagePreviewUrl: action.previewUrl ?? state.imagePreviewUrl,
        currentScreen: 'loading',
      };

    case 'CANCEL_PREVIEW':
      return {
        ...state,
        uploadedImage: null,
        imagePreviewUrl: null,
        currentScreen: 'upload',
      };

    case 'SET_RESULT': {
      const payload = action.result;
      if (isPDFResult(payload)) {
        return {
          ...state,
          pdfResult: payload,
          transcriptionResult: payload.pages[0]?.ocr || null,
          imagePreviewUrl: payload.pages[0]
            ? `data:${payload.pages[0].media_type};base64,${payload.pages[0].image_b64}`
            : null,
          currentScreen: 'result',
          selectedBlockId: null,
          currentPageIndex: 0,
          pdfPagesTotal: action.pagesTotal ?? payload.pages.length,
        };
      }
      return {
        ...state,
        transcriptionResult: payload,
        pdfResult: null,
        currentScreen: 'result',
        selectedBlockId: null,
        currentPageIndex: 0,
        pdfPagesTotal: null,
      };
    }

    // Ajoute les pages nouvellement prêtes à un `pdfResult` déjà affiché — dispatché à
    // chaque poll une fois l'écran 'result' déjà atteint (voir App.tsx). `action.result.pages`
    // est garanti par `useTranscribe.ts` (`takeReadyPagePrefix`) être une extension du
    // préfixe déjà stocké (même contenu pour les pages déjà chargées, jamais réécrites une
    // fois transcrites) — un simple remplacement du tableau est donc sûr, sans avoir besoin
    // de fusionner élément par élément. `currentPageIndex`/`selectedBlockId` et les éditions
    // déjà faites sur les pages en place ne sont jamais touchés.
    case 'MERGE_PDF_RESULT': {
      if (!state.pdfResult) return state;
      const incomingPages = action.result.pages;
      const pagesTotal = action.pagesTotal ?? state.pdfPagesTotal;
      if (incomingPages.length <= state.pdfResult.pages.length) {
        return pagesTotal === state.pdfPagesTotal ? state : { ...state, pdfPagesTotal: pagesTotal };
      }
      return {
        ...state,
        pdfResult: {
          ...state.pdfResult,
          pages: incomingPages,
          final_warning: action.result.final_warning ?? state.pdfResult.final_warning,
        },
        pdfPagesTotal: pagesTotal,
      };
    }

    case 'SET_PAGE':
      if (!state.pdfResult) return state;
      const page = state.pdfResult.pages[action.pageIndex];
      if (!page) return state;
      return {
        ...state,
        currentPageIndex: action.pageIndex,
        transcriptionResult: page.ocr,
        imagePreviewUrl: `data:${page.media_type};base64,${page.image_b64}`,
        selectedBlockId: null,
      };

    case 'SELECT_BLOCK':
      return { ...state, selectedBlockId: action.blockId };

    case 'UPDATE_BLOCK_MARKDOWN': {
      if (!state.transcriptionResult) return state;
      const updatedBlocks = state.transcriptionResult.blocks.map((b) =>
        b.id === action.blockId ? { ...b, markdown: action.markdown } : b
      );
      const newTranscriptionResult = { ...state.transcriptionResult, blocks: updatedBlocks };

      let newPdfResult = state.pdfResult;
      if (state.pdfResult) {
        const updatedPages = [...state.pdfResult.pages];
        updatedPages[state.currentPageIndex] = {
          ...updatedPages[state.currentPageIndex],
          ocr: newTranscriptionResult,
        };
        newPdfResult = { ...state.pdfResult, pages: updatedPages };
      }

      return {
        ...state,
        transcriptionResult: newTranscriptionResult,
        pdfResult: newPdfResult,
      };
    }

    case 'UPDATE_BLOCK_BBOX': {
      if (!state.transcriptionResult) return state;
      const updatedBlocks = state.transcriptionResult.blocks.map((b) =>
        b.id === action.blockId ? { ...b, bbox: action.bbox } : b
      );
      const newTranscriptionResult = { ...state.transcriptionResult, blocks: updatedBlocks };

      let newPdfResult = state.pdfResult;
      if (state.pdfResult) {
        const updatedPages = [...state.pdfResult.pages];
        updatedPages[state.currentPageIndex] = {
          ...updatedPages[state.currentPageIndex],
          ocr: newTranscriptionResult,
        };
        newPdfResult = { ...state.pdfResult, pages: updatedPages };
      }

      return {
        ...state,
        transcriptionResult: newTranscriptionResult,
        pdfResult: newPdfResult,
      };
    }

    case 'RESET':
      return { ...initialState };

    default:
      return state;
  }
}

interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
}

const AppContext = createContext<AppContextValue | null>(null);

/** Accès à `{ state, dispatch }` depuis n'importe quel composant sous `<AppProvider>`. */
export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useApp doit être utilisé à l'intérieur d'un AppProvider");
  }
  return context;
}

interface AppProviderProps {
  children: ReactNode;
}

/** Fournit `AppContext` à tout l'arbre — monté une seule fois dans `main.tsx`. */
export function AppProvider({ children }: AppProviderProps) {
  const [state, dispatch] = useReducer(appReducer, initialState);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}