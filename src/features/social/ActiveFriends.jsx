import Icon from '../../ui/Icon.jsx';
import { PersonAvatar, Skeleton } from '../../ui/ui.jsx';
import { useResource } from '../../lib/resources.js';
import { PersonButton } from './PersonCard.jsx';
import { openMessagesDock } from './dock-bus.js';

// Amigos ativos agora: a mesma fonte (GET /api/friends, presença calculada no
// servidor) e a mesma peça no Início ("Ativos agora") e na lateral do Feed
// ("Estudando agora", só quem está numa sessão de estudo). Presença não gera XP.

export function useActiveFriends(account, { only = 'active' } = {}) {
  const resource = useResource('/api/friends', { interval: 45000, enabled: Boolean(account) });
  const friends = resource.data?.friends || [];
  const active = friends
    .filter((friend) => friend.activity?.active && (only !== 'studying' || friend.activity.status === 'studying'))
    .sort((a, b) => Number(b.activity?.status === 'studying') - Number(a.activity?.status === 'studying') || a.name.localeCompare(b.name, 'pt-BR'));
  return { friends, active, loaded: Boolean(resource.data), error: resource.error };
}

export function ActiveFriendList({ account, go, friends, active, loaded, empty }) {
  if (!account) return <p className="muted-text active-rail-empty">Amigos, mensagens e ranking ficam disponíveis com uma conta.</p>;
  if (!loaded) return <Skeleton label="Carregando amigos…" rows={2}/>;
  if (!active.length) return <p className="muted-text active-rail-empty">{friends.length ? empty : 'Estudar junto é opcional. Um convite começa a lista.'}</p>;
  return <ul className="active-rail-list">{active.map((friend) => {
    const activity = friend.activity || { status: 'online', label: 'Online', topic: '' };
    const studying = activity.status === 'studying';
    return <li key={friend.id} className={`active-card ${studying ? 'is-studying' : ''}`}>
      <div className="active-card-head">
        <PersonButton person={friend} go={go} className="active-card-who">
          <span className="active-avatar-wrap">
            <PersonAvatar person={friend} className="avatar active-avatar"/>
            <span className="active-presence"/>
          </span>
          <span className="active-copy">
            <strong>{friend.name}</strong>
            <span className="active-status">{activity.label}</span>
          </span>
        </PersonButton>
        <button type="button" className="active-msg" onClick={() => openMessagesDock({ contactId: friend.id })} aria-label={`Mensagem para ${friend.name}`} title={`Mensagem para ${friend.name}`}>
          <Icon name="message"/>
        </button>
      </div>
      {studying && <div className="active-card-body">
        <span className="active-tile" aria-hidden="true"><Icon name="book"/></span>
        <span className="active-copy">
          <strong>{activity.topic || 'Sessão de estudo'}</strong>
          <span className="active-status">estudando agora</span>
        </span>
      </div>}
    </li>;
  })}</ul>;
}
