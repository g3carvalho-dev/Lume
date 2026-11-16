import { useEffect, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import { Button, Skeleton } from '../../ui/ui.jsx';
import { api, apiError } from '../../lib/api.js';
import { copyText } from '../../lib/clipboard.js';
import { invalidateResources, useResource } from '../../lib/resources.js';
import { SocialAvatar } from './SocialFeed.jsx';
import { PersonButton } from './PersonCard.jsx';
import SocialFrame from './SocialFrame.jsx';

// Aba Amigos: a lista de amigos primeiro, pedidos pendentes em destaque quando
// existem, o convite recebido por link (#amigos?convite= ou #adicionar?convite=) e
// a área "Encontrar pessoas" (busca pelo @usuário exato e convite por link). A área
// foi desenhada para receber, depois do alfa, busca por nome ou disciplina sem
// refazer a tela. A amizade só começa quando a outra pessoa aceita; nada disso
// concede XP nem expõe biblioteca ou progresso.

function PersonRow({ person, go, children, status }) {
  return <li className="addfriend-person">
    <PersonButton person={person} go={go} className="addfriend-person-who">
      <SocialAvatar person={person}/>
      <span className="addfriend-person-name"><strong>{person.name}</strong>{person.handle && <small className="mono">@{person.handle}</small>}{status}</span>
    </PersonButton>
    <span className="addfriend-person-actions">{children}</span>
  </li>;
}

function presenceLabel(friend) {
  const status = friend.activity?.status || 'offline';
  if (status === 'studying') return 'Estudando agora';
  return friend.activity?.label || 'Offline';
}

export default function AddFriends({ account, inviteCode = '', notify, go }) {
  const requests = useResource('/api/friends/requests', { enabled: Boolean(account), interval: 30000 });
  const friendsResource = useResource('/api/friends', { enabled: Boolean(account), interval: 45000 });
  const data = requests.data;
  const [query, setQuery] = useState('');
  const [found, setFound] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState(inviteCode);
  const [inviteError, setInviteError] = useState('');
  useEffect(() => { if (inviteCode) setCode(inviteCode); }, [inviteCode]);

  async function run(action) {
    setBusy(true); setError('');
    try { return await action(); } catch (exception) { setError(exception.message); return null; } finally { setBusy(false); }
  }

  async function refresh() {
    await Promise.all([requests.refresh(), friendsResource.refresh()]);
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
    const previous = requests.data;
    requests.mutate((current) => current ? { ...current, received: (current.received || []).filter((item) => item.id !== request.id) } : current);
    try {
      const result = await api(`/api/friends/requests/${encodeURIComponent(request.id)}/respond`, { method: 'POST', body: { action } });
      if (!result.ok) throw new Error(apiError(result));
      notify(action === 'accept' ? `Agora você e ${request.user.name} são amigos.` : `Solicitação de ${request.user.name} recusada.`);
      refresh();
    } catch (exception) {
      if (previous) requests.mutate(previous);
      setError(exception.message);
      notify(exception.message);
    }
  }

  async function cancel(request) {
    setError('');
    const previous = requests.data;
    const previousFound = found;
    requests.mutate((current) => current ? { ...current, sent: (current.sent || []).filter((item) => item.id !== request.id) } : current);
    if (found?.requestId === request.id) setFound({ ...found, status: 'none', requestId: undefined });
    try {
      const result = await api(`/api/friends/requests/${encodeURIComponent(request.id)}`, { method: 'DELETE' });
      if (!result.ok) throw new Error(apiError(result));
      notify(`Solicitação para ${request.user.name} cancelada.`);
      refresh();
    } catch (exception) {
      if (previous) requests.mutate(previous);
      setFound(previousFound);
      setError(exception.message);
      notify(exception.message);
    }
  }

  async function acceptInvite(event) {
    event.preventDefault();
    if (!code.trim()) return;
    setBusy(true); setInviteError('');
    try {
      const result = await api('/api/friends/accept', { method: 'POST', body: { code } });
      if (!result.ok) throw new Error(apiError(result));
      notify(result.data.alreadyFriends ? `Você e ${result.data.friend.name} já eram amigos.` : `Agora você e ${result.data.friend.name} são amigos.`);
      setCode('');
      try { history.replaceState(null, '', '#adicionar'); } catch { /* Hash indisponível. */ }
      await refresh();
    } catch (exception) { setInviteError(exception.message); }
    finally { setBusy(false); }
  }

  const inviteUrl = (value) => `${location.origin}/#amigos?convite=${value}`;

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
    return <SocialFrame route="adicionar" account={account}>
      <section className="card-surface social-feed-empty">
        <span className="social-empty-icon"><Icon name="lock"/></span><h2 className="title">Entre para adicionar amigos.</h2>
        <p>Com uma conta você acha pessoas pelo @usuário e convida quem ainda não usa o Lume.</p>
        <Button onClick={() => go('login')}>Entrar<Icon name="arrow"/></Button>
      </section>
    </SocialFrame>;
  }

  const received = data?.received || [];
  const sent = data?.sent || [];
  const friends = friendsResource.data?.friends || [];

  const searchBlock = <section className="addfriend-block" aria-labelledby="addfriend-search-title">
    <h3 id="addfriend-search-title" className="addfriend-subtitle">Buscar pelo @usuário</h3>
    <form className="addfriend-search" onSubmit={search} role="search">
      <label className="addfriend-search-field"><span className="sr-only">@usuário</span><Icon name="search"/>
        <input value={query} onChange={event => { setQuery(event.target.value); setFound(null); setError(''); }} placeholder="@usuario" maxLength={26} autoComplete="off" autoCapitalize="none" spellCheck="false" disabled={busy}/>
      </label>
      <Button type="submit" secondary disabled={busy || !query.trim()}>Buscar</Button>
    </form>
    {error && <p className="form-error" role="alert">{error}</p>}
    {found && <ul className="addfriend-list" aria-live="polite">
      <PersonRow person={found.user} go={go}>
        {found.status === 'none' && <Button onClick={sendRequest} disabled={busy}>Enviar solicitação</Button>}
        {found.status === 'sent' && <Button secondary disabled>Solicitação enviada</Button>}
        {found.status === 'friends' && <span className="soft-badge">Já são amigos</span>}
        {found.status === 'received' && <Button onClick={() => respond({ id: found.requestId, user: found.user }, 'accept')} disabled={busy}>Aceitar</Button>}
        {found.status === 'self' && <span className="quiet-note">Esse é você.</span>}
      </PersonRow>
    </ul>}
    {found?.status === 'none' && <p className="addfriend-note"><Icon name="lock"/>A amizade começa quando a outra pessoa aceita.</p>}
  </section>;

  const friendList = !friendsResource.data && !friendsResource.error ? <Skeleton label="Carregando amigos…" rows={3}/>
    : friends.length === 0 ? <p className="social-sidebar-empty">Sua lista ainda está vazia. Busque alguém pelo @usuário ou envie um convite por link.</p>
      : <ul className="addfriend-list addfriend-friends">{friends.map(friend => <PersonRow key={friend.id} person={friend} go={go}
        status={<small className={`addfriend-presence is-${friend.activity?.status || 'offline'}`}>{presenceLabel(friend)}</small>}>
        <a className="icon-button" href={`#mensagens?com=${encodeURIComponent(friend.id)}`} aria-label={`Mensagem para ${friend.name}`} title={`Mensagem para ${friend.name}`}><Icon name="message"/></a>
      </PersonRow>)}</ul>;

  const loadError = requests.error || friendsResource.error;

  return <SocialFrame route="adicionar" account={account}>
    {loadError && <div className="form-error form-error-block" role="alert">{loadError}<Button secondary onClick={() => refresh()}>Tentar novamente</Button></div>}
    <div className="addfriend-layout">
      <div className="addfriend-main">
        {code && <section className="card-surface addfriend-card addfriend-highlight" aria-labelledby="social-invite-title">
          <h2 id="social-invite-title" className="title"><Icon name="plus"/>Convite recebido</h2>
          <p className="quiet-note">Você chegou por um link de convite. Aceite para virar amigo de quem o enviou.</p>
          <form className="social-invite-form" onSubmit={acceptInvite}>
            <label className="field">Código do convite
              <input value={code} onChange={event => setCode(event.target.value.toUpperCase())} placeholder="XXXX-XXXX-XXXX" maxLength={20} autoComplete="off" spellCheck="false" disabled={busy}/>
            </label>
            <Button type="submit" disabled={busy || !code.trim()}><Icon name="check"/>Aceitar convite</Button>
          </form>
          {inviteError && <p className="form-error" role="alert">{inviteError}</p>}
        </section>}
        {received.length > 0 && <section className="card-surface addfriend-card addfriend-highlight" aria-labelledby="addfriend-received-title">
          <h2 id="addfriend-received-title" className="title">Pediram para ser seu amigo <span className="nav-badge addfriend-badge" aria-label={`${received.length} pendentes`}>{received.length}</span></h2>
          <ul className="addfriend-list">{received.map(request => <PersonRow key={request.id} person={request.user} go={go}>
            <Button secondary onClick={() => respond(request, 'decline')} disabled={busy}>Recusar</Button>
            <Button onClick={() => respond(request, 'accept')} disabled={busy}>Aceitar</Button>
          </PersonRow>)}</ul>
        </section>}
        <section className="card-surface addfriend-card" aria-labelledby="addfriend-friends-title">
          <div className="addfriend-block-head">
            <h2 id="addfriend-friends-title" className="title">Seus amigos{friends.length > 0 && <span className="mono addfriend-count">{friends.length}</span>}</h2>
            {data?.handle && <span className="quiet-note">Você é <strong className="mono">@{data.handle}</strong></span>}
          </div>
          {friendList}
        </section>
      </div>
      <aside className="addfriend-side" aria-label="Encontrar pessoas">
        <section className="card-surface addfriend-card addfriend-find" aria-labelledby="addfriend-find-title">
          <h2 id="addfriend-find-title" className="title">Encontrar pessoas</h2>
          {searchBlock}
          <section className="addfriend-block addfriend-invite-row" aria-labelledby="addfriend-invite-title">
            <div>
              <h3 id="addfriend-invite-title" className="addfriend-subtitle">Convidar por link</h3>
              <p className="quiet-note">Para quem ainda não está no Lume. O link vale por 7 dias.</p>
            </div>
            <Button onClick={shareInvite} disabled={busy}><Icon name="link"/>Copiar link</Button>
          </section>
        </section>
        {sent.length > 0 && <section className="card-surface addfriend-card" aria-labelledby="addfriend-sent-title">
          <h2 id="addfriend-sent-title" className="title">Aguardando resposta</h2>
          <ul className="addfriend-list">{sent.map(request => <PersonRow key={request.id} person={request.user} go={go}>
            <span className="soft-badge">Aguardando</span>
            <Button secondary onClick={() => cancel(request)} disabled={busy}>Cancelar</Button>
          </PersonRow>)}</ul>
        </section>}
      </aside>
    </div>
  </SocialFrame>;
}
