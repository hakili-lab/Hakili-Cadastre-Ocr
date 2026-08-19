/**
 * main.tsx
 * Point d'entrée Vite. Monte l'arbre React racine : `QueryClientProvider`
 * (React Query, utilisé par `useTranscribe.ts` pour les mutations/le polling
 * PDF) puis `AppProvider` (état global applicatif, `context/AppContext.tsx`).
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppProvider } from './context/AppContext';
import App from './App';
import './index.css';

// staleTime: 0 + retry: 1 + pas de refetch au focus : chaque transcription est
// un événement ponctuel déclenché par l'utilisateur, pas des données à tenir
// à jour en arrière-plan comme le ferait une app avec un cache de lecture classique.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppProvider>
        <App />
      </AppProvider>
    </QueryClientProvider>
  </StrictMode>
);