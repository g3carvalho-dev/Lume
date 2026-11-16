import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../ui/Icon.jsx';
import { Button, PersonAvatar } from '../../ui/ui.jsx';
import { useResource } from '../../lib/resources.js';
import { warmProfile } from './prefetch.js';

// Cartão rápido da pessoa: a mesma peça no Feed, no Ranking, em Amigos e em
// Mensagens. Clicar no nome ou na foto abre foto, nome, @usuário, nível, posição
// no ranking (só para quem participa) e os atalhos Ver perfil e Enviar mensagem.
// Os dados vêm de GET /api/people/:id; enquanto carregam, o cartão mostra o que a
// tela já sabia da pessoa. Nada disso gera XP.

export function profileRoute(person, { self = false } = {}) {
  if (self) return 'perfil';
  if (person?.handle) return `perfil?u=${person.handle}`;
  return `perfil?id=${encodeURIComponent(person?.id || '')}`;
}

const SHEET = '(max-width: 600px)';

function PersonCardPanel({ person, anchor, go, onClose }) {
  const card = useResource(person?.id ? `/api/people/${encodeURIComponent(person.id)}` : '');
  const data = card.data;
  const shown = { ...person, ...(data?.person || {}) };
  const self = data?.relation === 'self' || person?.isSelf;
  const ref = useRef(null);
  const [position, setPosition] = useState(null);
  const sheet = typeof matchMedia === 'function' && matchMedia(SHEET).matches;

  useLayoutEffect(() => {
    if (sheet || !anchor) return;
    const place = () => {
      const box = anchor.getBoundingClientRect();
      const width = Math.min(320, window.innerWidth - 32);
      const left = Math.max(16, Math.min(box.left, window.innerWidth - width - 16));
      const height = ref.current?.offsetHeight || 260;
      const below = box.bottom + 8;
      const top = below + height > window.innerHeight - 16 && box.top - height - 8 > 16 ? box.top - height - 8 : below;
      setPosition({ top: Math.max(16, top), left, width });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [anchor, sheet, Boolean(data)]);

  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    const escape = (event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    const outside = (event) => {
      if (ref.current?.contains(event.target) || anchor?.contains(event.target)) return;
      onClose();
    };
    document.addEventListener('keydown', escape, true);
    document.addEventListener('pointerdown', outside);
    return () => { document.removeEventListener('keydown', escape, true); document.removeEventListener('pointerdown', outside); };
  }, [anchor, onClose]);

  const open = (route) => { onClose(); go(route); };
  const missing = card.error && !data;
  const panel = <div
    ref={ref}
    className={`person-card ${sheet ? 'is-sheet' : ''}`}
    role="dialog"
    aria-label={`Cartão de ${shown.name || 'pessoa'}`}
    tabIndex={-1}
    style={sheet ? undefined : { top: position?.top ?? -9999, left: position?.left ?? -9999, width: position?.width }}
  >
    <div className="person-card-head">
      <PersonAvatar person={shown} className="person-card-avatar"/>
      <div className="person-card-who">
        <strong>{shown.name}</strong>
        {shown.handle && <span className="mono">@{shown.handle}</span>}
      </div>
      <button type="button" className="icon-button person-card-close" onClick={onClose} aria-label="Fechar cartão"><Icon name="close"/></button>
    </div>
    {missing
      ? <p className="quiet-note">{card.error}</p>
      : <dl className="person-card-stats">
        <div><dt>Nível</dt><dd className="mono">{data ? (data.level ?? '—') : '…'}</dd></div>
        {data?.ranking && <div><dt>Ranking</dt><dd className="mono">{data.ranking.position}º <small>de {data.ranking.participants}</small></dd></div>}
      </dl>}
    <div className="person-card-actions">
      <Button secondary onClick={() => open(profileRoute(shown, { self }))} disabled={missing}><Icon name="user"/>{self ? 'Meu perfil' : 'Ver perfil'}</Button>
      {!self && data?.canMessage && <Button onClick={() => open(`mensagens?com=${encodeURIComponent(shown.id)}`)}><Icon name="message"/>Enviar mensagem</Button>}
    </div>
  </div>;

  return createPortal(<>
    {sheet && <div className="person-card-backdrop" aria-hidden="true" onClick={onClose}/>}
    {panel}
  </>, document.body);
}

// Botão que abre o cartão. `children` é o que a tela já desenhava (foto, nome);
// sem `children`, desenha foto e nome.
export function PersonButton({ person, go, className = '', label, children, ...props }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef(null);
  const close = useCallback(() => {
    setOpen(false);
    if (anchor.current?.isConnected) anchor.current.focus({ preventScroll: true });
  }, []);
  if (!person?.id) return children || null;
  return <>
    <button
      ref={anchor}
      type="button"
      className={`person-button ${className}`}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={label || `Abrir cartão de ${person.name}`}
      onPointerEnter={() => warmProfile(person)}
      onFocus={() => warmProfile(person)}
      onClick={(event) => { event.stopPropagation(); setOpen((value) => !value); }}
      {...props}
    >
      {children || <><PersonAvatar person={person} className="social-avatar small"/><strong>{person.name}</strong></>}
    </button>
    {open && <PersonCardPanel person={person} anchor={anchor.current} go={go} onClose={close}/>}
  </>;
}
