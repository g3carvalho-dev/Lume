import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { api, apiError } from '../../lib/api.js';
import { invalidateResources, mutateResource, useResource } from '../../lib/resources.js';
import { useRealtimeStatus } from '../../lib/realtime.js';
import { materialType } from '../../../public/domain.js';
import { GROUP_MAX_MEMBERS, GROUP_MIN_OTHERS, GROUP_NAME_LIMIT } from '../../../public/report-domain.js';
import Icon from '../../ui/Icon.jsx';
import { Button, Empty, Heading, PersonAvatar, Skeleton } from '../../ui/ui.jsx';
import ReportDialog from './ReportDialog.jsx';

function timeLabel(value) {
  if (!value) return '';
  const date = new Date(value);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

function dayLabel(value) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Hoje';
  if (date.toDateString() === yesterday.toDateString()) return 'Ontem';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' });
}

function referenceLabel(reference) {
  const types = { course: 'Curso', lesson: 'Aula', article: 'Leitura', book: 'Livro', exercise: 'Exercícios', project: 'Projeto', slide: 'Slides' };
  return `${types[reference.type] || 'Material'} · ${reference.title}`;
}

function GroupAvatar({ large = false }) {
  return <span className={`conversation-avatar mg-group-avatar ${large ? 'is-large' : ''}`} aria-hidden="true"><Icon name="users"/></span>;
}

// Fecha um menu ao clicar fora ou apertar Esc.
function useDismiss(active, close) {
  const root = useRef(null);
  useEffect(() => {
    if (!active) return undefined;
    const outside = (event) => { if (!root.current?.contains(event.target)) close(); };
    const escape = (event) => { if (event.key === 'Escape') close(); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [active, close]);
  return root;
}

function ThreadMenu({ label, children }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const root = useDismiss(open, close);
  return <div className="mg-menu" ref={root}>
    <button type="button" className="icon-button" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}><Icon name="more"/></button>
    {open && <div className="mg-menu-list" role="menu" onClick={close}>{children}</div>}
  </div>;
}

function MenuItem({ icon, danger = false, ...props }) {
  return <button type="button" role="menuitem" className={`mg-menu-item ${danger ? 'is-danger' : ''}`} {...props}><Icon name={icon}/>{props.children}</button>;
}

// Nova conversa: escolher uma amizade ou montar um grupo.
function NewChat({ friends, onDirect, onCreated, notify }) {
  const [mode, setMode] = useState('direct');
  const [name, setName] = useState('');
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toggle = (id) => setPicked((list) => list.includes(id) ? list.filter((item) => item !== id) : [...list, id]);
  async function create(event) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const result = await api('/api/groups', { method: 'POST', body: { name, memberIds: picked } });
      if (!result.ok) throw new Error(apiError(result));
      invalidateResources('/api/messages');
      notify('Grupo criado.');
      onCreated(result.data.id);
    } catch (exception) {
      setError(exception.message);
    } finally {
      setBusy(false);
    }
  }
  return <div className="mg-new">
    <h2 className="title">Nova conversa</h2>
    <div className="mg-segment" role="tablist" aria-label="Tipo de conversa">
      <button type="button" role="tab" aria-selected={mode === 'direct'} onClick={() => setMode('direct')}><Icon name="message"/>Conversa direta</button>
      <button type="button" role="tab" aria-selected={mode === 'group'} onClick={() => setMode('group')}><Icon name="users"/>Novo grupo</button>
    </div>
    {friends.length === 0 && <p className="inline-note"><Icon name="users"/><span>Nenhuma amizade ainda. <a href="#adicionar" className="text-link">Convide alguém</a> para começar.</span></p>}
    {mode === 'direct'
      ? <ul className="mg-pick-list">{friends.map((friend) => <li key={friend.id}>
        <button type="button" className="mg-pick" onClick={() => onDirect(friend.id)}><PersonAvatar person={friend} className="conversation-avatar"/><strong>{friend.name}</strong></button>
      </li>)}</ul>
      : <form className="mg-group-form" onSubmit={create}>
        <label className="field">Nome do grupo
          <input value={name} maxLength={GROUP_NAME_LIMIT} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Turma de Direito Civil" autoComplete="off" disabled={busy}/>
        </label>
        <fieldset className="mg-pick-fieldset">
          <legend className="metric-label">Adicionar amigos · {picked.length} de {GROUP_MAX_MEMBERS - 1}</legend>
          <ul className="mg-pick-list">{friends.map((friend) => <li key={friend.id}>
            <label className="mg-pick"><PersonAvatar person={friend} className="conversation-avatar"/><strong>{friend.name}</strong>
              <input type="checkbox" checked={picked.includes(friend.id)} onChange={() => toggle(friend.id)} disabled={busy || (!picked.includes(friend.id) && picked.length >= GROUP_MAX_MEMBERS - 1)}/>
            </label>
          </li>)}</ul>
        </fieldset>
        <p className="quiet-note">Só entram pessoas da sua lista de amigos. Escolha pelo menos {GROUP_MIN_OTHERS}.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <Button type="submit" disabled={busy || !name.trim() || picked.length < GROUP_MIN_OTHERS}>{busy ? 'Criando…' : 'Criar grupo'}</Button>
      </form>}
  </div>;
}

