/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL du backend ocr-math-api. Repli sur http://127.0.0.1:8000 si absente (voir src/services/apiClient.ts). */
  readonly VITE_API_BASE_URL: string;
  /** Doit être identique à APP_API_KEY côté backend — envoyée dans le header X-API-Key. */
  readonly VITE_APP_API_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
