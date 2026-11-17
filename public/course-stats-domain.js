import { materialSteps, materialStructure } from './material-model.js';
import { completedUnitIds } from './progress-domain.js';
import { addDays, buildSchedule } from './schedule-domain.js';
import { closeStaleSession, formatMinutes, localDay, minutesByDay } from './session-domain.js';
import { DEFAULT_SESSION_MINUTES } from './study-plan.js';

export const PACE_WINDOW_DAYS = 14;
export const MIN_PACE_DAYS = 3;
export const MIN_PACE_MINUTES = 60;

export function courseStats(state, courseId, now = Date.now()) {
  const course = state.courses.find(item => item.id === courseId);
  if (!course) return null;
  const lessons = materialSteps(course);
  const selected = new Set(lessons.map(item => item.id));
  const done = completedUnitIds(state);
  const remaining = lessons.filter(item => !done.has(item.id));
  const durations = lessons.map(item => item.duration).filter(value => value > 0);
  const fallback = durations.length ? durations.reduce((sum, n) => sum + n, 0) / durations.length
    : (Number(state.onboarding?.answers?.sessionMinutes) || DEFAULT_SESSION_MINUTES) * 60;
  const knownMinutes = remaining.reduce((sum, lesson) => sum + (lesson.duration || 0), 0) / 60;
  const unknown = remaining.filter(item => !item.duration).length;
  const minutes = Math.ceil(knownMinutes + unknown * fallback / 60);
  const modules = [], disciplines = [];
  for (const discipline of materialStructure(course)) {
    const section = [];
    for (const module of discipline.modules) {
      const included = module.lessons.filter(item => selected.has(item.id));
      if (included.length) section.push(included.every(item => done.has(item.id)));
    }
    if (section.length) {
      modules.push(...section);
      disciplines.push(section.every(Boolean));
    }
  }
  const recent = closeStaleSession(state, now);
  const days = minutesByDay({
    studySessions: recent.studySessions.filter(item => item.courseId === courseId),
    activeSession: recent.activeSession?.courseId === courseId ? recent.activeSession : null,
  }, PACE_WINDOW_DAYS, now);
  const studied = days.reduce((sum, day) => sum + day.minutes, 0);
  const pace = studied / PACE_WINDOW_DAYS;
  const today = localDay(now);
  let basis = null, finish = null;
  if (remaining.length && studied >= MIN_PACE_MINUTES && days.filter(day => day.minutes > 0).length >= MIN_PACE_DAYS) {
    basis = 'pace';
    finish = addDays(today, Math.ceil(minutes / pace));
  } else if (remaining.length && Object.values(state.plan?.availability || {}).some(value => value > 0)) {
    finish = buildSchedule(state, { today }).courses.find(item => item.courseId === courseId)?.finish || null;
    if (finish) basis = 'plan';
  }
  const counts = values => ({ total: values.length, completed: values.filter(Boolean).length });
  return { total: lessons.length, completed: lessons.length - remaining.length, remaining: remaining.length,
    modules: counts(modules), disciplines: counts(disciplines), knownMinutes, unknown, minutes, pace, finish, basis, todayMinutes: days.at(-1).minutes };
}

export function courseEstimateText(stats) {
  if (!stats.remaining) return 'Todas as aulas selecionadas foram concluídas.';
  const count = stats.remaining === 1 ? 'Falta 1 aula' : `Faltam ${stats.remaining} aulas`;
  let text = `${count} · cerca de ${formatMinutes(stats.minutes)}.`;
  if (stats.finish) {
    const date = new Date(`${stats.finish}T12:00:00`).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
    text += ` ${stats.basis === 'pace' ? 'No seu ritmo' : 'Pela disponibilidade do plano'}, você termina por volta de ${date}.`;
  }
  return text;
}
