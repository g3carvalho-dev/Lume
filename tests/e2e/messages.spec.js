import { test, expect } from '@playwright/test';
import { createInitialState } from '../../public/domain.js';

const PASSWORD = 'senha-local-teste-123';

async function register(requestContext, baseURL, name, prefix) {
  const email = `${prefix}-${crypto.randomUUID()}@example.test`;
  const response = await requestContext.post('/api/register', {
    data: { name, email, password: PASSWORD },
    headers: { origin: baseURL },
  });
  expect(response.status()).toBe(201);
  return email;
}

async function markOnboarded(requestContext, baseURL) {
  const current = await requestContext.get('/api/library', { headers: { origin: baseURL } });
  const revision = current.ok() ? (await current.json()).revision : 0;
  const saved = await requestContext.post('/api/library/actions', {
    data: { id: crypto.randomUUID(), revision, actions: [{ type: 'account.update', value: { onboarded: true } }] },
    headers: { origin: baseURL },
  });
  expect(saved.status()).toBe(200);
}

async function makeFriends(page, requestContext, baseURL, name, prefix) {
  await register(requestContext, baseURL, name, prefix);
  await markOnboarded(requestContext, baseURL);
  await page.goto('/#amigos');
  // O convite é criado na dock de Mensagens; aqui basta a rota.
  const invite = await page.request.post('/api/friends/invite', { data: {}, headers: { origin: baseURL } });
  expect(invite.status()).toBe(201);
  const code = (await invite.json()).code;
  expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  return code;
}

test('mensagem direta entre amizades, não lida, bloqueio e desbloqueio', { tag: '@celular' }, async ({ page, browser }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  const code = await makeFriends(page, page.request, baseURL, 'Ana Mensagens', 'msg-a');

  const guestContext = await browser.newContext({ baseURL });
  const guestPage = await guestContext.newPage();
  await register(guestPage.request, baseURL, 'Bia Mensagens', 'msg-b');
  await markOnboarded(guestPage.request, baseURL);
  const accepted = await guestPage.request.post('/api/friends/accept', {
    data: { code },
    headers: { origin: baseURL },
  });
  expect(accepted.status()).toBe(200);

  // Ana abre a conversa pela dock flutuante.
  await page.getByRole('button', { name: /Abrir mensagens/ }).click();
  await page.getByRole('button', { name: /Bia Mensagens/ }).click();
  await expect(page.locator('.messages-dock-panel')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Conversa selecionada' })).toBeVisible();
  await page.getByLabel('Mensagem', { exact: true }).fill('Oi, vamos revisar constitucional?');
  await page.getByRole('button', { name: 'Enviar' }).click();
  await expect(page.getByRole('region', { name: 'Conversa selecionada' }).getByText('Oi, vamos revisar constitucional?')).toBeVisible();

  // Bia vê a conversa e a mensagem não lida.
  await guestPage.goto('/#hoje');
  await guestPage.getByRole('button', { name: /Abrir mensagens/ }).click();
  await expect(guestPage.locator('.messages-dock-panel').getByText('Oi, vamos revisar constitucional?')).toBeVisible();
  await guestPage.locator('.messages-dock-panel').getByRole('button', { name: /Ana Mensagens/ }).first().click();
  await expect(guestPage.getByLabel('Mensagem', { exact: true })).toBeVisible();
  await expect(guestPage.getByRole('region', { name: 'Conversa selecionada' }).getByText('Oi, vamos revisar constitucional?')).toBeVisible();
  await guestPage.getByLabel('Mensagem', { exact: true }).fill('Vamos! Começo pelas questões.');
  await guestPage.getByRole('button', { name: 'Enviar' }).click();
  await expect(guestPage.getByRole('region', { name: 'Conversa selecionada' }).getByText('Vamos! Começo pelas questões.')).toBeVisible();

  // Ana recarrega e vê a resposta.
  await page.reload();
  await page.getByRole('button', { name: /Abrir mensagens/ }).click();
  await page.locator('.messages-dock-panel').getByRole('button', { name: /Bia Mensagens/ }).first().click();
  const thread = page.getByRole('region', { name: 'Conversa selecionada' });
  await expect(thread.getByText('Vamos! Começo pelas questões.')).toBeVisible();

  // Responder citando e reagir com um emoji da lista do Feed.
  await thread.locator('.message-row.from-them').getByRole('button', { name: 'Responder' }).click();
  await expect(page.getByText('Respondendo a Bia Mensagens')).toBeVisible();
  await page.getByLabel('Mensagem', { exact: true }).fill('Combinado.');
  await page.getByRole('button', { name: 'Enviar' }).click();
  await expect(thread.locator('.message-row.from-me .mg-quote').last()).toContainText('Vamos! Começo pelas questões.');
  await thread.locator('.message-row.from-them').getByRole('button', { name: 'Reagir' }).click();
  await page.getByRole('searchbox', { name: 'Buscar emoji' }).fill('joinha');
  await page.getByRole('button', { name: 'joinha curtir', exact: true }).click();
  await expect(thread.getByRole('button', { name: /^👍 1, você reagiu/ })).toBeVisible();

  // Silenciar pelo painel de detalhes.
  await page.getByRole('button', { name: 'Detalhes da conversa' }).click();
  const mute = page.getByRole('switch', { name: /Silenciar conversa/ });
  await mute.click();
  await expect(mute).toHaveAttribute('aria-checked', 'true');

  // Bloqueio interrompe a composição nos dois lados e preserva o histórico.
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: /^Bloquear/ }).click();
  await expect(page.getByText('Desbloqueie para voltar a enviar mensagens.')).toBeVisible();
  await expect(page.getByLabel('Mensagem', { exact: true })).toHaveCount(0);
  await guestPage.reload();
  await guestPage.getByRole('button', { name: /Abrir mensagens/ }).click();
  await guestPage.locator('.messages-dock-panel').getByRole('button', { name: /Ana Mensagens/ }).first().click();
  await expect(guestPage.getByText('Esta pessoa bloqueou novas mensagens.')).toBeVisible();
  await expect(guestPage.getByLabel('Mensagem', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: /^Desbloquear/ }).click();
  await expect(page.getByLabel('Mensagem', { exact: true })).toBeVisible();
  await guestPage.reload();
  await guestPage.getByRole('button', { name: /Abrir mensagens/ }).click();
  await guestPage.locator('.messages-dock-panel').getByRole('button', { name: /Ana Mensagens/ }).first().click();
  await expect(guestPage.getByLabel('Mensagem', { exact: true })).toBeVisible();

  await guestContext.close();
});

