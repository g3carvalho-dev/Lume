import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Icon from '../ui/Icon.jsx';
import { Logo, Star } from '../ui/ui.jsx';
import { levelInfo } from '../../public/domain.js';
import { levelProgress } from '../../public/xp-policy.js';
import { useResource } from '../lib/resources.js';
import { isDesktopApp } from '../lib/desktop.js';
import DesktopUpdate from '../features/desktop/DesktopUpdate.jsx';
import NotificationBell from '../features/social/NotificationBell.jsx';
import HeaderTimer, { openTimerPanel, timerEnabled } from '../features/progress/HeaderTimer.jsx';
import SectionTabs, { SECTIONS, sectionOf } from './SectionTabs.jsx';
import { ENTRY_ROUTES } from './routes.jsx';

const desktop = isDesktopApp();
const STITCH_ENTRY_ROUTES = new Set(['conheca', 'login', 'inicio']);

// Quatro destinos no cabeçalho (Início, Biblioteca, Plano de Estudos, Amigos); o Perfil abre pelo menu da conta.
const links = Object.entries(SECTIONS).filter(([, section]) => section.nav !== false).map(([key, section]) => [key, section.home, section.icon, section.label, section.short]);
const syncLabels = { loading: 'Carregando biblioteca…', saving: 'Salvando na conta…', saved: 'Progresso salvo na conta', error: 'Gravação não confirmada' };

// Marca do destino aberto: a estrela da marca pousa na linha do cabeçalho, sob o
// destino. Ao trocar de destino ela percorre a linha e deixa o caminho tracejado
// por um instante, como nas capas dos materiais. A posição é medida no DOM; fonte
// carregada e janela redimensionada reposicionam sem animar o caminho.
function useNavMark(section, enabled) {
  const headerRef = useRef(null);
  const navRef = useRef(null);
  const last = useRef(null);
  const [mark, setMark] = useState(null);

  const measure = (travel) => {
    const header = headerRef.current;
    const link = navRef.current?.querySelector('.nav-link.active');
    if (!header || !link) { last.current = null; setMark(null); return; }
    const box = link.getBoundingClientRect();
    const x = Math.round(box.left - header.getBoundingClientRect().left + box.width / 2);
    const from = travel && last.current !== null && last.current !== x ? last.current : null;
    last.current = x;
    setMark((previous) => {
      if (previous && previous.x === x && from === null) return previous;
      return { x, from: from ?? null, trip: (previous?.trip || 0) + (from === null ? 0 : 1) };
    });
  };

  useLayoutEffect(() => { measure(true); }, [section, enabled]);
  useEffect(() => {
    const nav = navRef.current;
    if (!enabled || !nav) return undefined;
    const settle = () => measure(false);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(settle) : null;
    observer?.observe(nav);
    window.addEventListener('resize', settle);
    return () => { observer?.disconnect(); window.removeEventListener('resize', settle); };
  }, [enabled]);

  return { headerRef, navRef, mark };
}

function positionPopoverFallback(panel, trigger) {
  if (!panel || !trigger) return;
  if (typeof CSS !== 'undefined' && CSS.supports?.('position-area', 'block-end')) {
    panel.style.top = '';
    panel.style.left = '';
    return;
  }
  const rect = trigger.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const width = panelRect.width || 272;
  const height = panelRect.height || 260;
  const maxLeft = Math.max(8, window.innerWidth - width - 8);
  const left = Math.min(Math.max(8, rect.right - width), maxLeft);
  const fitsBelow = rect.bottom + 8 + height <= window.innerHeight - 8;
  const top = fitsBelow ? rect.bottom + 8 : Math.max(8, rect.top - height - 8);
  panel.style.top = `${Math.round(top)}px`;
  panel.style.left = `${Math.round(left)}px`;
}

