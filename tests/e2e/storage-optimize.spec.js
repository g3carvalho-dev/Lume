import { expect, test } from '@playwright/test';
import { addPdfMaterial } from '../../public/pdf-domain.js';
import { libraryActions } from '../../public/library-actions.js';
import { SOCIAL_IMAGE_BYTES } from '../../public/social-domain.js';
import { noisePng } from '../fixtures/sample-image.js';
import { scannedPdf } from '../fixtures/sample-pdf.js';
import { E2E_ORIGIN, seedAccount } from './library-helpers.js';

async function uploadLibraryPdf(request, bytes, name) {
  const fileId = crypto.randomUUID();
  const created = await request.post(`/api/library/files/${fileId}/upload-url`, {
    headers: { origin: E2E_ORIGIN },
    data: { name, size: bytes.length, contentType: 'application/pdf' },
  });
  expect(created.ok()).toBe(true);
  const upload = await created.json();
  const stored = await request.put(upload.uploadUrl, { headers: { ...upload.headers, origin: E2E_ORIGIN }, data: bytes });
  expect(stored.ok()).toBe(true);
  const confirmed = await request.post(`/api/library/files/${fileId}/confirm`, { headers: { origin: E2E_ORIGIN } });
  expect(confirmed.ok()).toBe(true);
  return { fileId, name, size: bytes.length, pages: 1, outline: [] };
}

async function openStorage(page) {
  await page.goto('/#armazenamento');
  await expect(page.getByRole('heading', { name: 'Armazenamento' })).toBeVisible();
}

test('PDF existente da Biblioteca é otimizado pela tela de armazenamento', async ({ page }) => {
  await seedAccount(page);
  const bytes = scannedPdf({ pages: 1, width: 900, height: 1200 });
  const file = await uploadLibraryPdf(page.request, bytes, 'digitalizado.pdf');
  const loaded = await page.request.get('/api/library', { headers: { origin: E2E_ORIGIN } });
  expect(loaded.ok()).toBe(true);
  const current = await loaded.json();
  const next = addPdfMaterial(current.state, { title: 'Digitalizacao de teste', file }, 'pdf-otimizar');
  const actions = libraryActions(current.state, next);
  const saved = await page.request.post('/api/library/actions', {
    headers: { origin: E2E_ORIGIN },
    data: { id: crypto.randomUUID(), revision: current.revision, actions },
  });
  expect(saved.ok()).toBe(true);

  await openStorage(page);
  const row = page.locator('.cfg-storage-item').filter({ hasText: 'Digitalizacao de teste' });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Otimizar' }).click();
  const offer = page.getByRole('region', { name: 'Confirmar redução para digitalização' });
  await expect(offer).toBeVisible();
  await offer.getByRole('button', { name: 'Reduzir digitalização' }).click();
  await expect(page.getByRole('status').getByText(/PDF otimizado:/)).toBeVisible();

  const storage = await page.request.get('/api/storage', { headers: { origin: E2E_ORIGIN } });
  expect(storage.ok()).toBe(true);
  expect((await storage.json()).breakdown.libraryBytes).toBeLessThan(bytes.length);
});

test('imagem existente do Social é recomprimida pela tela de armazenamento', async ({ page }) => {
  await seedAccount(page);
  const bytes = noisePng({ width: 700, height: 700 });
  expect(bytes.length).toBeLessThan(SOCIAL_IMAGE_BYTES);
  const created = await page.request.post('/api/social/posts', {
    headers: { origin: E2E_ORIGIN },
    multipart: {
      id: crypto.randomUUID(),
      body: 'Foto grande',
      kind: 'material',
      attachment: { name: 'foto.png', mimeType: 'image/png', buffer: bytes },
    },
  });
  expect(created.status()).toBe(201);

  await openStorage(page);
  const row = page.locator('.cfg-storage-item').filter({ hasText: 'foto.png' });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Otimizar' }).click();
  await expect(page.getByRole('status').getByText(/Anexo otimizado:/)).toBeVisible();

  const storage = await page.request.get('/api/storage', { headers: { origin: E2E_ORIGIN } });
  expect(storage.ok()).toBe(true);
  expect((await storage.json()).breakdown.socialBytes).toBeLessThan(bytes.length);
});

test('anexo PDF existente do Social é otimizado pela tela de armazenamento', async ({ page }) => {
  await seedAccount(page);
  const bytes = scannedPdf({ pages: 1, width: 900, height: 1200 });
  const created = await page.request.post('/api/social/posts', {
    headers: { origin: E2E_ORIGIN },
    multipart: {
      id: crypto.randomUUID(),
      body: 'Caderno digitalizado',
      kind: 'material',
      attachment: { name: 'caderno.pdf', mimeType: 'application/pdf', buffer: bytes },
    },
  });
  expect(created.status()).toBe(201);

  await openStorage(page);
  const row = page.locator('.cfg-storage-item').filter({ hasText: 'caderno.pdf' });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Otimizar' }).click();
  const offer = page.getByRole('region', { name: 'Confirmar redução para digitalização' });
  await expect(offer).toBeVisible();
  await offer.getByRole('button', { name: 'Reduzir digitalização' }).click();
  await expect(page.getByRole('status').getByText(/Anexo otimizado:/)).toBeVisible();

  const storage = await page.request.get('/api/storage', { headers: { origin: E2E_ORIGIN } });
  expect(storage.ok()).toBe(true);
  expect((await storage.json()).breakdown.socialBytes).toBeLessThan(bytes.length);
});
