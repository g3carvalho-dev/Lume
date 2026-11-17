import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../ui/Icon.jsx';
import { Button, PersonAvatar, STAR_PATH, Star } from '../../ui/ui.jsx';
import { useResource } from '../../lib/resources.js';
import { warmProfile } from './prefetch.js';
import { openMessagesDock } from './dock-bus.js';

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

const CARD_CONSTELLATION = [[22, 46], [62, 24], [104, 38], [148, 18]];

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
      const width = Math.min(344, window.innerWidth - 32);
      const left = Math.max(16, Math.min(box.left, window.innerWidth - width - 16));
      const height = ref.current?.offsetHeight || 310;
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
  const [starX, starY] = CARD_CONSTELLATION[CARD_CONSTELLATION.length - 1];
  const relationLabel = self ? 'Você' : data?.relation === 'friend' ? 'Amigo' : '';

  const panel = <div
    ref={ref}
    className={`person-card ${sheet ? 'is-sheet' : ''}`}
    role="dialog"
    aria-label={`Cartão de ${shown.name || 'pessoa'}`}
    tabIndex={-1}
    style={sheet ? undefined : { top: position?.top ?? -9999, left: position?.left ?? -9999, width: position?.width }}
  >
    <div className="person-card-banner" aria-hidden="true">
      <svg className="person-card-constellation" viewBox="0 0 180 64" preserveAspectRatio="xMaxYMid meet">
        <polyline points={CARD_CONSTELLATION.map((point) => point.join(',')).join(' ')} className="person-card-constellation-line"/>
        {CARD_CONSTELLATION.slice(0, -1).map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2" className="person-card-constellation-dot"/>
        ))}
        <path d={STAR_PATH} className="person-card-constellation-star" transform={`translate(${starX - 7} ${starY - 7}) scale(0.58)`}/>
      </svg>
      <div className="person-card-banner-fade"/>
    </div>
    <button type="button" className="icon-button person-card-close" onClick={onClose} aria-label="Fechar cartão"><Icon name="close"/></button>
    <div className="person-card-body">
      <div className="person-card-top">
        <PersonAvatar person={shown} className="person-card-avatar"/>
        {relationLabel && (
          <span className={`person-card-badge ${self ? 'is-self' : ''}`}>
            {self && <Star size={10}/>}
            {relationLabel}
          </span>
        )}
      </div>
      <div className="person-card-who">
        <strong>{shown.name}</strong>
        {shown.handle && <span className="mono">@{shown.handle}</span>}
      </div>
      {missing
        ? <p className="quiet-note person-card-error">{card.error}</p>
        : <dl className={`person-card-stats ${!data?.ranking ? 'is-single' : ''}`}>
          <div>
            <dt><Star size={11}/>Nível</dt>
            <dd className="mono">{data ? (data.level ?? '—') : <span className="person-card-stat-loading" aria-label="Carregando"/>}</dd>
          </div>
          {data?.ranking && (
            <div>
              <dt><Icon name="trophy"/>Ranking</dt>
              <dd className="mono">{data.ranking.position}º <small>de {data.ranking.participants}</small></dd>
            </div>
          )}
        </dl>}
      <div className="person-card-actions">
        <Button secondary onClick={() => open(profileRoute(shown, { self }))} disabled={missing}><Icon name="user"/>{self ? 'Meu perfil' : 'Ver perfil'}</Button>
        {!self && data?.canMessage && <Button onClick={() => { onClose(); openMessagesDock({ contactId: shown.id }); }}><Icon name="message"/>Enviar mensagem</Button>}
      </div>
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
