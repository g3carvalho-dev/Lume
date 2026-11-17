// Canal leve para abrir a dock flutuante de Mensagens a partir de qualquer tela
// (perfil, aviso de mensagem, Início, etc.) sem acoplar rotas ou props globais.

const OPEN_EVENT = 'lume:messages-dock-open';
const STATE_EVENT = 'lume:messages-dock-state';

let openContactId = '';

export function getOpenDockContactId() {
  return openContactId;
}

export function setOpenDockContactId(contactId) {
  const next = contactId ? String(contactId) : '';
  if (openContactId === next) return;
  openContactId = next;
  window.dispatchEvent(new CustomEvent(STATE_EVENT, { detail: { contactId: next } }));
}

export function openMessagesDock(detail = {}) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail }));
}

export function subscribeDockOpen(handler) {
  const listener = (event) => handler(event.detail || {});
  window.addEventListener(OPEN_EVENT, listener);
  return () => window.removeEventListener(OPEN_EVENT, listener);
}

export function subscribeDockState(handler) {
  const listener = (event) => handler(event.detail || {});
  window.addEventListener(STATE_EVENT, listener);
  return () => window.removeEventListener(STATE_EVENT, listener);
}
