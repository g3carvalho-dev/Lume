import { test, expect } from '@playwright/test';
import { seedAccount, readAccount } from './library-helpers.js';

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
