import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from './context/ThemeContext'
import { FilterProvider } from './context/FilterContext'
import App from './App'
import './index.css'

const REFRESH_INTERVAL = Number(import.meta.env.VITE_REFRESH_INTERVAL) || 7_200_000

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: REFRESH_INTERVAL,
      gcTime: REFRESH_INTERVAL * 2,
      refetchInterval: REFRESH_INTERVAL,
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <FilterProvider>
          <App />
        </FilterProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>
)
