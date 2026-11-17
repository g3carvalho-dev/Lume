import { useEffect } from 'react';
import Icon from '../../ui/Icon.jsx';
import { Button } from '../../ui/ui.jsx';
import { preloadProfileScreen } from './prefetch.js';
import SocialFrame from './SocialFrame.jsx';
import SocialFeed from './SocialFeed.jsx';
import { ActiveFriendList, useActiveFriends } from './ActiveFriends.jsx';
import { openMessagesDock } from './dock-bus.js';

// Feed do Social: publicações entre amigos e, ao lado, quem está estudando agora
// (a mesma peça do Início). Amigos, pedidos e convites ficam na dock de Mensagens:
// um link de convite (#amigos?convite=) abre o painel de conexões dela com o
// código preenchido. Ser amigo não compartilha biblioteca, progresso nem XP.

function StudyingNow({ account, go }) {
  const { friends, active, loaded } = useActiveFriends(account, { only: 'studying' });
  return <aside className="card-surface social-panel social-studying" aria-labelledby="social-studying-title">
    <div className="active-rail-head">
      <div className="active-rail-heading">
        <Icon name="users"/>
        <h2 id="social-studying-title" className="active-rail-title">Estudando agora</h2>
      </div>
      {loaded && <span className="active-rail-badge">{active.length}</span>}
    </div>
    <ActiveFriendList account={account} go={go} friends={friends} active={active} loaded={loaded} empty="Ninguém estudando agora."/>
    <div className="active-rail-foot">
      <button type="button" className="text-link" onClick={() => openMessagesDock()}>Ver todos os amigos{friends.length ? ` (${friends.length})` : ''}</button>
    </div>
  </aside>;
}

export default function Friends({ account, state, xp, inviteCode = '', notify, go }) {
  useEffect(() => { preloadProfileScreen(); }, []);
  useEffect(() => {
    if (!inviteCode || !account) return;
    openMessagesDock({ mode: 'connections', inviteCode });
    // O código já está no painel: o endereço volta ao Feed para não reabrir ao recarregar.
    try { history.replaceState(null, '', '#amigos'); } catch { /* Hash indisponível. */ }
  }, [inviteCode, account]);

  return <SocialFrame route="amigos" account={account}>
    {!account
      ? <section className="card-surface social-feed-empty">
        <span className="social-empty-icon"><Icon name="lock"/></span><h2 className="title">Seu espaço entre amigos.</h2>
        <p>Entre na sua conta para publicar, conversar e compartilhar seus estudos. Cada pessoa escolhe o que mostra no perfil.</p>
        <Button onClick={() => go('login')}>Entrar para participar<Icon name="arrow"/></Button>
      </section>
      : <div className="social-layout">
        <SocialFeed account={account} avatar={state?.profile?.avatar} xp={xp} notify={notify} go={go}/>
        <div className="social-sidebar"><StudyingNow account={account} go={go}/></div>
      </div>}
  </SocialFrame>;
}
