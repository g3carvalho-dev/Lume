import { test, expect } from '@playwright/test';

const PASSWORD = 'senha-local-teste-123';
// Definido em playwright.config.js (LUME_CREATOR_EMAIL do servidor de teste).
const CREATOR_EMAIL = 'criadora-e2e@example.test';

async function signUp(request, baseURL, name, email = `grp-${crypto.randomUUID()}@example.test`) {
  const response = await request.post('/api/register', { data: { name, email, password: PASSWORD }, headers: { origin: baseURL } });
  expect(response.status()).toBe(201);
  const current = await request.get('/api/library', { headers: { origin: baseURL } });
  const revision = current.ok() ? (await current.json()).revision : 0;
  const saved = await request.post('/api/library/actions', {
    data: { id: crypto.randomUUID(), revision, actions: [{ type: 'account.update', value: { onboarded: true } }] },
    headers: { origin: baseURL },
  });
  expect(saved.status()).toBe(200);
  return (await (await request.get('/api/me')).json()).user;
}

async function befriend(owner, guest, baseURL) {
  const invite = await owner.post('/api/friends/invite', { data: {}, headers: { origin: baseURL } });
  const { code } = await invite.json();
  expect((await guest.post('/api/friends/accept', { data: { code }, headers: { origin: baseURL } })).status()).toBe(200);
}

