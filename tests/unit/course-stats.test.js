import assert from 'node:assert/strict';
import test from 'node:test';
import { courseStats } from '../../public/course-stats-domain.js';
import { createInitialState } from '../../public/domain.js';
import { unitsFromStructure } from '../../public/material-model.js';
import { completeLesson } from '../../public/import-domain.js';

const now = Date.parse('2026-11-16T12:00:00Z');
function sample(duration) {
  const lessons = [{ id: 'a', title: 'A', duration }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }];
  const units = unitsFromStructure([{ id: 'd', title: 'Área', modules: [{ id: 'm', title: 'Módulo', lessons }] }], ['a', 'b']);
  return { ...createInitialState(), courses: [{ id: 'c', title: 'Curso', type: 'course', units }] };
}
test('estimativa usa aulas selecionadas, média conhecida e a duração do onboarding como reserva', () => {
  const state = sample(1200);
  assert.deepEqual([courseStats(state, 'c', now).minutes, courseStats(state, 'c', now).unknown], [40, 1]);
  const empty = sample(null);
  empty.onboarding = { answers: { sessionMinutes: 15 } };
  assert.deepEqual([courseStats(empty, 'c', now).minutes, courseStats(empty, 'c', now).finish], [30, null]);
});
test('só sessões do curso definem o ritmo e só três dias e 60 minutos substituem o plano', () => {
  let state = sample(1200);
  state.plan.availability = { 1: 60 };
  const session = (day, id) => ({ id, courseId: id === 'outro' ? 'outro' : 'c', startedAt: day, endedAt: day, durationMs: 20 * 60000 });
  state.studySessions = [session('2026-11-11', 'a'), session('2026-11-12', 'b'), session('2026-11-13', 'outro')];
  assert.equal(courseStats(state, 'c', now).basis, 'plan');
  state.studySessions.push(session('2026-11-14', 'c'));
  assert.equal(courseStats(state, 'c', now).basis, 'pace');
  for (const id of ['a', 'b']) state = completeLesson(state, 'c', id).state;
  const done = courseStats(state, 'c', now);
  assert.deepEqual([done.remaining, done.minutes, done.finish, done.modules.completed, done.disciplines.completed], [0, 0, null, 1, 1]);
});
