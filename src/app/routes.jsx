// Tabela de rotas da SPA. Uma tela nova é uma linha aqui: hash, título, seção
// do menu (com o rótulo da aba) e como desenhar. O menu, as abas de seção e o
// título da janela derivam desta tabela.

import { lazy } from 'react';
import { LoadingScreen } from '../ui/ui.jsx';
import { Login, Recovery } from '../features/account/Auth.jsx';
import { Library } from '../features/library/Study.jsx';
import { SubjectsPage } from '../features/library/Subjects.jsx';
import { Home } from '../features/library/Today.jsx';
import Onboarding from '../features/account/Onboarding.jsx';
import Tasks from '../features/plan/Tasks.jsx';

// Telas fora do caminho inicial (entrada, Início e Biblioteca) carregam sob
// demanda: cada uma vira um pacote próprio e o primeiro acesso fica menor.
// A Agenda leva o FullCalendar consigo. O App envolve a rota em Suspense.
const named = (load, name) => lazy(() => load().then((module) => ({ default: module[name] })));
const personal = () => import('../features/settings/Personal.jsx');
const Achievements = named(personal, 'Achievements');
const Preferences = named(() => import('../features/settings/Settings.jsx'), 'Preferences');
const StoragePage = named(() => import('../features/settings/StoragePanel.jsx'), 'StoragePage');
const Friends = lazy(() => import('../features/social/Friends.jsx'));
const Profile = lazy(() => import('../features/social/Profile.jsx'));
const Agenda = lazy(() => import('../features/agenda/Agenda.jsx'));
const Ranking = lazy(() => import('../features/social/Ranking.jsx'));
const AddFriends = lazy(() => import('../features/social/AddFriends.jsx'));
const Reports = lazy(() => import('../features/social/Reports.jsx'));
const ScheduleSession = lazy(() => import('../features/agenda/ScheduleSession.jsx'));
const News = lazy(() => import('../features/news/News.jsx'));
const Landing = lazy(() => import('../features/account/Landing.jsx'));

// Quatro destinos no cabeçalho; as demais telas ficam em abas ou no menu da conta.
export const SECTIONS = {
  hoje: { label: 'Início', icon: 'home', home: 'hoje' },
  biblioteca: { label: 'Biblioteca', icon: 'book', home: 'biblioteca' },
  plano: { label: 'Plano de Estudos', short: 'Plano', icon: 'calendar', home: 'plano' },
  amigos: { label: 'Social', icon: 'users', home: 'amigos' },
  // Perfil, Conquistas e Configurações abrem pelo menu da conta, não pelo cabeçalho.
  perfil: { label: 'Perfil', icon: 'user', home: 'perfil', nav: false },
};

// Telas de entrada: sem menu principal, com cabeçalho próprio.
export const ENTRY_ROUTES = new Set(['login', 'inicio', 'recuperar', 'redefinir', 'conheca']);

// Telas abertas sem conta nem prévia (a apresentação e a recuperação de acesso).
export const PUBLIC_ROUTES = new Set(['recuperar', 'redefinir', 'conheca']);

// Endereços antigos continuam válidos. `#plano` abre a aba padrão do Plano
// (Tarefas), assim como Missões e Roteiro; Meu caminho virou Conquistas. A tela
// de Foco e a aba Agenda deixaram de existir: o timer fica no cabeçalho e as
// aulas previstas, no Calendário.
const ALIASES = { plano: 'tarefas', missoes: 'tarefas', roteiro: 'tarefas', historico: 'conquistas', foco: 'hoje' };

// Enquanto a sessão é verificada, o formulário não aparece: evita a impressão de estar deslogada.
export function SessionCheck() {
  return <LoadingScreen/>;
}

