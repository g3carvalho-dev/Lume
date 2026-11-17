import { expect, test } from '@playwright/test';
import { createInitialState } from '../../public/domain.js';
import { addSubject } from '../../public/subject-domain.js';
import { readAccount, seedAccount } from './library-helpers.js';

test('cria disciplina em modal e mantém a grade apenas com cards de disciplinas', async ({ page }) => {
  await seedAccount(page, { ...createInitialState(), onboarded: true });
  await page.goto('/#biblioteca');
  await expect(page.getByRole('heading', { name: 'Biblioteca', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Adicionar material' }).click();
  await page.getByRole('menuitem', { name: 'Adicionar disciplina' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Nova disciplina', exact: true })).toBeVisible();
  await dialog.getByLabel('Nome da disciplina').fill('Direito Penal');
  await dialog.getByLabel('Palavras-chave (opcional)').fill('penal, crime');
  await dialog.getByRole('button', { name: 'Criar disciplina' }).click();

  await expect(dialog).toBeHidden();
  const card = page.locator('.subject-card').filter({ hasText: 'Direito Penal' });
  await expect(card).toBeVisible();
  await expect(page.locator('.subject-card.subject-new')).toHaveCount(0);
  const saved = await readAccount(page);
  expect(saved.subjects).toHaveLength(1);
  expect(saved.subjects[0]).toMatchObject({ title: 'Direito Penal', keywords: ['penal', 'crime'] });

  await card.getByRole('button', { name: /Vincular apostilas ou PDFs/ }).click();
  const attach = page.getByRole('dialog');
  await expect(attach.getByLabel('Disciplina')).toHaveValue(saved.subjects[0].id);
  await attach.getByRole('button', { name: 'Fechar janela' }).click();

  await card.getByRole('button', { name: 'Direito Penal' }).click();
  const detail = page.getByRole('dialog');
  await expect(detail.getByRole('heading', { name: 'Direito Penal', exact: true })).toBeVisible();
  await detail.getByRole('button', { name: 'Fechar', exact: true }).click();
});

test('disciplinas em excesso viram um carrossel 3D infinito', async ({ page }) => {
  let state = { ...createInitialState(), onboarded: true };
  for (let index = 1; index <= 8; index += 1) {
    state = addSubject(state, { title: `Disciplina ${index}` }, `subject-${index}`);
  }
  await seedAccount(page, state);
  await page.goto('/#biblioteca');
  await expect(page.locator('.subject-slide')).toHaveCount(8);
  const active = page.locator('.subject-slide.is-active');
  await expect(active).toContainText('Disciplina 1');
  await expect(page.locator('.subject-slide.is-near')).toHaveCount(2);
  const farFilter = await page.locator('.subject-slide').filter({ hasText: 'Disciplina 3' }).evaluate((node) => getComputedStyle(node).filter);
  expect(farFilter).toContain('blur');

  await page.getByRole('button', { name: 'Disciplinas anteriores' }).click();
  await expect(active).toContainText('Disciplina 8');
  await page.getByRole('button', { name: 'Próximas disciplinas' }).click();
  await expect(active).toContainText('Disciplina 1');
  await page.getByRole('button', { name: 'Próximas disciplinas' }).click();
  await expect(active).toContainText('Disciplina 2');
});
