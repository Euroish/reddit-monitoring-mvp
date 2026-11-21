import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { ApiError } from './contracts/api';
import './styles/tokens.css';
import './styles/global.css';
import './styles/homepage.css';
import './styles/public-site.css';
import './styles/auth.css';
import './styles/workbench.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (failureCount, error) => {
        if (error instanceof ApiError) {
          if (error.status === 401) {
            queryClient.invalidateQueries({ queryKey: ['session'] });
            return false;
          }
          if ([403, 404, 409, 413, 422, 429].includes(error.status)) {
            return false;
          }
          return error.retryable && failureCount < 2;
        }
        return failureCount < 1;
      },
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