// ctx: { model, state, open, go, notify, params, hash, authMode, setAuthMode, checkingSession }
// `loading`: forma do esqueleto ('cards' ou 'panel') enquanto a biblioteca da conta
// carrega; sem ele, a tela se vira sozinha (ex.: Agenda, telas sociais).
const ROUTES = [
  { id: 'login', title: 'Bem-vindo', render: (ctx) => <Login model={ctx.model} mode={ctx.authMode} setMode={ctx.setAuthMode} go={ctx.go} notify={ctx.notify}/> },
  { id: 'inicio', title: 'Seu ritmo', render: (ctx) => <Onboarding key={ctx.model.account?.id || 'local'} state={ctx.state} actions={ctx.model.accountActions} libraryActions={ctx.model.libraryActions} open={ctx.open} go={ctx.go} notify={ctx.notify} account={ctx.model.account} onExit={ctx.onExit}/> },
  { id: 'recuperar', title: 'Recuperar acesso', render: (ctx) => <Recovery key="recuperar" reset={false} notify={ctx.notify} go={ctx.go}/> },
  { id: 'conheca', title: 'Conheça o Lume', render: (ctx) => <Landing go={ctx.go} setAuthMode={ctx.setAuthMode} signedIn={Boolean(ctx.model.account)}/> },
  { id: 'redefinir', title: 'Nova senha', render: (ctx) => <Recovery key={ctx.hash} reset notify={ctx.notify} go={ctx.go}/> },

  { id: 'hoje', title: 'Início', loading: 'panel', section: 'hoje', render: (ctx) => <Home state={ctx.state} open={ctx.open} go={ctx.go} planActions={ctx.model.planActions} progressActions={ctx.model.progressActions} notify={ctx.notify} account={ctx.model.account} xp={ctx.model.xp}/> },

  { id: 'biblioteca', title: 'Biblioteca', loading: 'cards', section: 'biblioteca', tab: 'Materiais', render: (ctx) => <Library state={ctx.state} open={ctx.open} go={ctx.go} actions={ctx.model.libraryActions}/> },

  { id: 'disciplinas', title: 'Disciplinas', loading: 'cards', section: 'biblioteca', tab: 'Disciplinas', render: (ctx) => <SubjectsPage state={ctx.state} open={ctx.open}/> },

  { id: 'agendar', title: 'Agendar sessão', loading: 'panel', section: 'plano', hideTabs: () => true, render: (ctx) => <ScheduleSession state={ctx.state} actions={ctx.model.agendaActions} open={ctx.open} confirmSave={ctx.model.confirmSave} notify={ctx.notify} go={ctx.go}/> },
  { id: 'tarefas', title: 'Tarefas', loading: 'panel', section: 'plano', tab: 'Tarefas', tabIcon: 'check', hideTabs: () => true, render: (ctx) => <Tasks state={ctx.state} actions={ctx.model.planActions} notify={ctx.notify} onSchedule={(task) => ctx.go(`agenda?tarefa=${encodeURIComponent(task.id)}`)}/> },
  { id: 'agenda', title: 'Calendário', section: 'plano', tab: 'Calendário', tabIcon: 'layers', hideTabs: () => true, render: (ctx) => <Agenda key={ctx.hash} state={ctx.state} actions={ctx.model.agendaActions} taskActions={ctx.model.planActions} confirmSave={ctx.model.confirmSave} retrySave={ctx.model.retrySave} saveError={ctx.model.saveError} syncStatus={ctx.model.syncStatus} params={ctx.params} notify={ctx.notify} open={ctx.open}/> },

  { id: 'amigos', title: 'Social', section: 'amigos', tab: 'Feed', hideTabs: () => true, render: (ctx) => <Friends account={ctx.model.account} state={ctx.state} xp={ctx.model.xp} inviteCode={ctx.params.get('convite') || ''} notify={ctx.notify} go={ctx.go}/> },
  { id: 'ranking', title: 'Ranking', section: 'amigos', tab: 'Ranking', hideTabs: () => true, render: (ctx) => <Ranking account={ctx.model.account} xp={ctx.model.xp} refreshXP={ctx.model.refreshXP} notify={ctx.notify} go={ctx.go}/> },
  { id: 'adicionar', title: 'Amigos', section: 'amigos', tab: 'Amigos', tabIcon: 'users', hideTabs: () => true, render: (ctx) => <AddFriends account={ctx.model.account} inviteCode={ctx.params.get('convite') || ''} notify={ctx.notify} go={ctx.go}/> },


  // Perfil de uma amizade (#perfil?id=) não mostra as abas da própria conta.
  { id: 'perfil', title: 'Perfil', loading: 'panel', section: 'perfil', tab: 'Meu perfil', hideTabs: (ctx) => Boolean(ctx.params.get('id') || ctx.params.get('u')), render: (ctx) => <Profile id={ctx.params.get('id') || ''} handle={ctx.params.get('u') || ''} state={ctx.state} actions={ctx.model.settingsActions} account={ctx.model.account} notify={ctx.notify} go={ctx.go} xp={ctx.model.xp}/> },
  { id: 'conquistas', title: 'Conquistas', loading: 'cards', section: 'perfil', tab: 'Conquistas', render: (ctx) => <Achievements state={ctx.state} account={ctx.model.account} xp={ctx.model.xp}/> },
  { id: 'armazenamento', title: 'Armazenamento', loading: 'panel', section: 'perfil', tab: 'Armazenamento', render: (ctx) => <StoragePage state={ctx.state} account={ctx.model.account} libraryActions={ctx.model.libraryActions} settingsActions={ctx.model.settingsActions} confirmSave={ctx.model.confirmSave} notify={ctx.notify} open={ctx.open} go={ctx.go}/> },
  { id: 'configuracoes', title: 'Configurações', loading: 'panel', section: 'perfil', tab: 'Configurações', render: (ctx) => <Preferences state={ctx.state} actions={ctx.model.settingsActions} libraryActions={ctx.model.libraryActions} confirmSave={ctx.model.confirmSave} account={ctx.model.account} notify={ctx.notify} go={ctx.go} open={ctx.open} xp={ctx.model.xp} refreshXP={ctx.model.refreshXP} initialSection={ctx.params.get('secao') || ''} onPersonalize={() => ctx.go('inicio')}/> },

  { id: 'denuncias', title: 'Denúncias', loading: 'panel', render: (ctx) => <Reports account={ctx.model.account} notify={ctx.notify}/> },
  { id: 'novidades', title: 'Novidades', render: (ctx) => <News go={ctx.go} focusId={ctx.params.get('id') || ''}/> },
  { id: 'aplicativo', title: 'Conexões', loading: 'panel', section: 'perfil', render: (ctx) => <Preferences state={ctx.state} actions={ctx.model.settingsActions} libraryActions={ctx.model.libraryActions} confirmSave={ctx.model.confirmSave} account={ctx.model.account} notify={ctx.notify} go={ctx.go} open={ctx.open} xp={ctx.model.xp} refreshXP={ctx.model.refreshXP} initialSection="conexoes" onPersonalize={() => ctx.go('inicio')}/> },
];

export const ROUTE_BY_ID = new Map(ROUTES.map((route) => [route.id, route]));

export function tabsOf(sectionKey) {
  return ROUTES.filter((route) => route.section === sectionKey && route.tab).map((route) => [route.id, route.tab, route.tabIcon]);
}

export function sectionOf(routeId) {
  return ROUTE_BY_ID.get(routeId)?.section || null;
}

// Endereço atual como `#rota?param=valor`. O perfil de uma pessoa tem endereço limpo,
// `/@usuario`, que vale como `#perfil?u=usuario`; um hash explícito sempre vence.
const PROFILE_PATH = /^\/@([A-Za-z0-9._]{3,24})\/?$/;
export function routeHash() {
  if (location.hash) return location.hash;
  const match = PROFILE_PATH.exec(location.pathname);
  return match ? `#perfil?u=${match[1].toLowerCase()}` : '';
}

// Lê `#rota?param=valor`, aplicando os apelidos de endereços antigos.
export function parseHash(hash) {
  const [path, query = ''] = String(hash || '').replace(/^#/, '').split('?');
  return { requested: ALIASES[path] || path, params: new URLSearchParams(query) };
}
