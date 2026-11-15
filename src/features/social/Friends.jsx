import { useCallback, useEffect, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import { Button, Heading, Skeleton } from '../../ui/ui.jsx';
import { api, apiError } from '../../lib/api.js';
import { preloadProfileScreen, warmProfileProps } from './prefetch.js';
import { CollaborationInbox } from '../library/Collaboration.jsx';
import { invalidateResources, useResource } from '../../lib/resources.js';
import SectionTabs from '../../app/SectionTabs.jsx';
import SocialFeed, { SocialAvatar } from './SocialFeed.jsx';

// Amizades. Criar convite e buscar pelo @usuário ficam em Adicionar amigos (#adicionar); aqui só se
// aceita o convite de quem chegou por um link (#amigos?convite=). Não existe busca por e-mail. Ser amigo não compartilha biblioteca, progresso
// nem XP — isso depende do perfil e das escolhas de quem é dono dos dados.

const FRIENDS_SHOWN = 4;

export default function Friends({ account, state, xp, inviteCode = '', notify, go }) {
  const resource = useResource('/api/friends', { enabled: Boolean(account) });
  const data = resource.data;
  const [code, setCode] = useState(inviteCode);
  const [actionError, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [allFriends, setAllFriends] = useState(false);

  const load = useCallback(async () => {
    if (!account) return;
    const result = await resource.refresh();
    if (!result.ok) { setError(apiError(result)); return; }
    setError('');
  }, [account, resource.refresh]);

  useEffect(() => { load().catch(() => {}); }, [load]);
  useEffect(() => { preloadProfileScreen(); }, []);
  useEffect(() => { if (inviteCode) setCode(inviteCode); }, [inviteCode]);

  async function accept(event) {
    event.preventDefault();
    if (!code.trim()) return;
    setBusy(true); setError('');
    try {
      const result = await api('/api/friends/accept', { method: 'POST', body: { code } });
      if (!result.ok) throw new Error(apiError(result));
      notify(result.data.alreadyFriends ? `Você e ${result.data.friend.name} já eram amigos.` : `Agora você e ${result.data.friend.name} são amigos.`);
      setCode('');
      history.replaceState(null, '', '#amigos');
      await load();
      invalidateResources('/api/social/');
    } catch (exception) { setError(exception.message); }
    finally { setBusy(false); }
  }

  async function remove(friend) {
    setBusy(true); setError('');
    try {
      const result = await api(`/api/friends/${encodeURIComponent(friend.id)}`, { method: 'DELETE' });
      if (!result.ok) throw new Error(apiError(result));
      notify(`${friend.name} saiu da sua lista.`);
      await load();
      invalidateResources('/api/social/');
    } catch (exception) { setError(exception.message); }
    finally { setBusy(false); }
  }

  return <div className="social-root">
    <Heading title="Social">
      Compartilhe seus estudos e converse com seus amigos.
    </Heading>
    <SectionTabs route="amigos"/>
    {!account
      ? <section className="card-surface social-feed-empty">
        <span className="social-empty-icon"><Icon name="lock"/></span><h2 className="title">Seu espaço entre amigos.</h2>
        <p>Entre na sua conta para publicar, conversar e compartilhar seus estudos. Cada pessoa escolhe o que mostra no perfil.</p>
        <Button onClick={() => go('login')}>Entrar para participar<Icon name="arrow"/></Button>
      </section>
      : <div className="social-layout">
        <SocialFeed account={account} avatar={state?.profile?.avatar} xp={xp} notify={notify} go={go}/>
        <aside className="social-sidebar" aria-label="Amigos e convites">
          <section className="card-surface social-panel" aria-labelledby="social-friends-title">
            <div className="social-panel-heading"><h2 id="social-friends-title" className="title"><Icon name="users"/>Amigos · {data?.friends.length || 0}</h2>{data?.friends.length > FRIENDS_SHOWN && <button type="button" className="text-link" aria-expanded={allFriends} onClick={() => setAllFriends((value) => !value)}>{allFriends ? 'Ver menos' : 'Ver todos'}</button>}</div>
            {!data && !resource.error && <Skeleton label="Carregando sua lista de amigos…" rows={3}/>}
            {data?.friends.length === 0 && <p className="social-sidebar-empty">Ninguém por aqui ainda. Um convite já começa a lista.</p>}
            {data?.friends.length > 0 && <ul className="social-friend-list">
              {(allFriends ? data.friends : data.friends.slice(0, FRIENDS_SHOWN)).map(friend => <li key={friend.id}>
                <button type="button" className="social-friend-profile" {...warmProfileProps(friend)} onClick={() => go(friend.handle ? `perfil?u=${friend.handle}` : `perfil?id=${encodeURIComponent(friend.id)}`)} aria-label={`Ver perfil de ${friend.name}`}>
                  <SocialAvatar person={friend}/><span><strong>{friend.name}</strong><small>Amigos desde {new Date(friend.since).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</small></span>
                </button>
                <button type="button" className="icon-button" onClick={() => go(`mensagens?com=${encodeURIComponent(friend.id)}`)} aria-label={`Conversar com ${friend.name}`} title="Enviar mensagem"><Icon name="message"/></button>
                <button type="button" className="icon-button social-friend-remove" onClick={() => remove(friend)} disabled={busy} aria-label={`Remover ${friend.name} da lista`} title="Remover amizade"><Icon name="close"/></button>
              </li>)}
            </ul>}
            {resource.error && <div className="form-error form-error-block" role="alert">{resource.error}<Button secondary onClick={load}>Tentar novamente</Button></div>}
          </section>

          {inviteCode && <section className="card-surface social-panel" aria-labelledby="social-invite-title">
            <div className="social-panel-heading"><h2 id="social-invite-title" className="title"><Icon name="plus"/>Convite recebido</h2></div>
            <p className="quiet-note">Você chegou por um link de convite. Aceite para virar amigo de quem o enviou.</p>
            <form className="social-invite-form" onSubmit={accept}>
              <label className="field">Código do convite
                <input value={code} onChange={event => setCode(event.target.value.toUpperCase())} placeholder="XXXX-XXXX-XXXX" maxLength={20} autoComplete="off" spellCheck="false" disabled={busy}/>
              </label>
              <Button secondary type="submit" disabled={busy || !code.trim()}><Icon name="check"/>Aceitar convite</Button>
            </form>
            {actionError && <p className="form-error" role="alert">{actionError}</p>}
          </section>}

          <section className="card-surface social-panel social-ranking-link">
            <div className="social-panel-heading"><h2 className="title"><span className="social-ranking-icon"><Icon name="podium"/></span>Ranking entre amigos</h2></div>
            <p>Nível · Cursos concluídos · Empenho</p>
            <Button secondary onClick={() => go('ranking')}>Ver ranking<Icon name="arrow"/></Button>
          </section>

          <CollaborationInbox account={account} notify={notify}/>
        </aside>
      </div>}
  </div>;
}
