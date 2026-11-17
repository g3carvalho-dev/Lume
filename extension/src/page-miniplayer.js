// Conserva o elemento da plataforma, sua posição de reprodução e seus ouvintes.
// O top layer permite que o player saia de contêineres com overflow ou transform.
export function openPageMiniplayer(video, onClose) {
  const playerDoc = video.ownerDocument;
  const frame = (playerDoc !== document && playerDoc.defaultView.frameElement)
    || video.closest('.video-js, [data-purpose="video-player"], [data-purpose="video-player-container"]') || video;
  const doc = frame.ownerDocument;
  const bounds = frame.getBoundingClientRect();
  const ratio = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9;
  const placeholder = doc.createElement('div');
  if (!['absolute','fixed'].includes(doc.defaultView.getComputedStyle(frame).position)) {
    Object.assign(placeholder.style, {width:'100%', maxWidth:bounds.width+'px', height:bounds.height+'px'});
    frame.before(placeholder);
  }
  const size = 'min(360px, 44vw, ' + Math.round(55 * ratio) + 'vh)';
  const styles = {
    position:'fixed', top:'12px', right:'12px', bottom:'auto', left:'auto', width:size,
    height:'auto', 'min-height':'0', 'min-width':'0', 'max-height':'none', 'max-width':'none',
    'aspect-ratio':String(ratio), 'object-fit':'contain', 'z-index':'2147483645',
  };
  for (const side of ['top','right','bottom','left']) {
    styles['margin-'+side]='0';
    styles['padding-'+side]='0';
  }
  const original = Object.keys(styles).map(key => [key,frame.style.getPropertyValue(key),frame.style.getPropertyPriority(key)]);
  const nativeControls = video.controls;
  let popover = false;
  if (frame.showPopover && !frame.hasAttribute('popover') && !doc.fullscreenElement) {
    frame.setAttribute('popover','manual');
    try { frame.showPopover(); popover=true; } catch { frame.removeAttribute('popover'); }
  }
  for (const [key,value] of Object.entries(styles)) frame.style.setProperty(key,value,'important');
  if (frame === video) video.controls = true;
  let closed = false;
  function close() {
    if (closed) return;
    closed=true;
    if (popover) {
      if (frame.matches(':popover-open')) frame.hidePopover();
      frame.removeAttribute('popover');
    }
    for (const [key,value,priority] of original) {
      if (value) frame.style.setProperty(key,value,priority);
      else frame.style.removeProperty(key);
    }
    if (frame === video) video.controls = nativeControls;
    placeholder.remove();
    doc.removeEventListener('keydown',escape,true);
    if (playerDoc !== doc) playerDoc.removeEventListener('keydown',escape,true);
    onClose();
  }
  function escape(event) {
    if (event.key === 'Escape') close();
  }
  doc.addEventListener('keydown',escape,true);
  if (playerDoc !== doc) playerDoc.addEventListener('keydown',escape,true);
  return close;
}
