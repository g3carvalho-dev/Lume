import { isSessionLive } from '../../../public/session-domain.js';
import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import Icon from '../../ui/Icon.jsx';
import { AnimatedNumber, Button, Cover, Heading, Progress, Skeleton, stagger } from '../../ui/ui.jsx';
import { invalidateResources, useResource } from '../../lib/resources.js';
import { api, apiError } from '../../lib/api.js';
import { profilePath, warmProfileProps } from './prefetch.js';
import { SocialAvatar } from './SocialFeed.jsx';
import { openMessagesDock } from './dock-bus.js';
import SectionTabs from '../../app/SectionTabs.jsx';
import { buildProfile } from '../../../public/profile-domain.js';
import { HEADER_ZOOM, MAX_PROFILE_BIO_LENGTH, normalizeHeaderFrame, studyRhythm } from '../../../public/domain.js';
import { LEVEL_XP } from '../../../public/xp-policy.js';
import { prepareProfileImageBlob, uploadProfileBlob } from './profile-media.js';

// Perfil em coluna central inspirada no X, preservando a identidade celestial do Lume:
// - Banner panorâmico com constelação padrão (ou capa enviada para R2);
// - Avatar circular sobreposto na borda inferior do banner + ações à direita;
// - Identidade limpa (@handle, títulos, bio corrida, metadados e contadores inline);
// - Abas horizontais (Estudando, Atividade, Conquistas, Amigos) com indicador dourado.

const STATUS_LABEL = { active: 'Em andamento', new: 'Começando', paused: 'Pausado', completed: 'Concluído' };

const BANNER_CONSTELLATION = [
  [36, 118], [94, 72], [168, 96], [242, 48], [326, 78], [412, 42], [496, 86], [588, 54], [674, 82], [752, 44],
];

function formatBioLines(bio) {
  return String(bio || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4);
}