// PNG 1×1 válido, para a foto de perfil de teste.
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

async function setAvatar(requestContext, baseURL) {
  const upload = await requestContext.put('/api/profile/media/avatar', { data: PIXEL, headers: { origin: baseURL, 'content-type': 'image/png' } });
  expect(upload.status()).toBe(201);
  const { url } = await upload.json();
  const current = await (await requestContext.get('/api/library', { headers: { origin: baseURL } })).json();
  const saved = await requestContext.post('/api/library/actions', {
    data: { id: crypto.randomUUID(), revision: current.revision, actions: [{ type: 'account.update', value: { profile: { bio: '', avatar: url, header: '' } } }] },
    headers: { origin: baseURL },
  });
  expect(saved.status()).toBe(200);
  return url;
}

test('fotos de perfil na área Social e aviso flutuante de mensagem nova', async ({ page, browser }, testInfo) => {
  test.slow();
  const baseURL = testInfo.project.use.baseURL;
  const code = await makeFriends(page, page.request, baseURL, 'Ana Aviso', 'alert-a');
  const ana = (await (await page.request.get('/api/me')).json()).user;

  const guestContext = await browser.newContext({ baseURL });
  const guestPage = await guestContext.newPage();
  await register(guestPage.request, baseURL, 'Bia Aviso', 'alert-b');
  await markOnboarded(guestPage.request, baseURL);
  expect((await guestPage.request.post('/api/friends/accept', { data: { code }, headers: { origin: baseURL } })).status()).toBe(200);
  const bia = (await (await guestPage.request.get('/api/me')).json()).user;
  const avatar = await setAvatar(guestPage.request, baseURL);
  for (const request of [page.request, guestPage.request]) {
    expect((await request.patch('/api/xp/settings', { data: { rankingOptIn: true }, headers: { origin: baseURL } })).ok()).toBe(true);
  }

  // A foto da amizade aparece na dock flutuante e no Ranking; sem foto, a inicial.
  await page.getByRole('button', { name: /Abrir mensagens/ }).click();
  const conversation = page.getByRole('button', { name: /Bia Aviso/ });
  await expect(conversation.locator(`.conversation-avatar img[src="${avatar}"]`)).toBeVisible();
  await page.getByRole('button', { name: 'Minimizar mensagens' }).first().click();
  await page.goto('/#ranking');
  await expect(page.locator(`.ranking-avatar img[src="${avatar}"]`)).toBeVisible();
  await expect(page.locator('.rk-row.is-self .ranking-avatar')).toHaveText('AA');
  await page.screenshot({ path: testInfo.outputPath('ranking.png'), fullPage: true });

  // Mensagem nova fora da conversa: aviso com foto, nome e começo do texto.
  const send = async (body) => expect((await guestPage.request.post(`/api/messages/${ana.id}`, { data: { body }, headers: { origin: baseURL } })).status()).toBe(201);
  const recheck = async () => {
    const answered = page.waitForResponse((response) => response.url().endsWith('/api/messages/unread'));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await answered;
  };
  const alert = page.locator('.message-alert');
  await page.goto('/#hoje');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await send('Bora revisar processo civil hoje à noite?');
  await recheck();
  await expect(alert).toContainText('Bia Aviso');
  await expect(alert).toContainText('Bora revisar processo civil hoje à noite?');
  await expect(alert.locator(`img[src="${avatar}"]`)).toBeVisible();
  await alert.getByRole('button', { name: /Abrir conversa com Bia Aviso/ }).click();
  await expect(alert).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Conversa selecionada' }).getByText('Bora revisar processo civil hoje à noite?')).toBeVisible();
  // Garante que a leitura da conversa zerou o contador antes da próxima chegada.
  await recheck();

  // Com a conversa dessa pessoa aberta, não há aviso.
  // A mensagem chega pelo canal de tempo real, sem reler a lista de conversas.
  await send('Já estou com o código aberto.');
  await expect(page.getByRole('region', { name: 'Conversa selecionada' }).getByText('Já estou com o código aberto.')).toBeVisible();
  await recheck();
  await page.waitForTimeout(300);
  await expect(alert).toHaveCount(0);

  // Com a dock minimizada em outra tela o aviso volta, fecha pelo botão e some sozinho depois de alguns segundos.
  await page.getByRole('button', { name: 'Minimizar mensagens' }).first().click();
  await page.goto('/#biblioteca');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await send('Mandei o resumo.');
  await recheck();
  await expect(alert).toContainText('Mandei o resumo.');
  await alert.getByRole('button', { name: 'Fechar aviso de mensagem' }).click();
  await expect(alert).toHaveCount(0);
  // Com o ponteiro em cima, o aviso espera; longe dele, fecha sozinho.
  await page.mouse.move(0, 0);
  await send('Viu o resumo?');
  await recheck();
  await expect(alert).toContainText('Viu o resumo?');
  await expect(alert).toHaveCount(0, { timeout: 12000 });

  // Notificações de mensagens desligadas: nenhum aviso.
  expect((await page.request.patch('/api/messages/settings', { data: { notifications: false }, headers: { origin: baseURL } })).ok()).toBe(true);
  await recheck();
  await send('Silenciado?');
  await recheck();
  await page.waitForTimeout(500);
  await expect(alert).toHaveCount(0);

  await guestContext.close();
});

