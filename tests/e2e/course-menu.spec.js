import { test, expect } from '@playwright/test';
import { seedAccount, readAccount } from './library-helpers.js';
import { createInitialState, STORAGE_KEY } from '../../public/domain.js';
import { applyCourseImport, normalizePayload } from '../../public/import-domain.js';

function stateWithCourse() {
  const payload = normalizePayload({
    title: 'Preparação Oab',
    provider: { id: 'grancursos' },
    sourceUrl: 'https://www.grancursosonline.com.br/aluno/curso/video/codigo/ABC',
    disciplines: [{ title: 'Direito', modules: [{ title: 'Aula 1', lessons: [{ title: 'Um' }, { title: 'Dois' }, { title: 'Três' }] }] }],
    extraction: { kind: 'extension-capture', confidence: 'medium', notes: [] },
    completeness: 'partial',
  });
  return { ...applyCourseImport({ ...createInitialState(), onboarded: true }, payload), onboarded: true };
}

// Excluir material: pelo editor, só depois da confirmação.

test('excluir o material pelo editor só acontece depois da confirmação', { tag: '@celular' }, async ({ page }) => {
  const state = stateWithCourse();
  expect(state.courses.length).toBeGreaterThan(0);
  const target = state.courses[0];
  await seedAccount(page, state);
  await page.goto('/#biblioteca');
  await expect(page.getByRole('heading', { name: 'Biblioteca', exact: true })).toBeVisible();

  const card = page.getByRole('region', { name: 'Cursos e trilhas' }).getByRole('button', { name: new RegExp(target.title) });
  await card.click();
  await page.getByRole('button', { name: 'Editar material' }).first().click();
  await page.getByRole('button', { name: 'Excluir material' }).click();

  // Confirmação: nada some antes dela.
  await page.getByRole('button', { name: 'Manter material' }).click();
  expect((await readAccount(page)).courses.map((course) => course.id)).toContain(target.id);

  await page.getByRole('button', { name: 'Excluir material' }).click();
  await page.getByRole('button', { name: 'Sim, excluir' }).click();
  await expect.poll(async () => (await readAccount(page)).courses.map((course) => course.id)).not.toContain(target.id);
  expect((await readAccount(page)).courses).toHaveLength(state.courses.length - 1);
});
