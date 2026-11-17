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

test('revisão da extensão mostra módulos reais, seleção e histórico no computador e celular', { tag: '@celular' }, async ({ page, isMobile }, testInfo) => {
  if (!isMobile) await page.setViewportSize({ width: 1280, height: 1200 });
  await openLibrary(page);
  const lesson = (title, completed = false) => ({ title, completed });
  await captureCourse(page, {
    title: 'Astronomia observacional — fundamentos e prática',
    sourceUrl: 'https://www.udemy.com/course/astronomia-observacional',
    provider: { id: 'udemy' },
    completionSource: 'lesson-flags',
    warnings: ['A página pode carregar mais aulas ao expandir os módulos.'],
    disciplines: [{ title: 'Conteúdo do curso', modules: [
      { title: 'Observação inicial', lessons: [lesson('O céu a olho nu', true), lesson('Escolhendo o equipamento', true), lesson('Organizando a primeira observação')] },
      { title: 'Mapas celestes e localização dos objetos', lessons: [lesson('Lendo um mapa celeste'), lesson('Encontrando as constelações')] },
      { title: 'Registro das observações', lessons: [lesson('O diário de observação')] },
    ] }],
  });
  const dialog = page.getByRole('dialog');
  const selection = dialog.getByRole('region', { name: 'Seleção de conteúdo' });
  const status = dialog.getByRole('status');
  await expect(dialog.getByText('Udemy · Lido pela extensão', { exact: true })).toBeVisible();
  await expect(selection.getByText('3 módulos · 6 aulas')).toBeVisible();
  await expect(dialog.locator('.import-review-module')).toHaveCount(3);
  await expect(dialog.locator('.import-review-group-heading')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: /Observação inicial/ })).toHaveAttribute('aria-expanded', 'true');
  await expect(dialog.getByRole('button', { name: /Mapas celestes/ })).toHaveAttribute('aria-expanded', 'false');
  await expect(dialog.locator('.import-review-history-badge')).toHaveText(['Histórico', 'Histórico']);
  await expect(dialog.locator('.import-review-history')).toHaveText('2 aulas concluídas na fonte entram como histórico, sem XP.');

  // Entender explica a leitura parcial, sem acrescentar outra caixa de avisos.
  await expect(dialog.getByText('A página pode carregar mais aulas ao expandir os módulos.')).toBeHidden();
  await dialog.getByText('Entender', { exact: true }).click();
  await expect(dialog.getByText('A página pode carregar mais aulas ao expandir os módulos.')).toBeVisible();
  await dialog.getByText('Entender', { exact: true }).click();

  // Módulos preservam a seleção ao fechar e abrir; teclado também altera a aula.
  await dialog.getByRole('button', { name: /Mapas celestes/ }).click();
  const mapLesson = dialog.getByRole('checkbox', { name: 'Incluir a aula Lendo um mapa celeste' });
  await mapLesson.focus();
  await page.keyboard.press('Space');
  await expect(dialog.getByRole('checkbox', { name: 'Selecionar o módulo Mapas celestes e localização dos objetos' })).toHaveAttribute('aria-checked', 'mixed');
  await expect(status).toHaveText('5 de 6 aulas selecionadas');
  await dialog.getByRole('button', { name: /Mapas celestes/ }).click();
  await dialog.getByRole('button', { name: /Mapas celestes/ }).click();
  await expect(mapLesson).not.toBeChecked();

  await dialog.getByRole('button', { name: 'Limpar seleção' }).click();
  await expect(status).toHaveText('0 de 6 aulas selecionadas');
  await expect(dialog.getByRole('button', { name: 'Adicionar 0 aulas à biblioteca' })).toBeDisabled();
  await expect(dialog.locator('.import-review-history')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Selecionar todas' }).click();
  await expect(status).toHaveText('6 de 6 aulas selecionadas');
  await dialog.getByRole('checkbox', { name: 'Incluir a aula Organizando a primeira observação' }).click();
  await dialog.getByRole('button', { name: /Mapas celestes/ }).click();
  await expect(status).toHaveText('5 de 6 aulas selecionadas');
  await expect(dialog).not.toContainText(/analisar outro link|Técnico em Manutenção|Primeiros passos/);
  expect(await dialog.evaluate(node => {
    const rect = node.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= innerWidth && node.scrollWidth <= node.clientWidth;
  })).toBe(true);
  await dialog.evaluate(node => { node.scrollTop = 0; });
  await page.screenshot({ path: `data/import-review-${testInfo.project.name}.png`, fullPage: true });

  const confirm = dialog.getByRole('button', { name: 'Adicionar 5 aulas à biblioteca' });
  await confirm.scrollIntoViewIfNeeded();
  if (isMobile) await page.screenshot({ path: 'data/import-review-mobile-footer.png' });
  await confirm.click();
  await expect(page.getByText('Importação concluída')).toBeVisible();
  const saved = await readAccount(page);
  expect(materialSteps(saved.courses[0])).toHaveLength(5);
  expect(saved.progress).toHaveLength(2);
  expect(saved.progress.every(event => event.origin === 'import' && event.historical)).toBe(true);
});
