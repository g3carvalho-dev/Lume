import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createUpdater, nativeUpdatesSupported } from './updater.mjs';

function fakeAutoUpdater({ version = '0.7.0', fail = null } = {}) {
  const emitter = new EventEmitter();
  emitter.calls = [];
  emitter.checkForUpdates = async () => {
    emitter.calls.push('check');
    if (fail) throw new Error(fail);
    emitter.emit('checking-for-update');
    if (version === '0.6.5') {
      emitter.emit('update-not-available', { version });
      return { updateInfo: { version } };
    }
    emitter.emit('update-available', { version, releaseNotes: 'Novidades' });
    emitter.emit('download-progress', { percent: 42.4 });
    emitter.emit('update-downloaded', { version });
    return { updateInfo: { version } };
  };
  emitter.quitAndInstall = (silent, run) => emitter.calls.push(`install:${silent}:${run}`);
  return emitter;
}

test('só usa atualização nativa instalada no Windows ou em AppImage', () => {
  assert.equal(nativeUpdatesSupported({ platform: 'win32', packaged: true }), true);
  assert.equal(nativeUpdatesSupported({ platform: 'win32', packaged: false }), false);
  assert.equal(nativeUpdatesSupported({ platform: 'linux', packaged: true, env: { APPIMAGE: '/x/Lume.AppImage' } }), true);
  assert.equal(nativeUpdatesSupported({ platform: 'linux', packaged: true, env: {} }), false);
  assert.equal(nativeUpdatesSupported({ platform: 'darwin', packaged: true }), false);
});

test('baixa sozinho e instala por cima em silêncio, reabrindo o app', async () => {
  const auto = fakeAutoUpdater();
  const seen = [];
  let prepared = 0;
  const updater = createUpdater({
    autoUpdater: auto, currentVersion: '0.6.5', native: true,
    onChange: (info) => seen.push(info.status), beforeInstall: () => { prepared += 1; },
  });
  assert.equal(auto.autoDownload, true);
  const info = await updater.check();
  assert.equal(info.status, 'ready');
  assert.equal(info.latest, '0.7.0');
  assert.equal(info.notes, 'Novidades');
  assert.ok(seen.includes('downloading'));
  assert.equal(updater.getInfo().progress, 100);

  await updater.install();
  assert.equal(prepared, 1);
  assert.deepEqual(auto.calls.filter((call) => call.startsWith('install')), ['install:true:true']);
  assert.equal(updater.getInfo().status, 'installing');
});

test('versão igual ou menor conta como atualizada', async () => {
  const updater = createUpdater({ autoUpdater: fakeAutoUpdater({ version: '0.6.5' }), currentVersion: '0.6.5', native: true });
  assert.equal((await updater.check()).status, 'current');
});

test('instalar antes de terminar o download é recusado', async () => {
  const updater = createUpdater({ autoUpdater: fakeAutoUpdater(), currentVersion: '0.6.5', native: true });
  await assert.rejects(() => updater.install(), /terminou de baixar/);
});

test('verificação manual mostra o erro; a automática fica quieta', async () => {
  const manual = createUpdater({ autoUpdater: fakeAutoUpdater({ fail: 'getaddrinfo ENOTFOUND github.com' }), currentVersion: '0.6.5', native: true });
  const failed = await manual.check();
  assert.equal(failed.status, 'error');
  assert.match(failed.error, /Sem conexão/);
  const quiet = createUpdater({ autoUpdater: fakeAutoUpdater({ fail: 'boom' }), currentVersion: '0.6.5', native: true });
  const result = await quiet.check({ silent: true });
  assert.equal(result.status, 'idle');
  assert.equal(result.error, null);
});

test('sem suporte nativo usa o fluxo manual de baixar e abrir o instalador', async () => {
  const opened = [];
  const updater = createUpdater({
    currentVersion: '0.6.5', native: false,
    fallback: {
      checkForUpdate: async () => ({ available: true, latest: '0.7.0', assetName: 'Lume.deb', installerUrl: 'https://github.com/x/Lume.deb', size: 1, notes: '', page: '' }),
      downloadInstaller: async ({ onProgress }) => { onProgress(100); return '/tmp/Lume-0.7.0.deb'; },
      openInstaller: async (file) => { opened.push(file); },
    },
  });
  assert.equal(updater.getInfo().mode, 'manual');
  assert.equal((await updater.check()).status, 'available');
  assert.equal((await updater.download()).status, 'ready');
  assert.equal((await updater.install()).status, 'installing');
  assert.deepEqual(opened, ['/tmp/Lume-0.7.0.deb']);
});

test('start agenda a verificação automática e stop cancela', () => {
  const scheduled = [];
  const updater = createUpdater({
    autoUpdater: fakeAutoUpdater(), currentVersion: '0.6.5', native: true,
    setTimer: (fn, ms) => { scheduled.push(['timer', ms]); return { unref() {} }; },
    setRepeat: (fn, ms) => { scheduled.push(['repeat', ms]); return { unref() {} }; },
  });
  updater.start();
  assert.deepEqual(scheduled.map(([kind]) => kind), ['timer', 'repeat']);
  updater.stop();
});
