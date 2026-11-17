import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('./renderer/lesson-player.css', import.meta.url), 'utf8');

// Executada no mundo isolado do Chromium. O player permanece no DOM original
// com seus controles, legendas, sessão e fluxo de mídia.
function observePlayer(provider) {
  window.lumePlayerObserver?.disconnect();
  const pathAttr = 'data-lume-player-path';
  const rootAttr = 'data-lume-lesson-player';
  let root;
  function update() {
    const videos = [...document.querySelectorAll('video')];
    const video = videos.find(v => v.id === 'video-player_html5_api')
      || videos.find(v => v.getBoundingClientRect().width > 0);
    const wrapper = video?.closest(provider === 'Gran' ? '.video-js' : '[data-purpose="video-player"], [data-purpose="video-player-container"]');
    const next = wrapper || video;
    if (next === root) return;
    document.querySelectorAll('[' + pathAttr + '],[' + rootAttr + ']').forEach(el => {
      el.removeAttribute(pathAttr);
      el.removeAttribute(rootAttr);
    });
    root = next;
    if (!root) return;
    if (!wrapper) video.controls = true;
    root.setAttribute(rootAttr, '');
    for (let el = root.parentElement; el; el = el.parentElement) el.setAttribute(pathAttr, '');
  }
  const observer = new MutationObserver(update);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.lumePlayerObserver = observer;
  update();
}

export async function presentPlayer(contents, provider) {
  await contents.insertCSS(css, { cssOrigin: 'user' });
  await contents.executeJavaScriptInIsolatedWorld(1001, [{code:'(' + observePlayer.toString() + ')(' + JSON.stringify(provider) + ')'}]);
}
