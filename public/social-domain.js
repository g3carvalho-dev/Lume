// Limites compartilhados do feed entre amigos. Publicar e interagir não gera XP.
export const SOCIAL_POST_LIMIT = 2000;
export const SOCIAL_COMMENT_LIMIT = 1000;
export const SOCIAL_IMAGE_BYTES = 2 * 1024 * 1024;
export const SOCIAL_PDF_BYTES = 10 * 1024 * 1024;
export const SOCIAL_PAGE_SIZE = 20;

export function socialText(value) {
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim() : '';
}

export function socialFileName(value) {
  return String(value || 'anexo').replace(/[\u0000-\u001f\u007f/\\]/g, '_').trim().slice(0, 160) || 'anexo';
}

export const MESSAGE_ALERT_PREVIEW = 90;

// Aviso de mensagem nova: a conversa mais recente com mensagem não lida vinda
// da amizade, que ainda não foi avisada. Fica em silêncio com as notificações
// de mensagens desligadas, com a conversa silenciada ou quando a conversa dessa
// pessoa já está aberta.
// Aviso flutuante a partir do aviso do canal de tempo real (mensagem direta com
// conteúdo). Mesmas regras de `messageAlert`: uma vez por mensagem, nunca da
// conversa aberta nem de conversa silenciada.
export function messageAlertFromEvent(event, { seen = new Set(), openContactId = '', notifications = true } = {}) {
  const message = event?.message;
  if (!notifications || event?.type !== 'message' || event.conversation?.kind !== 'direct' || !message || !event.sender) return null;
  if (event.muted || message.fromMe || message.kind === 'system' || seen.has(message.id) || event.conversation.id === openContactId) return null;
  const text = socialText(message.body || (message.gif ? 'GIF' : message.reference ? 'Material compartilhado' : '')).replace(/\s+/g, ' ');
  return {
    messageId: message.id,
    from: { id: event.sender.id, name: event.sender.name, avatar: event.sender.avatar || '' },
    preview: text.length > MESSAGE_ALERT_PREVIEW ? `${text.slice(0, MESSAGE_ALERT_PREVIEW).trimEnd()}…` : text,
  };
}

export function messageAlert(conversations, { seen = new Set(), openContactId = '', notifications = true } = {}) {
  if (!notifications || !Array.isArray(conversations)) return null;
  const candidate = conversations
    .filter((item) => item?.unread > 0 && !item.muted && item.lastMessage && !item.lastMessage.fromMe && !seen.has(item.lastMessage.id))
    .sort((left, right) => String(right.lastMessage.at || '').localeCompare(String(left.lastMessage.at || '')))[0];
  if (!candidate || candidate.id === openContactId) return null;
  const text = socialText(candidate.lastMessage.preview).replace(/\s+/g, ' ');
  return {
    messageId: candidate.lastMessage.id,
    from: { id: candidate.id, name: candidate.name, avatar: candidate.avatar || '' },
    preview: text.length > MESSAGE_ALERT_PREVIEW ? `${text.slice(0, MESSAGE_ALERT_PREVIEW).trimEnd()}…` : text,
  };
}
