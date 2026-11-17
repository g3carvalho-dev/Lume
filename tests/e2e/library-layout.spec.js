import { test, expect } from '@playwright/test';
import { addCourse, completeMission, createInitialState } from '../../public/domain.js';
import { applyCourseImport, normalizePayload } from '../../public/import-domain.js';
import { addPdfMaterial, setReadingPage } from '../../public/pdf-domain.js';
import { addSubject, linkMaterialSubject } from '../../public/subject-domain.js';
import { libraryActions } from '../../public/library-actions.js';
import { penalPdf } from '../fixtures/sample-pdf.js';
import { E2E_ORIGIN, seedAccount, readAccount } from './library-helpers.js';

async function mixedLibrary(page) {
  let state = addSubject({ ...createInitialState(), onboarded: true }, { title: 'Física aplicada' }, 'physics');
  state = applyCourseImport(state, normalizePayload({
    title: 'Eletricidade — circuitos e medições', provider: { id: 'udemy' },
    sourceUrl: 'https://www.udemy.com/course/circuitos-e-medicoes', completeness: 'partial',
    extraction: { kind: 'extension-capture', confidence: 'medium', notes: [] }, completionSource: 'lesson-flags',
    disciplines: [{ title: 'Eletricidade', modules: [{ title: 'Circuitos', lessons: [
      { title: 'Grandezas elétricas', completed: true }, { title: 'Corrente e tensão' }, { title: 'Medições com multímetro' },
    ] }] }],
  }));
  const courseId = state.courses[0].id;
  state = linkMaterialSubject(state, courseId, 'physics');
  state = { ...state, courses: state.courses.map(course => ({ ...course, slides: [{ id: 'slide-1', title: 'Circuitos', body: 'Anotações da aula.' }] })) };
  state = addCourse(state, { title: 'Introdução à metrologia', steps: ['Leitura de instrumentos'] }, 'finished');
  state = completeMission(state, 'finished', 'finished-0').state;
  state.selectedCourseId = courseId;
  await seedAccount(page, state);
  const loaded = await page.request.get('/api/library', { headers: { origin: E2E_ORIGIN } });
  const current = await loaded.json();
  state = current.state;
  // Os PDFs usam arquivos reais no servidor de testes, sem binário no estado.
  for (const [index, title] of ['Apostila de exercícios', 'Guia de fórmulas'].entries()) {
    const fileId = crypto.randomUUID();
    const bytes = penalPdf();
    const upload = await page.request.put(`/api/library/files/${fileId}`, {
      headers: { origin: E2E_ORIGIN, 'content-type': 'application/pdf', 'x-file-name': `apostila-${index}.pdf` }, data: bytes,
    });
    expect(upload.status()).toBe(201);
    state = addPdfMaterial(state, { title, file: { fileId, name: `apostila-${index}.pdf`, size: bytes.length, pages: 6, outline: [] }, subjectId: 'physics' }, `pdf-${index}`);
    if (index === 1) state = setReadingPage(state, 'pdf-1', { page: 3, section: 'Seção completa disponível no leitor' });
  }
  state.selectedCourseId = courseId;
  const saved = await page.request.post('/api/library/actions', {
    headers: { origin: E2E_ORIGIN }, data: { id: crypto.randomUUID(), revision: current.revision, actions: libraryActions(current.state, state) },
  });
  expect(saved.ok()).toBe(true);
}

test('Biblioteca mantém retomada, cartões essenciais, PDFs e concluídos no computador e celular', { tag: '@celular' }, async ({ page, isMobile }, testInfo) => {
  if (!isMobile) await page.setViewportSize({ width: 1440, height: 1050 });
  await mixedLibrary(page);
  await page.goto('/#biblioteca');
  const main = page.locator('#main');
  const resume = main.locator('.library-resume');
  const courses = main.getByRole('region', { name: 'Cursos e trilhas' });
  const readings = main.getByRole('region', { name: 'Materiais e leituras' });
  await expect(resume).toContainText('Próximo passo: Corrente e tensão');
  await expect(resume.getByRole('button', { name: 'Continuar meu próximo passo' })).toHaveText('Continuar');
  await expect(resume.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '33');
  await expect(resume.locator('button')).toHaveCount(2);
  await expect(main).not.toContainText(/Lido pela extensão|áreas selecionadas|grade parcial|1 slides|Abrir apresentação/i);
  const card = courses.getByRole('button', { name: /^Eletricidade/ });
  await expect(card.getByRole('heading')).toHaveText('Eletricidade — circuitos e medições');
  await expect(card).toContainText('Em andamento');
  await expect(card).toContainText('33%');
  await expect(card).toContainText('Acessar');
  await expect(readings.getByRole('button', { name: /^Apostila de exercícios/ })).toContainText('6 páginas · não iniciado · Física aplicada');
  await expect(readings.getByRole('button', { name: /^Guia de fórmulas/ })).toContainText('p. 3 de 6 · Física aplicada');
  if (isMobile) {
    expect(await readings.locator('.reading-row').evaluateAll(rows => rows.every(row => {
      const copy = row.querySelector('.reading-copy').getBoundingClientRect();
      const arrow = row.querySelector('.reading-chevron').getBoundingClientRect();
      return arrow.left >= copy.right && arrow.top >= copy.top && arrow.bottom <= copy.bottom;
    }))).toBe(true);
  }
  await expect(main.getByText('Introdução à metrologia', { exact: true })).toHaveCount(0);
  const finished = main.getByRole('button', { name: /Concluídos/ });
  await expect(finished).toHaveAttribute('aria-expanded', 'false');
  expect(await main.evaluate(node => node.scrollWidth <= node.clientWidth && node.getBoundingClientRect().right <= innerWidth)).toBe(true);
  await page.screenshot({ path: `data/library-essential-${testInfo.project.name}.png`, fullPage: true });

  // Os detalhes retirados da listagem continuam acessíveis pelo material.
  await card.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Grade parcial', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Abrir apresentação (1)' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Fechar janela' }).click();
  await resume.getByRole('button', { name: 'Continuar meu próximo passo' }).click();
  await expect(dialog.getByRole('heading', { name: 'Corrente e tensão' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Fechar janela' }).click();
  await finished.click();
  await expect(main.getByRole('button', { name: /^Introdução à metrologia,/ })).toBeVisible();
  await main.getByRole('searchbox').fill('Guia de fórmulas');
  await expect(main.getByRole('status')).toHaveText('1 material encontrado');
  await expect(readings.locator('.reading-row')).toHaveCount(1);
  await readings.getByRole('button', { name: /^Guia de fórmulas/ }).click();
  await dialog.getByRole('button', { name: 'Continuar na p. 3' }).click();
  await expect(dialog.getByLabel('Página atual')).toHaveValue('3');
  const saved = await readAccount(page);
  expect(saved.courses).toHaveLength(4);
  expect(saved.progress).toHaveLength(2);
});
