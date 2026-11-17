import { test, expect } from '@playwright/test';
import { seedAccount, readAccount, E2E_ORIGIN } from './library-helpers.js';

test('perfil processa foto, salva apresentação e remove a imagem na conta', async ({ page }) => {
  await seedAccount(page);
  await page.goto('/#perfil');
  await page.getByRole('button', { name: 'Editar perfil', exact: true }).click();
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 8;
    canvas.getContext('2d').fillRect(0, 0, 8, 8);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByLabel('Selecionar foto de perfil do computador', { exact: true }).setInputFiles({
    name: 'avatar.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64'),
  });
  await expect(page.getByRole('button', { name: 'Remover foto', exact: true })).toBeVisible();
  const uploaded = await readAccount(page);
  expect(uploaded.profile.avatar).toMatch(/^\/api\/media\/profiles\//);
  expect((await page.request.get(uploaded.profile.avatar)).ok()).toBe(true);
  await page.getByLabel('Apresentação e metas').fill('Estudando arquitetura');
  await page.getByRole('button', { name: 'Salvar apresentação', exact: true }).click();
  expect((await readAccount(page)).profile.bio).toBe('Estudando arquitetura');
  await page.reload();
  await expect(page.getByText('Estudando arquitetura', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Editar perfil', exact: true }).click();
  const deletion = page.waitForResponse((response) => response.request().method() === 'DELETE' && response.url().endsWith('/api/profile/media/avatar'));
  await page.getByRole('button', { name: 'Remover foto', exact: true }).click();
  expect((await deletion).ok()).toBe(true);
  expect((await readAccount(page)).profile.avatar).toBe('');
  await page.reload();
  await page.getByRole('button', { name: 'Editar perfil', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remover foto', exact: true })).toHaveCount(0);
});

test('capa: arrastar reposiciona a imagem, o zoom salva e offline mostra o selo', async ({ page, context }) => {
  await seedAccount(page);
  await page.goto('/#perfil');
  await page.getByRole('button', { name: 'Editar perfil', exact: true }).click();
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 800; canvas.height = 800;
    canvas.getContext('2d').fillRect(0, 0, 800, 800);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByLabel('Selecionar imagem de capa (header) do computador', { exact: true }).setInputFiles({
    name: 'capa.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64'),
  });
  await expect.poll(async () => (await readAccount(page)).profile.header).toMatch(/^\/api\/media\/profiles\//);
  const banner = page.locator('.profile-x-banner');
  await expect(page.locator('.profile-x-banner-img')).toBeVisible();
  await page.waitForFunction(() => document.querySelector('.profile-x-banner-img')?.naturalWidth > 0);
  await banner.scrollIntoViewIfNeeded();
  const box = await banner.boundingBox();
  await page.mouse.move(box.x + 200, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 160, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await readAccount(page)).profile.headerY).toBeLessThan(50);
  await page.getByLabel('Zoom').fill('2');
  await page.getByLabel('Zoom').dispatchEvent('keyup');
  await expect.poll(async () => (await readAccount(page)).profile.headerZoom).toBe(2);
  await expect(page.locator('.profile-x-live')).toContainText(/Online|Estudando/);
  await context.setOffline(true);
  await expect(page.locator('.profile-x-live')).toHaveText('Offline');
  await context.setOffline(false);
});

test('perfil em duas colunas: publicar, fixar e privacidade por seção vista por quem não é amigo', { tag: '@celular' }, async ({ page, browser }) => {
  await seedAccount(page);
  const me = await (await page.request.get('/api/me', { headers: { origin: E2E_ORIGIN } })).json();
  await page.goto('/#perfil');
  await expect(page.getByRole('region', { name: 'Nível', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Conquistas', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Amigos', exact: true })).toBeVisible();

  // Publicar pelo compositor do perfil e fixar.
  await page.getByRole('tab', { name: /^Publicações/ }).click();
  await expect(page.getByText('Aparece no Feed e no seu perfil só para seus amigos.')).toBeVisible();
  for (const text of ['Primeira publicação do perfil', 'Segunda publicação do perfil']) {
    await page.getByLabel('Sua publicação').fill(text);
    await page.getByRole('button', { name: 'Publicar', exact: true }).click();
    await expect(page.locator('.profile-posts .social-post-body', { hasText: text })).toBeVisible();
  }
  const first = page.locator('.profile-posts .social-post', { hasText: 'Primeira publicação do perfil' });
  await first.getByRole('button', { name: 'Mais ações da publicação' }).click();
  await first.getByRole('menuitem', { name: 'Fixar no perfil' }).click();
  const pinned = page.locator('.profile-pinned .social-post');
  await expect(pinned).toContainText('Primeira publicação do perfil');
  await expect(pinned).toContainText('Fixada');
  await page.getByRole('tab', { name: /^Atividade/ }).click();
  await expect(pinned).toContainText('Primeira publicação do perfil');

  // Privacidade: o botão leva às Configurações; publicações a todos, atividade só para a pessoa.
  await page.getByRole('button', { name: 'Privacidade', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Social e privacidade' })).toBeVisible();
  const row = (label) => page.locator('.cfg-privacy-row', { hasText: label }).locator('select');
  await row('Publicações').selectOption('all');
  await row('Atividade').selectOption('self');
  await expect(page.getByText('Só você vê os materiais que você estuda, o tempo registrado e o progresso.')).toBeVisible();
  await expect.poll(async () => (await readAccount(page)).preferences.privacy).toMatchObject({ mode: 'open', posts: 'all', activity: 'self' });

  // Quem tem conta e não é amiga: lê as publicações, sem reagir; atividade com aviso.
  const context = await browser.newContext({ baseURL: E2E_ORIGIN, extraHTTPHeaders: { origin: E2E_ORIGIN }, viewport: page.viewportSize() });
  try {
    const visitor = await context.newPage();
    await seedAccount(visitor);
    await visitor.goto(`/#perfil?id=${encodeURIComponent(me.user.id)}`);
    await expect(visitor.getByText('Pessoa não mostra a atividade de estudo para você.')).toBeVisible();
    await expect(visitor.locator('.profile-pinned .social-post')).toContainText('Primeira publicação do perfil');
    await expect(visitor.locator('.profile-pinned').getByText('Só amigos reagem e comentam.')).toBeVisible();
    await expect(visitor.locator('.profile-pinned').getByRole('button', { name: /^Reagir/ })).toHaveCount(0);
    await visitor.getByRole('tab', { name: /^Publicações/ }).click();
    await expect(visitor.locator('.profile-posts .social-post-body', { hasText: 'Segunda publicação do perfil' })).toBeVisible();
    await expect(visitor.getByLabel('Sua publicação')).toHaveCount(0);
    // O Feed continua só entre amigos.
    expect((await (await visitor.request.get('/api/social/feed')).json()).posts).toHaveLength(0);
    // Nenhuma tela passa da largura do celular.
    const width = await visitor.evaluate(() => {
      const main = document.querySelector('#main');
      return { scroll: main.scrollWidth, client: main.clientWidth };
    });
    expect(width.scroll).toBeLessThanOrEqual(width.client);
  } finally { await context.close(); }
});
