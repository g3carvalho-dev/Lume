import { test, expect } from '@playwright/test';
import { materialSteps } from '../../public/material-model.js';
import { seedAccount, readAccount, addMaterial, captureCourse } from './library-helpers.js';
import { createInitialState } from '../../public/domain.js';
import { EXTENSION_STORE_URL } from '../../public/extension-domain.js';

// Capturas simulam a ponte da extensão; revisão e gravação usam a API real.

async function openLibrary(page) {
  await seedAccount(page, { ...createInitialState(), onboarded: true });
  await page.goto('/#biblioteca');
  await expect(page.getByRole('heading', { name: 'Biblioteca', exact: true })).toBeVisible();
}

test('Adicionar curso recebe a captura da extensão sem analisar links', async ({ page }) => {
  await openLibrary(page);
  const legacyRequests = [];
  page.on('request', request => {
    if (/\/api\/import\/(analyze|organize)$/.test(new URL(request.url()).pathname)) legacyRequests.push(request.url());
  });
  await addMaterial(page, 'Adicionar curso');
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Adicionar curso', exact: true })).toBeVisible();
  await captureCourse(page, {
    title: 'Curso pela extensão',
    disciplines: [{ title: 'Direito Constitucional', modules: [{ title: 'Princípios', lessons: [{ title: 'Aula 1 — Conceito' }] }] }],
  });
  await page.getByRole('button', { name: /Adicionar 1 aula à biblioteca/ }).click();
  await expect(page.getByText('XP concedido agora: 0')).toBeVisible();
  const saved = await readAccount(page);
  expect(saved.courses).toHaveLength(1);
  expect(saved.courses[0].title).toBe('Curso pela extensão');
  expect(legacyRequests).toEqual([]);
});

test('seleção parcial, reimportação sem duplicata e progresso preservado', async ({ page }) => {
  await openLibrary(page);
  await addMaterial(page, 'Adicionar curso');
  await captureCourse(page, {
    title: 'Preparatório OAB',
    disciplines: [
      { title: 'Direito Constitucional', modules: [{ title: 'Princípios', lessons: [{ title: 'Aula 1 — Conceito e fontes' }, { title: 'Aula 2 — Direitos fundamentais' }] }] },
      { title: 'Direito Penal', modules: [{ title: 'Parte geral', lessons: [{ title: 'Aula 1 — Aplicação da lei' }] }] },
    ],
  });
  await expect(page.getByRole('status').filter({ hasText: 'aulas selecionadas' })).toHaveText('3 de 3 aulas selecionadas');

  // Selecionar apenas uma área não conclui o curso inteiro.
  await page.getByRole('checkbox', { name: 'Selecionar a área Direito Penal' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'aulas selecionadas' })).toHaveText('2 de 3 aulas selecionadas');
  await page.getByRole('button', { name: /Adicionar 2 aulas à biblioteca/ }).click();
  await page.getByRole('button', { name: 'Voltar à biblioteca' }).click();

  await page.getByRole('button', { name: /^Preparatório OAB,/ }).click();
  await expect(page.getByText('Grade parcial', { exact: true })).toBeVisible();
  await expect(page.getByText(/não representa a conclusão do curso inteiro/i)).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByRole('button', { name: 'Concluí esta aula' }).click();
  await expect(page.getByText('registro manual').first()).toBeVisible();
  const firstLesson = (await readAccount(page)).progress.filter((event) => event.type === 'completion' && !event.revertedAt).at(-1).unitId;

  // Reimportação: a mesma identidade atualiza o curso, sem duplicar.
  await page.getByRole('dialog').getByRole('button', { name: 'Atualizar grade' }).click();
  await expect(page.getByRole('dialog').getByText(/Leia o curso novamente pela extensão/)).toBeVisible();
  await captureCourse(page, {
    title: 'Preparatório OAB',
    disciplines: [
      { title: 'Direito Constitucional', modules: [{ title: 'Princípios', lessons: [{ title: 'Aula 2 — Direitos fundamentais' }, { title: 'Aula 3 — Remédios constitucionais' }] }] },
      { title: 'Direito Tributário', modules: [{ title: 'Obrigação', lessons: [{ title: 'Aula 1 — Fato gerador' }] }] },
    ],
  });
  await page.getByRole('button', { name: /Adicionar 3 aulas à biblioteca/ }).click();
  await expect(page.getByText('Importação concluída')).toBeVisible();
  await page.getByRole('button', { name: 'Ver o curso' }).click();
  await expect(page.getByText(/Algumas aulas não aparecem mais na fonte/)).toBeVisible();
  await page.getByRole('button', { name: 'Fechar janela' }).click();

  await expect(page.locator('#library-results .course-card').filter({ hasText: 'Preparatório OAB' })).toHaveCount(1);
  const state = await readAccount(page);
  expect(state.courses.filter(course => course.title === 'Preparatório OAB')).toHaveLength(1);
  expect(state.progress.filter((event) => !event.revertedAt).map((event) => event.unitId)).toContain(firstLesson);
  expect(state.progress).toHaveLength(1);
  expect(state.progress[0].origin).toBe('manual');
  expect(state.imports.at(-1).mode).toBe('update');
});

