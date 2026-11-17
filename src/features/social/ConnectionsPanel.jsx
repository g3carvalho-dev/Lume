import { useEffect, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import { Button, PersonAvatar } from '../../ui/ui.jsx';
import { api, apiError } from '../../lib/api.js';
import { copyText } from '../../lib/clipboard.js';
import { invalidateResources } from '../../lib/resources.js';

// Painel inline de conexões dentro da dock flutuante: busca exata por @usuário,
// pedidos recebidos/enviados e geração de link de convite.
export default function ConnectionsPanel({
  account,
  requestsResource,
  searchQuery = '',
  notify,
  onOpenDirect,
  onBack,
}) {
  const data = requestsResource?.data;
  const incoming = data?.incoming || [];
  const outgoing = data?.outgoing || [];
  const [handleInput, setHandleInput] = useState(() => (searchQuery.startsWith('@') ? searchQuery : ''));
  const [found, setFound] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (searchQuery.startsWith('@')) setHandleInput(searchQuery);
  }, [searchQuery]);

  async function refresh() {
    await requestsResource?.refresh();
    invalidateResources('/api/friends');
    invalidateResources('/api/social/');
    invalidateResources('/api/messages');
  }

  async function search(event) {
    event?.preventDefault();
    const trimmed = handleInput.trim();
    if (!trimmed) return;
    setBusy(true);
    setError('');
    setFound(null);
    try {
      const result = await api(`/api/friends/search?handle=${encodeURIComponent(trimmed)}`);
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
    setFound({ ...found, status: found.status === 'incoming' ? 'friends' : 'sent' });
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
    requestsResource.mutate((current) => (current ? { ...current, incoming: (current.incoming || []).filter((item) => item.id !== request.id) } : current));
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
    requestsResource.mutate((current) => (current ? { ...current, outgoing: (current.outgoing || []).filter((item) => item.id !== request.id) } : current));
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

  return <div className="mg-connections">
    <div className="mg-conn-head">
      <button type="button" className="text-button accent" onClick={onBack}><Icon name="back"/>Conversas</button>
      <button type="button" className="text-button" onClick={shareInvite} disabled={busy}><Icon name="link"/>Link convite</button>
    </div>

    <form className="mg-conn-search" onSubmit={search}>
      <label className="mg-search"><Icon name="search"/><span className="sr-only">Buscar por @usuário</span>
        <input
          type="search"
          value={handleInput}
          placeholder="Buscar por @usuário exato…"
          autoComplete="off"
          spellCheck="false"
          disabled={busy}
          onChange={(event) => { setHandleInput(event.target.value); setError(''); }}
        />
      </label>
      <Button secondary type="submit" disabled={busy || !handleInput.trim()}>Buscar</Button>
    </form>

    {error && <p className="form-error" role="alert">{error}</p>}

    {found && <div className="mg-conn-card">
      {!found.user
        ? <p className="quiet-note">Nenhuma pessoa encontrada com esse @usuário.</p>
        : <div className="mg-conn-row">
          <PersonAvatar person={found.user} className="conversation-avatar"/>
          <span className="mg-conn-who">
            <strong>{found.user.name}</strong>
            <small className="mono">@{found.user.handle}</small>
          </span>
          <span className="mg-conn-actions">
            {found.status === 'self' && <span className="quiet-note">Você</span>}
            {found.status === 'friends' && <Button secondary type="button" onClick={() => onOpenDirect(found.user.id)}>Conversar</Button>}
            {found.status === 'none' && <Button secondary type="button" onClick={sendRequest}>Solicitar</Button>}
            {found.status === 'incoming' && <Button type="button" onClick={sendRequest}>Aceitar</Button>}
            {found.status === 'sent' && <span className="quiet-note">Enviada</span>}
          </span>
        </div>}
    </div>}

    {incoming.length > 0 && <div className="mg-conn-section">
      <span className="mg-section-label">Pedidos recebidos · {incoming.length}</span>
      <ul className="mg-conn-list">
        {incoming.map((request) => <li key={request.id} className="mg-conn-row">
          <PersonAvatar person={request.user} className="conversation-avatar"/>
          <span className="mg-conn-who">
            <strong>{request.user.name}</strong>
            {request.user.handle && <small className="mono">@{request.user.handle}</small>}
          </span>
          <span className="mg-conn-actions">
            <Button type="button" onClick={() => respond(request, 'accept')}>Aceitar</Button>
            <button type="button" className="icon-button" aria-label={`Recusar pedido de ${request.user.name}`} title="Recusar" onClick={() => respond(request, 'decline')}><Icon name="close"/></button>
          </span>
        </li>)}
      </ul>
    </div>}

    {outgoing.length > 0 && <div className="mg-conn-section">
      <span className="mg-section-label">Enviadas · {outgoing.length}</span>
      <ul className="mg-conn-list">
        {outgoing.map((request) => <li key={request.id} className="mg-conn-row">
          <PersonAvatar person={request.user} className="conversation-avatar"/>
          <span className="mg-conn-who">
            <strong>{request.user.name}</strong>
            {request.user.handle && <small className="mono">@{request.user.handle}</small>}
          </span>
          <span className="mg-conn-actions">
            <button type="button" className="text-button" onClick={() => cancel(request)}>Cancelar</button>
          </span>
        </li>)}
      </ul>
    </div>}

    {!found && incoming.length === 0 && outgoing.length === 0 && (
      <p className="quiet-note mg-conn-empty">Busque o <strong>@usuário</strong> exato de alguém para enviar uma solicitação ou gere um link de convite acima.</p>
    )}
  </div>;
}
