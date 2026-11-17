import test from 'node:test';
import assert from 'node:assert/strict';
import { extensionCapability, supportedExtensionVersion, supportsCourseExtension } from '../../public/extension-domain.js';
import { providerById } from '../../public/providers/registry.js';

test('a oferta de instalação considera versão numérica e navegador do computador', () => {
  for (const version of ['', 'invalid', '0.2.12']) assert.equal(supportedExtensionVersion(version), false);
  for (const version of ['0.3', '0.3.0.1', '0.12', '1']) assert.equal(supportedExtensionVersion(version), true);
  for (const ua of ['Chrome/157 Safari/537', 'Chrome/157 Edg/157']) assert.equal(supportsCourseExtension(ua), true);
  for (const ua of ['Firefox/151', 'Safari/605', 'Android Chrome/157', 'Chrome/157 Electron/43']) assert.equal(supportsCourseExtension(ua), false);
  assert.equal(supportsCourseExtension('Macintosh Chrome/157', 5), false);
  assert.match(extensionCapability(providerById('grancursos')), /sua conta/);
  assert.match(extensionCapability(providerById('udemy')), /marcas de conclusão/);
  assert.doesNotMatch(extensionCapability(null), /conclusão/);
});
