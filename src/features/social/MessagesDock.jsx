import { Suspense, lazy, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import Icon from '../../ui/Icon.jsx';
import { Skeleton, ease } from '../../ui/ui.jsx';
import { useResource } from '../../lib/resources.js';
import { useRealtimeStatus } from '../../lib/realtime.js';
import { setOpenDockContactId, subscribeDockOpen } from './dock-bus.js';

const Messages = lazy(() => import('./Messages.jsx'));

// Dock flutuante autocontido de Mensagens & Conexões.
// Recolhido: barra compacta no canto inferior direito (Variação B).
// Expandido: painel em duas colunas com conversas, @usuário e pedidos (Variação A).
export default function MessagesDock({ account, state, notify, go, visible = false }) {
  const [expanded, setExpanded] = useState(false);
  const [selection, setSelection] = useState(null);
  const [leftView, setLeftView] = useState('chats');

  const live = useRealtimeStatus();
  const unreadResource = useResource('/api/messages/unread', { interval: live ? 60000 : 10000, enabled: Boolean(account && visible) });
  const requestsResource = useResource('/api/friends/requests', { interval: 30000, enabled: Boolean(account && visible) });

  const unread = unreadResource.data?.notifications !== false ? Number(unreadResource.data?.unread) || 0 : 0;
  const incomingCount = requestsResource.data?.incoming?.length || 0;

  useEffect(() => {
    return subscribeDockOpen((detail) => {
      setExpanded(true);
      if (detail.mode === 'connections') {
        setLeftView('connections');
        return;
      }
      setLeftView('chats');
      if (detail.groupId) setSelection({ kind: 'group', id: detail.groupId });
      else if (detail.contactId) setSelection({ kind: 'direct', id: detail.contactId });
    });
  }, []);

  useEffect(() => {
    setOpenDockContactId(expanded && visible && selection?.kind === 'direct' ? selection.id : '');
    return () => setOpenDockContactId('');
  }, [expanded, visible, selection?.kind, selection?.id]);

  useEffect(() => {
    if (!expanded) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      if (document.querySelector('dialog[open]')) return;
      setExpanded(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [expanded]);

  if (!account || !visible) return null;

  const statusParts = [];
  if (unread > 0) statusParts.push(`${unread} ${unread === 1 ? 'não lida' : 'não lidas'}`);
  if (incomingCount > 0) statusParts.push(`${incomingCount} ${incomingCount === 1 ? 'pedido' : 'pedidos'}`);
  const statusText = statusParts.join(' · ') || 'Conversas e @conexões';
  const hasThread = Boolean(selection);

  return <aside className="messages-dock-root" aria-label="Mensagens e conexões">
    <AnimatePresence mode="wait" initial={false}>
      {expanded
        ? <motion.div
          key="expanded"
          className={`card-surface messages-dock-panel ${hasThread ? 'has-thread' : ''}`}
          initial={{ opacity: 0, y: 14, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.98 }}
          transition={{ duration: 0.2, ease }}
        >
          <Suspense fallback={<div className="messages-dock-loading"><Skeleton label="Abrindo mensagens…" rows={4}/></div>}>
            <Messages
              account={account}
              state={state}
              notify={notify}
              go={go}
              selection={selection}
              setSelection={setSelection}
              leftView={leftView}
              setLeftView={setLeftView}
              requestsResource={requestsResource}
              onMinimize={() => setExpanded(false)}
            />
          </Suspense>
        </motion.div>
        : <motion.div
          key="minimized"
          className="messages-dock-bar"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.18, ease }}
        >
          <button
            type="button"
            className="messages-dock-trigger"
            onClick={() => setExpanded(true)}
            aria-expanded={false}
            aria-label={`Abrir mensagens (${statusText})`}
          >
            <span className="messages-dock-icon" aria-hidden="true"><Icon name="message"/></span>
            <span className="messages-dock-copy">
              <strong>Mensagens</strong>
              <small className="mono">{statusText}</small>
            </span>
          </button>
          <button
            type="button"
            className="icon-button mg-at-btn"
            aria-label="Adicionar amigo ou ver pedidos"
            title="Adicionar amigo (@usuário)"
            onClick={() => { setLeftView('connections'); setExpanded(true); }}
          >
            <span className="mg-at-glyph mono">+@</span>
            {incomingCount > 0 && <span className="mg-at-badge" aria-hidden="true">{incomingCount > 9 ? '9+' : incomingCount}</span>}
          </button>
          {unread > 0 && <span className="unread-badge" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
          <button
            type="button"
            className="icon-button"
            aria-label="Expandir mensagens"
            title="Expandir"
            onClick={() => setExpanded(true)}
          ><Icon name="chevron-up"/></button>
        </motion.div>}
    </AnimatePresence>
  </aside>;
}
