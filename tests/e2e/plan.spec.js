import { test, expect } from '@playwright/test';
import { materialSteps } from '../../public/material-model.js';
import { seedAccount, readAccount, E2E_ORIGIN } from './library-helpers.js';
import { createInitialState } from '../../public/domain.js';
import { applyCourseImport, normalizePayload } from '../../public/import-domain.js';
import { createAppointment, shiftDate } from '../../public/agenda-domain.js';
import { localDate } from '../../public/tasks-domain.js';

function seeded() {
  const payload = normalizePayload({
    title: 'Direito Constitucional — OAB',
    provider: { id: 'grancursos' },
    sourceUrl: 'https://www.grancursosonline.com.br/curso/constitucional',
    disciplines: [{ title: 'Direito Constitucional', modules: [{ title: 'Direitos fundamentais', lessons: [
      { title: 'Aula 1 — Teoria geral', duration: '30:00' },
      { title: 'Aula 2 — Direitos individuais', duration: '30:00' },
      { title: 'Aula 3 — Remédios constitucionais', duration: '30:00' },
      { title: 'Aula 4 — Nacionalidade' },
    ] }] }],
  });
  const state = applyCourseImport({ ...createInitialState(), onboarded: true }, payload);
  state.onboarding = { ...state.onboarding, status: 'done', answers: { sessionMinutes: 30 } };
  return state;
}