test('mensagem enviada chega à conversa aberta da outra pessoa sem recarregar', async ({ page, browser }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  const code = await makeFriends(page, page.request, baseURL, 'Ana Tempo', 'msg-t-a');
  const guestContext = await browser.newContext({ baseURL });
  const guestPage = await guestContext.newPage();
  await register(guestPage.request, baseURL, 'Bia Tempo', 'msg-t-b');
  await markOnboarded(guestPage.request, baseURL);
  const accepted = await guestPage.request.post('/api/friends/accept', { data: { code }, headers: { origin: baseURL } });
  expect(accepted.status()).toBe(200);

  await guestPage.goto('/#hoje');
  await guestPage.getByRole('button', { name: /Abrir mensagens/ }).click();
  await guestPage.locator('.messages-dock-panel').getByRole('button', { name: /Ana Tempo/ }).first().click();
  await expect(guestPage.getByLabel('Mensagem', { exact: true })).toBeVisible();

  const sent = await page.request.get('/api/friends', { headers: { origin: baseURL } });
  const friendId = (await sent.json()).friends.find((item) => item.name === 'Bia Tempo').id;
  // O aviso do canal traz a mensagem: nada de mensagens é relido do servidor, só
  // a leitura é registrada (a conversa está aberta).
  const calls = [];
  guestPage.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith('/api/messages') || pathname.startsWith('/api/groups')) calls.push(`${request.method()} ${pathname}`);
  });
  const read = guestPage.waitForResponse((response) => response.url().endsWith('/read') && response.request().method() === 'POST');
  const posted = await page.request.post(`/api/messages/${friendId}`, { data: { body: 'Chegou sem recarregar?' }, headers: { origin: baseURL } });
  expect(posted.status()).toBe(201);
  await expect(guestPage.getByRole('region', { name: 'Conversa selecionada' }).getByText('Chegou sem recarregar?')).toBeVisible({ timeout: 3000 });
  await read;
  await guestPage.waitForTimeout(300);
  expect(calls.filter((call) => call.startsWith('GET'))).toEqual([]);
  expect(calls.filter((call) => call.startsWith('POST')).length).toBe(1);
});

