import { test, expect } from '@playwright/test';
import { COMPRESSION } from '../../public/compression-domain.js';
import { seedAccount } from './library-helpers.js';
import { penalPdf } from '../fixtures/sample-pdf.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64');
const photo = { name: 'anotacoes.png', type: 'image/png', bytes: [...png] };

async function transferFor(page, files) {
  return page.evaluateHandle(items => {
    const transfer = new DataTransfer();
    for (const item of items) transfer.items.add(new File([new Uint8Array(item.bytes || item.size)], item.name, { type: item.type }));
    return transfer;
  }, files);
}

async function drop(page, target, files) {
  const transfer = await transferFor(page, files);
  try {
    await target.dispatchEvent('dragenter', { dataTransfer: transfer });
    await target.dispatchEvent('dragover', { dataTransfer: transfer });
    await target.dispatchEvent('drop', { dataTransfer: transfer });
  } finally { await transfer.dispose(); }
}

test('Adicionar anexo escolhe PDF ou imagem e arrastar só publica após confirmar', { tag: '@celular' }, async ({ page }, testInfo) => {
  await seedAccount(page);
  await page.goto('/#amigos');
  const composer = page.getByRole('region', { name: 'Criar publicação' });
  await expect(composer.getByRole('button', { name: 'Adicionar anexo', exact: true })).toBeVisible();
  await expect(composer.getByRole('button', { name: /^(Arquivo|Foto)$/ })).toHaveCount(0);
  await expect(composer.locator('input[type=file]')).toHaveCount(1);
  await composer.getByLabel('Sua publicação').fill('Meus apontamentos da semana.');
  const chooser = page.waitForEvent('filechooser');
  await composer.getByRole('button', { name: 'Adicionar anexo', exact: true }).click();
  await (await chooser).setFiles({ name: 'anotacoes.png', mimeType: 'image/png', buffer: png });
  await expect(composer.getByAltText('Prévia do anexo')).toBeVisible();
  await expect(composer.getByRole('button', { name: 'Adicionar anexo' })).toBeEnabled();

  await drop(page, composer.getByLabel('Sua publicação'), [{ name: 'resumo.pdf', type: 'application/pdf', bytes: [...penalPdf()] }]);
  await expect(composer.locator('.social-draft-attachment')).toContainText('resumo.pdf');
  await expect(composer.getByAltText('Prévia do anexo')).toHaveCount(0);
  await expect(composer.getByRole('button', { name: 'Adicionar anexo' })).toBeEnabled();
  await drop(page, composer, [photo]);
  await expect(composer.getByAltText('Prévia do anexo')).toBeVisible();
  await expect(composer.locator('.social-draft-attachment')).toContainText('anotacoes.png');
  await expect(composer.getByLabel('Sua publicação')).toHaveValue('Meus apontamentos da semana.');
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(composer.getByText('Solte o anexo aqui')).toHaveCount(0);
  expect(await composer.evaluate(node => node.scrollWidth <= node.clientWidth && node.getBoundingClientRect().right <= innerWidth)).toBe(true);
  await composer.screenshot({ path: `data/social-composer-${testInfo.project.name}.png` });

  // Uma queda durante o envio não troca o arquivo que está sendo publicado.
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/social/posts', async route => { await gate; await route.continue(); });
  await composer.getByRole('button', { name: 'Publicar', exact: true }).click();
  await expect(composer.getByRole('button', { name: 'Publicando…' })).toBeDisabled();
  await drop(page, composer, [{ name: 'outro.pdf', type: 'application/pdf', bytes: [...penalPdf()] }]);
  await expect(composer.locator('.social-draft-attachment')).toContainText('anotacoes.png');
  release();
  const post = page.getByRole('article').filter({ hasText: 'Meus apontamentos da semana.' });
  await expect(post.getByAltText('anotacoes.png')).toBeVisible();
  await expect(composer.locator('.social-draft-attachment')).toHaveCount(0);
  await expect(composer.getByLabel('Sua publicação')).toHaveValue('');

  // O perfil usa o mesmo compositor e oferece a mesma ação de anexo.
  await page.goto('/#perfil');
  await page.getByRole('tab', { name: /^Publicações/ }).click();
  await expect(page.getByRole('region', { name: 'Criar publicação' }).getByRole('button', { name: 'Adicionar anexo' })).toBeVisible();
});

test('arrastar valida quantidade e formato, preserva o rascunho e não confunde texto com arquivo', async ({ page }) => {
  await seedAccount(page);
  await page.goto('/#amigos');
  const composer = page.getByRole('region', { name: 'Criar publicação' });
  const text = composer.getByLabel('Sua publicação');
  await text.fill('Rascunho preservado.');
  await drop(page, composer, [photo]);
  await expect(composer.getByRole('button', { name: 'Adicionar anexo' })).toBeEnabled();

  const transfer = await transferFor(page, [photo]);
  try {
    const before = await composer.boundingBox();
    await composer.dispatchEvent('dragenter', { dataTransfer: transfer });
    await text.dispatchEvent('dragenter', { dataTransfer: transfer });
    await text.dispatchEvent('dragleave', { dataTransfer: transfer });
    await expect(composer.getByText('Solte o anexo aqui')).toBeVisible();
    expect((await composer.boundingBox()).height).toBe(before.height);
    await composer.screenshot({ path: 'data/social-composer-drop.png' });
    await composer.dispatchEvent('dragleave', { dataTransfer: transfer });
    await expect(composer.getByText('Solte o anexo aqui')).toHaveCount(0);
  } finally { await transfer.dispose(); }

  const textTransfer = await page.evaluateHandle(() => {
    const data = new DataTransfer(); data.setData('text/plain', 'texto arrastado'); return data;
  });
  await text.dispatchEvent('dragenter', { dataTransfer: textTransfer });
  await text.dispatchEvent('drop', { dataTransfer: textTransfer });
  await textTransfer.dispose();
  await expect(composer.getByText('Solte o anexo aqui')).toHaveCount(0);

  await drop(page, composer, [{ name: 'notas.txt', type: 'text/plain', bytes: [65] }]);
  await expect(composer.getByRole('alert')).toHaveText('Escolha um PDF, PNG, JPG, WebP ou GIF.');
  await drop(page, composer, [photo, { ...photo, name: 'segunda.png' }]);
  await expect(composer.getByRole('alert')).toHaveText('Adicione um anexo por publicação.');
  await drop(page, composer, [{ name: 'imagem-grande.png', type: 'image/png', size: COMPRESSION.imageSourceBytes + 1 }]);
  await expect(composer.getByRole('alert')).toContainText('para otimizar no navegador o máximo é');
  await expect(composer.locator('.social-draft-attachment')).toContainText('anotacoes.png');
  await expect(text).toHaveValue('Rascunho preservado.');
  await expect(page.getByRole('article')).toHaveCount(0);
  await composer.getByRole('button', { name: 'Remover anexo' }).click();
  await expect(composer.locator('.social-draft-attachment')).toHaveCount(0);
  await expect(text).toHaveValue('Rascunho preservado.');
});
