import { readsCompletion } from './providers/registry.js';

export const EXTENSION_STORE_URL = 'https://chromewebstore.google.com/detail/lcjchobdkejffabkoclbdpalbbkelcic';
export const MIN_EXTENSION_VERSION = '0.3.0';

export function supportedExtensionVersion(version) {
  if (!/^\d+(?:\.\d+){0,3}$/.test(version || '')) return false;
  const actual = version.split('.').map(Number);
  const minimum = MIN_EXTENSION_VERSION.split('.').map(Number);
  for (let i = 0; i < minimum.length; i++) {
    const difference = (actual[i] || 0) - minimum[i];
    if (difference) return difference > 0;
  }
  return true;
}

export function supportsCourseExtension(ua, touchPoints = 0) {
  return /(?:Chrome|Edg)\//.test(ua) && !/Electron|Android|Mobile|iPhone|iPad|OPR\/|SamsungBrowser/.test(ua)
    && !(/Macintosh/.test(ua) && touchPoints > 1);
}

export function extensionCapability(provider) {
  if (provider?.capabilities.requiresLogin) return `Abra o curso em ${provider.label} com a sua conta para ler a grade completa disponível na página.`;
  if (readsCompletion(provider)) return `Na ${provider.label}, a leitura inclui as marcas de conclusão disponíveis na grade.`;
  return 'Leia a grade na página aberta do curso e escolha as aulas que quer adicionar à biblioteca.';
}
