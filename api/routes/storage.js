// Rotas de gerenciamento de armazenamento (usuário) e controle de cotas (criadora).

import { LIMITS } from '../config.js';
import { json } from '../http.js';
import { SOCIAL_PDF_BYTES } from '../../public/social-domain.js';
import { replaceSocialAttachment, SocialError } from '../domain/social-feed.js';
import {
  deleteStorageItem,
  listCreatorStorageAccounts,
  setAccountStorageTier,
  storageOverview,
} from '../domain/storage.js';

const ACCOUNT = { auth: 'Entre na sua conta para gerenciar seu armazenamento.', origin: true };
const REPLACE_ATTEMPTS = {
  key: (ctx) => `storage-replace|${ctx.user?.id || ctx.clientIp}`,
  limit: 30,
  message: 'Muitas otimizações em pouco tempo. Aguarde alguns minutos.',
  code: 'rate_limited',
};

export function storageRoutes(router) {
  router.add('GET', '/api/storage', ACCOUNT, async (ctx) =>
    json(await storageOverview(ctx.db, ctx.media, ctx.user.id, ctx.config)));

  router.add('PUT', '/api/storage/items/social/:itemId/replace', { ...ACCOUNT, rateLimit: REPLACE_ATTEMPTS }, async (ctx) => {
    const tooLarge = () => new SocialError('O anexo pode ter até 10 MB.', 'file_too_large', 413);
    const declared = Number(ctx.request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > SOCIAL_PDF_BYTES) throw tooLarge();
    const bytes = await ctx.bytes(SOCIAL_PDF_BYTES, tooLarge);
    let name = '';
    try { name = decodeURIComponent(ctx.request.headers.get('x-file-name') || ''); } catch { name = ''; }
    const replaced = await replaceSocialAttachment(ctx.db, ctx.media, ctx.user.id, ctx.params.itemId, { bytes, name, config: ctx.config });
    return json({ ...replaced, storage: await storageOverview(ctx.db, ctx.media, ctx.user.id, ctx.config) });
  });

  router.add('DELETE', '/api/storage/items/:kind/:itemId', ACCOUNT, async (ctx) =>
    json(await deleteStorageItem(ctx.db, ctx.media, ctx.user.id, ctx.params.kind, ctx.params.itemId, ctx.config)));

  router.add('GET', '/api/admin/storage', ACCOUNT, async (ctx) =>
    json(await listCreatorStorageAccounts(ctx.db, ctx.config, ctx.user, {
      q: ctx.url.searchParams.get('q') || '',
      filter: ctx.url.searchParams.get('filter') || 'all',
    })));

  router.add('PATCH', '/api/admin/storage/:userId', ACCOUNT, async (ctx) => {
    const body = await ctx.json(LIMITS.tiny);
    return json(await setAccountStorageTier(ctx.db, ctx.config, ctx.user, ctx.params.userId, body?.plan));
  });
}
