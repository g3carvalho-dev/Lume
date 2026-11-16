import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, apiError } from '../../lib/api.js';
import { invalidateResources, mutateResource, useResource } from '../../lib/resources.js';
import { useRealtimeStatus } from '../../lib/realtime.js';
import { materialType } from '../../../public/domain.js';
import { GROUP_MAX_MEMBERS, GROUP_MIN_OTHERS, GROUP_NAME_LIMIT } from '../../../public/report-domain.js';
import Icon from '../../ui/Icon.jsx';
import { Button, Empty, PersonAvatar, Skeleton } from '../../ui/ui.jsx';
import ReportDialog from './ReportDialog.jsx';
import EmojiButton from './EmojiPicker.jsx';
import SocialFrame from './SocialFrame.jsx';
import { PersonButton, profileRoute } from './PersonCard.jsx';

// Mensagens em três regiões: lista de conversas (busca e filtro), conversa e
// detalhes sob demanda (pessoa ou grupo). No celular, uma região por vez: lista,
// conversa em tela cheia com voltar, detalhes em folha inferior. Responder
// citando, reagir, GIF e silenciar valem para conversas diretas e grupos.
// Mensagens não geram XP.

const FILTERS = [['all', 'Todas'], ['direct', 'Privadas'], ['group', 'Grupos']];
const RUN_GAP_MS = 5 * 60 * 1000;

