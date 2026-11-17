// Canal de tempo real (WebSocket). O aviso traz a novidade (mensagem, reação ou
// leitura) e ela é aplicada direto no cache de resources.js, sem ida ao servidor.
// Aviso sem conteúdo (mudança num grupo, pedido de amizade) pede a releitura só
// do que mudou. Com o canal aberto, a consulta periódica fica como reserva
// (intervalos longos); sem ele, volta aos intervalos curtos, então a conversa
// nunca depende só do WebSocket.

import { useEffect, useSyncExternalStore } from 'react';
import { invalidateResources, mutateResource, peekResource, refreshResourceFresh, resourceBusy } from './resources.js';
import { LIST_KEY, UNREAD_KEY, appendMessage, applyReaction, applyRead, isThreadKey, listWithMessage, threadKey } from './message-cache.js';

const HEARTBEAT_MS = 25000;
const PONG_WAIT_MS = 10000;
const MAX_BACKOFF_MS = 30000;

let live = false;
const listeners = new Set();
const watchers = new Set();

function setLive(value) {
  if (live === value) return;
  live = value;
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Verdadeiro enquanto o canal está aberto.
export function useRealtimeStatus() {
  return useSyncExternalStore(subscribe, () => live, () => false);
}

// Recebe cada aviso depois de aplicado ao cache, e `{ type: 'sync' }` quando o
// canal (re)abre e o que chegou no intervalo acabou de ser pedido.
export function onRealtimeEvent(watcher) {
  watchers.add(watcher);
  return () => watchers.delete(watcher);
}

function emit(event) {
  watchers.forEach((watcher) => { try { watcher(event); } catch { /* um ouvinte com erro não cala os outros */ } });
}

// Lista, contador e conversas em uso: nunca os ajustes (`/api/messages/settings`).
function refreshMessages() {
  invalidateResources((key) => key === LIST_KEY || key === UNREAD_KEY || isThreadKey(key));
}

const refreshOne = (wanted) => invalidateResources((key) => key === wanted);
// Só altera o que já está em cache: conversa nunca aberta não ganha uma entrada pela metade.
const patch = (key, change) => { if (peekResource(key) !== undefined) mutateResource(key, change); };

export function applyRealtimeEvent(event) {
  if (!event || typeof event !== 'object') return;
  if (event.type === 'friend_request') invalidateResources('/api/friends');
  if (event.type === 'message') {
    const key = threadKey(event.conversation);
    if (!key) refreshMessages();
    else if (!event.message) {
      // Mudança no grupo (criado, renomeado, alguém entrou ou saiu).
      refreshOne(LIST_KEY);
      refreshOne(UNREAD_KEY);
      refreshOne(key);
    } else {
      patch(key, (thread) => appendMessage(thread, event.message));
      let found = false;
      patch(LIST_KEY, (list) => {
        const next = listWithMessage(list, event);
        found = next.found;
        return next.list;
      });
      // Conversa que a lista em cache não conhece, ou lista sendo lida agora (a
      // resposta pode ter saído do servidor antes desta mensagem): relê.
      if ((peekResource(LIST_KEY) && !found) || resourceBusy(LIST_KEY)) refreshOne(LIST_KEY);
      if (resourceBusy(UNREAD_KEY)) refreshResourceFresh(UNREAD_KEY);
      else if (!event.muted && event.message.kind !== 'system') {
        patch(UNREAD_KEY, (summary) => (summary ? { ...summary, unread: (Number(summary.unread) || 0) + 1 } : summary));
      }
    }
  }
  if (event.type === 'reaction' && event.conversation) patch(threadKey(event.conversation), (thread) => applyReaction(thread, event));
  if (event.type === 'read' && event.conversation) patch(threadKey(event.conversation), (thread) => applyRead(thread, event.readUpTo, event.at));
  emit(event);
}

export function openChannel() {
  if (typeof WebSocket === 'undefined') return () => {};
  let socket = null;
  let closed = false;
  let attempt = 0;
  let retryTimer = null;
  let beatTimer = null;
  let pongTimer = null;

  function stopBeat() {
    clearInterval(beatTimer);
    clearTimeout(pongTimer);
  }

  function connect() {
    if (closed) return;
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    socket = new WebSocket(`${scheme}://${location.host}/api/realtime`);
    const current = socket;
    current.onopen = () => {
      attempt = 0;
      setLive(true);
      // O que chegou enquanto o canal estava fora é buscado agora.
      refreshMessages();
      emit({ type: 'sync' });
      beatTimer = setInterval(() => {
        if (current.readyState !== WebSocket.OPEN) return;
        current.send('ping');
        pongTimer = setTimeout(() => current.close(), PONG_WAIT_MS);
      }, HEARTBEAT_MS);
    };
    current.onmessage = (event) => {
      if (event.data === 'pong') { clearTimeout(pongTimer); return; }
      try {
        applyRealtimeEvent(JSON.parse(event.data));
      } catch { /* aviso ilegível: a consulta periódica cobre */ }
    };
    current.onclose = () => {
      stopBeat();
      if (socket === current) setLive(false);
      if (closed) return;
      const wait = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt) + Math.random() * 500;
      attempt += 1;
      retryTimer = setTimeout(connect, wait);
    };
    current.onerror = () => current.close();
  }

  // Voltar à aba com o canal fora do ar reconecta na hora.
  function wake() {
    if (document.visibilityState === 'hidden' || closed) return;
    if (socket && socket.readyState <= WebSocket.OPEN) return;
    clearTimeout(retryTimer);
    attempt = 0;
    connect();
  }
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('online', wake);
  connect();

  return () => {
    closed = true;
    clearTimeout(retryTimer);
    stopBeat();
    document.removeEventListener('visibilitychange', wake);
    window.removeEventListener('online', wake);
    socket?.close();
    setLive(false);
  };
}

// Mantém o canal aberto enquanto há conta (montar uma vez, no aviso de mensagem).
export function useRealtime(account) {
  useEffect(() => (account ? openChannel() : undefined), [account?.id]);
}
