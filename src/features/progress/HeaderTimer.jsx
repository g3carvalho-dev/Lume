// Timer de estudo no cabeçalho: um controle pequeno que inicia, pausa e encerra
// uma sessão sobre o que a pessoa já está fazendo. Estudar é abrir o conteúdo;
// o timer é acessório, nunca condição, e pode ser desligado em Configurações ›
// Ritmo de estudo (`preferences.focusTimer`). As regras de sessão, tempo
// elegível e XP continuam em `public/session-domain.js` e no servidor.
//
// No celular o controle do cabeçalho some: um botão flutuante pequeno aparece
// acima da barra inferior só com sessão em andamento, e iniciar fica no menu da conta.

import { useEffect, useRef, useState } from 'react';
import { nextAction } from '../../../public/study-plan.js';
import { focusedTask } from '../../../public/tasks-domain.js';
import { subjectOf } from '../../../public/subject-domain.js';
import { formatSessionDuration, sessionElapsed } from '../../../public/session-domain.js';
import { TIME_BLOCK_MINUTES } from '../../../public/xp-policy.js';
import Icon from '../../ui/Icon.jsx';
import { SOUNDSCAPES, createSoundscape } from './soundscape.js';

export const TIMER_POPOVER_ID = 'timer-popover';

// Ciclo é só uma contagem regressiva sobre a sessão declarada: chegar a zero
// toca um sino baixo, mas não encerra a sessão nem gera XP.
const CYCLES = [10, 15, 30, 60];
const OPEN_TYPES = new Set(['session', 'pdf', 'course', 'slides']);

export function timerEnabled(state) {
  return state.preferences?.focusTimer !== false;
}

// Abre o painel pelo menu da conta (celular). O menu é fechado antes, para o
// painel não virar um popover aninhado nele.
export function openTimerPanel() {
  try { document.getElementById(TIMER_POPOVER_ID)?.showPopover?.(); } catch { /* já aberto */ }
}

