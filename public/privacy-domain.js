// Privacidade do perfil (16/11/2026): uma chave geral (aberto/privado) define o
// padrão, e cada seção pode ser ajustada para Todos, Só amigos ou Só eu.
// "Todos" quer dizer quem tem conta no Lume e está logado; nada é visível sem login.
// O servidor usa estas mesmas regras para negar cada seção (api/domain/friends.js).
// Sem dependências: domain.js e profile-domain.js importam daqui.

export const PRIVACY_MODES = ['open', 'private'];
export const AUDIENCES = ['all', 'friends', 'self'];
export const PRIVACY_SECTIONS = ['posts', 'activity', 'achievements', 'friends'];

export const PRIVACY_SECTION_LABELS = {
  posts: 'Publicações',
  activity: 'Atividade',
  achievements: 'Conquistas e nível',
  friends: 'Amigos',
};

export const AUDIENCE_LABELS = { all: 'Todos', friends: 'Só amigos', self: 'Só eu' };

// Contas novas: perfil aberto, seções seguindo o padrão, publicações só entre
// amigos (escrever no Feed é compartilhar com amigos; ampliar é escolha explícita).
export function defaultPrivacy() {
  return { mode: 'open', posts: 'friends', activity: null, achievements: null, friends: null };
}

function audienceOf(value) {
  return AUDIENCES.includes(value) ? value : null;
}

// Recebe as preferências inteiras. Sem `privacy`, converte as escolhas antigas
// (`sharing`) sem ampliar o alcance de ninguém: Publicações começam em Só amigos;
// Atividade e Conquistas ficam em Só eu se a pessoa tinha desligado biblioteca,
// progresso ou XP; o resto segue a chave geral, que herda o antigo "Perfil público".
export function normalizePrivacy(preferences) {
  const prefs = preferences && typeof preferences === 'object' ? preferences : {};
  const source = prefs.privacy;
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    return {
      mode: source.mode === 'private' ? 'private' : 'open',
      posts: audienceOf(source.posts),
      activity: audienceOf(source.activity),
      achievements: audienceOf(source.achievements),
      friends: audienceOf(source.friends),
    };
  }
  const legacy = prefs.sharing && typeof prefs.sharing === 'object' ? prefs.sharing : {};
  return {
    mode: legacy.public === false ? 'private' : 'open',
    posts: 'friends',
    activity: legacy.library !== false && legacy.progress !== false ? null : 'self',
    achievements: legacy.xp !== false ? null : 'self',
    friends: null,
  };
}

export function modeDefault(mode) {
  return mode === 'private' ? 'friends' : 'all';
}

// Alcance efetivo de uma seção: o ajuste da seção ou o padrão da chave geral.
// Perfil privado não abre para quem não é amigo, então "Todos" vale como Só amigos.
export function sectionAudience(privacy, section) {
  const value = privacy?.[section] ?? modeDefault(privacy?.mode);
  return privacy?.mode === 'private' && value === 'all' ? 'friends' : value;
}

// relation: 'self' | 'friend' | 'member' (conta logada sem amizade) | 'blocked'.
export function canSee(audience, relation) {
  if (relation === 'self') return true;
  if (relation === 'friend') return audience === 'all' || audience === 'friends';
  if (relation === 'member') return audience === 'all';
  return false;
}

// O que uma relação pode ver no perfil de alguém. `open` diz se o perfil abre;
// bloqueio, nos dois sentidos, nega tudo.
export function profileAccess(preferences, relation) {
  const privacy = normalizePrivacy(preferences);
  const open = relation === 'self' || relation === 'friend' || (relation === 'member' && privacy.mode === 'open');
  const sections = Object.fromEntries(PRIVACY_SECTIONS.map((section) => [
    section,
    open && canSee(sectionAudience(privacy, section), relation),
  ]));
  return { open, privacy, sections };
}

// Frase curta para Configurações: quem vê cada coisa.
export function audienceSentence(privacy, section) {
  const audience = sectionAudience(privacy, section);
  if (section === 'posts') {
    if (audience === 'all') return 'No seu perfil, qualquer pessoa com conta no Lume vê suas publicações. No Feed, elas continuam só entre amigos.';
    if (audience === 'friends') return 'Só seus amigos veem suas publicações, no Feed e no seu perfil.';
    return 'Ninguém vê suas publicações no seu perfil. Elas continuam aparecendo no Feed dos seus amigos.';
  }
  const what = {
    activity: 'os materiais que você estuda, o tempo registrado e o progresso',
    achievements: 'seu nível, XP e conquistas',
    friends: 'sua lista de amigos',
  }[section];
  if (audience === 'all') return `Qualquer pessoa com conta no Lume vê ${what}.`;
  if (audience === 'friends') return `Só seus amigos veem ${what}.`;
  return `Só você vê ${what}.`;
}