function timeLabel(value) {
  if (!value) return '';
  const date = new Date(value);
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

function clockLabel(value) {
  return new Date(value).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
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

const normalize = (value) => String(value || '').toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[̀-ͯ]/g, '');

function GroupAvatar({ size = '' }) {
  return <span className={`conversation-avatar mg-group-avatar ${size}`} aria-hidden="true"><Icon name="users"/></span>;
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

function RowMenu({ label, children }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const root = useDismiss(open, close);
  return <div className="mg-menu" ref={root}>
    <button type="button" className="icon-button" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}><Icon name="more"/></button>
    {open && <div className="mg-menu-list" role="menu" onClick={close}>{children}</div>}
  </div>;
}

function MenuItem({ icon, danger = false, children, ...props }) {
  return <button type="button" role="menuitem" className={`mg-menu-item ${danger ? 'is-danger' : ''}`} {...props}><Icon name={icon}/>{children}</button>;
}

// A altura do corpo acompanha a janela: só a lista e a conversa rolam.
function useFillHeight(ref, deps) {
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const fit = () => {
      // O que fica abaixo da caixa: o respiro do <main> e a reserva da barra
      // inferior do celular (padding da casca).
      const top = node.getBoundingClientRect().top + window.scrollY;
      const main = document.getElementById('main');
      const shell = main?.parentElement;
      const below = (main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0)
        + (shell ? parseFloat(getComputedStyle(shell).paddingBottom) || 0 : 0);
      node.style.setProperty('--mg-height', `${Math.max(320, Math.floor(window.innerHeight - top - below))}px`);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, deps);
}

// Nova conversa: escolher uma amizade ou montar um grupo.
function NewChat({ friends, onDirect, onCreated, onBack, notify }) {
  const [mode, setMode] = useState('direct');
  const [name, setName] = useState('');
  const [picked, setPicked] = useState([]);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toggle = (id) => setPicked((list) => list.includes(id) ? list.filter((item) => item !== id) : [...list, id]);
  const shown = friends.filter((friend) => !filter.trim() || normalize(friend.name).includes(normalize(filter.trim())));
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
    <div className="mg-new-head">
      <button type="button" className="icon-button mg-back" onClick={onBack} aria-label="Voltar para as conversas"><Icon name="back"/></button>
      <h2 className="title">Nova conversa</h2>
    </div>
    <div className="mg-segment" role="tablist" aria-label="Tipo de conversa">
      <button type="button" role="tab" aria-selected={mode === 'direct'} onClick={() => setMode('direct')}><Icon name="message"/>Conversa privada</button>
      <button type="button" role="tab" aria-selected={mode === 'group'} onClick={() => setMode('group')}><Icon name="users"/>Novo grupo</button>
    </div>
    {friends.length === 0 && <p className="inline-note"><Icon name="users"/><span>Nenhuma amizade ainda. <a href="#adicionar" className="text-link">Convide alguém</a> para começar.</span></p>}
    {friends.length > 6 && <label className="mg-search"><Icon name="search"/><span className="sr-only">Filtrar amigos</span>
      <input type="search" value={filter} placeholder="Filtrar amigos" onChange={(event) => setFilter(event.target.value)}/>
    </label>}
    {mode === 'direct'
      ? <ul className="mg-pick-list">{shown.map((friend) => <li key={friend.id}>
        <button type="button" className="mg-pick" onClick={() => onDirect(friend.id)}><PersonAvatar person={friend} className="conversation-avatar"/><strong>{friend.name}</strong><Icon name="chevron"/></button>
      </li>)}</ul>
      : <form className="mg-group-form" onSubmit={create}>
        <label className="field">Nome do grupo
          <input value={name} maxLength={GROUP_NAME_LIMIT} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Turma de Direito Civil" autoComplete="off" disabled={busy}/>
        </label>
        <fieldset className="mg-pick-fieldset">
          <legend className="metric-label">Adicionar amigos · {picked.length} de {GROUP_MAX_MEMBERS - 1}</legend>
          <ul className="mg-pick-list">{shown.map((friend) => <li key={friend.id}>
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

// Nome do grupo editável no próprio lugar (só quem é dona do grupo).
function GroupName({ group, onRename, busy }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(group.name);
  useEffect(() => { if (!editing) setName(group.name); }, [group.name, editing]);
  if (!group.isOwner) return <h2 className="title mg-details-title">{group.name}</h2>;
  if (!editing) return <button type="button" className="mg-details-title mg-rename-button" onClick={() => setEditing(true)} aria-label={`Renomear grupo ${group.name}`}>
    <span className="title">{group.name}</span><Icon name="edit"/>
  </button>;
  const save = async () => {
    const next = name.trim();
    if (!next || next === group.name) { setEditing(false); return; }
    if (await onRename(next)) setEditing(false);
  };
  return <form className="mg-rename" onSubmit={(event) => { event.preventDefault(); save(); }}>
    <label className="sr-only" htmlFor="mg-group-name">Nome do grupo</label>
    <input id="mg-group-name" value={name} maxLength={GROUP_NAME_LIMIT} autoFocus disabled={busy} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setEditing(false); } }}/>
    <button type="submit" className="icon-button" aria-label="Salvar nome" disabled={busy || !name.trim()}><Icon name="check"/></button>
    <button type="button" className="icon-button" aria-label="Cancelar" onClick={() => setEditing(false)}><Icon name="close"/></button>
  </form>;
}

// Painel de detalhes: pessoa (conversa privada) ou grupo.
function Details({ thread, isGroup, selected, friends, account, busy, go, notify, onRun, onOptimistic, onMute, onBlock, onReport, onLeave, onDelete, onClose, sheet }) {
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState([]);
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const escape = (event) => { if (event.key === 'Escape' && !event.defaultPrevented) onClose(); };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose]);

  const muteRow = <button type="button" className="mg-detail-action" role="switch" aria-checked={Boolean(thread.muted)} onClick={onMute} disabled={busy}>
    <Icon name={thread.muted ? 'mute' : 'bell'}/><span><strong>Silenciar conversa</strong><small>{thread.muted ? 'Sem aviso nem contador. As mensagens continuam chegando.' : 'Avisos e contador ligados.'}</small></span>
    <span className={`mg-switch ${thread.muted ? 'is-on' : ''}`} aria-hidden="true"/>
  </button>;

  let body;
  if (!isGroup) {
    const friend = thread.friend;
    body = <>
      <div className="mg-details-person">
        <PersonAvatar person={friend} className="conversation-avatar is-xl"/>
        <h2 className="title mg-details-title">{friend.name}</h2>
        {friend.handle && <span className="mono mg-details-handle">@{friend.handle}</span>}
        <Button secondary onClick={() => go(profileRoute(friend))}><Icon name="user"/>Ver perfil</Button>
      </div>
      <div className="mg-details-actions">
        {muteRow}
        <button type="button" className="mg-detail-action" onClick={onBlock} disabled={busy}><Icon name="lock"/><span><strong>{thread.blockedByMe ? 'Desbloquear' : 'Bloquear'}</strong><small>{thread.blockedByMe ? 'Voltar a trocar mensagens.' : 'Interrompe novas mensagens nos dois sentidos; o histórico fica.'}</small></span></button>
        <button type="button" className="mg-detail-action is-danger" onClick={() => onReport({ person: friend, context: 'direct', canBlock: !thread.blockedByMe })}><Icon name="flag"/><span><strong>Denunciar</strong><small>Só a equipe do Lume vê. A pessoa não é avisada.</small></span></button>
      </div>
    </>;
  } else {
    const { group, members } = thread;
    const inGroup = new Set(members.map((member) => member.id));
    const candidates = friends.filter((friend) => !inGroup.has(friend.id));
    body = <>
      <div className="mg-details-person">
        <GroupAvatar size="is-xl"/>
        <GroupName group={group} busy={busy} onRename={(name) => onRun(() => api(`/api/groups/${encodeURIComponent(group.id)}`, { method: 'PATCH', body: { name } }), 'Nome do grupo atualizado.', () => onOptimistic.rename(group.id, name))}/>
        <span className="mono mg-details-handle">{members.length} {members.length === 1 ? 'pessoa' : 'pessoas'} · até {GROUP_MAX_MEMBERS}</span>
      </div>
      <section className="mg-details-section" aria-labelledby="mg-members-title">
        <div className="mg-details-section-head">
          <h3 id="mg-members-title" className="metric-label">Participantes</h3>
          {group.isOwner && members.length < GROUP_MAX_MEMBERS && !adding && <button type="button" className="text-button accent" onClick={() => setAdding(true)}><Icon name="plus"/>Adicionar</button>}
        </div>
        {adding && <div className="mg-add">
          {candidates.length === 0
            ? <p className="quiet-note">Todos os seus amigos já estão no grupo.</p>
            : <ul className="mg-pick-list">{candidates.map((friend) => <li key={friend.id}>
              <label className="mg-pick"><PersonAvatar person={friend} className="conversation-avatar"/><strong>{friend.name}</strong>
                <input type="checkbox" checked={picked.includes(friend.id)} disabled={!picked.includes(friend.id) && members.length + picked.length >= GROUP_MAX_MEMBERS} onChange={() => setPicked((list) => list.includes(friend.id) ? list.filter((item) => item !== friend.id) : [...list, friend.id])}/>
              </label>
            </li>)}</ul>}
          <div className="action-row">
            <Button secondary onClick={() => { setAdding(false); setPicked([]); }}>Cancelar</Button>
            <Button disabled={busy || picked.length === 0} onClick={async () => { if (await onRun(() => api(`/api/groups/${encodeURIComponent(group.id)}/members`, { method: 'POST', body: { memberIds: picked } }), picked.length === 1 ? 'Pessoa adicionada.' : 'Pessoas adicionadas.')) { setAdding(false); setPicked([]); } }}>Adicionar</Button>
          </div>
        </div>}
        <ul className="mg-members">
          {members.map((member) => <li key={member.id}>
            {member.isMe
              ? <span className="mg-member-who"><PersonAvatar person={member} className="conversation-avatar"/><strong>{member.name} <small>(você)</small></strong></span>
              : <PersonButton person={member} go={go} className="mg-member-who"><PersonAvatar person={member} className="conversation-avatar"/><strong>{member.name}</strong></PersonButton>}
            {member.isOwner && <span className="soft-badge">Criou o grupo</span>}
            {!member.isMe && <RowMenu label={`Ações para ${member.name}`}>
              <MenuItem icon="flag" danger onClick={() => onReport({ person: member, context: 'group', groupId: selected })}>Denunciar</MenuItem>
              {group.isOwner && <MenuItem icon="close" danger onClick={() => { if (window.confirm(`Remover ${member.name} do grupo?`)) onRun(() => api(`/api/groups/${encodeURIComponent(group.id)}/members/${encodeURIComponent(member.id)}`, { method: 'DELETE' }), `${member.name} saiu do grupo.`, () => onOptimistic.removeMember(member.id)); }}>Remover do grupo</MenuItem>}
            </RowMenu>}
          </li>)}
        </ul>
      </section>
      <div className="mg-details-actions">
        {muteRow}
        <button type="button" className="mg-detail-action is-danger" onClick={onLeave} disabled={busy}><Icon name="logout"/><span><strong>Sair do grupo</strong><small>{group.isOwner ? 'O grupo passa para a pessoa mais antiga que ficar.' : 'Você deixa de ver as mensagens.'}</small></span></button>
        {group.isOwner && <button type="button" className="mg-detail-action is-danger" onClick={onDelete} disabled={busy}><Icon name="trash"/><span><strong>Apagar grupo</strong><small>Para todas as pessoas. Não pode ser desfeito.</small></span></button>}
      </div>
    </>;
  }

  return <>
    {sheet && <div className="mg-details-backdrop" aria-hidden="true" onClick={onClose}/>}
    <aside ref={ref} tabIndex={-1} className={`mg-details ${sheet ? 'is-sheet' : ''}`} aria-label={isGroup ? 'Detalhes do grupo' : 'Detalhes da conversa'}>
      <div className="mg-details-head">
        <strong className="metric-label">{isGroup ? 'Grupo' : 'Conversa privada'}</strong>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Fechar detalhes"><Icon name="close"/></button>
      </div>
      <div className="mg-details-body">{body}</div>
    </aside>
  </>;
}

