import { formatSessionDuration, sessionElapsed } from '../../public/session-domain.js';
import { openPageMiniplayer } from './page-miniplayer.js';

export function watchBadge() {
  const host = document.createElement('aside');
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>
    :host { all:initial; position:fixed; right:16px; bottom:16px; z-index:2147483646; color-scheme:dark }
    section { background:#141b2a; color:#eef2f7; border:1px solid #3a4868; border-radius:14px; padding:10px 14px; max-width:230px; font:15px 'Atkinson Hyperlegible Next',system-ui,sans-serif; box-shadow:0 4px 16px #0005 }
    button { color:inherit; background:transparent; border:0; cursor:pointer; font:inherit; padding:2px; display:flex; align-items:center; gap:8px }
    b {color:#f6c165} small {display:block;margin-top:6px} time {font-family:'JetBrains Mono',monospace}
    progress {width:100%;height:5px;accent-color:#9ec5ff} [hidden]{display:none}
  </style><section><button type="button"><b>✦</b><span>Lume</span><time></time></button><div><small></small><progress max="100"></progress><button type="button" class="on-page" aria-pressed="false">Miniplayer nesta página</button><button type="button" class="mini">Assistir sobre o Lume ↗</button><small role="status"></small></div></section>`;
  const button = root.querySelector('button'), details = root.querySelector('div');
  const time = root.querySelector('time'), label = root.querySelector('span');
  let session = null, collapsed = false;
  let player = null;
  const mini = root.querySelector('.mini'), feedback = root.querySelector('[role=status]');
  const pageMini = root.querySelector('.on-page');
  let closePageMini;
  pageMini.onclick = () => {
    if (closePageMini) { closePageMini(); return; }
    closePageMini = openPageMiniplayer(player, () => {
      closePageMini = null;
      pageMini.textContent = 'Miniplayer nesta página';
      pageMini.setAttribute('aria-pressed','false');
    });
    pageMini.textContent = 'Voltar ao tamanho original';
    pageMini.setAttribute('aria-pressed','true');
  };
  mini.onclick = async () => {
    try {
      const doc = player.ownerDocument;
      if (doc.pictureInPictureElement === player) await doc.exitPictureInPicture();
      else {
        closePageMini?.();
        await player.requestPictureInPicture();
        const result = await chrome.runtime.sendMessage({type:'watch-open-lume'});
        if (!result?.ok) { feedback.textContent = 'Miniplayer aberto. Entre no Lume para ver a aula.'; return; }
      }
      updateMini();
    } catch { feedback.textContent = 'O player bloqueou a janela flutuante. Use “Miniplayer nesta página”.'; }
  };
  function updateMini() {
    mini.disabled = !player?.ownerDocument.pictureInPictureEnabled || player.disablePictureInPicture || !player.requestPictureInPicture;
    mini.textContent = player?.ownerDocument.pictureInPictureElement === player ? 'Fechar miniplayer' : 'Assistir sobre o Lume ↗';
    mini.hidden = mini.disabled;
    feedback.textContent = '';
  }
  const renderToggle = () => {
    details.hidden = collapsed;
    button.setAttribute('aria-expanded', String(!collapsed));
    button.title = collapsed ? 'Expandir o selo do Lume' : 'Recolher o selo do Lume';
  };
  chrome.storage.local.get('watchCollapsed').then(value => { collapsed = Boolean(value.watchCollapsed); renderToggle(); });
  button.onclick = () => { collapsed = !collapsed; renderToggle(); chrome.storage.local.set({ watchCollapsed: collapsed }); };
  const tick = () => { time.textContent = session ? formatSessionDuration(sessionElapsed(session)) : ''; };
  const timer = setInterval(tick, 1000);
  const faces = [['Atkinson Hyperlegible Next','atkinson-hyperlegible-next'],['JetBrains Mono','jetbrains-mono']].map(([family, file]) =>
    new FontFace(family, `url("${chrome.runtime.getURL('fonts/'+file+'-latin.woff2')}")`));
  for (const face of faces) face.load().then(font => { if (host.isConnected) document.fonts.add(font); }).catch(() => {});
  return {
    show(result, video) {
      if (player !== video) {
        closePageMini?.();
        player?.removeEventListener('leavepictureinpicture', updateMini);
        player = video;
        player?.addEventListener('leavepictureinpicture', updateMini);
        updateMini();
      }
      session = result.session?.origin === 'watching' && result.session.stepId === result.stepId ? result.session : null;
      label.textContent = result.login ? 'Entre no Lume para contar o tempo' : result.completed ? 'Aula concluída'
        : session?.status === 'active' ? 'Contando' : result.otherSession ? 'Timer já em uso' : 'Pausado';
      root.querySelector('small').textContent = result.stats ? `Aula ${result.index} de ${result.stats.total}` : '';
      const bar = root.querySelector('progress');
      bar.hidden = !result.stats;
      if (result.stats) bar.value = 100 * result.stats.completed / (result.stats.total || 1);
      tick();
      if (!host.isConnected) document.documentElement.append(host);
      const bounds = video?.getBoundingClientRect();
      host.style.bottom = bounds && bounds.right > innerWidth - host.offsetWidth - 20 && bounds.bottom > innerHeight - host.offsetHeight - 26
        ? Math.max(72, innerHeight - bounds.bottom + 74) + 'px' : '16px';
    },
    remove() { closePageMini?.(); clearInterval(timer); player?.removeEventListener('leavepictureinpicture', updateMini); host.remove(); for (const face of faces) document.fonts.delete(face); },
  };
}
