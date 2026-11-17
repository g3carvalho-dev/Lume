// Como o cache de mensagens (resources.js) muda sem ir ao servidor: os avisos do
// canal de tempo real trazem a mensagem, a reação ou a leitura, e estas funções
// aplicam isso na conversa aberta, na lista e no contador. São puras; quem lê e
// grava o cache é realtime.js e a tela de Mensagens.

export const LIST_KEY = '/api/messages';
export const UNREAD_KEY = '/api/messages/unread';
const OPTIMISTIC = 'optimistic:';

export const isOptimistic = (id) => String(id).startsWith(OPTIMISTIC);
export const optimisticId = (clientId) => `${OPTIMISTIC}${clientId}`;

export function threadKey(conversation) {
  if (!conversation?.id) return '';
  return conversation.kind === 'group' ? `/api/groups/${encodeURIComponent(conversation.id)}` : `/api/messages/${encodeURIComponent(conversation.id)}`;
}

// Endereço de uma conversa (direta ou grupo), e não de lista, contador ou ajustes.
export function isThreadKey(key) {
  const rest = key.startsWith('/api/groups/') ? key.slice(12) : key.startsWith('/api/messages/') ? key.slice(14) : '';
  return Boolean(rest) && !/[/?]/.test(rest) && rest !== 'unread' && rest !== 'settings';
}

const byId = (left, right) => (isOptimistic(left.id) - isOptimistic(right.id)) || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

// Junta a página recém-lida do servidor com o que a tela já tinha: páginas
// anteriores carregadas, mensagens que chegaram pelo canal durante a leitura e
// envios ainda em andamento. Se a página nova não encosta no que havia (chegou
// mais de uma página enquanto a conversa esteve fora), fica só a página nova.
export function mergeThread(previous, incoming) {
  if (!incoming?.messages || !previous?.messages?.length) return incoming;
  const fresh = incoming.messages;
  if (!fresh.length) return incoming;
  const real = previous.messages.filter((item) => !isOptimistic(item.id));
  const first = fresh[0].id;
  const last = fresh.at(-1).id;
  const gap = incoming.hasMore && real.length > 0 && real.at(-1).id < first;
  const older = gap ? [] : real.filter((item) => item.id < first);
  const newer = real.filter((item) => item.id > last);
  const pending = previous.messages.filter((item) => isOptimistic(item.id) && !fresh.some((sent) => sent.id.endsWith(`-${item.id.slice(OPTIMISTIC.length)}`)));
  return {
    ...incoming,
    messages: [...older, ...fresh, ...newer, ...pending],
    hasMore: older.length ? Boolean(previous.hasMore) : Boolean(incoming.hasMore),
  };
}

// Página anterior (mais antiga) na frente do que já está na tela.
export function prependPage(thread, page) {
  if (!thread?.messages || !page?.messages) return thread;
  const known = new Set(thread.messages.map((item) => item.id));
  return { ...thread, messages: [...page.messages.filter((item) => !known.has(item.id)), ...thread.messages], hasMore: Boolean(page.hasMore) };
}

export function appendMessage(thread, message) {
  if (!thread?.messages || !message?.id || thread.messages.some((item) => item.id === message.id)) return thread;
  return { ...thread, messages: [...thread.messages, message].sort(byId) };
}

// Reação de outra pessoa: só o total muda; `mine` continua como estava.
export function applyReaction(thread, { messageId, emoji, on }) {
  if (!thread?.messages) return thread;
  return {
    ...thread,
    messages: thread.messages.map((item) => {
      if (item.id !== messageId) return item;
      const list = item.reactions || [];
      const found = list.find((reaction) => reaction.emoji === emoji);
      if (on) {
        return { ...item, reactions: found ? list.map((reaction) => (reaction === found ? { ...reaction, count: reaction.count + 1 } : reaction)) : [...list, { emoji, count: 1, mine: false }] };
      }
      if (!found) return item;
      return { ...item, reactions: list.map((reaction) => (reaction === found ? { ...reaction, count: reaction.count - 1 } : reaction)).filter((reaction) => reaction.count > 0) };
    }),
  };
}

// A outra pessoa leu a conversa direta até `readUpTo`.
export function applyRead(thread, readUpTo, at) {
  if (!thread?.messages || !readUpTo) return thread;
  return {
    ...thread,
    readUpTo,
    messages: thread.messages.map((item) => (item.fromMe && !item.readAt && !isOptimistic(item.id) && item.id <= readUpTo ? { ...item, readAt: at || true } : item)),
  };
}

function clip(text) {
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

// Trecho da lista de conversas, igual ao que o servidor monta.
export function messagePreview(message, kind) {
  if (message.kind === 'system') return clip(String(message.body || ''));
  const text = message.body ? clip(String(message.body)) : message.gif ? 'GIF' : message.reference ? 'Material compartilhado' : '';
  if (kind !== 'group') return text;
  const who = message.fromMe ? 'Você' : String(message.sender?.name || 'Alguém').split(' ')[0];
  return clip(`${who}: ${text}`);
}

// Atualiza a conversa na lista com a mensagem que chegou. `found` falso pede uma
// releitura da lista (conversa que a tela ainda não conhece).
export function listWithMessage(list, { conversation, message }) {
  if (!list || !conversation || !message) return { list, found: false };
  const field = conversation.kind === 'group' ? 'groups' : 'conversations';
  let found = false;
  const items = (list[field] || []).map((item) => {
    if (item.id !== conversation.id) return item;
    found = true;
    if (item.lastMessage?.id === message.id) return item;
    const counts = !message.fromMe && message.kind !== 'system';
    return {
      ...item,
      lastMessage: { id: message.id, fromMe: Boolean(message.fromMe), preview: messagePreview(message, conversation.kind), at: message.at },
      unread: (item.unread || 0) + (counts ? 1 : 0),
    };
  });
  return { list: found ? { ...list, [field]: items } : list, found };
}

// Total de não lidas pela lista em cache: conversa silenciada e pessoa bloqueada não contam.
export function unreadFromList(list) {
  if (!list) return null;
  return [...(list.conversations || []), ...(list.groups || [])]
    .filter((item) => !item.muted && !item.blockedByMe)
    .reduce((total, item) => total + (Number(item.unread) || 0), 0);
}
