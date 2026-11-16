import { useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import { Button, Heading, Skeleton } from '../../ui/ui.jsx';
import { api, apiError } from '../../lib/api.js';
import { copyText } from '../../lib/clipboard.js';
import { invalidateResources, useResource } from '../../lib/resources.js';
import { SocialAvatar } from './SocialFeed.jsx';
import { warmProfileProps } from './prefetch.js';

// Adicionar amigos: busca pelo @usuário exato, solicitações recebidas e enviadas
// e convite por link (para quem ainda não tem conta). A amizade só começa quando
// a outra pessoa aceita; nada disso concede XP nem expõe biblioteca ou progresso.

function PersonRow({ person, children }) {
  return <li className="addfriend-person">
    <SocialAvatar person={person}/>
    <span className="addfriend-person-name"><strong>{person.name}</strong>{person.handle && <small className="mono">@{person.handle}</small>}</span>
    <span className="addfriend-person-actions">{children}</span>
  </li>;
}

export default function AddFriends({ account, notify, go }) {
  const requests = useResource('/api/friends/requests', { enabled: Boolean(account), interval: 30000 });
  const data = requests.data;
  const [query, setQuery] = useState('');
  const [found, setFound] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(action) {
    setBusy(true); setError('');
    try { return await action(); } catch (exception) { setError(exception.message); return null; } finally { setBusy(false); }
  }

  async function refresh() {
    await requests.refresh();
    invalidateResources('/api/friends');
    invalidateResources('/api/social/');
  }

  async function search(event) {
    event.preventDefault();
    if (!query.trim()) return;
    setFound(null);
    await run(async () => {
      const result = await api(`/api/friends/search?handle=${encodeURIComponent(query.trim())}`);
      if (!result.ok) throw new Error(apiError(result));
      setFound(result.data);
    });
  }

  async function sendRequest() {
    await run(async () => {
      const result = await api('/api/friends/requests', { method: 'POST', body: { handle: found.user.handle } });
      if (!result.ok) throw new Error(apiError(result));
      setFound({ ...found, status: result.data.status, requestId: result.data.requestId });
      notify(result.data.status === 'friends' ? `Você e ${found.user.name} agora são amigos.` : `Solicitação enviada para ${found.user.name}.`);
      await refresh();
    });
  }

  async function respond(request, action) {
    await run(async () => {
      const result = await api(`/api/friends/requests/${encodeURIComponent(request.id)}/respond`, { method: 'POST', body: { action } });
      if (!result.ok) throw new Error(apiError(result));
      notify(action === 'accept' ? `Agora você e ${request.user.name} são amigos.` : `Solicitação de ${request.user.name} recusada.`);
      await refresh();
    });
  }

  async function cancel(request) {
    await run(async () => {
      const result = await api(`/api/friends/requests/${encodeURIComponent(request.id)}`, { method: 'DELETE' });
      if (!result.ok) throw new Error(apiError(result));
      notify(`Solicitação para ${request.user.name} cancelada.`);
      if (found?.requestId === request.id) setFound({ ...found, status: 'none', requestId: undefined });
      await refresh();
    });
  }

  const inviteUrl = (code) => `${location.origin}/#amigos?convite=${code}`;

  // Um clique: cria o convite, copia o link e, onde houver, abre o compartilhar do sistema.
  async function shareInvite() {
    const link = await run(async () => {
      const result = await api('/api/friends/invite', { method: 'POST', body: {} });
      if (!result.ok) throw new Error(apiError(result));
      return inviteUrl(result.data.code);
    });
    if (!link) return;
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      try { await navigator.share({ title: 'Convite para o Lume', text: `${account.name} convidou você para ser amigo no Lume.`, url: link }); return; } catch (exception) { if (exception?.name === 'AbortError') return; }
    }
    notify(await copyText(link) ? 'Link do convite copiado. Vale por 7 dias.' : `Não foi possível copiar automaticamente. Link: ${link}`);
  }

  if (!account) {
    return <div className="social-root">
      <Heading eyebrow="amigos, mensagens e ranking" title="Adicione seus amigos">Encontre quem já está aqui ou convide alguém para o Lume.</Heading>
      <section className="card-surface social-feed-empty">
        <span className="social-empty-icon"><Icon name="lock"/></span><h2 className="title">Entre para adicionar amigos.</h2>
        <p>Com uma conta você acha pessoas pelo @usuário e convida quem ainda não usa o Lume.</p>
        <Button onClick={() => go('login')}>Entrar<Icon name="arrow"/></Button>
      </section>
    </div>;
  }

  const received = data?.received || [];
  const sent = data?.sent || [];

  const searchCard = <section className="addfriend-block" aria-labelledby="addfriend-search-title">
    <div className="addfriend-block-head">
      <h2 id="addfriend-search-title" className="title">Buscar pelo @usuário</h2>
      {data?.handle && <span className="quiet-note">Você é <strong className="mono">@{data.handle}</strong></span>}
    </div>
    <form className="addfriend-search" onSubmit={search} role="search">
      <label className="addfriend-search-field"><span className="sr-only">@usuário</span><Icon name="search"/>
        <input value={query} onChange={event => { setQuery(event.target.value); setFound(null); setError(''); }} placeholder="@usuario" maxLength={26} autoComplete="off" autoCapitalize="none" spellCheck="false" disabled={busy}/>
      </label>
      <Button type="submit" secondary disabled={busy || !query.trim()}>Buscar</Button>
    </form>
    {error && <p className="form-error" role="alert">{error}</p>}
    {found && <ul className="addfriend-list" aria-live="polite">
      <PersonRow person={found.user}>
        {found.status === 'none' && <Button onClick={sendRequest} disabled={busy}>Enviar solicitação</Button>}
        {found.status === 'sent' && <Button secondary disabled>Solicitação enviada</Button>}
        {found.status === 'friends' && <Button secondary {...warmProfileProps(found.user)} onClick={() => go(found.user.handle ? `perfil?u=${found.user.handle}` : `perfil?id=${encodeURIComponent(found.user.id)}`)}>Já são amigos</Button>}
        {found.status === 'received' && <Button onClick={() => respond({ id: found.requestId, user: found.user }, 'accept')} disabled={busy}>Aceitar</Button>}
        {found.status === 'self' && <span className="quiet-note">Esse é você.</span>}
        {found.publicProfile && found.status !== 'friends' && found.status !== 'self' && <Button secondary {...warmProfileProps(found.user)} onClick={() => go(found.user.handle ? `perfil?u=${found.user.handle}` : `perfil?id=${encodeURIComponent(found.user.id)}`)}>Ver perfil</Button>}
      </PersonRow>
    </ul>}
    {found?.status === 'none' && <p className="addfriend-note"><Icon name="lock"/>A amizade começa quando a outra pessoa aceita.</p>}
  </section>;

  const receivedList = !data && !requests.error ? <Skeleton label="Carregando solicitações…" rows={2}/>
    : received.length === 0 ? <p className="social-sidebar-empty">Nenhuma solicitação recebida por enquanto.</p>
      : <ul className="addfriend-list">{received.map(request => <PersonRow key={request.id} person={request.user}>
        <Button secondary onClick={() => respond(request, 'decline')} disabled={busy}>Recusar</Button>
        <Button onClick={() => respond(request, 'accept')} disabled={busy}>Aceitar</Button>
      </PersonRow>)}</ul>;

  const sentList = !data && !requests.error ? <Skeleton label="Carregando solicitações…" rows={2}/>
    : sent.length === 0 ? <p className="social-sidebar-empty">Você não tem solicitações aguardando resposta.</p>
      : <ul className="addfriend-list">{sent.map(request => <PersonRow key={request.id} person={request.user}>
        <span className="soft-badge">Aguardando</span>
        <Button secondary onClick={() => cancel(request)} disabled={busy}>Cancelar</Button>
      </PersonRow>)}</ul>;

  const pending = received.length + sent.length;

  return <div className="social-root">
    <Heading title="Adicionar amigos">Busque pelo @usuário ou envie um link para quem ainda não tem conta.</Heading>
    {requests.error && <div className="form-error form-error-block" role="alert">{requests.error}<Button secondary onClick={() => requests.refresh()}>Tentar novamente</Button></div>}
    <div className="card-surface addfriend-card addfriend-simple">
      {searchCard}
      <section className="addfriend-block addfriend-invite-row" aria-labelledby="addfriend-invite-title">
        <div>
          <h2 id="addfriend-invite-title" className="title">Convidar por link</h2>
          <p className="quiet-note">Para quem ainda não está no Lume. O link vale por 7 dias.</p>
        </div>
        <Button onClick={shareInvite} disabled={busy}><Icon name="link"/>Copiar link</Button>
      </section>
    </div>
    {pending > 0 && <div className="addfriend-requests">
      {received.length > 0 && <section className="card-surface addfriend-card"><h2 className="title">Pediram para ser seu amigo <span className="nav-badge addfriend-badge" aria-label={`${received.length} pendentes`}>{received.length}</span></h2>{receivedList}</section>}
      {sent.length > 0 && <section className="card-surface addfriend-card"><h2 className="title">Aguardando resposta</h2>{sentList}</section>}
    </div>}
  </div>;
}
