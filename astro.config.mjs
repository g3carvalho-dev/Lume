import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

// HTML e bundles estáticos; a API permanece no Worker existente, sem SSR pago.
export default defineConfig({
  integrations: [react()],
  output: 'static',
  // Arquivos .js sob /api são módulos importados pelo front (public/slides-domain.js
  // usa api/domain/media.js); só o resto vai para a API.
  vite: { server: { proxy: { '/api': { target: `http://127.0.0.1:${process.env.LUME_API_PORT || '4173'}`, bypass: (req) => (/^\/api\/[^?]*\.js(\?|$)/.test(req.url) ? req.url : undefined) } } } },
});