export default function HeaderTimer({ state, actions, settingsActions, notify, account, current, positionFallback }) {
  const active = state.activeSession;
  const enabled = timerEnabled(state);
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);
  const audio = useRef(null);
  const chimed = useRef(false);
  const [picked, setPicked] = useState(null);
  const [cycle, setCycle] = useState(30);
  const [custom, setCustom] = useState('');
  const [offset, setOffset] = useState(0);
  const [volume, setVolume] = useState(45);
  const [now, setNow] = useState(() => Date.now());
  // O conteúdo do painel só existe aberto: fechado, nada dele fica na página.
  const [opened, setOpened] = useState(false);
  const sound = state.preferences?.soundscape || 'off';

  useEffect(() => {
    if (!active || active.status !== 'active') return undefined;
    setNow(Date.now());
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(clock);
  }, [active?.id, active?.status]);

  // Sessão nova (inclusive a de leitura) começa o ciclo do zero.
  useEffect(() => { setOffset(0); chimed.current = false; }, [active?.id]);

  // Sem sessão, o som para; ao pausar, também.
  useEffect(() => {
    if (!active || active.status !== 'active') audio.current?.play('off');
  }, [active?.id, active?.status]);

  useEffect(() => () => audio.current?.close(), []);

  const reading = active?.origin === 'reading';
  const elapsed = active ? sessionElapsed(active, now) : 0;
  const cycleMs = cycle * 60000;
  const remaining = Math.max(0, cycleMs - Math.max(0, elapsed - offset));
  const finished = Boolean(active) && !reading && remaining === 0;

  useEffect(() => {
    if (!finished || chimed.current) return;
    chimed.current = true;
    sounds().chime();
    notify('Ciclo concluído. A sessão continua aberta até você encerrar.');
  }, [finished, notify]);

  // Material: o conteúdo aberto agora, senão a tarefa em foco ou a próxima do roteiro.
  const openId = current && OPEN_TYPES.has(current.type) ? current.id : '';
  const focus = focusedTask(state);
  const suggestion = nextAction(state);
  const fallbackId = openId || focus?.courseId || suggestion?.courseId || '';
  const courseId = picked ?? fallbackId;
  const course = state.courses.find((item) => item.id === courseId) || null;
  const lesson = course && suggestion?.courseId === course.id && !course.pdf ? suggestion : null;

  // Uma sessão de foco já aberta continua controlável mesmo com o timer desligado.
  if (!enabled && !(active && !reading)) return null;

  function sounds() {
    audio.current ||= createSoundscape();
    return audio.current;
  }

  function chooseSound(id) {
    settingsActions?.setPreference?.('soundscape', id);
    if (active?.status === 'active') {
      sounds().setVolume(volume / 100);
      sounds().play(id);
    }
  }

  function changeVolume(value) {
    setVolume(value);
    sounds().setVolume(value / 100);
  }

  function chooseCycle(minutes) {
    const value = Math.max(1, Math.min(180, Math.round(Number(minutes) || 0)));
    if (!value) return;
    setCycle(value);
    setOffset(active ? elapsed : 0);
    chimed.current = false;
  }

  function begin() {
    const label = focus?.title || (lesson ? lesson.title : course?.title) || 'Sessão de estudo';
    if (!actions.startSession({ courseId: course?.id || '', stepId: lesson?.lessonId || '', label, origin: 'focus' })) return;
    setOffset(0);
    chimed.current = false;
    if (sound !== 'off') {
      sounds().setVolume(volume / 100);
      sounds().play(sound);
    }
  }

  function togglePause() {
    const resuming = active?.status !== 'active';
    if (!actions.toggleSessionPause()) return;
    if (resuming && sound !== 'off') {
      sounds().setVolume(volume / 100);
      sounds().play(sound);
    }
  }

  function finish() {
    const result = actions.endSession(Date.now());
    if (!result?.session) return;
    audio.current?.play('off');
    setPicked(null);
    try { popoverRef.current?.hidePopover?.(); } catch { /* já fechado */ }
    const duration = formatSessionDuration(result.session.durationMs);
    notify(account
      ? `Sessão registrada: ${duration}. O servidor confirma os blocos de ${TIME_BLOCK_MINUTES} minutos.`
      : `Sessão registrada: ${duration}. Nesta prévia o tempo fica local; entre na conta para o XP de tempo.`,
    { important: true });
  }

  const status = !active ? 'idle' : active.status === 'active' ? 'running' : 'paused';
  const digits = formatSessionDuration(reading ? elapsed : remaining);
  const statusLabel = status === 'idle' ? 'Timer de estudo' : `${status === 'running' ? 'Timer em andamento' : 'Timer pausado'}: ${reading ? `${digits} de leitura` : `faltam ${digits} no ciclo`}`;
  const onToggle = (event) => {
    setOpened(event.newState === 'open');
    if (event.newState === 'open') requestAnimationFrame(() => positionFallback?.(popoverRef.current, triggerRef.current));
  };

  return <>
    <button
      type="button"
      ref={triggerRef}
      popoverTarget={TIMER_POPOVER_ID}
      className={`header-timer is-${status}${finished ? ' is-finished' : ''}`}
      aria-label={statusLabel}
      title={statusLabel}
    >
      <Icon name={status === 'paused' ? 'pause' : 'timer'}/>
      {status !== 'idle' && <span className="header-timer-digits" aria-hidden="true">{digits}</span>}
    </button>
    {status !== 'idle' && <button
      type="button"
      popoverTarget={TIMER_POPOVER_ID}
      className={`timer-fab is-${status}`}
      aria-label={statusLabel}
    >
      <Icon name={status === 'paused' ? 'pause' : 'timer'}/>
      <span aria-hidden="true">{digits}</span>
    </button>}
    <div id={TIMER_POPOVER_ID} ref={popoverRef} popover="auto" className="shell-popover timer-popover anchored-overlay" onToggle={onToggle} aria-label="Timer de estudo">
      {opened && <>
      <div className="timer-popover-head">
        <strong>Timer de estudo</strong>
        {status !== 'idle' && <span className="timer-popover-time" role="timer">{digits}<small>{reading ? 'de leitura' : status === 'paused' ? 'pausado' : finished ? 'ciclo concluído' : 'no ciclo'}</small></span>}
      </div>

      {status === 'idle'
        ? <label className="timer-field">
          <span>Material</span>
          <select aria-label="Material da sessão" value={courseId} onChange={(event) => setPicked(event.target.value)}>
            <option value="">Estudo livre, sem material</option>
            {state.courses.map((item) => <option key={item.id} value={item.id}>{item.title}{subjectOf(state, item) ? ` · ${subjectOf(state, item).title}` : ''}</option>)}
          </select>
        </label>
        : <p className="timer-current">{active.label || 'Sessão de estudo'}</p>}

      {!reading && <div className="timer-field">
        <span id="timer-cycle-label">Ciclo</span>
        <div className="timer-chips" role="group" aria-labelledby="timer-cycle-label">
          {CYCLES.map((minutes) => <button key={minutes} type="button" aria-pressed={cycle === minutes} onClick={() => chooseCycle(minutes)}>{minutes < 60 ? `${minutes} min` : '1 h'}</button>)}
          <input
            type="number"
            min={1}
            max={180}
            inputMode="numeric"
            aria-label="Ciclo personalizado, em minutos"
            placeholder="outro"
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
            onBlur={() => { if (custom) chooseCycle(custom); }}
            onKeyDown={(event) => { if (event.key === 'Enter' && custom) chooseCycle(custom); }}
          />
        </div>
      </div>}

      <div className="timer-field">
        <span id="timer-sound-label">Som ambiente</span>
        <div className="timer-chips" role="group" aria-labelledby="timer-sound-label">
          {SOUNDSCAPES.map((item) => <button key={item.id} type="button" aria-pressed={sound === item.id} onClick={() => chooseSound(item.id)}><Icon name={item.icon}/>{item.title}</button>)}
        </div>
        {sound !== 'off' && <label className="timer-volume"><Icon name="mute"/><span className="sr-only">Volume</span><input type="range" min={0} max={100} value={volume} onChange={(event) => changeVolume(Number(event.target.value))}/><Icon name="volume"/></label>}
      </div>

      <div className="timer-actions">
        {status === 'idle'
          ? <button type="button" className="button primary" onClick={begin}><Icon name="play"/>Iniciar</button>
          : <>
            <button type="button" className="button secondary" onClick={togglePause}><Icon name={status === 'running' ? 'pause' : 'play'}/>{status === 'running' ? 'Pausar' : 'Retomar'}</button>
            <button type="button" className="button secondary" onClick={finish}><Icon name="check"/>Encerrar</button>
          </>}
      </div>
      </>}
    </div>
  </>;
}
