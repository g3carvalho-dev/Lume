// Perfil compartilhado: projeta somente as seções que quem vê pode ver.
// Nas contas, XP e conquistas vêm do livro do servidor; percentuais de progresso
// continuam sendo registros declarados, não prova de compreensão.
// A Agenda e as tarefas nunca entram no perfil.
import {
  achievements, courseProgress, courseStatus, levelInfo, normalizeProfileCard, STUDY_TYPES,
} from './domain.js';
import { materialSteps } from './material-model.js';
import { normalizePrivacy, profileAccess, sectionAudience, PRIVACY_SECTIONS } from './privacy-domain.js';

export { normalizePrivacy, profileAccess } from './privacy-domain.js';

export const ACTIVITY_LIMIT = 8;
export const RECENT_ACTIVITY_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

// Compatibilidade: as chaves antigas continuam nos dados, mas o perfil não as lê mais.
export function normalizeSharing(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    library: source.library !== false,
    queue: source.queue !== false,
    progress: source.progress !== false,
    xp: source.xp !== false,
    public: source.public !== false,
  };
}

function typeLabel(course) {
  return STUDY_TYPES.find((type) => type.id === course.type)?.title || 'Material';
}

function realCourses(state) {
  const courses = Array.isArray(state?.courses) ? state.courses : [];
  return courses.filter((course) => course && course.example !== true && materialSteps(course).length > 0);
}

// Um projeto só aparece no perfil quando a pessoa marca explicitamente.
export function isPublicProject(course) {
  return Boolean(course && course.type === 'project' && course.shared === true);
}

function safeArt(art) {
  return ['design', 'code', 'language', 'nature'].includes(art) ? art : 'nature';
}

// Atividade: um cartão por material, mais recente primeiro; em andamento antes
// dos concluídos. Tempo registrado conta só as últimas duas semanas.
export function buildActivity(state, courses, { now = Date.now() } = {}) {
  const courseMap = new Map(courses.map((course) => [course.id, course]));
  const cutoff = now - RECENT_ACTIVITY_WINDOW_MS;
  const info = new Map();
  let recentSteps = 0;
  let recentMs = 0;
  const entry = (id) => {
    if (!info.has(id)) info.set(id, { lastAt: 0, lastStep: '', lastStepAt: 0, recentMs: 0 });
    return info.get(id);
  };

  for (const record of state?.progress || []) {
    const course = courseMap.get(record.materialId);
    if (!course || record.revertedAt || !record.at) continue;
    const at = Date.parse(record.at);
    if (!Number.isFinite(at)) continue;
    const item = entry(course.id);
    item.lastAt = Math.max(item.lastAt, at);
    if (record.type === 'completion') {
      if (at >= cutoff) recentSteps += 1;
      if (at >= item.lastStepAt) {
        item.lastStepAt = at;
        item.lastStep = materialSteps(course).find((step) => step.id === record.unitId)?.title || record.title || item.lastStep;
      }
    }
  }
  for (const session of state?.studySessions || []) {
    const course = courseMap.get(session.courseId);
    if (!course) continue;
    const at = Date.parse(session.endedAt || session.startedAt);
    if (!Number.isFinite(at)) continue;
    const item = entry(course.id);
    item.lastAt = Math.max(item.lastAt, at);
    if (at >= cutoff) {
      const duration = Math.max(0, Number(session.durationMs) || 0);
      item.recentMs += duration;
      recentMs += duration;
    }
  }
  // Materiais com etapas concluídas sem data (históricos) também entram, por último.
  for (const course of courses) {
    if (!info.has(course.id) && courseProgress(state, course).done > 0) entry(course.id);
  }

  const items = [...info.entries()].map(([id, data]) => {
    const course = courseMap.get(id);
    const progress = courseProgress(state, course);
    return {
      id,
      title: course.title,
      type: typeLabel(course),
      art: safeArt(course.art),
      status: courseStatus(state, course),
      progress,
      lastAt: data.lastAt ? new Date(data.lastAt).toISOString() : null,
      lastStep: data.lastStep || '',
      recentMinutes: data.recentMs > 0 ? Math.max(1, Math.round(data.recentMs / 60000)) : 0,
    };
  });
  const byRecency = (a, b) => Date.parse(b.lastAt || 0) - Date.parse(a.lastAt || 0) || b.progress.done - a.progress.done;
  const ordered = [
    ...items.filter((item) => item.status !== 'completed').sort(byRecency),
    ...items.filter((item) => item.status === 'completed').sort(byRecency),
  ];
  return {
    items: ordered.slice(0, ACTIVITY_LIMIT),
    recentSteps,
    recentMinutes: recentMs > 0 ? Math.max(1, Math.round(recentMs / 60000)) : 0,
  };
}

