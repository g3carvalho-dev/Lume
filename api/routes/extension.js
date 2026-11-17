import { json } from '../http.js';
import { MIN_EXTENSION_VERSION } from '../../public/extension-domain.js';
import { applyWatchEvent, resolveWatchLesson } from '../domain/watch.js';

export function extensionRoutes(router) {
  const options = limit => ({ auth:'Entre no Lume para acompanhar a aula.', authCode:'extension_signed_out', origin:'extension',
    rateLimit:{key:ctx=>'extension|'+ctx.url.pathname+'|'+ctx.user.id, limit, code:'rate_limited', message:'Aguarde um momento e tente novamente.'} });
  const status = ctx => json({signedIn:true,name:ctx.user.name,minVersion:MIN_EXTENSION_VERSION});
  router.add('GET','/api/extension/status',options(120),status);
  // O Chrome 157 omite Origin no GET do service worker autorizado. O POST de
  // consulta envia a origem real do navegador e usa a mesma lista de acesso.
  router.add('POST','/api/extension/status',options(120),status);
  router.add('GET','/api/extension/lesson',options(240),async ctx=>json(await resolveWatchLesson(ctx.db,ctx.user.id,ctx.url.searchParams.get('url'))));
  router.add('POST','/api/extension/lesson',options(240),async ctx=>json(await resolveWatchLesson(ctx.db,ctx.user.id,(await ctx.json(8192)).url)));
  router.add('POST','/api/extension/watch',options(600),async ctx=>json(await applyWatchEvent(ctx.db,ctx.user.id,await ctx.json(8192))));
}
