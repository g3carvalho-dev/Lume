import { randomUUID } from 'node:crypto';

// A fila pertence à janela do Lume: trocar de player termina a sessão anterior
// antes de enviar os eventos da próxima, mesmo quando a resposta demora.
const queues = new WeakMap();
function enqueue(host, work) {
  const next = (queues.get(host) || Promise.resolve()).then(work);
  queues.set(host, next.catch(() => {}));
  return next;
}

export function lessonTracking(host, getAddress, accepts, onUpdate) {
  const origin = new URL(host.getURL()).origin;
  let last;
  let stopped = false;

  function api(path, payload) {
    if (host.isDestroyed()) return Promise.resolve({login:true});
    // A requisição sai da origem do Lume, com a sessão da conta. As credenciais
    // da conta nunca entram no documento ou na partição da plataforma.
    return host.executeJavaScript(`(async () => {
      if (location.origin !== ${JSON.stringify(origin)}) return {login:true};
      const response = await fetch(${JSON.stringify(origin + '/api/extension/' + path)}, {
        method:'POST', credentials:'same-origin', redirect:'error',
        headers:{'Content-Type':'application/json'}, body:${JSON.stringify(JSON.stringify(payload))}
      });
      if (response.status === 401) return {login:true};
      if (!response.ok) throw Error('Falha no acompanhamento da aula');
      const result = await response.json();
      if (${path === 'watch'} && result.found)
        window.postMessage({source:'lume-extension',type:'library-changed'}, location.origin);
      return result;
    })()`);
  }

  async function finish() {
    if (last && last.state !== 'ended') {
      await api('watch', {...last, state:'ended', platformDone:null, eventId:randomUUID()});
    }
    last = null;
  }

  function handle(message) {
    if (stopped) return {found:false};
    const page = new URL(getAddress());
    const url = page.origin + page.pathname;
    if (message?.type === 'watch-resolve') {
      return enqueue(host, async () => {
        if (last && last.pageUrl !== url) await finish();
        if (message.pageUrl !== url || !accepts(url)) return {found:false};
        return api('lesson', {url});
      });
    }
    if (message?.type !== 'watch-event' || message.payload?.pageUrl !== url || !accepts(url)) return {found:false};
    return enqueue(host, async () => {
      const result = await api('watch', message.payload);
      last = result.found ? message.payload : null;
      if (!stopped && getAddress().split(/[?#]/)[0] === url) onUpdate(result, message.payload);
      return result;
    });
  }
  return {
    handle,
    navigate() { enqueue(host, finish).catch(() => {}); },
    close() { stopped = true; enqueue(host, finish).catch(() => {}); }
  };
}
