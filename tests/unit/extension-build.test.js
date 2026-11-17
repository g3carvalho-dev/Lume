import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCapture, platformModule } from '../../scripts/build-extension.mjs';
import { PROVIDERS } from '../../public/providers/registry.js';

// extension/capture.js é gerado a partir de extension/src/ e do registro de
// provedores. Se alguém editar a fonte e esquecer de gerar, a extensão
// carregada no Chrome fica com o leitor antigo.
test('extension/capture.js está em dia com a fonte', async () => {
  const fresh = await buildCapture({ write: false });
  const committed = readFileSync(new URL('../../extension/capture.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(committed, fresh.replace(/\r\n/g, '\n'), 'rode npm run extension:build');
});

test('plataformas do popup acompanham o registro', () => {
  assert.equal(readFileSync(new URL('../../extension/platforms.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n'), platformModule());
});

test('observador, permissões opcionais e fontes acompanham as fontes do projeto', async () => {
  const fresh = await buildCapture({entry:'watch',write:false});
  assert.equal(readFileSync(new URL('../../extension/watch.js',import.meta.url),'utf8').replace(/\r\n/g,'\n'),fresh.replace(/\r\n/g,'\n'));
  const preload = await buildCapture({entry:'desktop-watch',write:false});
  assert.equal(readFileSync(new URL('../../companion/electron/lesson-preload.cjs',import.meta.url),'utf8').replace(/\r\n/g,'\n'), preload.replace(/\r\n/g,'\n'));
  const edge = await buildCapture({entry:'edge-watch',write:false});
  assert.equal(readFileSync(new URL('../../companion/electron/edge-observer.js',import.meta.url),'utf8').replace(/\r\n/g,'\n'), edge.replace(/\r\n/g,'\n'));
  const manifest=JSON.parse(readFileSync(new URL('../../extension/manifest.json',import.meta.url)));
  const hosts=PROVIDERS.flatMap(p=>p.hosts.map(h=>'https://*.'+h+'/*'));
  assert.deepEqual(manifest.optional_host_permissions,hosts);
  assert.deepEqual(manifest.web_accessible_resources[0].matches,hosts);
});
