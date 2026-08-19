/**
 * hooks/pdfWorkerEntry.ts
 * Point d'entrée du Web Worker pdfjs-dist (chargé via `new Worker(new URL(...))`
 * dans `usePdfPreview.ts`), avec un polyfill de `Promise.withResolvers` posé
 * dans le scope du Worker lui-même — un polyfill posé côté thread principal
 * n'a aucun effet ici, un Worker a son propre global scope isolé.
 *
 * `pdf.worker.min.mjs` (build standard ET legacy) utilise `Promise.withResolvers`
 * en interne (sendWithPromise, WorkerTask, le PdfManager en mémoire utilisé par
 * `getDocument({ data })`, ChunkedStreamManager) sans aucun fallback. C'est une
 * méthode ES2024 récente (non supportée avant Firefox 121 / Chrome 119 / Safari
 * 17.4) : sur un navigateur plus ancien, l'appel échoue à l'intérieur du Worker,
 * en réponse à un message du thread principal — donc de façon asynchrone, sans
 * jamais déclencher l'événement `error` du Worker ni rejeter la promesse de
 * `getDocument()` côté thread principal. Résultat observé : l'aperçu PDF reste
 * indéfiniment vide (isLoading bloqué à `true`, aucun message d'erreur), sans
 * rien dans la console — cf. PreviewScreen.tsx/usePdfPreview.ts.
 */
// `lib` du projet est ES2023 : Promise.withResolvers (ES2024) n'y est pas encore
// typé. Augmentation locale plutôt que de relever `lib` globalement au projet.
declare global {
  interface PromiseConstructor {
    withResolvers<T>(): {
      promise: Promise<T>;
      resolve: (value: T | PromiseLike<T>) => void;
      reject: (reason?: unknown) => void;
    };
  }
}

if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

import 'pdfjs-dist/build/pdf.worker.min.mjs';