test('conversa longa mantém a altura da tela e rola por dentro até a última mensagem', { tag: '@celular' }, async ({ page, browser }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  const code = await makeFriends(page, page.request, baseURL, 'Ana Rolagem', 'msg-r-a');
  const guestContext = await browser.newContext({ baseURL });
  const guestPage = await guestContext.newPage();
  await register(guestPage.request, baseURL, 'Bia Rolagem', 'msg-r-b');
  await markOnboarded(guestPage.request, baseURL);
  expect((await guestPage.request.post('/api/friends/accept', { data: { code }, headers: { origin: baseURL } })).status()).toBe(200);
  const anaId = (await (await guestPage.request.get('/api/friends', { headers: { origin: baseURL } })).json()).friends.find((item) => item.name === 'Ana Rolagem').id;
  for (let index = 1; index <= 55; index += 1) {
    const posted = await guestPage.request.post(`/api/messages/${anaId}`, { data: { body: `Mensagem número ${index} para encher a conversa e forçar a rolagem.` }, headers: { origin: baseURL } });
    expect(posted.status()).toBe(201);
  }

  await page.getByRole('button', { name: /Abrir mensagens/ }).click();
  await page.locator('.messages-dock-panel').getByRole('button', { name: /Bia Rolagem/ }).first().click();
  const list = page.getByRole('log');
  await expect(list.getByText('Mensagem número 55 para')).toBeVisible();
  const metrics = await page.evaluate(() => {
    const node = document.querySelector('.message-list');
    const dock = document.querySelector('.messages-dock-panel');
    return {
      overflow: node.scrollHeight > node.clientHeight + 40,
      atEnd: node.scrollHeight - node.scrollTop - node.clientHeight < 4,
      layout: document.querySelector('.mg-shell').getBoundingClientRect().height,
      dock: dock.getBoundingClientRect().height,
      viewport: innerHeight,
    };
  });
  expect(metrics.overflow).toBe(true);
  expect(metrics.atEnd).toBe(true);
  expect(metrics.layout).toBeLessThanOrEqual(metrics.dock + 1);
  // A dock cabe na altura da janela e rola por dentro.
  expect(metrics.dock).toBeLessThanOrEqual(metrics.viewport + 1);

  // A conversa abre com a página mais recente (50); as anteriores vêm sob pedido,
  // sem tirar a leitura do lugar.
  await expect(list.getByText('Mensagem número 5 para')).toHaveCount(0);
  await list.getByRole('button', { name: 'Carregar mensagens anteriores' }).click();
  await expect(list.getByText('Mensagem número 1 para')).toBeAttached();
  await expect(list.getByRole('button', { name: 'Carregar mensagens anteriores' })).toHaveCount(0);
  expect(await page.evaluate(() => document.querySelector('.message-list').scrollTop)).toBeGreaterThan(0);
});