function Reactions({ message, onToggle, disabled }) {
  if (!message.reactions?.length) return null;
  return <div className="mg-reactions">
    {message.reactions.map((item) => <button key={item.emoji} type="button" className={`sf-reaction ${item.mine ? 'is-mine' : ''}`} aria-pressed={item.mine} aria-label={`${item.emoji} ${item.count}${item.mine ? ', você reagiu' : ''}`} disabled={disabled} onClick={() => onToggle(message, item.emoji, item.mine)}><span aria-hidden="true">{item.emoji}</span>{item.count}</button>)}
  </div>;
}

function Message({ message, isGroup, person, me, startsRun, endsRun, canMessage, busy, go, onReply, onReact, onReport, onJump }) {
  const mine = message.fromMe;
  const who = mine ? me : person;
  return <div id={`mg-msg-${message.id}`} className={`message-row ${mine ? 'from-me' : 'from-them'} ${startsRun ? 'starts-run' : ''} ${endsRun ? 'ends-run' : ''}`}>
    <span className="message-avatar-slot">{!mine && endsRun && (isGroup
      ? <PersonButton person={message.sender} go={go} className="message-avatar-button" label={`Abrir cartão de ${message.sender.name}`}><PersonAvatar person={message.sender} className="message-avatar"/></PersonButton>
      : <PersonAvatar person={who} className="message-avatar"/>)}</span>
    <div className="message-stack">
      {isGroup && !mine && startsRun && <PersonButton person={message.sender} go={go} className="mg-sender">{message.sender.name}</PersonButton>}
      <div className="message-bubble-wrap">
        <div className={`message-bubble ${message.gif && !message.body ? 'is-media' : ''}`}>
          {message.replyTo && <button type="button" className="mg-quote" onClick={() => onJump(message.replyTo.id)} aria-label={`Ver mensagem citada de ${message.replyTo.senderName || 'alguém'}`}>
            <strong>{message.replyTo.senderName || 'Mensagem'}</strong><span>{message.replyTo.preview}</span>
          </button>}
          {message.body && <p>{message.body}</p>}
          {message.gif && <img className="mg-gif" src={message.gif} alt="GIF" loading="lazy"/>}
          {message.reference && <span className="message-reference"><Icon name="book"/>{referenceLabel(message.reference)}</span>}
        </div>
        {canMessage && !String(message.id).startsWith('optimistic:') && <div className="mg-tools" role="group" aria-label="Ações da mensagem">
          <button type="button" className="mg-tool" aria-label="Responder" title="Responder" onClick={() => onReply(message)} disabled={busy}><Icon name="reply"/></button>
          <EmojiButton className="mg-tool" label="Reagir" align={mine ? 'right' : 'left'} disabled={busy} onEmoji={(emoji) => onReact(message, emoji, Boolean(message.reactions?.some((item) => item.emoji === emoji && item.mine)))}><Icon name="smile-plus"/></EmojiButton>
          {isGroup && !mine && <button type="button" className="mg-tool" aria-label={`Denunciar mensagem de ${message.sender.name}`} title="Denunciar mensagem" onClick={() => onReport(message)}><Icon name="flag"/></button>}
        </div>}
      </div>
      <Reactions message={message} onToggle={onReact} disabled={busy || !canMessage}/>
      {endsRun && <time className="message-time" dateTime={message.at}>{clockLabel(message.at)}{!isGroup && mine && message.readAt ? ' · lida' : ''}</time>}
    </div>
  </div>;
}