// relation: quem vê ('self', 'friend', 'member'). O servidor decide a relação;
// aqui só se projeta o que ela permite. Seção oculta vem como null, e
// `visibility` diz à tela para mostrar o aviso no lugar.
export function buildProfile(state, { now = Date.now(), validated = null, relation = 'self' } = {}) {
  const access = profileAccess(state?.preferences, relation);
  const show = access.sections;
  const customization = normalizeProfileCard(state?.profile);
  // Projeto privado não aparece em lugar nenhum do perfil: nem na atividade,
  // nem nas contagens — senão a própria existência vazaria.
  const courses = realCourses(state).filter((course) => course.type !== 'project' || course.shared === true);
  const visibleState = { ...state, courses };

  const totals = courses.reduce((accumulator, course) => {
    const progress = courseProgress(state, course);
    accumulator.done += progress.done;
    if (progress.total > 0 && progress.done === progress.total) accumulator.completedCourses += 1;
    return accumulator;
  }, { done: 0, completedCourses: 0 });

  const level = show.achievements
    ? (validated
      ? { level: validated.level, total: validated.totalXP, current: validated.levelCurrent, next: validated.levelNext }
      : levelInfo(state))
    : null;
  // Conquistas validadas vêm do livro de eventos do servidor. Sem elas (prévia
  // ou perfil antigo), os selos genéricos permanecem visíveis como legado.
  const allAchievements = show.achievements
    ? (validated
      ? (validated.achievements || []).map((item) => ({
        id: item.id,
        title: item.title,
        text: item.criterion,
        icon: item.kind === 'project' ? 'flag' : item.kind === 'slide' ? 'book' : 'trophy',
        unlocked: true,
        current: 1,
        target: 1,
      }))
      : achievements(visibleState))
    : null;
  const unlockedBadges = allAchievements ? allAchievements.filter((item) => item.unlocked) : [];
  const featuredBadge = unlockedBadges[unlockedBadges.length - 1] || null;
  const activity = show.activity ? buildActivity(state, courses, { now }) : null;

  return {
    // Só o próprio perfil recebe a configuração; os outros só sabem o que podem ver.
    ...(relation === 'self' ? {
      privacy: access.privacy,
      audiences: Object.fromEntries(PRIVACY_SECTIONS.map((section) => [section, sectionAudience(access.privacy, section)])),
    } : {}),
    visibility: { ...show },
    customization,
    activity: activity ? activity.items : null,
    titles: show.achievements ? (validated?.titles || []) : [],
    achievements: allAchievements
      ? allAchievements.map(({ id, title, text, icon, unlocked, current, target }) => ({
        id, title, text, icon, unlocked, current, target,
      }))
      : null,
    featuredBadge: featuredBadge
      ? { id: featuredBadge.id, title: featuredBadge.title, text: featuredBadge.text || '', icon: featuredBadge.icon }
      : null,
    stats: {
      materials: show.activity ? courses.length : null,
      doneLessons: show.activity ? totals.done : null,
      completedMaterials: show.activity ? totals.completedCourses : null,
      recentStepsTwoWeeks: activity ? activity.recentSteps : null,
      recentMinutesTwoWeeks: activity ? activity.recentMinutes : null,
      xp: level ? level.total : null,
      level: level ? level.level : null,
      xpValidated: Boolean(validated),
      unlockedAchievements: allAchievements ? unlockedBadges.length : null,
      totalAchievements: allAchievements ? allAchievements.length : null,
    },
  };
}

// Compatibilidade para quem só precisa da chave geral (busca por @usuário).
export function isOpenProfile(preferences) {
  return normalizePrivacy(preferences).mode === 'open';
}
