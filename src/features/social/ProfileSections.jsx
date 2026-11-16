// Parte de baixo do perfil (16/11/2026): coluna principal com as abas Atividade e
// Publicações e coluna lateral com Nível, Conquistas em destaque e Amigos.
// O servidor já entrega cada seção só para quem pode vê-la; aqui, seção oculta
// mostra um aviso curto no lugar, sem sumir sem explicação.
import { useState } from 'react';
import { motion } from 'motion/react';
import Icon from '../../ui/Icon.jsx';
import { Cover, Progress, Skeleton, Star, stagger } from '../../ui/ui.jsx';
import { api, apiError } from '../../lib/api.js';
import { invalidateResources, useResource } from '../../lib/resources.js';
import { LEVEL_XP } from '../../../public/xp-policy.js';
import { AUDIENCE_LABELS } from '../../../public/privacy-domain.js';
import { Composer, PostCard, SocialAvatar } from './SocialFeed.jsx';
import { PersonButton } from './PersonCard.jsx';

const STATUS_LABEL = { active: 'Em andamento', new: 'Começando', paused: 'Pausado', completed: 'Concluído' };
const FRIENDS_PREVIEW = 6;
const BADGES_PREVIEW = 3;

function shortDate(value) {
  return new Date(value).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

export function PrivateNote({ children }) {
  return <p className="profile-private-note"><Icon name="lock"/><span>{children}</span></p>;
}

// No próprio perfil, cada bloco diz para quem está visível.
function AudienceTag({ audience }) {
  if (!audience) return null;
  return <span className="profile-audience mono" title="Quem vê esta seção">{AUDIENCE_LABELS[audience]}</span>;
}

function SideCard({ title, audience, action, children, label }) {
  return <section className="profile-side-card" aria-label={label || title}>
    <header className="profile-side-head">
      <h2 className="metric-label">{title}</h2>
      <AudienceTag audience={audience}/>
      {action}
    </header>
    {children}
  </section>;
}

// Bloco de nível: emblema com a estrela, número grande em mono, cargo e barra fina.
export function LevelBlock({ stats, titles = [], featuredBadge, visible, audience, name }) {
  const shown = visible && stats.level !== null;
  const current = shown && stats.xp !== null ? stats.xp % LEVEL_XP : 0;
  const role = titles.at(-1)?.title || '';
  return <section className={`profile-side-card profile-level ${shown ? '' : 'is-private'}`} aria-label="Nível">
    <header className="profile-side-head">
      <h2 className="metric-label">Nível</h2>
      <AudienceTag audience={audience}/>
    </header>
    <div className="profile-level-main">
      <span className="profile-level-emblem" aria-hidden="true"><Star size={30}/></span>
      {shown
        ? <div className="profile-level-copy">
          <strong className="mono profile-level-number" aria-label={`Nível ${stats.level}`}>{stats.level}</strong>
          {role && <span className="profile-level-role">{role}</span>}
        </div>
        : <div className="profile-level-copy">
          <strong className="profile-level-private">Nível privado</strong>
          <span className="profile-level-role">{name ? `${name} não mostra o nível para você.` : 'O nível não está visível.'}</span>
        </div>}
    </div>
    {shown && stats.xp !== null && <div className="profile-level-bar">
      <Progress value={current} max={LEVEL_XP} tone="reward" label="XP no nível atual"/>
      <span className="mono">{current} / {LEVEL_XP} xp</span>
    </div>}
    {shown && featuredBadge && <p className="profile-level-featured">
      <Icon name={featuredBadge.icon || 'trophy'}/>
      <span><small className="metric-label">Em destaque</small><strong>{featuredBadge.title}</strong></span>
    </p>}
  </section>;
}

export function AchievementsBlock({ achievements, stats, visible, audience, isSelf, name, go }) {
  const [all, setAll] = useState(false);
  const unlocked = (achievements || []).filter((item) => item.unlocked).reverse();
  const list = all ? unlocked : unlocked.slice(0, BADGES_PREVIEW);
  const action = visible && unlocked.length > 0 && (isSelf
    ? <button type="button" className="text-button accent" onClick={() => go('conquistas')}>Ver todas<Icon name="arrow"/></button>
    : unlocked.length > BADGES_PREVIEW && <button type="button" className="text-button accent" aria-expanded={all} onClick={() => setAll((value) => !value)}>{all ? 'Ver menos' : 'Ver todas'}</button>);
  return <SideCard title="Conquistas" audience={audience} action={action}>
    {!visible && <PrivateNote>{name} não mostra as conquistas para você.</PrivateNote>}
    {visible && stats.unlockedAchievements !== null && <p className="profile-side-count mono">{stats.unlockedAchievements} {stats.unlockedAchievements === 1 ? 'desbloqueada' : 'desbloqueadas'}</p>}
    {visible && unlocked.length === 0 && <p className="quiet-note">{isSelf ? 'Suas conquistas aparecem aqui quando o servidor validar a primeira.' : 'Nenhuma conquista ainda.'}</p>}
    {visible && list.length > 0 && <ul className="profile-badges">
      {list.map((badge) => <li key={badge.id} title={badge.text}>
        <span className="profile-badge-icon"><Icon name={badge.icon || 'trophy'}/></span>
        <span><strong>{badge.title}</strong>{badge.text && <small>{badge.text}</small>}</span>
      </li>)}
    </ul>}
  </SideCard>;
}

export function FriendsBlock({ resource, enabled, audience, isSelf, name, go }) {
  const [all, setAll] = useState(false);
  const data = resource.data;
  const friends = data?.friends || [];
  const hidden = !enabled ? false : data?.hidden;
  const list = all ? friends : friends.slice(0, FRIENDS_PREVIEW);
  const action = friends.length > FRIENDS_PREVIEW && <button type="button" className="text-button accent" aria-expanded={all} onClick={() => setAll((value) => !value)}>
    {all ? 'Ver menos' : `Ver todos (${friends.length})`}
  </button>;
  return <SideCard title="Amigos" audience={audience} action={action}>
    {!enabled && <p className="quiet-note">A lista de amigos exige conta.</p>}
    {enabled && !data && !resource.error && <Skeleton label="Carregando amigos…" rows={2}/>}
    {enabled && resource.error && !data && <p className="form-error" role="alert">{resource.error}</p>}
    {hidden && <PrivateNote>{name} não mostra a lista de amigos para você.</PrivateNote>}
    {data && !hidden && friends.length === 0 && <p className="quiet-note">{isSelf ? 'Você ainda não tem amigos no Lume.' : 'Nenhum amigo para mostrar.'}</p>}
    {list.length > 0 && <ul className={`profile-friends-grid ${all ? 'is-full' : ''}`}>
      {list.map((friend) => <li key={friend.id}>
        <PersonButton person={{ ...friend, isSelf: false }} go={go} className="profile-friend" label={`Abrir cartão de ${friend.name}`}>
          <SocialAvatar person={friend}/>
          <span><strong>{friend.name}</strong>{friend.handle && <small className="mono">@{friend.handle}</small>}</span>
        </PersonButton>
      </li>)}
    </ul>}
  </SideCard>;
}

// Atividade: um cartão por material, mais recente primeiro.
export function ActivityPanel({ activity, stats, visible, name, isSelf }) {
  if (!visible) return <PrivateNote>{name} não mostra a atividade de estudo para você.</PrivateNote>;
  return <>
    <p className="profile-panel-summary mono">
      {stats.recentStepsTwoWeeks} {stats.recentStepsTwoWeeks === 1 ? 'aula concluída' : 'aulas concluídas'}
      {stats.recentMinutesTwoWeeks ? ` · ${stats.recentMinutesTwoWeeks} min registrados` : ''} nas últimas 2 semanas
    </p>
    {activity.length === 0
      ? <p className="inline-note"><Icon name="clock"/><span>{isSelf ? 'Quando você estudar um material, ele aparece aqui.' : 'Nenhuma atividade de estudo ainda.'}</span></p>
      : <div className="profile-activity-list">
        {activity.map((item, index) => <motion.article key={item.id} className="profile-activity-card" {...stagger(index)}>
          <Cover art={item.art} className="profile-activity-thumb"/>
          <div className="profile-activity-body">
            <div className="profile-activity-top">
              <h3 className="title">{item.title}</h3>
              <span className={`soft-badge ${item.status === 'completed' ? 'tone-reward' : 'tone-mint'}`}>{STATUS_LABEL[item.status] || item.status}</span>
            </div>
            <p className="profile-activity-meta mono">
              {item.type}
              {item.recentMinutes > 0 && <> · <strong>{item.recentMinutes} min</strong> nas últimas 2 semanas</>}
              {item.lastAt && <> · último registro em {shortDate(item.lastAt)}</>}
            </p>
            <div className="profile-activity-progress">
              <Progress value={item.progress.done} max={item.progress.total || 1} tone={item.status === 'completed' ? 'mint' : 'lume'} label={`Progresso de ${item.title}`}/>
              <span className="mono">{item.progress.done} de {item.progress.total} · {item.progress.percent}%</span>
            </div>
            {item.lastStep && <p className="profile-activity-step">Último passo: {item.lastStep}</p>}
          </div>
        </motion.article>)}
      </div>}
  </>;
}

// Recurso de publicações de uma pessoa; a primeira página traz a fixada.
export function useProfilePosts(path, cursor = '') {
  return useResource(path ? `${path}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}` : '', { enabled: Boolean(path) });
}

function postMutations(resource, key = 'posts') {
  return {
    mutatePost: (postId, updater) => resource.mutate((previous) => previous ? {
      ...previous,
      pinned: previous.pinned?.id === postId ? updater(previous.pinned) : previous.pinned,
      [key]: (previous[key] || []).map((item) => (item.id === postId ? updater(item) : item)),
    } : previous),
    removePost: (postId) => {
      const snapshot = resource.data;
      resource.mutate((previous) => previous ? {
        ...previous,
        pinned: previous.pinned?.id === postId ? null : previous.pinned,
        [key]: (previous[key] || []).filter((item) => item.id !== postId),
      } : previous);
      return snapshot;
    },
    restorePost: (snapshot) => { if (snapshot) resource.mutate(snapshot); },
  };
}

function usePin(notify) {
  return async (post, pinned) => {
    const result = await api(`/api/social/posts/${encodeURIComponent(post.id)}/pin`, { method: pinned ? 'PUT' : 'DELETE' });
    if (!result.ok) { notify(apiError(result)); return; }
    invalidateResources('/api/profile/');
    notify(pinned ? 'Publicação fixada no topo do seu perfil.' : 'Publicação desafixada.');
  };
}

// Publicação fixada no topo das duas abas.
export function PinnedPost({ path, me, go, notify, isSelf }) {
  const resource = useProfilePosts(path);
  const pin = usePin(notify);
  const post = resource.data?.pinned;
  if (!post) return null;
  const { mutatePost, removePost, restorePost } = postMutations(resource);
  return <div className="profile-pinned">
    <PostCard post={post} me={me} mutatePost={mutatePost} removePost={removePost} restorePost={restorePost} refresh={resource.refresh} go={go} notify={notify} onPin={isSelf ? pin : null}/>
  </div>;
}

function PostsPage({ path, cursor, last, me, go, notify, isSelf, onMore }) {
  const resource = useProfilePosts(path, cursor);
  const pin = usePin(notify);
  const { mutatePost, removePost, restorePost } = postMutations(resource);
  const posts = resource.data?.posts || [];
  return <>
    {resource.loading && !resource.data && <Skeleton rows={2} label="Carregando publicações…"/>}
    {resource.error && !resource.data && <p className="form-error" role="alert">{resource.error}</p>}
    {posts.map((post) => <PostCard key={post.id} post={post} me={me} mutatePost={mutatePost} removePost={removePost} restorePost={restorePost} refresh={resource.refresh} go={go} notify={notify} onPin={isSelf ? pin : null}/>)}
    {!cursor && resource.data && !resource.data.hidden && posts.length === 0 && !resource.data.pinned && <p className="inline-note"><Icon name="message"/><span>{isSelf ? 'Suas publicações aparecem aqui.' : 'Nenhuma publicação ainda.'}</span></p>}
    {last && resource.data?.nextCursor && <button type="button" className="button secondary social-load-more" onClick={() => onMore(resource.data.nextCursor)}>Ver mais publicações<Icon name="chevron-down"/></button>}
  </>;
}

const COMPOSER_NOTE = {
  all: 'Aparece no Feed dos seus amigos e, no seu perfil, para qualquer pessoa com conta no Lume.',
  friends: 'Aparece no Feed e no seu perfil só para seus amigos.',
  self: 'Aparece no Feed dos seus amigos; no seu perfil, só você vê.',
};

export function PostsPanel({ path, enabled, visible, me, account, avatar, xp, go, notify, isSelf, name, audience }) {
  const [cursors, setCursors] = useState(['']);
  const first = useProfilePosts(enabled ? path : '');
  if (!enabled) return <p className="inline-note"><Icon name="lock"/><span>Publicações exigem conta.</span></p>;
  if (first.data?.hidden || !visible) return <PrivateNote>{name} não mostra as publicações para você.</PrivateNote>;
  function posted() {
    setCursors(['']);
    invalidateResources('/api/profile/');
    invalidateResources('/api/social/feed');
    notify('Publicação compartilhada.');
  }
  return <div className="profile-posts">
    {isSelf && account && <Composer account={account} avatar={avatar} xp={xp} onPosted={posted} note={COMPOSER_NOTE[audience] || ''}/>}
    {!isSelf && first.data?.readOnly && <p className="quiet-note profile-posts-note">Vocês ainda não são amigos: as publicações ficam só para leitura.</p>}
    {cursors.map((cursor, index) => <PostsPage key={cursor || 'first'} path={path} cursor={cursor} last={index === cursors.length - 1} me={me} go={go} notify={notify} isSelf={isSelf} onMore={(next) => setCursors((items) => [...items, next])}/>)}
  </div>;
}
