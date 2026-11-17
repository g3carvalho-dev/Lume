import { presentPlayer } from './present-player.mjs';
import { WebContentsView } from 'electron';
import { fileURLToPath } from 'node:url';

const toolbarFile = fileURLToPath(new URL('./renderer/lesson.html', import.meta.url));

export function lessonProvider(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  if (/(^|\.)udemy\.com$/.test(url.hostname) && /^\/course\/[^/]+\/learn\/lecture\/\d+\/?$/.test(url.pathname)) return 'Udemy';
  if (/(^|\.)grancursosonline\.com\.br$/.test(url.hostname) && /^\/aluno\/curso\/video\/codigo\/[^/]+\/v\/[^/]+\/?$/.test(url.pathname)) return 'Gran';
  return null;
}

export function showLesson(window, url, provider, titleHeight, openExternal) {
  const bar = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const player = new WebContentsView({ webPreferences: { partition: 'persist:lume-courses', sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const contents = player.webContents;
  const partition = contents.session;
  partition.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'fullscreen'));
  partition.setPermissionCheckHandler((_wc, permission) => permission === 'fullscreen');
  window.contentView.addChildView(bar);
  window.contentView.addChildView(player);
  function layout() {
    const [width, height] = window.getContentSize();
    bar.setBounds({ x: 0, y: titleHeight, width, height: 52 });
    player.setBounds({ x: 0, y: titleHeight + 52, width, height: Math.max(1, height-titleHeight-52) });
  }
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    window.off('resize', layout);
    window.off('close', close);
    for (const view of [player, bar]) {
      window.contentView.removeChildView(view);
      if (!view.webContents.isDestroyed()) view.webContents.close();
    }
    if (!window.webContents.isDestroyed()) window.webContents.focus();
  }
  function setStatus(message) {
    if (!closed) bar.webContents.executeJavaScript('document.querySelector("output").textContent = ' + JSON.stringify(message)).catch(() => {});
  }
  bar.webContents.on('did-navigate-in-page', (_event, address) => {
    const action = new URL(address).hash;
    if (action === '#back') close();
    if (action === '#browser') { openExternal(url); close(); }
  });
  const isHttps = address => { try { return new URL(address).protocol === 'https:'; } catch { return false; } };
  contents.on('will-navigate', (event, address) => { if (!isHttps(address)) event.preventDefault(); });
  contents.on('will-redirect', (event, address) => { if (!isHttps(address)) event.preventDefault(); });
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('dom-ready', () => {
    if (lessonProvider(contents.getURL()) === provider) presentPlayer(contents, provider).catch(() => {});
  });
  contents.on('did-navigate', (_event, address) => { if (isHttps(address)) setStatus(new URL(address).hostname); });
  contents.on('did-fail-load', (_event, code, _reason, _address, mainFrame) => {
    if (mainFrame && code !== -3) setStatus('A aula não carregou. Você pode abri-la no navegador.');
  });
  window.on('resize', layout);
  window.once('close', close);
  layout();
  bar.webContents.loadFile(toolbarFile).then(() => {
    if (closed) return;
    setStatus('Abrindo a aula · ' + provider);
    contents.loadURL(url).catch(() => {});
  }).catch(close);
  return close;
}
