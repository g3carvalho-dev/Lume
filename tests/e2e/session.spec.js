import { test, expect } from '@playwright/test';
import { stepUnits } from '../../public/material-model.js';
import { seedAccount, readAccount } from './library-helpers.js';
import { createInitialState } from '../../public/domain.js';

// Sessão declarada pelo timer do cabeçalho: relógio de continuidade iniciado
// pela pessoa. O servidor confirma blocos de 25 minutos; a sessão não comprova
// estudo. A tela de Foco deixou de existir e `#foco` abre o Início.

function seeded() {
  const state = createInitialState();
  state.onboarded = true;
  state.courses = [{ id: 'design', title: 'Design de interfaces', category: 'Design', art: 'design', url: '', example: false, paused: false, units: stepUnits([{ id: 'design-1', title: 'Abrir o material e conhecer o curso' }]) }];
  state.selectedCourseId = 'design';
  return state;
}

test('timer do cabeçalho inicia, persiste ao recarregar, pausa, retoma e encerra sem conceder XP local', async ({ page }) => {
  await seedAccount(page, seeded());
  await page.goto('/#foco');
  await expect(page.getByRole('heading', { name: 'Início', exact: true })).toBeAttached();
  await expect(page.getByRole('navigation', { name: 'Navegação' }).getByRole('link')).toHaveCount(4);

  await page.getByRole('button', { name: 'Timer de estudo', exact: true }).click();
  const panel = page.locator('#timer-popover');
  await expect(panel.getByLabel('Material da sessão')).toHaveValue('design');
  await panel.getByRole('button', { name: '15 min' }).click();
  await panel.getByRole('button', { name: 'Iniciar' }).click();
  await expect(panel.getByRole('timer')).toBeVisible();
  await expect(panel.getByText('Abrir o material e conhecer o curso')).toBeVisible();
  await expect(page.locator('.header-timer.is-running')).toBeVisible();

  // Recarregar não perde a sessão em andamento.
  await page.reload();
  await expect(page.locator('.header-timer.is-running')).toBeVisible();

  await page.locator('.header-timer').click();
  await panel.getByRole('button', { name: 'Pausar' }).click();
  await expect(page.locator('.header-timer.is-paused')).toBeVisible();
  await panel.getByRole('button', { name: 'Retomar' }).click();
  await expect(page.locator('.header-timer.is-running')).toBeVisible();
  await panel.getByRole('button', { name: 'Encerrar' }).click();
  await expect(page.getByText(/Sessão registrada:/)).toBeVisible();
  await expect(page.locator('.header-timer.is-idle')).toBeVisible();

  const state = await readAccount(page);
  expect(state.studySessions).toHaveLength(1);
  expect(state.studySessions[0].origin).toBe('focus');
  expect(state.studySessions[0].label).toBe('Abrir o material e conhecer o curso');
  expect(state.activeSession).toBeNull();
  expect(state.progress).toHaveLength(0);
});

test('o timer pode ser desligado em Configurações › Ritmo de estudo', async ({ page }) => {
  await seedAccount(page, seeded());
  await page.goto('/#configuracoes?secao=ritmo');
  await expect(page.getByRole('button', { name: 'Timer de estudo', exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Mostrar o timer de estudo' }).uncheck();
  await expect(page.getByRole('button', { name: 'Timer de estudo', exact: true })).toHaveCount(0);
  expect((await readAccount(page)).preferences.focusTimer).toBe(false);

  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'Mostrar o timer de estudo' })).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Timer de estudo', exact: true })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Mostrar o timer de estudo' }).check();
  await expect(page.getByRole('button', { name: 'Timer de estudo', exact: true })).toBeVisible();
});

test('no celular o timer começa pelo menu da conta e fica num botão flutuante', { tag: '@celular' }, async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Só no celular o timer sai do cabeçalho.');
  await seedAccount(page, seeded());
  await page.goto('/#hoje');
  await expect(page.locator('.header-timer')).toBeHidden();
  await expect(page.locator('.timer-fab')).toHaveCount(0);
  await page.getByRole('button', { name: /^Menu da conta/ }).click();
  await page.getByLabel('Opções do usuário').getByRole('button', { name: 'Timer de estudo' }).click();
  const panel = page.locator('#timer-popover');
  await panel.getByRole('button', { name: 'Iniciar' }).click();
  await page.keyboard.press('Escape');
  const fab = page.locator('.timer-fab');
  await expect(fab).toBeVisible();
  expect(await page.evaluate(() => document.querySelector('#main').scrollWidth <= window.innerWidth + 1)).toBe(true);
  await fab.click();
  await panel.getByRole('button', { name: 'Encerrar' }).click();
  await expect(fab).toHaveCount(0);
});