test('aulas previstas aparecem no Calendário, recalculam após conclusão e sobrevivem ao recarregamento', async ({ page }) => {
  await seedAccount(page, seeded());

  await page.goto('/#hoje');
  await page.getByRole('navigation', { name: 'Navegação' }).getByRole('link', { name: 'Plano de Estudos', exact: true }).click();
  // A aba padrão do Plano é Tarefas; a aba Agenda deixou de existir.
  await expect(page.getByRole('heading', { name: 'Tarefas', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Seções de Plano de Estudos' }).getByRole('link')).toHaveText(['Tarefas', 'Calendário']);
  await page.getByRole('navigation', { name: 'Seções de Plano de Estudos' }).getByRole('link', { name: 'Calendário', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Calendário', exact: true })).toBeVisible();

  // Sem disponibilidade, nada é previsto; o estado vazio oferece segunda a sexta.
  await expect(page.locator('[data-planned-lesson]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Usar segunda a sexta, 30 min por dia' }).click();
  const planned = (title) => page.getByLabel(`Aula prevista: ${title}`, { exact: true });
  await expect(planned('Aula 1 — Teoria geral')).toBeVisible();

  // Clicar numa aula prevista mostra o dia abaixo da grade; ela não abre o editor nem é arrastável.
  await planned('Aula 1 — Teoria geral').click();
  const detail = page.locator('.agenda-day');
  await expect(detail.locator('.agenda-day-item.is-planned').first()).toContainText('Aula 1 — Teoria geral');
  await expect(detail).toContainText('(duração da fonte)');
  await expect(page.getByLabel('Título do compromisso')).toHaveCount(0);

  // A Aula 4 não informa duração: fica como estimativa.
  for (let step = 0; step < 2 && !(await planned('Aula 4 — Nacionalidade').count()); step += 1) {
    await page.getByRole('button', { name: 'Próximo período' }).click();
  }
  await planned('Aula 4 — Nacionalidade').click();
  await expect(detail).toContainText('(estimativa)');
  await page.getByRole('button', { name: 'Hoje', exact: true }).click();

  // Concluir a primeira aula recalcula o cronograma a partir de hoje.
  await planned('Aula 1 — Teoria geral').click();
  await detail.getByRole('button', { name: 'Estudar' }).click();
  await page.getByRole('button', { name: 'Concluí esta aula' }).click();
  await page.getByRole('button', { name: 'Fechar janela' }).click();
  await expect(planned('Aula 1 — Teoria geral')).toHaveCount(0);
  await expect(planned('Aula 2 — Direitos individuais')).toBeVisible();

  // Adiar, no detalhe do dia, move a aula e as seguintes do curso; nada é concluído.
  await planned('Aula 2 — Direitos individuais').click();
  await detail.getByRole('button', { name: 'Adiar Aula 2 — Direitos individuais' }).click();
  await expect(page.getByText(/As aulas seguintes de Direito Constitucional — OAB acompanham/)).toBeVisible();
  const beforeReload = await readAccount(page);
  expect(Object.keys(beforeReload.plan.postponed)).toEqual([materialSteps(beforeReload.courses[0])[1].id]);
  expect(beforeReload.agenda).toEqual([]);

  await page.reload();
  await expect(planned('Aula 2 — Direitos individuais')).toBeVisible();
  const saved = await readAccount(page);
  const course = saved.courses[0];
  expect(saved.plan.availability).toEqual({ 1: 30, 2: 30, 3: 30, 4: 30, 5: 30 });
  expect(Object.keys(saved.plan.postponed)).toEqual([materialSteps(course)[1].id]);
  expect(saved.progress.filter((event) => event.type === 'completion' && !event.revertedAt).map((event) => event.unitId)).toEqual([materialSteps(course)[0].id]);
  expect(saved.progress.some((event) => event.legacyXp)).toBe(false);
});

test('tarefa vinculada conclui a aula uma vez; subtarefa vale 10 XP uma vez e reabertura não repete', async ({ page }) => {
  await seedAccount(page, seeded());

  await page.goto('/#tarefas');
  await page.getByRole('button', { name: 'Nova tarefa', exact: true }).click();
  await page.getByLabel('Tarefa', { exact: true }).fill('Revisar Aula 1 com questões');
  await page.getByLabel('Curso ou prova (opcional)').selectOption({ label: 'Direito Constitucional — OAB' });
  await page.getByLabel('Aula ou etapa (opcional)').selectOption({ label: 'Aula 1 — Teoria geral' });
  await page.getByRole('button', { name: 'Adicionar tarefa' }).click();
  await expect(page.locator('.todo-item').first()).toContainText('Aula 1 — Teoria geral');

  await page.getByRole('button', { name: 'Adicionar subtarefa' }).click();
  await page.getByLabel('Nova subtarefa de Revisar Aula 1 com questões').fill('Resolver 10 questões');
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Resolver 10 questões' }).check();
  await expect(page.getByText('1 de 1 subtarefa concluída')).toBeVisible();
  const beforeReload = await readAccount(page);
  expect(beforeReload.tasks[0].subtasks[0].done).toBe(true);

  await page.reload();
  await expect(page.getByText('1 de 1 subtarefa concluída')).toBeVisible();
  const saved = await readAccount(page);
  expect(saved.tasks[0].lessonId).toBe(materialSteps(saved.courses[0])[0].id);
  expect(saved.tasks[0].subtasks).toEqual([expect.objectContaining({ title: 'Resolver 10 questões', done: true })]);
  expect(saved.tasks[0].done).toBe(false);
  expect(saved.progress).toEqual([]);
  await page.getByRole('checkbox', { name: 'Concluir tarefa Revisar Aula 1 com questões' }).click();
  await expect(page.getByRole('checkbox', { name: 'Reabrir tarefa Revisar Aula 1 com questões' })).toBeChecked();
  const completed = await readAccount(page);
  expect(completed.progress.filter((event) => !event.revertedAt)).toHaveLength(1);
  const xp = async () => (await (await page.request.get('/api/xp', { headers: { origin: E2E_ORIGIN } })).json()).summary.totalXP;
  expect(await xp()).toBe(110);
  await page.getByRole('checkbox', { name: 'Reabrir tarefa Revisar Aula 1 com questões' }).click();
  await expect(page.getByRole('checkbox', { name: 'Concluir tarefa Revisar Aula 1 com questões' })).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'Concluir tarefa Revisar Aula 1 com questões' }).click();
  await expect(page.getByRole('checkbox', { name: 'Reabrir tarefa Revisar Aula 1 com questões' })).toBeChecked();
  await readAccount(page);
  expect(await xp()).toBe(110);
  await page.goto('/#perfil');
  await expect(page.getByRole('region', { name: 'Cargos de estudo' })).toContainText('Iniciante');
});

test('próximo marco do Início conta só provas e entregas', async ({ page }) => {
  const base = (days) => { const date = shiftDate(localDate(), days); return { date, endDate: date, start: '', end: '', timeZone: 'America/Sao_Paulo', taskIds: [] }; };
  let state = createAppointment({ ...createInitialState(), onboarded: true }, { ...base(1), title: 'Consulta médica', category: 'personal' });
  state = createAppointment(state, { ...base(2), title: 'Revisão em grupo', category: 'study' });
  state = createAppointment(state, { ...base(3), title: 'Prova de Falência', category: 'exam' });
  await seedAccount(page, state);
  await page.goto('/#hoje');
  const milestone = page.locator('.today-radar-milestone');
  await expect(milestone).toContainText('Prova de Falência');
  await expect(milestone.locator('.countdown-number')).toHaveText('3');
  await expect(milestone).not.toContainText('Consulta médica');
  // A sessão de estudo agendada aparece só como a próxima sessão.
  await expect(milestone).toContainText('próxima sessão');
});
