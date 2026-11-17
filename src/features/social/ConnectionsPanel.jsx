import { useEffect, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import { Button, PersonAvatar } from '../../ui/ui.jsx';
import { api, apiError } from '../../lib/api.js';
import { copyText } from '../../lib/clipboard.js';
import { invalidateResources } from '../../lib/resources.js';

// Painel de conexões dentro da dock de Mensagens: o único lugar para achar
// alguém pelo @usuário, convidar por link, aceitar um convite recebido por link
// (#amigos?convite=) e responder pedidos. A lista de amigos é a própria lista de
// conversas. A amizade só começa quando a outra pessoa aceita; nada aqui concede
// XP nem expõe biblioteca ou progresso.
const bare = (value) => String(value || '').trim().replace(/^@+/, '');

export default function ConnectionsPanel({
  account,
  requestsResource,
  searchQuery = '',
  inviteCode = '',
  onInviteDone,
  notify,
  onOpenDirect,
  onBack,
}) {
  const data = requestsResource?.data;
  const received = data?.received || [];
  const sent = data?.sent || [];
  const [handleInput, setHandleInput] = useState(() => (searchQuery.startsWith('@') ? bare(searchQuery) : ''));
  const [found, setFound] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState(inviteCode);
  const [inviteError, setInviteError] = useState('');

  useEffect(() => {
    if (searchQuery.startsWith('@')) setHandleInput(bare(searchQuery));
  }, [searchQuery]);
  useEffect(() => { if (inviteCode) setCode(inviteCode); }, [inviteCode]);

  async function refresh() {
    await requestsResource?.refresh();
    invalidateResources('/api/friends');
    invalidateResources('/api/social/');
    invalidateResources('/api/messages');
  }

  async function search(event) {
    event?.preventDefault();
    const handle = bare(handleInput);
    if (!handle) return;
    setBusy(true);
    setError('');
    setFound(null);
    try {
      const result = await api(`/api/friends/search?handle=${encodeURIComponent(handle)}`);
      if (!result.ok) throw new Error(apiError(result));
      setFound(result.data);
    } catch (exception) {
      setError(exception.message);
    } finally {
      setBusy(false);
    }
  }

  async function sendRequest() {
    if (!found) return;
    setError('');
    const previousFound = found;
    setFound({ ...found, status: found.status === 'received' ? 'friends' : 'sent' });
    try {
      const result = await api('/api/friends/requests', { method: 'POST', body: { handle: previousFound.user.handle } });
      if (!result.ok) throw new Error(apiError(result));
      setFound({ ...previousFound, status: result.data.status, requestId: result.data.requestId });
      notify(result.data.status === 'friends' ? `Você e ${previousFound.user.name} agora são amigos.` : `Solicitação enviada para ${previousFound.user.name}.`);
      refresh();
    } catch (exception) {
      setFound(previousFound);
      setError(exception.message);
      notify(exception.message);
    }
  }

  async function respond(request, action) {
    setError('');
    const previous = requestsResource.data;
    requestsResource.mutate((current) => (current ? { ...current, received: (current.received || []).filter((item) => item.id !== request.id) } : current));
    try {
      const result = await api(`/api/friends/requests/${encodeURIComponent(request.id)}/respond`, { method: 'POST', body: { action } });
      if (!result.ok) throw new Error(apiError(result));
      notify(action === 'accept' ? `Agora você e ${request.user.name} são amigos.` : `Solicitação de ${request.user.name} recusada.`);
      refresh();
    } catch (exception) {
      if (previous) requestsResource.mutate(previous);
      setError(exception.message);
      notify(exception.message);
    }
  }

  async function cancel(request) {
    setError('');
    const previous = requestsResource.data;
    const previousFound = found;
    requestsResource.mutate((current) => (current ? { ...current, sent: (current.sent || []).filter((item) => item.id !== request.id) } : current));
    if (found?.requestId === request.id) setFound({ ...found, status: 'none', requestId: undefined });
    try {
      const result = await api(`/api/friends/requests/${encodeURIComponent(request.id)}`, { method: 'DELETE' });
      if (!result.ok) throw new Error(apiError(result));
      notify(`Solicitação para ${request.user.name} cancelada.`);
      refresh();
    } catch (exception) {
      if (previous) requestsResource.mutate(previous);
      setFound(previousFound);
      setError(exception.message);
      notify(exception.message);
    }
  }

  async function acceptInvite(event) {
    event.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setInviteError('');
    try {
      const result = await api('/api/friends/accept', { method: 'POST', body: { code } });
      if (!result.ok) throw new Error(apiError(result));
      notify(result.data.alreadyFriends ? `Você e ${result.data.friend.name} já eram amigos.` : `Agora você e ${result.data.friend.name} são amigos.`);
      setCode('');
      onInviteDone?.();
      await refresh();
    } catch (exception) {
      setInviteError(exception.message);
    } finally {
      setBusy(false);
    }
  }

  function dismissInvite() {
    setCode('');
    setInviteError('');
    onInviteDone?.();
  }

  // Um clique: cria o convite, copia o link e, onde houver, abre o compartilhar do sistema.
  async function shareInvite() {
    setBusy(true);
    setError('');
    try {
      const result = await api('/api/friends/invite', { method: 'POST', body: {} });
      if (!result.ok) throw new Error(apiError(result));
      const link = `${location.origin}/#amigos?convite=${result.data.code}`;
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        try {
          await navigator.share({ title: 'Convite para o Lume', text: `${account.name} convidou você para ser amigo no Lume.`, url: link });
          return;
        } catch (exception) {
          if (exception?.name === 'AbortError') return;
        }
      }
      notify((await copyText(link)) ? 'Link do convite copiado. Vale por 7 dias.' : `Não foi possível copiar automaticamente. Link: ${link}`);
    } catch (exception) {
      setError(exception.message);
    } finally {
      setBusy(false);
    }
  }

  const person = (user) => <>
    <PersonAvatar person={user} className="conversation-avatar"/>
    <span className="mg-conn-who">
      <strong>{user.name}</strong>
      {user.handle && <small className="mono">@{user.handle}</small>}
    </span>
  </>;

  return <div className="mg-connections">
    <div className="mg-conn-head">
      <button type="button" className="text-button accent" onClick={onBack}><Icon name="back"/>Conversas</button>
    </div>
    <div className="mg-conn-title">
      <strong>Adicionar amigos</strong>
      {data?.handle && <small>Você é <span className="mono">@{data.handle}</span></small>}
    </div>

    {code && <form className="mg-conn-invite" onSubmit={acceptInvite} aria-label="Convite recebido">
      <span className="mg-section-label">Convite recebido</span>
      <label className="mg-handle-field"><span className="sr-only">Código do convite</span>
        <input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="XXXX-XXXX-XXXX" maxLength={20} autoComplete="off" spellCheck="false" disabled={busy}/>
      </label>
      <div className="mg-conn-invite-actions">
        <Button type="submit" disabled={busy || !code.trim()}><Icon name="check"/>Aceitar convite</Button>
        <button type="button" className="text-button" onClick={dismissInvite} disabled={busy}>Agora não</button>
      </div>
      {inviteError && <p className="form-error" role="alert">{inviteError}</p>}
    </form>}

    <form className="mg-conn-search" onSubmit={search} role="search">
      <label className="mg-handle-field">
        <span className="mg-handle-at mono" aria-hidden="true">@</span>
        <span className="sr-only">Buscar por @usuário</span>
        <input
          type="text"
          value={handleInput}
          placeholder="usuario"
          maxLength={26}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck="false"
          disabled={busy}
          onChange={(event) => { setHandleInput(bare(event.target.value)); setFound(null); setError(''); }}
        />
        <button type="submit" className="mg-handle-go" aria-label="Buscar" title="Buscar" disabled={busy || !handleInput.trim()}><Icon name="search"/></button>
      </label>
    </form>

    {error && <p className="form-error" role="alert">{error}</p>}

    {found?.user && <div className="mg-conn-row mg-conn-found" aria-live="polite">
      {person(found.user)}
      <span className="mg-conn-actions">
        {found.status === 'self' && <span className="quiet-note">Você</span>}
        {found.status === 'friends' && <Button secondary type="button" onClick={() => onOpenDirect(found.user.id)}>Conversar</Button>}
        {found.status === 'none' && <Button type="button" onClick={sendRequest}>Solicitar</Button>}
        {found.status === 'received' && <Button type="button" onClick={sendRequest}>Aceitar</Button>}
        {found.status === 'sent' && <span className="quiet-note">Enviada</span>}
      </span>
    </div>}

    {received.length > 0 && <div className="mg-conn-section">
      <span className="mg-section-label">Pedidos recebidos · {received.length}</span>
      <ul className="mg-conn-list">
        {received.map((request) => <li key={request.id} className="mg-conn-row">
          {person(request.user)}
          <span className="mg-conn-actions">
            <Button type="button" onClick={() => respond(request, 'accept')}>Aceitar</Button>
            <button type="button" className="icon-button" aria-label={`Recusar pedido de ${request.user.name}`} title="Recusar" onClick={() => respond(request, 'decline')}><Icon name="close"/></button>
          </span>
        </li>)}
      </ul>
    </div>}

    {sent.length > 0 && <div className="mg-conn-section">
      <span className="mg-section-label">Aguardando resposta · {sent.length}</span>
      <ul className="mg-conn-list">
        {sent.map((request) => <li key={request.id} className="mg-conn-row">
          {person(request.user)}
          <span className="mg-conn-actions">
            <button type="button" className="text-button" onClick={() => cancel(request)}>Cancelar</button>
          </span>
        </li>)}
      </ul>
    </div>}

    <button type="button" className="mg-invite-link" onClick={shareInvite} disabled={busy}>
      <span className="mg-invite-icon" aria-hidden="true"><Icon name="link"/></span>
      <span className="mg-invite-copy">
        <strong>Copiar link de convite</strong>
        <small>Para quem ainda não está no Lume. Vale por 7 dias.</small>
      </span>
    </button>
  </div>;
}