test('grupo entre amigos, denúncia enviada à criadora e acesso restrito', async ({ page, browser }, testInfo) => {
  test.slow();
  const baseURL = testInfo.project.use.baseURL;
  await signUp(page.request, baseURL, 'Ana Grupo');

  const biaContext = await browser.newContext({ baseURL });
  const biaPage = await biaContext.newPage();
  await signUp(biaPage.request, baseURL, 'Bia Grupo');
  const carlaContext = await browser.newContext({ baseURL });
  const carlaPage = await carlaContext.newPage();
  await signUp(carlaPage.request, baseURL, 'Carla Grupo');
  await befriend(page.request, biaPage.request, baseURL);
  await befriend(page.request, carlaPage.request, baseURL);

  // Ana cria o grupo: exige nome e pelo menos duas pessoas.
  await page.goto('/#hoje');
  await page.getByRole('button', { name: /Abrir mensagens/ }).click();
  await page.getByRole('button', { name: 'Nova conversa ou grupo' }).click();
  await page.getByRole('tab', { name: 'Novo grupo' }).click();
  const create = page.getByRole('button', { name: 'Criar grupo' });
  await expect(create).toBeDisabled();
  await page.getByLabel('Nome do grupo').fill('Turma de Direito');
  await page.getByRole('checkbox').first().check();
  await expect(create).toBeDisabled();
  await page.getByRole('checkbox').nth(1).check();
  await create.click();
  await expect(page.locator('.message-thread-head')).toContainText('Turma de Direito');
  await expect(page.getByRole('region', { name: 'Conversa selecionada' }).getByText('Ana Grupo criou o grupo.')).toBeVisible();
  await page.getByLabel('Mensagem', { exact: true }).fill('Bom dia, turma!');
  await page.getByRole('button', { name: 'Enviar' }).click();
  await expect(page.getByRole('region', { name: 'Conversa selecionada' }).getByText('Bom dia, turma!')).toBeVisible();

  await page.screenshot({ path: testInfo.outputPath('grupo.png') });

  // Bia vê o grupo com a mensagem não lida, abre e responde.
  await biaPage.goto('/#hoje');
  await biaPage.getByRole('button', { name: /Abrir mensagens/ }).click();
  const entry = biaPage.getByRole('button', { name: /Turma de Direito/ });
  await expect(entry).toContainText('Ana: Bom dia, turma!');
  await entry.click();
  await expect(biaPage.getByRole('region', { name: 'Conversa selecionada' }).getByText('Bom dia, turma!')).toBeVisible();
  await biaPage.getByLabel('Mensagem', { exact: true }).fill('Bom dia!');
  await biaPage.getByRole('button', { name: 'Enviar' }).click();
  await expect(biaPage.getByRole('region', { name: 'Conversa selecionada' }).getByText('Bom dia!')).toBeVisible();

  // Bia denuncia a mensagem de Ana, sem bloqueá-la.
  await biaPage.getByRole('button', { name: 'Denunciar mensagem de Ana Grupo' }).click();
  await expect(biaPage.getByRole('heading', { name: 'Denunciar Ana Grupo' })).toBeVisible();
  await biaPage.getByRole('button', { name: 'Enviar denúncia' }).click();
  await expect(biaPage.getByText('Escolha o motivo da denúncia.')).toBeVisible();
  await biaPage.getByLabel('Spam ou propaganda').check();
  await biaPage.getByLabel('Detalhes (opcional)').fill('Mensagem repetida em vários grupos.');
  await biaPage.getByRole('button', { name: 'Enviar denúncia' }).click();
  await expect(biaPage.getByRole('heading', { name: 'Denunciar Ana Grupo' })).toHaveCount(0);

  // Carla denuncia Ana na conversa direta e bloqueia ao mesmo tempo.
  await carlaPage.goto('/#hoje');
  await carlaPage.getByRole('button', { name: /Abrir mensagens/ }).click();
  await carlaPage.locator('.messages-dock-panel').getByRole('button', { name: /Ana Grupo/ }).first().click();
  await carlaPage.getByRole('button', { name: 'Detalhes da conversa' }).click();
  await carlaPage.getByRole('button', { name: /^Denunciar/ }).click();
  await carlaPage.getByLabel('Assédio, ameaça ou ofensa').check();
  await carlaPage.getByLabel('Bloquear Ana Grupo também').check();
  await carlaPage.getByRole('button', { name: 'Enviar denúncia' }).click();
  await expect(carlaPage.getByText('Desbloqueie para voltar a enviar mensagens.')).toBeVisible();

  // Quem não é a criadora não lê denúncias nem abre a tela.
  expect((await biaPage.request.get('/api/reports', { headers: { origin: baseURL } })).status()).toBe(403);
  await biaPage.goto('/#denuncias');
  await expect(biaPage.getByText('Acesso restrito.')).toBeVisible();

  // A criadora vê as duas denúncias com a cópia do conteúdo e pode analisá-las.
  const creatorContext = await browser.newContext({ baseURL });
  const creatorPage = await creatorContext.newPage();
  await signUp(creatorPage.request, baseURL, 'Criadora Lume', CREATOR_EMAIL);
  await creatorPage.goto('/#denuncias');
  await expect(creatorPage.getByRole('heading', { name: 'Denúncias', exact: true })).toBeVisible();
  const ownReports = creatorPage.locator('.report-card').filter({ hasText: 'Denunciada: Ana Grupo' });
  const spam = ownReports.filter({ hasText: 'Spam ou propaganda' });
  await expect(spam).toContainText('Denunciada: Ana Grupo');
  await expect(spam).toContainText('Mensagem repetida em vários grupos.');
  await expect(spam.getByLabel('Cópia do conteúdo')).toContainText('Bom dia, turma!');
  await expect(ownReports).toHaveCount(2);
  await spam.getByRole('button', { name: 'Marcar como analisada' }).click();
  await expect(ownReports).toHaveCount(1);
  await creatorPage.getByRole('button', { name: /^Analisada/ }).click();
  await expect(spam).toBeVisible();

  // Ana sai do grupo como dona: a pessoa mais antiga que ficou assume.
  await page.getByRole('button', { name: /Turma de Direito/ }).first().click();
  // Gestão no painel de detalhes: renomear no próprio lugar e depois sair.
  await page.getByRole('button', { name: 'Detalhes do grupo', exact: true }).click();
  await page.getByRole('button', { name: 'Renomear grupo Turma de Direito' }).click();
  await page.getByLabel('Nome do grupo').fill('Direito Civil');
  await page.getByRole('button', { name: 'Salvar nome' }).click();
  await expect(page.getByRole('region', { name: 'Conversa selecionada' }).getByText('Ana Grupo mudou o nome do grupo para “Direito Civil”.')).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: /^Sair do grupo/ }).click();
  await expect(page.getByText('Escolha uma conversa')).toBeVisible();
  await biaPage.reload();
  await biaPage.getByRole('button', { name: /Abrir mensagens/ }).click();
  await biaPage.getByRole('button', { name: /Direito Civil/ }).click();
  await expect(biaPage.getByRole('region', { name: 'Conversa selecionada' }).getByText('Ana Grupo saiu do grupo.')).toBeVisible();

  await Promise.all([biaContext.close(), carlaContext.close(), creatorContext.close()]);
});