// Gerenciar o grupo: renomear, membros, adicionar pessoas.
function GroupInfo({ thread, friends, onChanged, onOptimistic, onReport, notify }) {
  const { group, members } = thread;
  const [name, setName] = useState(group.name);
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inGroup = new Set(members.map((member) => member.id));
  const candidates = friends.filter((friend) => !inGroup.has(friend.id));

  async function run(task, success, optimistic) {
    setBusy(true); setError('');
    const rollback = optimistic ? optimistic() : null;
    try {
      const result = await task();
      if (!result.ok) throw new Error(apiError(result));
      if (success) notify(success);
      onChanged();
      return true;
    } catch (exception) {
      rollback?.();
      setError(exception.message);
      notify(exception.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  return <section className="mg-info" aria-label="Informações do grupo">
    {group.isOwner && <form className="mg-rename" onSubmit={(event) => {
      event.preventDefault();
      const trimmed = name.trim();
      if (trimmed && trimmed !== group.name) {
        run(
          () => api(`/api/groups/${group.id}`, { method: 'PATCH', body: { name: trimmed } }),
          'Nome do grupo atualizado.',
          () => onOptimistic?.rename(group.id, trimmed),
        );
      }
    }}>
      <label className="field">Nome do grupo
        <input value={name} maxLength={GROUP_NAME_LIMIT} onChange={(event) => setName(event.target.value)} disabled={busy}/>
      </label>
      <Button secondary type="submit" disabled={busy || !name.trim() || name.trim() === group.name}>Salvar nome</Button>
    </form>}
    <h3 className="metric-label">{members.length} {members.length === 1 ? 'pessoa' : 'pessoas'}</h3>
    <ul className="mg-members">
      {members.map((member) => <li key={member.id}>
        <PersonAvatar person={member} className="conversation-avatar"/>
        <span className="mg-member-name"><strong>{member.name}{member.isMe ? ' (você)' : ''}</strong>{member.isOwner && <small>Criou o grupo</small>}</span>
        {!member.isMe && <ThreadMenu label={`Ações para ${member.name}`}>
          <MenuItem icon="flag" danger onClick={() => onReport({ person: member })}>Denunciar</MenuItem>
          {group.isOwner && <MenuItem icon="close" danger onClick={() => run(
            () => api(`/api/groups/${group.id}/members/${encodeURIComponent(member.id)}`, { method: 'DELETE' }),
            `${member.name} saiu do grupo.`,
            () => onOptimistic?.removeMember(member.id),
          )}>Remover do grupo</MenuItem>}
        </ThreadMenu>}
      </li>)}
    </ul>
    {group.isOwner && members.length < GROUP_MAX_MEMBERS && (adding
      ? <div className="mg-add">
        {candidates.length === 0
          ? <p className="quiet-note">Todos os seus amigos já estão no grupo.</p>
          : <ul className="mg-pick-list">{candidates.map((friend) => <li key={friend.id}>
            <label className="mg-pick"><PersonAvatar person={friend} className="conversation-avatar"/><strong>{friend.name}</strong>
              <input type="checkbox" checked={picked.includes(friend.id)} onChange={() => setPicked((list) => list.includes(friend.id) ? list.filter((item) => item !== friend.id) : [...list, friend.id])}/>
            </label>
          </li>)}</ul>}
        <div className="action-row">
          <Button secondary type="button" onClick={() => { setAdding(false); setPicked([]); }}>Cancelar</Button>
          <Button type="button" disabled={busy || picked.length === 0} onClick={async () => { if (await run(() => api(`/api/groups/${group.id}/members`, { method: 'POST', body: { memberIds: picked } }), 'Pessoas adicionadas.')) { setAdding(false); setPicked([]); } }}>Adicionar</Button>
        </div>
      </div>
      : <button type="button" className="text-button accent" onClick={() => setAdding(true)}><Icon name="plus"/>Adicionar pessoas</button>)}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}

export default function Messages({ account, state, notify, go, contactId = '', groupId = '' }) {
  const initial = groupId ? { kind: 'group', id: groupId } : contactId ? { kind: 'direct', id: contactId } : null;
  const [selection, setSelection] = useState(initial);
  const [search, setSearch] = useState('');
  const [text, setText] = useState('');
  const [referenceId, setReferenceId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [report, setReport] = useState(null);
  const [notificationsOverride, setNotificationsOverride] = useState(null);
  const listRef = useRef(null);
  const stuck = useRef(true);
  const shownFor = useRef('');

  const live = useRealtimeStatus();
  const conversationsResource = useResource('/api/messages', { interval: live ? 60000 : 10000, enabled: Boolean(account) });
  const isGroup = selection?.kind === 'group';
  const isDirect = selection?.kind === 'direct';
  const selected = selection && selection.kind !== 'new' ? selection.id : '';
  const threadPath = isGroup ? `/api/groups/${encodeURIComponent(selected)}` : isDirect ? `/api/messages/${encodeURIComponent(selected)}` : '';
  const threadResource = useResource(threadPath, { interval: live ? 60000 : 5000, enabled: Boolean(account && threadPath) });
  const settingsResource = useResource('/api/messages/settings', { enabled: Boolean(account) });
  const friends = conversationsResource.data?.conversations || [];
  const groups = conversationsResource.data?.groups || [];
  const thread = threadPath && threadResource.data ? threadResource.data : null;
  const loading = Boolean(threadPath) && threadResource.loading && !threadResource.data;
  const notifications = notificationsOverride ?? settingsResource.data?.notifications !== false;
  const loadError = conversationsResource.error || (threadPath ? threadResource.error : '');

  const items = [
    ...friends.map((item) => ({ ...item, kind: 'direct' })),
    ...groups.map((item) => ({ ...item, kind: 'group' })),
  ].filter((item) => !search.trim() || item.name.toLocaleLowerCase('pt-BR').includes(search.trim().toLocaleLowerCase('pt-BR')))
    .sort((left, right) => (right.lastMessage?.at || '').localeCompare(left.lastMessage?.at || '') || left.name.localeCompare(right.name, 'pt-BR'));

  useEffect(() => {
    if (groupId) setSelection((current) => current?.kind === 'group' && current.id === groupId ? current : { kind: 'group', id: groupId });
    else if (contactId) setSelection((current) => current?.kind === 'direct' && current.id === contactId ? current : { kind: 'direct', id: contactId });
  }, [contactId, groupId]);

  // Abrir (ou receber novas mensagens na) conversa marca como lida e atualiza
  // o contador do menu, que usa o mesmo cache.
  const lastMessageId = thread?.messages?.at(-1)?.id || '';
  useEffect(() => {
    if (!account || !selected || !threadResource.data) return undefined;
    let alive = true;
    let previousUnread = 0;
    mutateResource('/api/messages', (previous) => {
      if (!previous) return previous;
      const clear = (item) => {
        if (item.id !== selected) return item;
        previousUnread = item.unread || 0;
        return { ...item, unread: 0 };
      };
      return { ...previous, conversations: (previous.conversations || []).map(isGroup ? (item) => item : clear), groups: (previous.groups || []).map(isGroup ? clear : (item) => item) };
    });
    const path = isGroup ? `/api/groups/${encodeURIComponent(selected)}/read` : `/api/messages/${encodeURIComponent(selected)}/read`;
    api(path, { method: 'POST' }).then((read) => {
      if (!alive) return;
      if (!read.ok) {
        if (previousUnread > 0) {
          mutateResource('/api/messages', (previous) => {
            if (!previous) return previous;
            const restore = (item) => item.id === selected ? { ...item, unread: previousUnread } : item;
            return { ...previous, conversations: (previous.conversations || []).map(isGroup ? (item) => item : restore), groups: (previous.groups || []).map(isGroup ? restore : (item) => item) };
          });
        }
        return;
      }
      invalidateResources('/api/messages/unread');
    });
    return () => { alive = false; };
  }, [account, selected, isGroup, lastMessageId, Boolean(threadResource.data)]);

  const messageCount = thread?.messages?.length || 0;
  const lastFromMe = Boolean(thread?.messages?.at(-1)?.fromMe);
  useEffect(() => {
    const node = listRef.current;
    if (!node) return;
    const opening = shownFor.current !== selected;
    shownFor.current = selected;
    if (opening || lastFromMe || stuck.current) node.scrollTop = node.scrollHeight;
  }, [messageCount, lastFromMe, selected, Boolean(thread)]);

  function select(next) {
    setSelection(next);
    setInfoOpen(false);
    setText('');
    setError('');
    const hash = next?.kind === 'group' ? `#mensagens?grupo=${encodeURIComponent(next.id)}` : next?.kind === 'direct' ? `#mensagens?com=${encodeURIComponent(next.id)}` : '#mensagens';
    try { history.replaceState(null, '', hash); } catch { /* Hash indisponível. */ }
  }

  async function send(event) {
    event.preventDefault();
    if (!selected) return;
    const body = text.trim();
    const course = state.courses.find((item) => item.id === referenceId);
    const reference = course ? { type: course.type || 'course', id: course.id, title: course.title } : null;
    if (!body && !reference) return;

    const tempId = `optimistic:${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const previewText = body || (reference ? referenceLabel(reference) : '');
    const optimisticMessage = {
      id: tempId,
      kind: 'text',
      body,
      reference,
      at: now,
      fromMe: true,
      senderId: account.id,
      ...(isGroup ? { sender: { id: account.id, name: account.name, avatar: state.profile?.avatar || account.avatar } } : {}),
    };

    let previousLast = null;
    setError('');
    setText('');
    setReferenceId('');
    setPickerOpen(false);
    threadResource.mutate((previous) => (previous ? { ...previous, messages: [...(previous.messages || []), optimisticMessage] } : previous));
    conversationsResource.mutate((previous) => {
      if (!previous) return previous;
      const updateList = (list) => (list || []).map((item) => {
        if (item.id !== selected) return item;
        previousLast = item.lastMessage || null;
        return { ...item, lastMessage: { id: tempId, fromMe: true, preview: previewText.length > 120 ? `${previewText.slice(0, 120)}…` : previewText, at: now } };
      });
      return {
        ...previous,
        conversations: isGroup ? previous.conversations : updateList(previous.conversations),
        groups: isGroup ? updateList(previous.groups) : previous.groups,
      };
    });

    try {
      const result = await api(isGroup ? `/api/groups/${encodeURIComponent(selected)}/messages` : `/api/messages/${encodeURIComponent(selected)}`, { method: 'POST', body: { body, reference } });
      if (!result.ok) throw new Error(apiError(result));
      const saved = result.data?.message;
      if (saved) {
        threadResource.mutate((previous) => (previous ? {
          ...previous,
          messages: (previous.messages || []).map((item) => (item.id === tempId ? { ...optimisticMessage, ...saved } : item)),
        } : previous));
      } else {
        threadResource.refresh();
      }
      conversationsResource.refresh();
    } catch (exception) {
      threadResource.mutate((previous) => (previous ? {
        ...previous,
        messages: (previous.messages || []).filter((item) => item.id !== tempId),
      } : previous));
      conversationsResource.mutate((previous) => {
        if (!previous) return previous;
        const restoreList = (list) => (list || []).map((item) => (item.id === selected && item.lastMessage?.id === tempId ? { ...item, lastMessage: previousLast } : item));
        return {
          ...previous,
          conversations: isGroup ? previous.conversations : restoreList(previous.conversations),
          groups: isGroup ? restoreList(previous.groups) : previous.groups,
        };
      });
      setText((current) => current || body);
      if (reference?.id) setReferenceId((current) => current || reference.id);
      setError(exception.message);
      notify(exception.message);
    }
  }

  async function toggleBlock() {
    if (!selected || !thread) return;
    const blocked = thread.blockedByMe;
    if (!blocked && !window.confirm('Bloquear esta pessoa? Novas mensagens serão interrompidas nos dois sentidos; o histórico continua guardado.')) return;
    const prevThread = threadResource.data;
    const prevConvs = conversationsResource.data;
    threadResource.mutate((previous) => previous ? { ...previous, blockedByMe: !blocked, canMessage: blocked && !previous.blockedMe } : previous);
    conversationsResource.mutate((previous) => previous ? {
      ...previous,
      conversations: (previous.conversations || []).map((item) => item.id === selected ? { ...item, blockedByMe: !blocked } : item),
    } : previous);
    try {
      const result = await api(`/api/blocks/${encodeURIComponent(selected)}`, { method: blocked ? 'DELETE' : 'POST' });
      if (!result.ok) throw new Error(apiError(result));
      notify(blocked ? 'Contato desbloqueado. A conversa pode continuar.' : 'Contato bloqueado. O histórico foi preservado.');
      threadResource.refresh();
      conversationsResource.refresh();
    } catch (exception) {
      if (prevThread) threadResource.mutate(prevThread);
      if (prevConvs) conversationsResource.mutate(prevConvs);
      setError(exception.message);
      notify(exception.message);
    }
  }

  async function leaveGroup() {
    if (!window.confirm('Sair deste grupo? Você deixa de ver as mensagens.')) return;
    const target = selected;
    const prevConvs = conversationsResource.data;
    conversationsResource.mutate((previous) => previous ? {
      ...previous,
      groups: (previous.groups || []).filter((item) => item.id !== target),
    } : previous);
    select(null);
    try {
      const result = await api(`/api/groups/${encodeURIComponent(target)}/members/${encodeURIComponent(account.id)}`, { method: 'DELETE' });
      if (!result.ok) throw new Error(apiError(result));
      notify('Você saiu do grupo.');
      invalidateResources('/api/groups/');
      conversationsResource.refresh();
    } catch (exception) {
      if (prevConvs) conversationsResource.mutate(prevConvs);
      select({ kind: 'group', id: target });
      setError(exception.message);
      notify(exception.message);
    }
  }

  async function deleteGroup() {
    if (!window.confirm('Apagar este grupo para todas as pessoas? Isso não pode ser desfeito.')) return;
    const target = selected;
    const prevConvs = conversationsResource.data;
    conversationsResource.mutate((previous) => previous ? {
      ...previous,
      groups: (previous.groups || []).filter((item) => item.id !== target),
    } : previous);
    select(null);
    try {
      const result = await api(`/api/groups/${encodeURIComponent(target)}`, { method: 'DELETE' });
      if (!result.ok) throw new Error(apiError(result));
      notify('Grupo apagado.');
      invalidateResources('/api/groups/');
      conversationsResource.refresh();
    } catch (exception) {
      if (prevConvs) conversationsResource.mutate(prevConvs);
      select({ kind: 'group', id: target });
      setError(exception.message);
      notify(exception.message);
    }
  }

  async function toggleNotifications() {
    const next = !notifications;
    setNotificationsOverride(next);
    const result = await api('/api/messages/settings', { method: 'PATCH', body: { notifications: next } });
    if (!result.ok) {
      setNotificationsOverride(!next);
      notify(apiError(result));
      return;
    }
    settingsResource.mutate({ notifications: next });
    setNotificationsOverride(null);
    invalidateResources('/api/messages/unread');
    notify(next ? 'Notificações de mensagens ativadas.' : 'Notificações de mensagens silenciadas. As mensagens continuam guardadas.');
  }

  if (!account) return <div className="personal-root">
    <Heading eyebrow="Conversas entre amigos" title="Mensagens">Mensagens exigem uma conta e amizades aceitas. Na prévia, você pode explorar o resto do Lume.</Heading>
    <Empty icon="mail" title="Entre para conversar.">O convite por link é o caminho para formar sua lista de amigos.</Empty>
    <Button onClick={() => go('login')}><Icon name="lock"/>Entrar na minha conta</Button>
  </div>;

  const me = { name: account.name, avatar: state.profile?.avatar || account.avatar };
  const chosen = state.courses.find((item) => item.id === referenceId);
  const title = thread ? (isGroup ? thread.group.name : thread.friend.name) : '';
  let lastDay = '';
  let lastSender = '';
  return <div className="messages-root">
    <Heading title="Mensagens" actions={<button className="chip-button" onClick={toggleNotifications} aria-pressed={notifications}><Icon name={notifications ? 'bell' : 'mute'}/>{notifications ? 'Notificações ativas' : 'Silenciadas'}</button>}>
      Conversas entre amigos.
    </Heading>

    {(error || loadError) && <p className="form-error" role="alert">{error || loadError}</p>}
    <div className="card-surface messages-layout">
      <aside className="messages-list" aria-label="Conversas">
        <div className="messages-list-head">
          <strong className="title">Conversas</strong>
          <span className="muted-text">{friends.length + groups.length}</span>
          <button type="button" className="icon-button" aria-label="Nova conversa" title="Nova conversa" onClick={() => select({ kind: 'new' })}><Icon name="edit"/></button>
        </div>
        <label className="mg-search"><Icon name="search"/><span className="sr-only">Buscar conversa</span>
          <input type="search" value={search} placeholder="Buscar conversa" onChange={(event) => setSearch(event.target.value)}/>
        </label>
        {!conversationsResource.data && !conversationsResource.error && <Skeleton label="Carregando as conversas…" rows={3}/>}
        {conversationsResource.data && friends.length + groups.length === 0 && <p className="inline-note"><Icon name="users"/><span>Nenhuma amizade ainda. <a href="#adicionar" className="text-link">Convide alguém</a> para começar.</span></p>}
        {items.length > 0 && <span className="mg-section-label">Recentes</span>}
        <ul className="conversation-list">
          {items.map((conversation) => {
            const active = selection?.kind === conversation.kind && selection.id === conversation.id;
            return <li key={`${conversation.kind}-${conversation.id}`}>
              <button className={`conversation-item ${active ? 'active' : ''}`} onClick={() => select({ kind: conversation.kind, id: conversation.id })} aria-current={active ? 'true' : undefined}>
                {conversation.kind === 'group' ? <GroupAvatar/> : <PersonAvatar person={conversation} className="conversation-avatar"/>}
                <span className="conversation-copy">
                  <span className="conversation-line"><strong>{conversation.name}</strong>
                    {conversation.lastMessage && <time dateTime={conversation.lastMessage.at}>{timeLabel(conversation.lastMessage.at)}</time>}
                  </span>
                  <span className="conversation-line">
                    <small>{conversation.kind === 'group'
                      ? (conversation.lastMessage ? conversation.lastMessage.preview : `${conversation.members} pessoas`)
                      : conversation.blockedByMe ? 'Você bloqueou esta pessoa' : conversation.blockedMe ? 'Mensagens bloqueadas por ela' : conversation.lastMessage ? `${conversation.lastMessage.fromMe ? 'Você: ' : ''}${conversation.lastMessage.preview}` : 'Comece uma conversa'}</small>
                    {conversation.unread > 0 && <span className="unread-badge" aria-label={`${conversation.unread} não lidas`}>{conversation.unread > 99 ? '99+' : conversation.unread}</span>}
                  </span>
                </span>
              </button>
            </li>;
          })}
        </ul>
        {search.trim() && items.length === 0 && conversationsResource.data && <p className="muted-text">Nenhuma conversa encontrada.</p>}
        <p className="mg-list-foot"><Icon name="lock"/>Só entre amigos</p>
      </aside>

      <section className="message-thread" aria-label="Conversa selecionada">
        {!selection && <div className="messages-placeholder"><span className="mg-bubbles" aria-hidden="true"><Icon name="message"/></span><h2 className="title">Escolha uma conversa</h2><p className="muted-text">Selecione um amigo ou grupo ao lado para continuar.</p></div>}
        {selection?.kind === 'new' && <NewChat friends={friends} notify={notify} onDirect={(id) => select({ kind: 'direct', id })} onCreated={(id) => select({ kind: 'group', id })}/>}
        {selected && loading && <Skeleton label="Carregando a conversa…" rows={3} variant="text"/>}
        {selected && thread && <>
          <header className="message-thread-head">
            {isGroup ? <GroupAvatar large/> : <PersonAvatar person={thread.friend} className="conversation-avatar is-large"/>}
            <div className="message-thread-who">
              <h2 className="title">{title}</h2>
              <p>{isGroup ? `${thread.members.length} pessoas` : thread.blockedByMe ? 'Você bloqueou esta pessoa.' : thread.blockedMe ? 'Esta pessoa bloqueou novas mensagens.' : 'Amizade aceita'}</p>
            </div>
            {isGroup && <button type="button" className="icon-button" aria-label="Informações do grupo" aria-pressed={infoOpen} onClick={() => setInfoOpen((value) => !value)}><Icon name="users"/></button>}
            <ThreadMenu label="Mais ações da conversa">
              {isDirect && <MenuItem icon="lock" onClick={toggleBlock} disabled={busy}>{thread.blockedByMe ? 'Desbloquear' : 'Bloquear'}</MenuItem>}
              {isDirect && <MenuItem icon="flag" danger onClick={() => setReport({ person: thread.friend, context: 'direct', canBlock: !thread.blockedByMe })}>Denunciar</MenuItem>}
              {isGroup && <MenuItem icon="close" danger onClick={leaveGroup} disabled={busy}>Sair do grupo</MenuItem>}
              {isGroup && thread.group.isOwner && <MenuItem icon="trash" danger onClick={deleteGroup} disabled={busy}>Apagar grupo</MenuItem>}
            </ThreadMenu>
          </header>
          {isGroup && infoOpen && <GroupInfo thread={thread} friends={friends} notify={notify} onChanged={() => Promise.all([threadResource.refresh(), conversationsResource.refresh()])} onOptimistic={{
            rename: (groupIdValue, nextName) => {
              const prevThread = threadResource.data;
              const prevConvs = conversationsResource.data;
              threadResource.mutate((previous) => previous ? { ...previous, group: { ...previous.group, name: nextName } } : previous);
              conversationsResource.mutate((previous) => previous ? { ...previous, groups: (previous.groups || []).map((item) => item.id === groupIdValue ? { ...item, name: nextName } : item) } : previous);
              return () => {
                if (prevThread) threadResource.mutate(prevThread);
                if (prevConvs) conversationsResource.mutate(prevConvs);
              };
            },
            removeMember: (memberId) => {
              const prevThread = threadResource.data;
              threadResource.mutate((previous) => previous ? { ...previous, members: (previous.members || []).filter((item) => item.id !== memberId) } : previous);
              return () => { if (prevThread) threadResource.mutate(prevThread); };
            },
          }} onReport={({ person, subjectId }) => setReport({ person, context: 'group', groupId: selected, subjectId })}/>}
          <div className="message-list" ref={listRef} onScroll={(event) => { const node = event.currentTarget; stuck.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80; }} tabIndex={0} role="log" aria-live="polite" aria-label={`Mensagens de ${title}`}>
            {thread.messages.length === 0 && <p className="messages-placeholder-copy">Nenhuma mensagem ainda. Diga olá ou compartilhe um material.</p>}
            {thread.messages.map((message) => {
              const day = new Date(message.at).toDateString();
              const divider = day !== lastDay;
              lastDay = day;
              if (message.kind === 'system') {
                lastSender = '';
                return <div key={message.id} className="message-group">
                  {divider && <div className="message-day" role="separator"><span>{dayLabel(message.at)}</span></div>}
                  <p className="mg-system">{message.body}</p>
                </div>;
              }
              const person = isGroup ? message.sender : thread.friend;
              const showName = isGroup && !message.fromMe && lastSender !== message.senderId;
              lastSender = message.senderId || (message.fromMe ? 'me' : '');
              return <div key={message.id} className="message-group">
                {divider && <div className="message-day" role="separator"><span>{dayLabel(message.at)}</span></div>}
                <motion.div className={`message-row ${message.fromMe ? 'from-me' : 'from-them'}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .2 }}>
                  {!message.fromMe && <PersonAvatar person={person} className="message-avatar"/>}
                  <div className="message-stack">
                    {showName && <span className="mg-sender">{message.sender.name}</span>}
                    <div className="message-bubble">
                      {message.body && <p>{message.body}</p>}
                      {message.reference && <span className="message-reference"><Icon name="book"/>{referenceLabel(message.reference)}</span>}
                    </div>
                    <time className="message-time" dateTime={message.at}>{timeLabel(message.at)}{!isGroup && message.fromMe && message.readAt ? ' · lida' : ''}</time>
                  </div>
                  {isGroup && !message.fromMe && <button type="button" className="mg-flag" aria-label={`Denunciar mensagem de ${message.sender.name}`} title="Denunciar mensagem" onClick={() => setReport({ person: message.sender, context: 'group', groupId: selected, subjectId: message.id })}><Icon name="flag"/></button>}
                  {message.fromMe && <PersonAvatar person={me} className="message-avatar"/>}
                </motion.div>
              </div>;
            })}
          </div>
          {!thread.canMessage
            ? <p className="inline-note"><Icon name="lock"/><span>{thread.blockedByMe ? 'Desbloqueie para voltar a enviar mensagens.' : 'A outra pessoa precisa desbloquear para a conversa continuar.'}</span></p>
            : <form className="message-composer" onSubmit={send}>
              {chosen && <span className="message-picked"><Icon name="book"/>{materialType(chosen.type).title} · {chosen.title}
                <button type="button" aria-label="Remover material" onClick={() => setReferenceId('')}><Icon name="close"/></button></span>}
              <div className="message-composer-bar">
                <div className="message-attach">
                  <button type="button" className="message-round" aria-label="Compartilhar material" aria-expanded={pickerOpen} onClick={() => setPickerOpen((open) => !open)}><Icon name="plus"/></button>
                  {pickerOpen && <ul className="message-picker" aria-label="Materiais para compartilhar">
                    {state.courses.length === 0 && <li className="muted-text">Nenhum material na biblioteca.</li>}
                    {state.courses.map((course) => <li key={course.id}><button type="button" onClick={() => { setReferenceId(course.id); setPickerOpen(false); }}>{materialType(course.type).title} · {course.title}</button></li>)}
                  </ul>}
                </div>
                <input className="message-input" value={text} maxLength={4000} onChange={(event) => setText(event.target.value)} placeholder={`Escreva para ${title}…`} aria-label="Mensagem" autoComplete="off"/>
                <button type="submit" className="message-round message-send" aria-label="Enviar" disabled={busy || (!text.trim() && !referenceId)}><Icon name="arrow"/></button>
              </div>
            </form>}
        </>}
      </section>
    </div>
    {report && <ReportDialog target={report.person} context={report.context} groupId={report.groupId} subjectId={report.subjectId} canBlock={Boolean(report.canBlock)} onClose={() => setReport(null)} onDone={({ blocked }) => {
      notify(blocked ? 'Denúncia enviada e contato bloqueado. A equipe do Lume vai analisar.' : 'Denúncia enviada. A equipe do Lume vai analisar.');
      if (blocked) { threadResource.refresh(); conversationsResource.refresh(); }
    }}/>}
  </div>;
}