test('biblioteca vazia pergunta a área e cria a primeira trilha sem XP', async ({ page }) => {
  await openLibrary(page);
  await expect(page.getByRole('heading', { name: 'Qual área você quer estudar?' })).toBeVisible();
  await page.getByLabel('Área de atuação').fill('Direito');
  await page.getByLabel('Primeiro passo (opcional)').fill('Ler a introdução de processo penal');
  await page.getByRole('button', { name: 'Criar minha trilha' }).click();

  await expect(page.getByRole('button', { name: /^Direito,/ })).toBeVisible();
  const state = await readAccount(page);
  expect(state.courses).toHaveLength(1);
  expect(state.courses[0].title).toBe('Direito');
  expect(state.courses[0].origin).toBe('manual');
  expect(materialSteps(state.courses[0])[0].title).toBe('Ler a introdução de processo penal');
  expect(state.progress.filter((event) => event.origin === 'manual' || event.legacyXp)).toEqual([]);
});

test('Adicionar curso explica instalação e uso da extensão no computador e celular', { tag: '@celular' }, async ({ page, isMobile }, testInfo) => {
  await openLibrary(page);
  await addMaterial(page, 'Adicionar curso');
  const dialog = page.getByRole('dialog');
  const guide = dialog.getByRole('region', { name: 'Extensão do Lume' });
  await expect(dialog.getByRole('heading', { name: 'Adicionar curso', exact: true })).toBeVisible();
  await expect(guide).toContainText('A extensão lê as aulas do curso aberto em uma plataforma compatível');
  await expect(guide.getByRole('listitem')).toHaveText([
    'Abra o curso na plataforma com a sua conta.',
    'Clique no ícone do Lume e em “Ler este curso”.',
    'Revise aqui as aulas e confirme para adicionar à biblioteca.',
  ]);
  const store = guide.getByRole('link', { name: isMobile ? 'Ver extensão na loja' : 'Instalar a extensão' });
  await expect(store).toHaveAttribute('href', EXTENSION_STORE_URL);
  await expect(store).toHaveAttribute('target', '_blank');
  await expect(guide).toContainText(isMobile ? 'usando a mesma conta do Lume' : 'confirme a instalação no navegador');
  await expect(dialog.locator('input, textarea, form')).toHaveCount(0);
  await expect(dialog).not.toContainText(/colar a grade|colar a página|analisar link|detectar e adicionar/i);
  expect(await dialog.evaluate(node => {
    const rect = node.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= innerWidth && node.scrollWidth <= node.clientWidth;
  })).toBe(true);
  await expect(guide.getByRole('status')).toHaveCount(0);
  await page.screenshot({ path: `data/import-extension-guide-${testInfo.project.name}.png`, fullPage: true });
});
