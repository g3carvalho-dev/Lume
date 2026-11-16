// Atualização automática do Lume.
//
// Dois caminhos, escolhidos por `nativeUpdatesSupported`:
// - nativo (Windows instalado e AppImage): `electron-updater` procura a versão
//   nova, baixa em segundo plano (só a diferença, quando possível) e, ao pedir,
//   fecha o app, instala POR CIMA da versão atual em silêncio e reabre. Não
//   sobra instalação antiga nem janela de instalador para conduzir à mão.
// - manual (pacote .deb e execução fora do instalador): o fluxo antigo de
//   `update.mjs` baixa o arquivo e abre o instalador, porque não há como
//   trocar o pacote sem uma ação da pessoa.
//
// O módulo não importa o Electron: o `autoUpdater` e as ações do sistema entram
// por parâmetro, o que permite testar a máquina de estados sem janela.

import { compareVersions } from './update.mjs';

export const CHECK_DELAY_MS = 20_000;
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function nativeUpdatesSupported({ platform = process.platform, packaged = false, env = process.env } = {}) {
  if (!packaged) return false;
  if (platform === 'win32') return true;
  if (platform === 'linux') return Boolean(env?.APPIMAGE);
  return false;
}

const INITIAL = {
  status: 'idle', latest: null, notes: '', progress: 0, error: null, file: null, mode: 'manual', auto: false,
};

function releaseNotes(info) {
  const notes = info?.releaseNotes;
  if (typeof notes === 'string') return notes;
  if (Array.isArray(notes)) return notes.map((item) => item?.note || '').filter(Boolean).join('\n\n');
  return '';
}

export function createUpdater({
  autoUpdater = null,
  currentVersion,
  native = false,
  fallback = null,
  releasesPage = '',
  onChange = () => {},
  beforeInstall = () => {},
  setTimer = setTimeout,
  setRepeat = setInterval,
} = {}) {
  let info = { ...INITIAL, mode: native && autoUpdater ? 'native' : 'manual', page: releasesPage };
  let timers = [];
  let installing = false;

  function patch(next) {
    info = { ...info, ...next };
    onChange(snapshot());
    return snapshot();
  }

  function snapshot() {
    return { ...info, currentVersion };
  }

  if (info.mode === 'native') {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.on('checking-for-update', () => patch({ status: 'checking', error: null }));
    autoUpdater.on('update-available', (update) => patch({
      status: 'downloading', latest: update?.version || null, notes: releaseNotes(update), progress: 0, error: null,
    }));
    autoUpdater.on('update-not-available', () => patch({ status: 'current', latest: currentVersion, progress: 0 }));
    autoUpdater.on('download-progress', (progress) => patch({
      status: 'downloading', progress: Math.max(0, Math.min(100, Math.round(progress?.percent ?? 0))),
    }));
    autoUpdater.on('update-downloaded', (update) => patch({
      status: 'ready', latest: update?.version || info.latest, notes: releaseNotes(update) || info.notes, progress: 100,
    }));
    autoUpdater.on('error', (error) => {
      if (installing) return;
      patch({ status: 'error', error: friendlyError(error), progress: 0 });
    });
  }

  function friendlyError(error) {
    const text = String(error?.message || error || '').split('\n')[0];
    if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|net::|network/i.test(text)) return 'Sem conexão com o servidor de atualizações.';
    return text.slice(0, 200) || 'Não foi possível atualizar agora.';
  }

  // `silent`: verificações automáticas não incomodam com erro de rede.
  async function check({ silent = false } = {}) {
    if (installing || info.status === 'downloading' || info.status === 'ready') return snapshot();
    if (info.mode === 'native') {
      try {
        patch({ status: 'checking', error: null, auto: silent });
        const result = await autoUpdater.checkForUpdates();
        if (!result?.updateInfo) patch({ status: 'current' });
        else if (compareVersions(result.updateInfo.version, currentVersion) <= 0) patch({ status: 'current', latest: currentVersion });
      } catch (error) {
        if (silent) patch({ status: 'idle', error: null });
        else patch({ status: 'error', error: friendlyError(error) });
      }
      return snapshot();
    }
    patch({ status: 'checking', error: null, progress: 0 });
    try {
      const result = await fallback.checkForUpdate({ current: currentVersion });
      patch({
        status: result.available ? 'available' : 'current',
        latest: result.latest,
        assetName: result.assetName || '',
        installerUrl: result.installerUrl || null,
        size: result.size || 0,
        notes: result.notes || '',
        page: result.page || releasesPage,
        file: null,
        progress: 0,
      });
    } catch (error) {
      if (silent) patch({ status: 'idle' });
      else patch({ status: 'error', error: friendlyError(error) });
    }
    return snapshot();
  }

  // Só o caminho manual precisa de um passo explícito de download.
  async function download() {
    if (info.mode === 'native') return snapshot();
    if (!info.installerUrl) throw new Error('Verifique a atualização antes de baixar.');
    patch({ status: 'downloading', progress: 0, error: null });
    try {
      const file = await fallback.downloadInstaller({
        url: info.installerUrl,
        version: info.latest,
        assetName: info.assetName,
        destDir: fallback.destDir?.() || '',
        onProgress: (percent) => patch({ progress: percent ?? info.progress }),
      });
      patch({ status: 'ready', file, progress: 100 });
    } catch (error) {
      patch({ status: 'error', error: friendlyError(error), progress: 0 });
    }
    return snapshot();
  }

  async function install() {
    if (info.mode === 'native') {
      if (info.status !== 'ready') throw new Error('A atualização ainda não terminou de baixar.');
      installing = true;
      patch({ status: 'installing' });
      try {
        beforeInstall();
        // silencioso, reabrindo o Lume depois de instalar.
        autoUpdater.quitAndInstall(true, true);
      } catch (error) {
        installing = false;
        patch({ status: 'error', error: friendlyError(error) });
      }
      return snapshot();
    }
    if (!info.file) throw new Error('Nenhum instalador baixado ainda.');
    await fallback.openInstaller(info.file);
    patch({ status: 'installing' });
    return snapshot();
  }

  // Procura sozinho logo depois de abrir e a cada poucas horas.
  function start() {
    stop();
    timers.push(setTimer(() => { check({ silent: true }); }, CHECK_DELAY_MS));
    timers.push(setRepeat(() => { check({ silent: true }); }, CHECK_INTERVAL_MS));
    for (const timer of timers) timer?.unref?.();
  }

  function stop() {
    for (const timer of timers) { clearTimeout(timer); clearInterval(timer); }
    timers = [];
  }

  return { check, download, install, start, stop, getInfo: snapshot };
}