export default function Shell({ route, model, children, hideTabs = false, onHelp, onRegister, onExit, notify, current }) {
  const section = sectionOf(route);
  const accountTriggerRef = useRef(null);
  const accountPopoverRef = useRef(null);
  const entry = ENTRY_ROUTES.has(route);
  const { headerRef, navRef, mark } = useNavMark(section, !entry);
  const stitchEntry = STITCH_ENTRY_ROUTES.has(route);
  const summary = model.xp?.summary;
  const level = model.account
    ? (summary ? levelProgress(summary.totalXP) : { level: 1, current: 0, next: 500, total: 0 })
    : levelInfo(model.state);
  const xpLabel = model.account ? 'XP' : 'XP · prévia local';
  const prefs = model.state.preferences;
  const gamified = prefs.gamification;
  const name = model.account?.name || 'Prévia';
  // O nível mora no próprio cartão da conta, sob o nome; enquanto o XP da conta
  // não chegou, o cartão mostra só o nome.
  const showLevel = gamified && !(model.account && !summary);
  const levelPercent = Math.max(0, Math.min(100, Math.round((level.current / (level.next || 1)) * 100)));
  const todayLabel = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  const today = todayLabel.charAt(0).toUpperCase() + todayLabel.slice(1);

  const hidePopover = ref => {
    try { ref.current?.hidePopover?.(); } catch {}
  };

  useEffect(() => {
    hidePopover(accountPopoverRef);
  }, [route]);

  if (entry && stitchEntry) {
    return <div className="entry-shell stitch-entry-shell">
      <main id="main" tabIndex={-1} className="entry-main stitch-entry-main">{children}</main>
    </div>;
  }

  if (entry) return <div className="entry-shell">
    <header className="entry-header"><a className="brand" href={route === 'conheca' ? '#conheca' : '#login'} aria-label="Lume — início"><Logo size={22}/><span className="brand-name">Lume</span></a><nav aria-label="Entrada no Lume">{route !== 'conheca' && <a className="text-button" href="#conheca">Conheça o Lume</a>}{route === 'login' ? <button className="text-button" onClick={onRegister}>Criar conta</button> : route === 'inicio' ? <button className="text-button" onClick={onExit}>Sair</button> : <a className="text-button" href={route === 'conheca' && model.account ? '#hoje' : '#login'}>{route !== 'conheca' ? 'Voltar à entrada' : model.account ? 'Voltar ao Lume' : 'Entrar'}</a>}<button className="text-button" onClick={onHelp}>Ajuda</button></nav></header>
    <main id="main" tabIndex={-1} className="entry-main">{children}</main>
    <footer className="entry-footer"><span>Provas, trabalhos e entregas em dia, disciplina por disciplina.</span><span>Cadastro e acesso com e-mail e senha</span></footer>
  </div>;

  const toggleAccountFallback = event => {
    if (event.newState === 'open') positionPopoverFallback(accountPopoverRef.current, accountTriggerRef.current);
  };

  return <div className="app-shell">
    <header className="topbar app-header" ref={headerRef}>
      <div className="app-header-inner">
        <a href="#hoje" className="brand" aria-label="Lume — página inicial"><Logo size={22}/><span className="brand-name">Lume</span></a>
        <nav className="nav" aria-label="Navegação" ref={navRef}>{links.map(([key, path, icon, label, short]) => <a key={key} href={`#${path}`} className={`nav-link ${section === key ? 'active' : ''}`} aria-current={section === key ? 'page' : undefined} aria-label={label}><Icon name={icon}/><span className="nav-label"><span className="nav-label-full">{label}</span>{short && <span className="nav-label-short" aria-hidden="true">{short}</span>}</span></a>)}</nav>
        <div className="topbar-right">
          {model.account && (model.syncStatus === 'saving' || model.syncStatus === 'loading') && <span className={`sr-only sync-${model.syncStatus}`} role="status">{syncLabels[model.syncStatus]}</span>}
          {(!model.account || model.syncStatus === 'error') && <span className={`sync-chip sync-${model.account ? model.syncStatus : 'local'}`} role="status"><Icon name="cloud"/>{model.account ? syncLabels[model.syncStatus] : 'Prévia temporária'}</span>}
          {desktop && <DesktopUpdate/>}
          <HeaderTimer state={model.state} actions={model.progressActions} settingsActions={model.settingsActions} notify={notify} account={model.account} current={current} positionFallback={positionPopoverFallback}/>
          <NotificationBell account={model.account} positionFallback={positionPopoverFallback}/>

          <div className="user-menu-wrap">
            <button
              type="button"
              ref={accountTriggerRef}
              popoverTarget="account-popover"
              className={`account-chip user-menu-trigger ${route === 'perfil' ? 'active' : ''}`}
              aria-label={`Menu da conta (${name})${showLevel ? ` · nível ${level.level}, ${level.current} de ${level.next} ${xpLabel}` : ''}`}
              title={model.account?.email || 'Modo prévia'}
            >
              {model.state.profile?.avatar
                ? <img className="avatar small player-avatar-img" src={model.state.profile.avatar} alt=""/>
                : <span className="avatar small">{name.slice(0, 1).toUpperCase()}</span>}
              <span className="account-meta">
                <span className="account-name">{name}</span>
                {showLevel && <span className="account-level">
                  <Star size={9}/>
                  <strong>nível {level.level}</strong>
                  <span className="account-level-bar"><span style={{ width: `${levelPercent}%` }}/></span>
                  <span className="account-level-note">{level.current}/{level.next}</span>
                </span>}
              </span>
              <span className="user-menu-caret" aria-hidden="true">▾</span>
            </button>
            <div
              id="account-popover"
              ref={accountPopoverRef}
              popover="auto"
              className="shell-popover user-dropdown anchored-overlay"
              onToggle={toggleAccountFallback}
              aria-label="Opções do usuário"
            >
              <div className="user-dropdown-header">
                <strong>{name}</strong>
                <small>{model.account?.email || 'Modo prévia local'}</small>
                {gamified && <small className="user-dropdown-level">{model.account && !summary ? 'Sincronizando XP…' : `Nível ${level.level} · ${level.current} / ${level.next} ${xpLabel}`}</small>}
              </div>
              <a className={`user-dropdown-item ${route === 'perfil' ? 'active' : ''}`} href="#perfil" onClick={() => hidePopover(accountPopoverRef)}>
                <Icon name="user"/>
                <span>Meu Perfil</span>
              </a>
              <a className={`user-dropdown-item ${route === 'conquistas' ? 'active' : ''}`} href="#conquistas" onClick={() => hidePopover(accountPopoverRef)}>
                <Icon name="trophy"/>
                <span>Conquistas</span>
              </a>
              {timerEnabled(model.state) && !model.state.activeSession && <button type="button" className="user-dropdown-item user-dropdown-timer" onClick={() => { hidePopover(accountPopoverRef); openTimerPanel(); }}>
                <Icon name="timer"/>
                <span>Timer de estudo</span>
              </button>}
              <a className={`user-dropdown-item ${route === 'configuracoes' ? 'active' : ''}`} href="#configuracoes" onClick={() => hidePopover(accountPopoverRef)}>
                <Icon name="settings"/>
                <span>Configurações</span>
              </a>
              {model.account?.isCreator && <a className={`user-dropdown-item ${route === 'denuncias' ? 'active' : ''}`} href="#denuncias" onClick={() => hidePopover(accountPopoverRef)}>
                <Icon name="flag"/>
                <span>Denúncias</span>
              </a>}
              <div className="user-dropdown-divider"/>
              <button
                type="button"
                className="user-dropdown-item danger"
                onClick={() => { hidePopover(accountPopoverRef); onExit(); }}
              >
                <Icon name="logout"/>
                <span>{model.account ? 'Sair' : 'Sair da prévia'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
      {mark && <span className="nav-mark" style={{ '--nav-x': `${mark.x}px` }} aria-hidden="true">
        <span className="nav-mark-star" key={mark.trip}><Star size={16}/></span>
      </span>}
      {mark && mark.from !== null && <span
        key={mark.trip}
        className={`nav-trail ${mark.from < mark.x ? 'to-right' : 'to-left'}`}
        style={{ left: `${Math.min(mark.from, mark.x)}px`, width: `${Math.abs(mark.x - mark.from)}px` }}
        aria-hidden="true"
      />}
    </header>
    <main id="main" tabIndex={-1}>{!hideTabs && <SectionTabs route={route}/>}{children}</main>
    <footer className="app-footer"><div className="app-footer-inner"><span className="app-footer-brand"><strong>Lume</strong><small>Seu norte para provas, trabalhos e entregas.</small></span><span className="app-footer-meta"><span>{today}</span><a className="text-link" href="#novidades"><Icon name="spark"/>Novidades</a></span></div></footer>
  </div>;
}
