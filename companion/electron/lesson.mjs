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

// Roda no mundo isolado e lê apenas os metadados exibidos pela plataforma.
function readPlayerDetails(provider) {
  const gran = provider === 'Gran';
  const title = selector => document.querySelector(selector)?.textContent.trim().slice(0, 300);
  const video = document.querySelector('[data-lume-lesson-player] video, video[data-lume-lesson-player]');
  return {
    lessonTitle: title(gran ? 'h2.line-clamp-2' : '[aria-current="true"] [data-purpose="item-title"], [data-purpose="lecture-title"]'),
    courseTitle: title(gran ? 'h1' : '[data-purpose="course-header-title"]'),
    duration: Number.isFinite(video?.duration) ? video.duration : null
  };
}

export function showLesson(window, url, provider, titleHeight, openExternal) {
  const bar = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const nav = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const player = new WebContentsView({ webPreferences: { partition: 'persist:lume-courses', sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const contents = player.webContents;
  const partition = contents.session;
  partition.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'fullscreen'));
  partition.setPermissionCheckHandler((_wc, permission) => permission === 'fullscreen');
  window.contentView.addChildView(bar);
  window.contentView.addChildView(nav);
  window.contentView.addChildView(player);
  let closed = false;
  // A faixa reservada aos controles nativos pertence à página de fundo.
  // Cubra-a também quando a aula foi aberta sobre uma página sem a barra do app.
  const titleStrip = window.webContents.insertCSS(`
    html::after {
      content: ""; position: fixed; top: 0; right: 0; width: 150px; pointer-events: none; height: ${titleHeight}px;
      background: #0c111b; z-index: 2147483647;
    }`, { cssOrigin: 'user' });
  let fullscreen = false;
  let layoutRevision = 0;
  function layout() {
    const revision = ++layoutRevision;
    const [width, height] = window.getContentSize();
    if (fullscreen) {
      player.setBounds({ x: 0, y: 0, width, height });
      return;
    }
    // A área dos três botões nativos permanece com a janela principal.
    nav.setBounds({ x: 0, y: 0, width: Math.max(1, width - 150), height: titleHeight });
    bar.setBounds({ x: 0, y: titleHeight, width, height: height-titleHeight });
    bar.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => {
      const box = document.querySelector('.stage')?.getBoundingClientRect();
      resolve(box && [box.x,box.y,box.width,box.height].map(Math.round));
    }))`).then(box => {
      if (!box || closed || revision !== layoutRevision) return;
      const [x,y,w,h] = box;
      player.setBounds({ x:x+3, y:y+titleHeight+3, width:Math.max(1,w-6), height:Math.max(1,h-6) });
    }).catch(() => {});
  }
  contents.on('enter-html-full-screen', () => { fullscreen = true; layout(); });
  contents.on('leave-html-full-screen', () => { fullscreen = false; layout(); });
  contents.on('before-input-event', (event, input) => {
    if (fullscreen && input.type === 'keyDown' && input.key === 'Escape') {
      event.preventDefault();
      contents.executeJavaScript('document.fullscreenElement && document.exitFullscreen()').catch(() => {});
    }
  });
  let timer;
  let currentAddress;
  let imported = {};
  let rendered;
  async function refresh() {
    const address = contents.getURL();
    if (lessonProvider(address) !== provider) return;
    if (currentAddress !== address) {
      currentAddress = address;
      imported = {};
      const request = "fetch('/api/extension/lesson?url=' + encodeURIComponent(" + JSON.stringify(address) + ")).then(r => r.ok ? r.json() : null)";
      window.webContents.executeJavaScript(request).then(result => {
        if (!closed && address === currentAddress && result?.found) {
          imported = {lessonTitle: result.lessonTitle, courseTitle: result.courseTitle, duration: result.duration};
        }
      }).catch(() => {});
    }
    const details = await contents.executeJavaScriptInIsolatedWorld(1001, [{
      code: '(' + readPlayerDetails.toString() + ')(' + JSON.stringify(provider) + ')'
    }]);
    if (closed || contents.getURL() !== address) return;
    const metadata = {
      lessonTitle: details.lessonTitle || imported.lessonTitle || 'Videoaula',
      courseTitle: details.courseTitle || imported.courseTitle || '',
      duration: details.duration || imported.duration || null
    };
    const serialized = JSON.stringify(metadata);
    if (rendered !== serialized) {
      rendered = serialized;
      updateLesson(metadata);
    }
  }
  function updateLesson(details) {
    if (!closed) bar.webContents.executeJavaScript('window.updateLesson(' + JSON.stringify(details) + ')').then(layout).catch(() => {});
  }
  function close() {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    titleStrip.then(key => {
      if (!window.webContents.isDestroyed()) return window.webContents.removeInsertedCSS(key);
    }).catch(() => {});
    window.off('resize', layout);
    window.off('close', close);
    for (const view of [player, nav, bar]) {
      window.contentView.removeChildView(view);
      if (!view.webContents.isDestroyed()) view.webContents.close();
    }
    if (!window.webContents.isDestroyed()) window.webContents.focus();
  }
  function setStatus(message) {
    if (!closed) bar.webContents.executeJavaScript('document.querySelector("output").textContent = ' + JSON.stringify(message)).catch(() => {});
  }
  nav.webContents.on('did-navigate-in-page', (_event, address) => {
    const action = new URL(address).hash;
    if (action === '#back') close();
    if (action === '#browser') { openExternal(lessonProvider(contents.getURL()) === provider ? contents.getURL() : url); close(); }
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
  nav.webContents.loadFile(fileURLToPath(new URL('./renderer/lesson-nav.html', import.meta.url))).catch(close);
  bar.webContents.loadFile(toolbarFile,{query:{provider}}).then(() => {
    if (closed) return;
    layout();
    timer = setInterval(() => refresh().catch(() => {}), 1000);
    setStatus('Abrindo a aula · ' + provider);
    contents.loadURL(url).catch(() => {});
  }).catch(close);
  return close;
}
