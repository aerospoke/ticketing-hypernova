import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// En desarrollo (`npm run dev -w admin`) se usa el mismo esquema que en Docker: el portal
// habla con /v1 en su propio origen y el proxy lo manda a la API (sin CORS).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/v1': process.env.API_URL ?? 'http://localhost:3000',
      '/ready': process.env.API_URL ?? 'http://localhost:3000',
    },
  },
})