export default function Profile({ id, handle = '', state, actions, account, notify, go, xp }) {
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState('atividade');
  const [uploadError, setUploadError] = useState('');
  const [bioDraft, setBioDraft] = useState(() => state.profile?.bio || '');
  // Enquadramento em edição: só vai à conta quando a pessoa solta o controle.
  const [frameDraft, setFrameDraft] = useState(null);
  const bannerRef = useRef(null);
  const bannerImageRef = useRef(null);
  const dragRef = useRef(null);
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  const avatarInputRef = useRef(null);
  const headerInputRef = useRef(null);

  // O perfil abre por id (#perfil?id=) ou por @usuário (/@usuario). Pelo @usuário só se
  // sabe se é o da própria conta depois de ler o @usuário dela.
  const own = useResource('/api/friends/handle', { enabled: Boolean(account) });
  const ownHandle = own.data?.handle || '';
  const ownReady = !account || own.data !== undefined || Boolean(own.error);
  const byHandle = Boolean(handle) && !id;
  const [selfByServer, setSelfByServer] = useState(false);
  useEffect(() => { setSelfByServer(false); }, [handle]);
  const isSelf = byHandle ? Boolean(account && ((ownReady && handle === ownHandle) || selfByServer)) : (!id || Boolean(account && id === account.id));

  useEffect(() => {
    setBioDraft(state.profile?.bio || '');
  }, [state.profile?.bio]);

  useEffect(() => {
    setEditing(false);
    setTab('atividade');
  }, [id, handle]);

  // Aba Amigos: a lista do próprio perfil usa o id da conta; a de outra pessoa, o id ou o @usuário.
  const friendsTarget = isSelf ? account?.id : (id || (handle ? `@${handle}` : ''));
  const friendsPath = friendsTarget && account ? `/api/profile/${encodeURIComponent(friendsTarget)}/friends` : '';
  const friendsResource = useResource(friendsPath, { enabled: Boolean(friendsPath) });

  // Dados do perfil de outra pessoa: recurso em cache.
  const path = !isSelf && (id || handle) ? profilePath({ id, handle: byHandle ? handle : '' }) : '';
  const remote = useResource(path, { enabled: Boolean(path), interval: isSelf ? 0 : 45000 });
  useEffect(() => { if (remote.data?.self) setSelfByServer(true); }, [remote.data]);
  const profile = remote.data?.profile || null;
  const error = remote.error && (!remote.data || remote.status === 403 || remote.status === 404)
    ? remote.error
    : (remote.data && !remote.data.self && !remote.data.profile ? 'Não foi possível abrir este perfil agora.' : '');

  // Endereço limpo do perfil: lumeacademy.site/@usuario.
  const addressHandle = isSelf ? ownHandle : profile?.user?.handle;
  useEffect(() => {
    if (!addressHandle) return;
    const clean = `/@${addressHandle}`;
    if (location.pathname !== clean) history.replaceState(null, '', clean);
  }, [addressHandle]);

  const [mediaPreview, setMediaPreview] = useState({ avatar: '', header: '' });
  const selfName = account?.name || 'Estudante na Prévia';
  const validated = xp?.summary ? { ...xp.summary, achievements: xp.achievements, titles: xp.titles } : null;
  const baseView = isSelf
    ? { user: { id: account?.id || 'local', name: selfName }, updatedAt: null, ...buildProfile(state, { validated }) }
    : profile;
  const view = isSelf && baseView
    ? { ...baseView, avatar: mediaPreview.avatar || baseView.avatar, header: mediaPreview.header || baseView.header }
    : baseView;

  async function handleImageUpload(kind, event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !actions) return;
    setUploadError('');
    let localUrl = '';
    try {
      // A capa vai inteira (só reduzida): a pessoa enquadra depois, sem perder o resto da imagem.
      const dimensions = kind === 'avatar' ? { crop: { width: 320, height: 320 } } : { maxWidth: 1600, maxHeight: 1600, force: true };
      const blob = await prepareProfileImageBlob(file, dimensions);
      localUrl = URL.createObjectURL(blob);
      setMediaPreview((current) => ({ ...current, [kind]: localUrl }));
      const mediaUrl = await uploadProfileBlob(kind, blob);
      if (!actions.updateProfile({ [kind]: mediaUrl })) return;
      notify(kind === 'avatar' ? 'Foto do perfil enviada e atualizada.' : 'Capa (header) enviada e atualizada.');
    } catch (exception) {
      setUploadError(exception.message || 'Não foi possível enviar a imagem.');
    } finally {
      setMediaPreview((current) => ({ ...current, [kind]: '' }));
      if (localUrl) URL.revokeObjectURL(localUrl);
    }
  }

  async function unfriend() {
    if (!window.confirm(`Desfazer a amizade com ${user.name}? Vocês deixam de ver o feed e as mensagens um do outro.`)) return;
    const result = await api(`/api/friends/${encodeURIComponent(user.id)}`, { method: 'DELETE' });
    if (!result.ok) { notify(apiError(result)); return; }
    notify(`${user.name} saiu da sua lista.`);
    invalidateResources('/api/friends');
    invalidateResources('/api/social/');
    invalidateResources('/api/messages');
    go('amigos');
  }

  function clearImage(kind) {
    if (!actions?.updateProfile({ [kind]: '' })) return;
    fetch(`/api/profile/media/${encodeURIComponent(kind)}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    }).catch(() => {});
    notify(kind === 'avatar' ? 'Foto do perfil removida.' : 'Capa do perfil restaurada ao padrão.');
  }

  function commitFrame(frame = frameDraft) {
    if (!frame) return;
    const next = normalizeHeaderFrame(frame);
    const current = normalizeHeaderFrame(state.profile);
    if (next.headerX !== current.headerX || next.headerY !== current.headerY || next.headerZoom !== current.headerZoom) {
      actions?.updateProfile(next);
    }
    setFrameDraft(null);
  }

  // Arrastar a capa move a imagem junto com o ponteiro: o ponto fixo percorre a
  // sobra da imagem (tamanho exibido menos a faixa), então 1 px arrastado = 1 px movido.
  const commitRef = useRef(commitFrame);
  commitRef.current = commitFrame;

  // Os ouvintes ficam na janela: soltar fora da faixa, ou a tela redesenhar no meio do gesto, não perde o arrasto.
  function startDrag(event) {
    const img = bannerImageRef.current;
    const box = bannerRef.current?.getBoundingClientRect();
    if (!img || !box || !img.naturalWidth || dragRef.current) return;
    const frame = normalizeHeaderFrame({ ...state.profile, ...(frameDraft || {}) });
    const cover = Math.max(box.width / img.naturalWidth, box.height / img.naturalHeight) * frame.headerZoom;
    const drag = {
      startX: event.clientX,
      startY: event.clientY,
      frame,
      latest: null,
      overflowX: img.naturalWidth * cover - box.width,
      overflowY: img.naturalHeight * cover - box.height,
    };
    dragRef.current = drag;
    const shift = (delta, overflow, from) => (overflow > 1 ? from - (delta / overflow) * 100 : from);
    const move = (moveEvent) => {
      drag.latest = normalizeHeaderFrame({
        ...drag.frame,
        headerX: shift(moveEvent.clientX - drag.startX, drag.overflowX, drag.frame.headerX),
        headerY: shift(moveEvent.clientY - drag.startY, drag.overflowY, drag.frame.headerY),
      });
      setFrameDraft(drag.latest);
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      dragRef.current = null;
      commitRef.current(drag.latest);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  function saveProfileText(event) {
    event.preventDefault();
    if (!actions?.updateProfile({ bio: bioDraft })) return;
    setEditing(false);
    notify('Detalhes do perfil salvos.');
  }

  if (error) return <div className="personal-root profile-x-root">
    <Heading eyebrow="Perfis ficam entre amigos e perfis públicos" title="Não foi possível abrir"/>
    <section className="card-surface settings-panel">
      <p className="muted-text">{error}</p>
      <Button secondary onClick={() => go('amigos')}>Voltar aos amigos<Icon name="arrow"/></Button>
    </section>
  </div>;

  if (!view) return <div className="personal-root profile-x-root">
    <Heading eyebrow="Perfil" title="Perfil"/>
    <Skeleton label="Carregando o perfil…" rows={4}/>
  </div>;

  const {
    user,
    customization = { bio: '', avatar: '', header: '', headerX: 50, headerY: 50, headerZoom: 1 },
    stats,
    studying = [],
    completed = [],
    queue = [],
    achievements: badges = [],
    featuredBadge = null,
    recentActivity = [],
  } = view;

  const friendActivity = view.presence;
  // Próprio perfil: sessão viva = Estudando; senão Online ou Offline (sem rede). Amigo: presença do servidor.
  const presence = isSelf
    ? (!online ? { tone: 'is-offline', label: 'Offline' }
      : isSessionLive(state.activeSession) ? { tone: '', label: `Estudando · ${state.activeSession.label}` }
      : { tone: '', label: 'Online' })
    : friendActivity
      ? { tone: friendActivity.status === 'offline' ? 'is-offline' : '', label: friendActivity.topic && friendActivity.status === 'studying' ? `Estudando · ${friendActivity.topic}` : friendActivity.label }
      : null;
  const nothingShared = !studying.length && !queue.length && !completed.length;
  const showcaseCourses = [...studying, ...completed].slice(0, 6);
  const rhythmLabel = studyRhythm(state).title;
  const bioLines = formatBioLines(customization.bio);
  const friendsList = friendsResource.data?.friends;
  const friendsCount = Array.isArray(friendsList) ? friendsList.length : null;
  const activeHandle = isSelf ? ownHandle : user.handle;
  const [starX, starY] = BANNER_CONSTELLATION[BANNER_CONSTELLATION.length - 1];

  const tabs = [
    { id: 'atividade', label: 'Atividade' },
    { id: 'estudando', label: 'Estudando' },
    { id: 'conquistas', label: 'Conquistas' },
    ...(friendsPath ? [{ id: 'amigos', label: 'Amigos' }] : []),
  ];

  return <div className="personal-root profile-x-root">
    {byHandle && isSelf && <SectionTabs route="perfil"/>}

    <article className={`profile-x-card ${isSelf && editing ? 'is-editing' : ''}`} aria-labelledby="profile-user-title">
      {isSelf && <>
        <input
          ref={avatarInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          aria-label="Selecionar foto de perfil do computador"
          onChange={(event) => handleImageUpload('avatar', event)}
        />
        <input
          ref={headerInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          aria-label="Selecionar imagem de capa (header) do computador"
          onChange={(event) => handleImageUpload('header', event)}
        />
      </>}
      {/* Banner panorâmico com constelação celestial ou capa enviada */}
      <div
        ref={bannerRef}
        className={`profile-x-banner ${customization.header ? 'has-custom-header' : ''} ${isSelf && editing && customization.header ? 'is-framing' : ''}`}
        onPointerDown={isSelf && editing && customization.header ? startDrag : undefined}
      >
        {customization.header && (() => {
          const frame = normalizeHeaderFrame({ ...customization, ...(isSelf && frameDraft ? frameDraft : {}) });
          return <img
            ref={bannerImageRef}
            src={customization.header}
            alt=""
            draggable={false}
            className="profile-x-banner-img"
            style={{
              objectPosition: `${frame.headerX}% ${frame.headerY}%`,
              transformOrigin: `${frame.headerX}% ${frame.headerY}%`,
              transform: `scale(${frame.headerZoom})`,
            }}
          />;
        })()}
        {!customization.header && <svg className="profile-x-constellation" viewBox="0 0 800 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <polyline points={BANNER_CONSTELLATION.map((point) => point.join(',')).join(' ')} className="profile-x-constellation-line"/>
          {BANNER_CONSTELLATION.slice(0, -1).map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2.6" className="profile-x-constellation-dot"/>)}
          <path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5Z" className="profile-x-constellation-star" transform={`translate(${starX - 10} ${starY - 10}) scale(0.85)`}/>
        </svg>}
        <div className="profile-x-banner-fade" aria-hidden="true"/>
        {isSelf && <button
          type="button"
          className="profile-x-banner-trigger"
          onClick={() => headerInputRef.current?.click()}
          aria-label="Alterar imagem de capa do perfil"
        >
          <Icon name="image"/><span>Alterar capa</span>
        </button>}
      </div>

      {/* Avatar sobreposto + ações à direita */}
      <div className="profile-x-identity-bar">
        <div className="profile-x-avatar-frame">
          {customization.avatar
            ? <img src={customization.avatar} alt={`Foto de perfil de ${user.name}`} className="profile-x-avatar-img"/>
            : <span className="profile-x-avatar-fallback" aria-hidden="true">{String(user.name || '?').slice(0, 1).toUpperCase()}</span>}
          {isSelf && <button
            type="button"
            className="profile-x-avatar-trigger"
            onClick={() => avatarInputRef.current?.click()}
            title="Enviar foto do computador"
            aria-label="Alterar foto do perfil"
          >
            <Icon name="image"/><span>Foto</span>
          </button>}
        </div>

        <div className="profile-x-actions">
          {isSelf && <Button ghost onClick={() => go('configuracoes')}>
            <Icon name="settings"/>Privacidade
          </Button>}
          {isSelf && <Button secondary onClick={() => setEditing((prev) => !prev)} aria-expanded={editing}>
            <Icon name="edit"/>{editing ? 'Fechar edição' : 'Editar perfil'}
          </Button>}
          {!isSelf && view.viewer === 'public' && account && <AddFriendButton person={user} notify={notify} onChanged={remote.refresh}/>}
          {!isSelf && view.viewer !== 'public' && account && <Button secondary onClick={() => openMessagesDock({ contactId: user.id })}>
            <Icon name="message"/>Mensagem
          </Button>}
          {!isSelf && view.viewer !== 'public' && account && <Button secondary onClick={unfriend}>
            <Icon name="close"/>Desfazer amizade
          </Button>}
          {!isSelf && view.viewer !== 'public' && <Button secondary onClick={() => go('amigos')}>
            <Icon name="users"/>Amigos
          </Button>}
        </div>
      </div>

      {/* Bloco de identidade (esquerda) + Nível & Conquista (direita) */}
      <header className="profile-x-header">
        <div className="profile-x-identity">
          <div className="profile-x-title-row">
            <h1 id="profile-user-title" className="display profile-x-name">{user.name}</h1>
            {presence && <span className={`profile-x-live ${presence.tone}`}>
              <span className="companion-dot" aria-hidden="true"/>
              {presence.label}
            </span>}
            {!isSelf && <span className="soft-badge tone-mint"><span className="soft-dot" aria-hidden="true"/>{view.viewer === 'public' ? 'Perfil público' : 'Perfil de amigo'}</span>}
          </div>

          {activeHandle && <p className="profile-x-handle mono">@{activeHandle}</p>}

          <div className="profile-x-bio">
            {bioLines.length > 0
              ? bioLines.map((line, index) => <p key={`${index}-${line}`}>{line}</p>)
              : <p className="muted-text">Ritmo atual: {rhythmLabel} · Uma disciplina por vez</p>}
          </div>

          <div className="profile-x-counts">
            {friendsPath && <button type="button" className="profile-x-count-link" onClick={() => setTab('amigos')}>
              <strong className="mono">{friendsCount ?? '—'}</strong>
              <span>{friendsCount === 1 ? 'Amigo' : 'Amigos'}</span>
            </button>}
            <span className="profile-x-count-item">
              <strong className="mono"><AnimatedNumber value={stats.activeCourses ?? 0}/></strong>
              <span>{stats.activeCourses === 1 ? 'Material' : 'Materiais'}</span>
            </span>
            {stats.doneLessons !== null && <span className="profile-x-count-item">
              <strong className="mono"><AnimatedNumber value={stats.doneLessons}/></strong>
              <span>Aulas concluídas</span>
            </span>}
            {stats.completedCourses !== null && <span className="profile-x-count-item">
              <strong className="mono"><AnimatedNumber value={stats.completedCourses}/></strong>
              <span>Completos</span>
            </span>}
          </div>
        </div>

        <aside className="profile-x-progression" aria-label="Nível e conquistas">
          <div className="profile-x-level-row">
            <span className="soft-badge tone-reward mono">
              <Icon name="spark"/>
              {stats.level !== null ? `Nível ${stats.level}` : 'Nível privado'}
            </span>
            <span className="profile-x-xp mono">
              {stats.xp !== null ? `${stats.xp % LEVEL_XP} / ${LEVEL_XP} xp` : 'XP oculto'}
            </span>
          </div>
          {stats.xp !== null && <Progress value={stats.xp % LEVEL_XP} max={LEVEL_XP} tone="reward" label="Progresso do nível"/>}
          {(featuredBadge || view.titles?.length > 0) && <div className="profile-x-panel-foot">
            {featuredBadge && <span className="profile-x-featured-line">
              <Icon name={featuredBadge.icon || 'trophy'}/>
              <span>{featuredBadge.title}</span>
            </span>}
            {view.titles?.length > 0 && <div className="profile-x-titles-row">
              {view.titles.map((item) => <span key={item.id} className="soft-badge" title={item.criterion}>
                {item.title}
              </span>)}
            </div>}
          </div>}
        </aside>
      </header>

      {/* Painel expansível de personalização (bio e remoção de mídias, se houver) */}
      {isSelf && editing && <motion.section
        className="profile-x-customizer"
        aria-label="Editar perfil"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        {customization.header && (() => {
          const frame = normalizeHeaderFrame({ ...customization, ...(frameDraft || {}) });
          const slider = (id, label, key, min, max, step) => <label className="field" htmlFor={id}>
            {label}
            <input
              id={id}
              type="range"
              min={min}
              max={max}
              step={step}
              value={frame[key]}
              onChange={(event) => setFrameDraft({ ...frame, [key]: Number(event.target.value) })}
              onPointerUp={() => commitFrame()}
              onKeyUp={() => commitFrame()}
              onBlur={() => commitFrame()}
            />
          </label>;
          return <div className="profile-x-frame-control">
            <p className="muted-text">Arraste a capa para escolher qual parte da imagem aparece, ou use os controles.</p>
            <div className="profile-x-frame-sliders">
              {slider('profile-frame-zoom', 'Zoom', 'headerZoom', HEADER_ZOOM.min, HEADER_ZOOM.max, 0.05)}
              {slider('profile-frame-x', 'Horizontal', 'headerX', 0, 100, 1)}
              {slider('profile-frame-y', 'Vertical', 'headerY', 0, 100, 1)}
            </div>
            <button type="button" className="text-button" onClick={() => { setFrameDraft(null); actions?.updateProfile({ headerX: 50, headerY: 50, headerZoom: 1 }); }}>Centralizar</button>
          </div>;
        })()}
        <form className="profile-x-bio-form" onSubmit={saveProfileText}>
          <label className="field" htmlFor="profile-bio-input">
            Apresentação e metas
            <textarea
              id="profile-bio-input"
              rows={3}
              maxLength={MAX_PROFILE_BIO_LENGTH}
              value={bioDraft}
              onChange={(event) => setBioDraft(event.target.value)}
              placeholder={'Ex.: Estudando Direito Processual e Python\nMeta: 3 sessões por semana'}
            />
          </label>
          <div className="action-row">
            <Button type="submit"><Icon name="check"/>Salvar apresentação</Button>
            {customization.avatar && <button type="button" className="text-button" onClick={() => clearImage('avatar')}>Remover foto</button>}
            {customization.header && <button type="button" className="text-button" onClick={() => clearImage('header')}>Restaurar padrão</button>}
          </div>
        </form>
        {uploadError && <p className="form-error" role="alert">{uploadError}</p>}
      </motion.section>}

      {/* Abas horizontais estilo X */}
      <nav className="profile-x-tabs" role="tablist" aria-label="Seções do perfil">
        {tabs.map((item) => <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={tab === item.id}
          className={`profile-x-tab ${tab === item.id ? 'is-active' : ''}`}
          onClick={() => setTab(item.id)}
        >
          <span>{item.label}</span>
        </button>)}
      </nav>

      {/* Conteúdo das abas */}
      <div className="profile-x-feed" role="tabpanel">
        {tab === 'estudando' && <div className="profile-x-tab-panel">
          {nothingShared
            ? <p className="profile-x-empty muted-text">Esta pessoa ainda não compartilhou nada do estudo com amigos.</p>
            : showcaseCourses.length > 0
              ? <div className="profile-x-showcase-list">
                {showcaseCourses.map((item, index) => <motion.article key={item.id} className="profile-x-feed-item" {...stagger(index)}>
                  <Cover art={item.art} className="profile-x-cover"/>
                  <div className="profile-x-feed-body">
                    <div className="profile-x-feed-top">
                      <span className={`course-status status-${item.status}`}>{STATUS_LABEL[item.status] || item.status}</span>
                      <span className="mono profile-x-feed-meta">{item.type}{item.progress ? ` · ${item.progress.percent}%` : ''}</span>
                    </div>
                    <h2 className="title profile-x-feed-title">{item.title}</h2>
                    {item.progress && <div className="profile-x-feed-progress">
                      <Progress value={item.progress.done} max={item.progress.total || 1} tone={item.status === 'completed' ? 'mint' : 'lume'} label={`Progresso de ${item.title}`}/>
                      <span className="mono profile-x-feed-meta">{item.progress.done} de {item.progress.total} etapas</span>
                    </div>}
                  </div>
                </motion.article>)}
              </div>
              : <p className="profile-x-empty inline-note"><Icon name="info"/><span>Nada em andamento compartilhado.</span></p>}
        </div>}

        {tab === 'atividade' && <div className="profile-x-tab-panel">
          <div className="profile-x-panel-head">
            <span className="mono muted-text">
              {stats.recentStepsTwoWeeks !== null
                ? `${stats.recentStepsTwoWeeks} ${stats.recentStepsTwoWeeks === 1 ? 'passo registrado' : 'passos registrados'}${stats.recentMinutesTwoWeeks ? ` · ${stats.recentMinutesTwoWeeks} min registrados` : ''} nas últimas 2 semanas`
                : 'Histórico de passos oculto'}
            </span>
          </div>
          <div className="profile-x-activity-wrap">
            {recentActivity.length > 0 ? <div className="steam-activity-list">
              {recentActivity.map((item) => <article key={item.id} className="steam-activity-card">
                <div className="steam-activity-top">
                  <Cover art={item.art} className="steam-activity-thumb"/>
                  <div className="steam-activity-heading">
                    <h2 className="title">{item.title}</h2>
                    <small>{item.type} · {STATUS_LABEL[item.status] || item.status}</small>
                  </div>
                  <div className="steam-activity-meta">
                    {item.durationMinutes && <strong>{item.durationMinutes} min registrados</strong>}
                    <small>
                      {item.lastAt
                        ? `Último registro em ${new Date(item.lastAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}`
                        : 'Progresso na biblioteca'}
                    </small>
                  </div>
                </div>

                {item.progress && <div className="steam-activity-progress">
                  <div className="steam-activity-progress-head">
                    <span><Icon name="trophy"/>Etapas concluídas</span>
                    <strong>{item.progress.done} de {item.progress.total} · {item.progress.percent}%</strong>
                  </div>
                  <Progress value={item.progress.done} max={item.progress.total || 1} tone={item.status === 'completed' ? 'mint' : 'lume'} label={`Progresso de ${item.title}`}/>
                  {item.lastLabel && <small className="steam-activity-step">Último passo: {item.lastLabel}</small>}
                </div>}
              </article>)}
            </div> : <p className="inline-note"><Icon name="clock"/><span>Nenhuma atividade recente compartilhada nas últimas semanas.</span></p>}
          </div>
        </div>}

        {tab === 'conquistas' && <div className="profile-x-tab-panel">
          <div className="profile-x-panel-head">
            {stats.unlockedAchievements !== null && <span className="mono muted-text">{stats.unlockedAchievements} de {stats.totalAchievements} desbloqueadas</span>}
            {isSelf && <button type="button" className="text-button accent" onClick={() => go('conquistas')}>
              Ver todas<Icon name="arrow"/>
            </button>}
          </div>
          {badges.length > 0 ? <div className="profile-x-badge-grid">
            {badges.map((badge) => <div key={badge.id} className={`profile-x-badge-item ${badge.unlocked ? 'is-unlocked' : 'is-locked'}`}>
              <span className="profile-x-badge-icon"><Icon name={badge.icon}/></span>
              <div>
                <strong>{badge.title}</strong>
                <small>{badge.text}</small>
                <span className="mono">{badge.current}/{badge.target}</span>
              </div>
            </div>)}
          </div> : <p className="profile-x-empty quiet-note">Conquistas e XP ocultos neste perfil.</p>}
        </div>}

        {tab === 'amigos' && friendsPath && <div className="profile-x-tab-panel">
          <ProfileFriends resource={friendsResource} isSelf={isSelf} name={user.name} go={go}/>
        </div>}
      </div>
    </article>
  </div>;
}

// Pedido de amizade a partir do perfil de quem ainda não é amigo.
function AddFriendButton({ person, notify, onChanged }) {
  const requests = useResource('/api/friends/requests');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!person?.handle) return null;
  const sent = requests.data?.sent?.some((item) => item.user.id === person.id);
  const received = requests.data?.received?.some((item) => item.user.id === person.id);

  async function add() {
    setBusy(true); setError('');
    try {
      const result = await api('/api/friends/requests', { method: 'POST', body: { handle: person.handle } });
      if (!result.ok) throw new Error(apiError(result));
      notify(result.data.status === 'friends' ? `Você e ${person.name} agora são amigos.` : `Solicitação enviada para ${person.name}.`);
      invalidateResources('/api/friends');
      invalidateResources('/api/social/');
      await Promise.all([requests.refresh(), onChanged?.()]);
    } catch (exception) { setError(exception.message); }
    finally { setBusy(false); }
  }

  return <>
    {sent
      ? <Button secondary disabled><Icon name="check"/>Solicitação enviada</Button>
      : <Button onClick={add} disabled={busy}><Icon name="plus"/>{received ? 'Aceitar amizade' : 'Adicionar amigo'}</Button>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </>;
}

// Amigos no perfil: só aparecem amigos que têm perfil público (regra do servidor).
function ProfileFriends({ resource, isSelf, name, go }) {
  const friends = resource.data?.friends;
  return <div className="profile-x-friends">
    {!resource.data && !resource.error && <Skeleton label="Carregando amigos…" rows={2}/>}
    {resource.error && !resource.data && <p className="form-error" role="alert">{resource.error}</p>}
    {friends?.length === 0 && <p className="profile-x-empty quiet-note">{isSelf ? 'Nenhum amigo com perfil público para mostrar.' : `${name} não tem amigos com perfil público para mostrar.`}</p>}
    {friends?.length > 0 && <ul className="profile-friend-list">
      {friends.map((friend) => <li key={friend.id}>
        <button type="button" className="social-friend-profile" {...warmProfileProps(friend)} onClick={() => go(friend.handle ? `perfil?u=${friend.handle}` : `perfil?id=${encodeURIComponent(friend.id)}`)} aria-label={`Ver perfil de ${friend.name}`}>
          <SocialAvatar person={friend}/>
          <span><strong>{friend.name}</strong>{friend.handle && <small className="mono">@{friend.handle}</small>}</span>
        </button>
      </li>)}
    </ul>}
    {isSelf && <p className="profile-x-friends-note quiet-note">Só aparecem amigos com perfil público.</p>}
  </div>;
}
