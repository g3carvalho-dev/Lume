import { edgeLesson } from './edge-lesson.mjs';
import { lessonTracking } from './lesson-tracking.mjs';
import { presentPlayer } from './present-player.mjs';
import { WebContentsView } from 'electron';
import { fileURLToPath } from 'node:url';

const toolbarFile = fileURLToPath(new URL('./renderer/lesson.html', import.meta.url));

import { lessonProvider } from './lesson-provider.mjs';
export { lessonProvider };

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
  const useEdge = process.platform === 'win32' && provider === 'Udemy' && !process.argv.includes('--lume-test-electron-player');
  const player = useEdge ? null : new WebContentsView({ webPreferences: { preload: fileURLToPath(new URL('./lesson-preload.cjs', import.meta.url)), partition: 'persist:lume-courses', sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const contents = player?.webContents;
  let edge;
  const getAddress = () => edge?.getURL() || contents?.getURL() || url;
  const tracking = lessonTracking(window.webContents, getAddress, address => lessonProvider(address) === provider, (result, payload) => {
    const own = result.session?.stepId === payload.stepId;
    const label = result.lesson?.completed ? 'Aula concluída' : own
      ? (result.session.status === 'active' ? 'Registrando estudo' : 'Estudo pausado') : '';
    setStatus([label, new URL(payload.pageUrl).hostname].filter(Boolean).join(' · '));
  });
  if (contents) {
    contents.ipc.handle('lesson-watch', (event,message) => event.senderFrame === contents.mainFrame ? tracking.handle(message) : {found:false});
    contents?.on('did-start-navigation', details => { if (details.isMainFrame && !details.isSameDocument) tracking.navigate(); });
  }
  const partition = contents?.session;
  partition?.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'fullscreen'));
  partition?.setPermissionCheckHandler((_wc, permission) => permission === 'fullscreen');
  window.contentView.addChildView(bar);
  window.contentView.addChildView(nav);
  if (player) window.contentView.addChildView(player);
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
      (edge || player)?.setBounds({ x: 0, y: 0, width, height });
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
      (edge || player)?.setBounds({ x:x+3, y:y+titleHeight+3, width:Math.max(1,w-6), height:Math.max(1,h-6) });
    }).catch(() => {});
  }
  contents?.on('enter-html-full-screen', () => { fullscreen = true; layout(); });
  contents?.on('leave-html-full-screen', () => { fullscreen = false; layout(); });
  contents?.on('before-input-event', (event, input) => {
    if (fullscreen && input.type === 'keyDown' && input.key === 'Escape') {
      event.preventDefault();
      contents.executeJavaScript('document.fullscreenElement && document.exitFullscreen()').catch(() => {});
    }
  });
  let timer;
  let currentAddress;
  let loginRefused = false;
  let imported = {};
  let rendered;
  async function refresh() {
    const address = getAddress();
    const page = new URL(address);
    const loginPage = provider === 'Udemy' && page.protocol === 'https:' &&
      /(^|\.)udemy\.com$/.test(page.hostname) && page.pathname.startsWith('/join/');
    const refused = !edge && loginPage && await contents.executeJavaScriptInIsolatedWorld(1001, [{
      code: `performance.getEntriesByType('resource').some(entry => {
        const request = new URL(entry.name);
        return request.origin === location.origin && request.pathname.startsWith('/api-2.0/auth/code-generation/login/') &&
          entry.responseStatus === 403;
      })`
    }]);
    if (closed || getAddress() !== address) return;
    if (refused !== loginRefused) {
      loginRefused = refused;
      await bar.webContents.executeJavaScript('document.querySelector("#login-help").hidden = ' + !refused);
      layout();
    }
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
    const details = edge ? await edge.details(readPlayerDetails) : await contents.executeJavaScriptInIsolatedWorld(1001, [{
      code: '(' + readPlayerDetails.toString() + ')(' + JSON.stringify(provider) + ')'
    }]);
    if (closed || getAddress() !== address) return;
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
    edge?.close();
    tracking.close();
    clearInterval(timer);
    titleStrip.then(key => {
      if (!window.webContents.isDestroyed()) return window.webContents.removeInsertedCSS(key);
    }).catch(() => {});
    window.off('resize', layout);
    window.off('close', close);
    for (const view of [player, nav, bar].filter(Boolean)) {
      window.contentView.removeChildView(view);
      if (!view.webContents.isDestroyed()) view.webContents.close();
    }
    if (!window.webContents.isDestroyed()) window.webContents.focus();
  }
  function showPlayerError(message) {
    if (closed) return;
    clearInterval(timer);
    bar.webContents.executeJavaScript(`(() => {
      const error = document.getElementById('player-error');
      error.querySelector('p').textContent = ${JSON.stringify(message)};
      error.hidden = false;
    })()`).catch(() => {});
    setStatus(provider);
  }
  function setStatus(message) {
    if (!closed) bar.webContents.executeJavaScript('document.querySelector("output").textContent = ' + JSON.stringify(message)).catch(() => {});
  }
  function handleAction(_event, address) {
    const action = new URL(address).hash;
    if (action === '#back') close();
    if (action === '#browser') { openExternal(lessonProvider(getAddress()) === provider ? getAddress() : currentAddress || url); close(); }
  }
  nav.webContents.on('did-navigate-in-page', handleAction);
  bar.webContents.on('did-navigate-in-page', handleAction);
  const isHttps = address => { try { return new URL(address).protocol === 'https:'; } catch { return false; } };
  contents?.on('will-navigate', (event, address) => { if (!isHttps(address)) event.preventDefault(); });
  contents?.on('will-redirect', (event, address) => { if (!isHttps(address)) event.preventDefault(); });
  contents?.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents?.on('dom-ready', () => {
    if (lessonProvider(contents.getURL()) === provider) presentPlayer(contents, provider).catch(() => {});
  });
  contents?.on('did-navigate', (_event, address) => { if (isHttps(address)) setStatus(new URL(address).hostname); });
  contents?.on('did-fail-load', (_event, code, _reason, _address, mainFrame) => {
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
    if (useEdge) {
      try {
        edge = edgeLesson(window, url, tracking, {
          source(address) { if (isHttps(address)) setStatus(new URL(address).hostname); },
          unavailable(message) { showPlayerError(message || 'O componente Microsoft Edge WebView2 ficou indisponível.'); },
          fullscreen(value) { fullscreen = value; layout(); }
        });
        layout();
      } catch {
        showPlayerError('O Windows não iniciou o player da Udemy. Se apareceu um aviso de Controle de Aplicativos, esta instalação precisa de uma assinatura aceita pelo computador.');
      }
    } else contents.loadURL(url).catch(() => {});
  }).catch(error => {
    console.warn('Falha ao preparar o player do Lume:', error.message);
    close();
  });
  return close;
}
