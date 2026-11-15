import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import { api, apiError } from '../../lib/api.js';
import { EMOJI_GROUPS } from '../../../public/social-emoji.js';

const RECENT_KEY = 'lume.emoji.recent';
const ALL = EMOJI_GROUPS.flatMap((group) => group.items);

function readRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    const known = new Set(ALL.map(([emoji]) => emoji));
    return Array.isArray(list) ? list.filter((emoji) => known.has(emoji)).slice(0, 10) : [];
  } catch { return []; }
}

function remember(emoji) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([emoji, ...readRecent().filter((item) => item !== emoji)].slice(0, 10)));
  } catch { /* a lista de recentes é só uma conveniência */ }
}

function EmojiTab({ onEmoji }) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('recent');
  const recent = readRecent();
  const text = query.trim().toLocaleLowerCase('pt-BR');
  const groups = [{ id: 'recent', title: 'Recentes', icon: 'clock', items: recent.map((emoji) => [emoji, '']) }, ...EMOJI_GROUPS];
  const current = groups.find((item) => item.id === group && (item.id !== 'recent' || recent.length)) || EMOJI_GROUPS[0];
  const shown = text ? ALL.filter(([, name]) => name.includes(text)) : current.items;
  return <div className="sf-picker-pane">
    <label className="sf-picker-search"><Icon name="search"/><span className="sr-only">Buscar emoji</span><input type="search" value={query} placeholder="Buscar emoji" onChange={(event) => setQuery(event.target.value)}/></label>
    {!text && <div className="sf-picker-groups" role="group" aria-label="Categorias de emoji">
      {groups.filter((item) => item.id !== 'recent' || recent.length).map((item) => <button key={item.id} type="button" className="sf-picker-group" aria-pressed={current.id === item.id} aria-label={item.title} title={item.title} onClick={() => setGroup(item.id)}><Icon name={item.icon}/></button>)}
    </div>}
    <div className="sf-picker-grid" role="group" aria-label={text ? 'Resultados' : current.title}>
      {shown.map(([emoji, name]) => <button key={emoji} type="button" className="sf-picker-emoji" aria-label={name || emoji} onClick={() => { remember(emoji); onEmoji(emoji); }}>{emoji}</button>)}
      {text && shown.length === 0 && <p className="sf-picker-empty">Nenhum emoji encontrado.</p>}
    </div>
  </div>;
}

function GifTab({ onGif }) {
  const [query, setQuery] = useState('');
  const [state, setState] = useState({ loading: true, available: true, gifs: [], error: '' });
  useEffect(() => {
    let alive = true;
    setState((value) => ({ ...value, loading: true, error: '' }));
    const timer = setTimeout(async () => {
      const result = await api(`/api/social/gifs?q=${encodeURIComponent(query.trim())}`);
      if (!alive) return;
      if (!result.ok) setState({ loading: false, available: true, gifs: [], error: apiError(result) });
      else setState({ loading: false, available: result.data.available, gifs: result.data.gifs, error: '' });
    }, query ? 350 : 0);
    return () => { alive = false; clearTimeout(timer); };
  }, [query]);
  return <div className="sf-picker-pane">
    <label className="sf-picker-search"><Icon name="search"/><span className="sr-only">Buscar GIF</span><input type="search" value={query} placeholder="Buscar GIF" onChange={(event) => setQuery(event.target.value)}/></label>
    {!state.available
      ? <p className="sf-picker-empty">A busca de GIFs ainda não está ativada neste ambiente.</p>
      : state.error
        ? <p className="sf-picker-empty" role="alert">{state.error}</p>
        : <div className="sf-gif-grid" role="group" aria-label="GIFs">
          {state.gifs.map((gif) => <button key={gif.id} type="button" className="sf-gif" aria-label={gif.title || 'GIF'} onClick={() => onGif(gif)}><img src={gif.preview} alt="" loading="lazy"/></button>)}
          {!state.loading && state.gifs.length === 0 && <p className="sf-picker-empty">Nenhum GIF encontrado.</p>}
        </div>}
    <small className="sf-picker-credit">GIFs por Giphy</small>
  </div>;
}

// Botão com painel de emojis (e, quando há onGif, de GIFs). Fecha ao escolher,
// ao clicar fora ou com Esc, devolvendo o foco ao botão.
export default function EmojiButton({ onEmoji, onGif, label = 'Emoji', className = '', align = 'left', children, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('emoji');
  const root = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => { if (!root.current?.contains(event.target)) close(); };
    const escape = (event) => { if (event.key === 'Escape') { event.stopPropagation(); close(); root.current?.querySelector('button')?.focus(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open, close]);
  const choose = (handler) => (value) => { close(); handler(value); };
  return <span className="sf-picker" ref={root}>
    <button type="button" className={className} aria-label={label} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={() => { setTab(onEmoji ? 'emoji' : 'gif'); setOpen((value) => !value); }}>{children}</button>
    {open && <div className={`sf-picker-panel align-${align}`} role="dialog" aria-label="Emojis e GIFs">
      {onEmoji && onGif && <div className="sf-picker-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'emoji'} onClick={() => setTab('emoji')}><Icon name="smile"/>Emojis</button>
        <button type="button" role="tab" aria-selected={tab === 'gif'} onClick={() => setTab('gif')}><span className="sf-gif-tag">GIF</span>GIFs</button>
      </div>}
      {tab === 'emoji' && onEmoji ? <EmojiTab onEmoji={choose(onEmoji)}/> : <GifTab onGif={choose(onGif)}/>}
    </div>}
  </span>;
}