export default function Messages({ account, state, notify, go, contactId = '', groupId = '' }) {
  const initial = groupId ? { kind: 'group', id: groupId } : contactId ? { kind: 'direct', id: contactId } : null;
  const [selection, setSelection] = useState(initial);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [text, setText] = useState('');
  const [referenceId, setReferenceId] = useState('');
  const [gif, setGif] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [report, setReport] = useState(null);
  const [notificationsOverride, setNotificationsOverride] = useState(null);
  const [narrow, setNarrow] = useState(() => typeof matchMedia === 'function' && matchMedia('(max-width: 820px)').matches);
  const [sheet, setSheet] = useState(() => typeof matchMedia === 'function' && matchMedia('(max-width: 1180px)').matches);
  const shellRef = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const stuck = useRef(true);
  const shownFor = useRef('');

  useEffect(() => {
    const narrowQuery = matchMedia('(max-width: 820px)');
    const sheetQuery = matchMedia('(max-width: 1180px)');
    const update = () => { setNarrow(narrowQuery.matches); setSheet(sheetQuery.matches); };
    narrowQuery.addEventListener('change', update);
    sheetQuery.addEventListener('change', update);
    return () => { narrowQuery.removeEventListener('change', update); sheetQuery.removeEventListener('change', update); };
  }, []);

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
  const inThread = Boolean(selection);

  const query = normalize(search.trim());
  const all = [
    ...friends.map((item) => ({ ...item, kind: 'direct' })),
    ...groups.map((item) => ({ ...item, kind: 'group' })),
  ].sort((left, right) => (right.lastMessage?.at || '').localeCompare(left.lastMessage?.at || '') || left.name.localeCompare(right.name, 'pt-BR'));
  const items = all.filter((item) => (filter === 'all' || item.kind === filter) && (!query || normalize(item.name).includes(query) || normalize(item.handle).includes(query)));
  const unreadBy = (kind) => all.filter((item) => (kind === 'all' || item.kind === kind) && item.unread > 0 && !item.muted).length;

  useFillHeight(shellRef, [Boolean(account), inThread, narrow]);

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
    setDetailsOpen(false);
    setText('');
    setGif(null);
    setReplyTo(null);
    setReferenceId('');
    setPickerOpen(false);
    setError('');
    const hash = next?.kind === 'group' ? `#mensagens?grupo=${encodeURIComponent(next.id)}` : next?.kind === 'direct' ? `#mensagens?com=${encodeURIComponent(next.id)}` : '#mensagens';
    try { history.replaceState(null, '', hash); } catch { /* Hash indisponível. */ }
  }

  const refreshAll = () => Promise.all([threadResource.refresh(), conversationsResource.refresh()]);

  async function run(task, success, optimistic) {
    setBusy(true); setError('');
    const rollback = optimistic?.();
    try {
      const result = await task();
      if (!result.ok) throw new Error(apiError(result));
      if (success) notify(success);
      await refreshAll();
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

  async function send(event) {
    event.preventDefault();
    if (!selected) return;
    const body = text.trim();
    const course = state.courses.find((item) => item.id === referenceId);
    const reference = course ? { type: course.type || 'course', id: course.id, title: course.title } : null;
    if (!body && !reference && !gif) return;
    const draftGif = gif;
    const draftReply = replyTo;

    const tempId = `optimistic:${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const previewText = body || (draftGif ? 'GIF' : reference ? referenceLabel(reference) : '');
    const optimisticMessage = {
      id: tempId,
      kind: 'text',
      body,
      reference,
      gif: draftGif?.url || '',
      replyTo: draftReply,
      at: now,
      fromMe: true,
      senderId: account.id,
      ...(isGroup ? { sender: { id: account.id, name: account.name, avatar: state.profile?.avatar || account.avatar } } : {}),
    };

    let previousLast = null;
    setError('');
    setText('');
    setGif(null);
    setReplyTo(null);
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
      const result = await api(isGroup ? `/api/groups/${encodeURIComponent(selected)}/messages` : `/api/messages/${encodeURIComponent(selected)}`, { method: 'POST', body: { body, reference, gifUrl: draftGif?.url, replyToId: draftReply?.id } });
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
      stuck.current = true;
      inputRef.current?.focus();
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
      if (draftGif) setGif((current) => current || draftGif);
      if (draftReply) setReplyTo((current) => current || draftReply);
      setError(exception.message);
      notify(exception.message);
    }
  }

  async function react(message, emoji, mine) {
    const base = isGroup ? `/api/groups/${encodeURIComponent(selected)}` : `/api/messages/${encodeURIComponent(selected)}`;
    const path = `${base}/messages/${encodeURIComponent(message.id)}/reaction?emoji=${encodeURIComponent(emoji)}`;
    threadResource.mutate((previous) => previous && ({
      ...previous,
      messages: previous.messages.map((item) => {
        if (item.id !== message.id) return item;
        const list = (item.reactions || []).map((reaction) => reaction.emoji === emoji ? { ...reaction, count: reaction.count + (mine ? -1 : 1), mine: !mine } : reaction).filter((reaction) => reaction.count > 0);
        if (!mine && !list.some((reaction) => reaction.emoji === emoji)) list.push({ emoji, count: 1, mine: true });
        return { ...item, reactions: list };
      }),
    }));
    const result = await api(path, { method: mine ? 'DELETE' : 'PUT' });
    if (!result.ok) setError(apiError(result));
    await threadResource.refresh();
  }

  function startReply(message) {
    setReplyTo({ id: message.id, senderName: message.fromMe ? 'Você' : (message.sender?.name || thread?.friend?.name || ''), preview: message.body || (message.gif ? 'GIF' : message.reference ? referenceLabel(message.reference) : '') });
    inputRef.current?.focus();
  }

  function jumpTo(id) {
    const node = document.getElementById(`mg-msg-${id}`);
    if (!node) { notify('A mensagem citada é mais antiga que as exibidas aqui.'); return; }
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    node.classList.add('is-flash');
    setTimeout(() => node.classList.remove('is-flash'), 1200);
  }

  async function toggleMute() {
    const path = isGroup ? `/api/groups/${encodeURIComponent(selected)}/mute` : `/api/messages/${encodeURIComponent(selected)}/mute`;
    const next = !thread?.muted;
    if (await run(() => api(path, { method: 'PUT', body: { muted: next } }), next ? 'Conversa silenciada. As mensagens continuam chegando.' : 'Avisos desta conversa ligados de novo.')) {
      invalidateResources('/api/messages/unread');
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

  if (!account) return <SocialFrame route="mensagens" account={account}>
    <Empty icon="mail" title="Entre para conversar.">Mensagens exigem uma conta e amizades aceitas. O convite por link é o caminho para formar sua lista de amigos.</Empty>
    <Button onClick={() => go('login')}><Icon name="lock"/>Entrar na minha conta</Button>
  </SocialFrame>;

  const me = { name: account.name, avatar: state.profile?.avatar || account.avatar };
  const chosen = state.courses.find((item) => item.id === referenceId);
  const title = thread ? (isGroup ? thread.group.name : thread.friend.name) : '';
  const messages = thread?.messages || [];
  const showDetails = Boolean(detailsOpen && thread);
  const view = !inThread ? 'list' : showDetails && narrow ? 'details' : 'thread';

  const list = <aside className="mg-list" aria-label="Conversas">
    <div className="mg-list-head">
      <h2 className="title">Conversas</h2>
      <button type="button" className="icon-button" onClick={toggleNotifications} aria-pressed={!notifications} aria-label={notifications ? 'Silenciar notificações de mensagens' : 'Ativar notificações de mensagens'} title={notifications ? 'Notificações ativas' : 'Notificações silenciadas'}><Icon name={notifications ? 'bell' : 'mute'}/></button>
      <button type="button" className="button primary mg-new-button" aria-label="Nova conversa" onClick={() => select({ kind: 'new' })}><Icon name="edit"/>Nova</button>
    </div>
    <label className="mg-search"><Icon name="search"/><span className="sr-only">Buscar conversa</span>
      <input type="search" value={search} placeholder="Buscar por nome" onChange={(event) => setSearch(event.target.value)}/>
    </label>
    <div className="mg-filters" role="group" aria-label="Filtrar conversas">
      {FILTERS.map(([id, label]) => {
        const count = unreadBy(id);
        return <button key={id} type="button" className="filter-btn" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}{count > 0 && <span className="mg-filter-dot" aria-label={`${count} com mensagens novas`}/>}</button>;
      })}
    </div>
    <div className="mg-list-scroll">
      {!conversationsResource.data && !conversationsResource.error && <Skeleton label="Carregando as conversas…" rows={4}/>}
      {conversationsResource.data && all.length === 0 && <p className="inline-note"><Icon name="users"/><span>Nenhuma amizade ainda. <a href="#adicionar" className="text-link">Convide alguém</a> para começar.</span></p>}
      <ul className="conversation-list">
        {items.map((conversation) => {
          const active = selection?.kind === conversation.kind && selection.id === conversation.id;
          const preview = conversation.kind === 'group'
            ? (conversation.lastMessage ? conversation.lastMessage.preview : `${conversation.members} pessoas`)
            : conversation.blockedByMe ? 'Você bloqueou esta pessoa' : conversation.blockedMe ? 'Mensagens bloqueadas por ela' : conversation.lastMessage ? `${conversation.lastMessage.fromMe ? 'Você: ' : ''}${conversation.lastMessage.preview}` : 'Comece uma conversa';
          return <li key={`${conversation.kind}-${conversation.id}`}>
            <button type="button" className={`conversation-item ${active ? 'active' : ''} ${conversation.unread > 0 ? 'is-unread' : ''} ${conversation.muted ? 'is-muted' : ''}`} onClick={() => select({ kind: conversation.kind, id: conversation.id })} aria-current={active ? 'true' : undefined}>
              {conversation.kind === 'group' ? <GroupAvatar/> : <PersonAvatar person={conversation} className="conversation-avatar"/>}
              <span className="conversation-copy">
                <span className="conversation-line"><strong>{conversation.name}</strong>
                  {conversation.lastMessage && <time dateTime={conversation.lastMessage.at}>{timeLabel(conversation.lastMessage.at)}</time>}
                </span>
                <span className="conversation-line">
                  <small>{preview}</small>
                  {conversation.muted && <Icon name="mute" className="conversation-muted"/>}
                  {conversation.unread > 0 && <span className="unread-badge" aria-label={`${conversation.unread} não lidas`}>{conversation.unread > 99 ? '99+' : conversation.unread}</span>}
                </span>
              </span>
            </button>
          </li>;
        })}
      </ul>
      {conversationsResource.data && all.length > 0 && items.length === 0 && <p className="muted-text mg-list-empty">{query ? 'Nenhuma conversa encontrada.' : filter === 'group' ? 'Nenhum grupo ainda. Crie um em Nova.' : 'Nenhuma conversa privada.'}</p>}
    </div>
    <p className="mg-list-foot"><Icon name="lock"/>Só entre amigos</p>
  </aside>;

  let lastDay = '';
  const center = <section className="mg-thread" aria-label="Conversa selecionada">
    {!selection && <div className="messages-placeholder"><span className="mg-bubbles" aria-hidden="true"><Icon name="message"/></span><h2 className="title">Escolha uma conversa</h2><p className="muted-text">Selecione um amigo ou grupo ao lado, ou comece uma conversa nova.</p></div>}
    {selection?.kind === 'new' && <NewChat friends={friends} notify={notify} onBack={() => select(null)} onDirect={(id) => select({ kind: 'direct', id })} onCreated={(id) => select({ kind: 'group', id })}/>}
    {selected && loading && <div className="mg-thread-loading"><Skeleton label="Carregando a conversa…" rows={3} variant="text"/></div>}
    {selected && !thread && !loading && threadResource.error && <div className="messages-placeholder"><p className="form-error" role="alert">{threadResource.error}</p><Button secondary onClick={() => select(null)}>Voltar às conversas</Button></div>}
    {selected && thread && <>
      <header className="message-thread-head">
        <button type="button" className="icon-button mg-back" onClick={() => select(null)} aria-label="Voltar para as conversas"><Icon name="back"/></button>
        {isGroup
          ? <button type="button" className="person-button mg-thread-who" onClick={() => setDetailsOpen(true)} aria-label={`Detalhes do grupo ${title}`}>
            <GroupAvatar size="is-large"/>
            <span className="message-thread-copy"><strong className="title">{title}</strong><small>{thread.members.map((member) => member.isMe ? 'você' : member.name.split(' ')[0]).join(', ')}</small></span>
          </button>
          : <PersonButton person={thread.friend} go={go} className="mg-thread-who">
            <PersonAvatar person={thread.friend} className="conversation-avatar is-large"/>
            <span className="message-thread-copy"><strong className="title">{title}</strong><small>{thread.blockedByMe ? 'Você bloqueou esta pessoa.' : thread.blockedMe ? 'Esta pessoa bloqueou novas mensagens.' : thread.friend.handle ? `@${thread.friend.handle}` : 'Amizade aceita'}</small></span>
          </PersonButton>}
        {thread.muted && <span className="mg-muted-tag" title="Conversa silenciada"><Icon name="mute"/><span className="sr-only">Conversa silenciada</span></span>}
        <button type="button" className="icon-button" aria-label={isGroup ? 'Detalhes do grupo' : 'Detalhes da conversa'} aria-expanded={showDetails} onClick={() => setDetailsOpen((value) => !value)}><Icon name="info"/></button>
      </header>
      <div className="message-list" ref={listRef} onScroll={(event) => { const node = event.currentTarget; stuck.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80; }} tabIndex={0} role="log" aria-live="polite" aria-label={`Mensagens de ${title}`}>
        {messages.length === 0 && <p className="messages-placeholder-copy">Nenhuma mensagem ainda. Diga olá ou compartilhe um material.</p>}
        {messages.map((message, index) => {
          const day = new Date(message.at).toDateString();
          const divider = day !== lastDay;
          lastDay = day;
          if (message.kind === 'system') {
            return <div key={message.id} className="message-group">
              {divider && <div className="message-day" role="separator"><span>{dayLabel(message.at)}</span></div>}
              <p className="mg-system">{message.body}</p>
            </div>;
          }
          const previous = messages[index - 1];
          const next = messages[index + 1];
          const same = (other) => other && other.kind !== 'system' && other.senderId === message.senderId && new Date(other.at).toDateString() === day && Math.abs(Date.parse(other.at) - Date.parse(message.at)) < RUN_GAP_MS;
          return <div key={message.id} className="message-group">
            {divider && <div className="message-day" role="separator"><span>{dayLabel(message.at)}</span></div>}
            <Message message={message} isGroup={isGroup} person={isGroup ? message.sender : thread.friend} me={me} startsRun={divider || !same(previous)} endsRun={!same(next)} canMessage={thread.canMessage} busy={busy} go={go}
              onReply={startReply} onReact={react} onJump={jumpTo}
              onReport={(item) => setReport({ person: item.sender, context: 'group', groupId: selected, subjectId: item.id })}/>
          </div>;
        })}
      </div>
      {!thread.canMessage
        ? <p className="inline-note mg-locked"><Icon name="lock"/><span>{thread.blockedByMe ? 'Desbloqueie para voltar a enviar mensagens.' : 'A outra pessoa precisa desbloquear para a conversa continuar.'}</span></p>
        : <form className="message-composer" onSubmit={send}>
          {replyTo && <div className="mg-draft mg-draft-reply"><Icon name="reply"/><span><strong>Respondendo a {replyTo.senderName}</strong><small>{replyTo.preview}</small></span>
            <button type="button" className="icon-button" aria-label="Cancelar resposta" onClick={() => setReplyTo(null)}><Icon name="close"/></button></div>}
          {chosen && <div className="mg-draft"><Icon name="book"/><span><strong>{materialType(chosen.type).title}</strong><small>{chosen.title}</small></span>
            <button type="button" className="icon-button" aria-label="Remover material" onClick={() => setReferenceId('')}><Icon name="close"/></button></div>}
          {gif && <div className="mg-draft"><img src={gif.preview} alt="Prévia do GIF"/><span><strong>GIF</strong><small>{gif.title || 'Será enviado com a mensagem'}</small></span>
            <button type="button" className="icon-button" aria-label="Remover GIF" onClick={() => setGif(null)}><Icon name="close"/></button></div>}
          <div className="message-composer-bar">
            <div className="message-attach">
              <button type="button" className="mg-tool" aria-label="Compartilhar material" title="Compartilhar material" aria-expanded={pickerOpen} onClick={() => setPickerOpen((open) => !open)}><Icon name="plus"/></button>
              {pickerOpen && <ul className="message-picker" aria-label="Materiais para compartilhar">
                {state.courses.length === 0 && <li className="muted-text">Nenhum material na biblioteca.</li>}
                {state.courses.map((course) => <li key={course.id}><button type="button" onClick={() => { setReferenceId(course.id); setPickerOpen(false); }}>{materialType(course.type).title} · {course.title}</button></li>)}
              </ul>}
            </div>
            <EmojiButton className="mg-tool" label="Emoji" disabled={busy} onEmoji={(emoji) => { setText((value) => `${value}${emoji}`.slice(0, 4000)); inputRef.current?.focus(); }}><Icon name="smile"/></EmojiButton>
            <EmojiButton className="mg-tool" label="GIF" disabled={busy} onGif={(item) => { setGif(item); inputRef.current?.focus(); }}><span className="sf-gif-tag">GIF</span></EmojiButton>
            <textarea ref={inputRef} className="message-input" rows={1} value={text} maxLength={4000} onChange={(event) => setText(event.target.value)} placeholder={`Escreva para ${title}…`} aria-label="Mensagem" autoComplete="off"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form.requestSubmit(); }
                if (event.key === 'Escape' && replyTo) { event.stopPropagation(); setReplyTo(null); }
              }}/>
            <button type="submit" className="message-round message-send" aria-label="Enviar" disabled={busy || (!text.trim() && !referenceId && !gif)}><Icon name="send"/></button>
          </div>
        </form>}
    </>}
  </section>;

  return <SocialFrame route="mensagens" account={account} className={`messages-frame ${inThread ? 'is-in-thread' : ''}`}>
    {(error || loadError) && <p className="form-error" role="alert">{error || loadError}</p>}
    <div ref={shellRef} className={`card-surface mg-shell ${showDetails ? 'has-details' : ''}`} data-view={view}>
      {list}
      {center}
      {showDetails && <Details thread={thread} isGroup={isGroup} selected={selected} friends={friends} account={account} busy={busy} go={go} notify={notify} sheet={sheet}
        onRun={run} onOptimistic={{
          rename: (id, name) => {
            const previousThread = threadResource.data;
            const previousConversations = conversationsResource.data;
            threadResource.mutate((current) => current ? { ...current, group: { ...current.group, name } } : current);
            conversationsResource.mutate((current) => current ? { ...current, groups: (current.groups || []).map((group) => group.id === id ? { ...group, name } : group) } : current);
            return () => {
              if (previousThread) threadResource.mutate(previousThread);
              if (previousConversations) conversationsResource.mutate(previousConversations);
            };
          },
          removeMember: (id) => {
            const previousThread = threadResource.data;
            threadResource.mutate((current) => current ? { ...current, members: (current.members || []).filter((member) => member.id !== id) } : current);
            return () => { if (previousThread) threadResource.mutate(previousThread); };
          },
        }} onMute={toggleMute} onBlock={toggleBlock} onLeave={leaveGroup} onDelete={deleteGroup} onClose={() => setDetailsOpen(false)}
        onReport={(target) => setReport(target)}/>}
    </div>
    {report && <ReportDialog target={report.person} context={report.context} groupId={report.groupId} subjectId={report.subjectId} canBlock={Boolean(report.canBlock)} onClose={() => setReport(null)} onDone={({ blocked }) => {
      notify(blocked ? 'Denúncia enviada e contato bloqueado. A equipe do Lume vai analisar.' : 'Denúncia enviada. A equipe do Lume vai analisar.');
      if (blocked) refreshAll();
    }}/>}
  </SocialFrame>;
}
