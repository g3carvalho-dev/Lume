import { test, expect } from '@playwright/test';
import { REPORT_DETAILS_LIMIT, REPORT_REASONS } from '../../public/report-domain.js';
import { E2E_ORIGIN, seedAccount } from './library-helpers.js';

test('denúncia de publicação usa o autor real, preserva escolhas na falha e só envia ao confirmar', { tag: '@celular' }, async ({ page, browser, isMobile }, testInfo) => {
  if (!isMobile) await page.setViewportSize({ width: 1280, height: 1050 });
  await seedAccount(page);
  const other = await browser.newContext({ baseURL: E2E_ORIGIN, extraHTTPHeaders: { origin: E2E_ORIGIN } });
  try {
    const registered = await other.request.post('/api/register', { data: {
      name: 'Marina de teste', email: `report-${crypto.randomUUID()}@example.test`, password: 'senha-de-teste-123',
    } });
    expect(registered.status()).toBe(201);
    const target = (await (await other.request.get('/api/me')).json()).user;
    const invite = await (await page.request.post('/api/friends/invite', { headers: { origin: E2E_ORIGIN } })).json();
    expect((await other.request.post('/api/friends/accept', { data: { code: invite.code } })).ok()).toBe(true);
    const postId = crypto.randomUUID();
    expect((await other.request.post('/api/social/posts', { data: { id: postId, body: 'Publicação para conferir a denúncia.' } })).status()).toBe(201);
    await page.goto('/#amigos');
    const post = page.getByRole('article').filter({ hasText: 'Publicação para conferir a denúncia.' });
    async function openReport() {
      await post.getByRole('button', { name: 'Mais ações da publicação' }).click();
      await post.getByRole('menuitem', { name: 'Denunciar publicação' }).click();
    }
    const requests = [];
    page.on('request', request => {
      if (new URL(request.url()).pathname === '/api/reports' && request.method() === 'POST') requests.push(request.postDataJSON());
    });
    await openReport();
    const dialog = page.getByRole('dialog', { name: 'Denunciar publicação', exact: true });
    await expect(dialog.getByText(`Publicação de ${target.name}`, { exact: true })).toBeVisible();
    await expect(dialog.getByRole('group', { name: 'Qual é o motivo?' }).getByRole('radio')).toHaveCount(6);
    for (const label of Object.values(REPORT_REASONS)) await expect(dialog.getByRole('radio', { name: label, exact: true })).not.toBeChecked();
    const details = dialog.getByRole('textbox', { name: /^Detalhes/ });
    await expect(details).toHaveAttribute('maxlength', String(REPORT_DETAILS_LIMIT));
    const copy = dialog.getByRole('checkbox', { name: 'Enviar uma cópia do texto da publicação' });
    await expect(copy).toBeChecked();
    await expect(dialog.getByText('Só a equipe do Lume recebe a denúncia. A pessoa denunciada não será avisada nem verá quem enviou.')).toBeVisible();
    await expect(dialog.getByRole('checkbox', { name: /^Bloquear/ })).toHaveCount(0);
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth && node.getBoundingClientRect().right <= innerWidth)).toBe(true);
    await expect(dialog.locator(':scope > div')).toHaveCSS('opacity', '1');
    await dialog.screenshot({ path: `data/report-post-${testInfo.project.name}.png` });
    if (!isMobile) {
      const theme = await page.locator('html').getAttribute('data-theme');
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
      await dialog.screenshot({ path: 'data/report-post-light.png' });
      await page.evaluate(previous => document.documentElement.setAttribute('data-theme', previous || 'dark'), theme);
    } else {
      await dialog.getByRole('button', { name: 'Enviar denúncia' }).scrollIntoViewIfNeeded();
      await dialog.screenshot({ path: 'data/report-post-mobile-footer.png' });
    }
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(requests).toHaveLength(0);

    await openReport();
    await dialog.getByRole('button', { name: 'Enviar denúncia' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Escolha o motivo da denúncia.');
    expect(requests).toHaveLength(0);
    const spam = dialog.getByRole('radio', { name: 'Spam ou propaganda', exact: true });
    await spam.focus();
    await page.keyboard.press('Space');
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await details.fill('O texto contém propaganda sem relação com estudos.');
    if (isMobile) await copy.uncheck();
    await page.route('**/api/reports', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Envio indisponível no teste.' }) }), { times: 1 });
    await dialog.getByRole('button', { name: 'Enviar denúncia' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Envio indisponível no teste.');
    await expect(spam).toBeChecked();
    await expect(details).toHaveValue('O texto contém propaganda sem relação com estudos.');
    await expect(copy).toBeChecked({ checked: !isMobile });
    await dialog.getByRole('button', { name: 'Enviar denúncia' }).click();
    await expect(dialog).toHaveCount(0);
    expect(requests).toHaveLength(2);
    expect(requests.at(-1)).toMatchObject({ context: 'post', targetId: target.id, subjectId: postId, reason: 'spam', includeContext: !isMobile, details: 'O texto contém propaganda sem relação com estudos.' });
    expect((await page.request.get('/api/reports', { headers: { origin: E2E_ORIGIN } })).status()).toBe(403);
    expect((await other.request.get('/api/reports')).status()).toBe(403);
    await expect(post).toBeVisible();
  } finally { await other.close(); }
});
