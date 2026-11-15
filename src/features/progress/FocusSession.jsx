import { useEffect, useRef, useState } from 'react';
import { nextAction } from '../../../public/study-plan.js';
import { focusedTask } from '../../../public/tasks-domain.js';
import { materialType } from '../../../public/domain.js';
import { materialStanding, subjectOf } from '../../../public/subject-domain.js';
import { formatMinutes, formatSessionDuration, minutesByDay, sessionElapsed } from '../../../public/session-domain.js';
import { TIME_BLOCK_MINUTES } from '../../../public/xp-policy.js';
import Icon from '../../ui/Icon.jsx';
import { Button } from '../../ui/ui.jsx';
import { SOUNDSCAPES, createSoundscape } from './soundscape.js';

// Ciclos sugeridos. O ciclo é só uma contagem regressiva sobre a sessão
// declarada: encerrar um ciclo não encerra a sessão nem gera XP.
const CYCLES = [
  { minutes: 10, title: 'Relâmpago' },
  { minutes: 15, title: 'Aquecimento' },
  { minutes: 30, title: 'Clássico' },
  { minutes: 60, title: 'Profunda' },
];
const RADIUS = 118;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const BLOCK_MS = TIME_BLOCK_MINUTES * 60 * 1000;

export default function FocusSession({ state, actions, settingsActions, open, notify, account }) {
  const active = state.activeSession;
  const focus = focusedTask(state);
  const suggestion = nextAction(state);
  const [courseId, setCourseId] = useState(() => active?.courseId || focus?.courseId || suggestion?.courseId || '');
  const [intention, setIntention] = useState('');
  const [cycle, setCycle] = useState(30);
  const [manual, setManual] = useState(false);
  const [custom, setCustom] = useState(25);
  const [offset, setOffset] = useState(0);
  const [sound, setSound] = useState(() => state.preferences?.soundscape || 'off');
  const [volume, setVolume] = useState(45);
  const [notes, setNotes] = useState(() => state.preferences?.focusNotes || '');
  const [notesDirty, setNotesDirty] = useState(false);
  const [lastSummary, setLastSummary] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const audio = useRef(null);
  const chimed = useRef(false);

  const shieldEnabled = Boolean(state.preferences?.focusShield);

  useEffect(() => {
    setNotes(state.preferences?.focusNotes || '');
    setNotesDirty(false);
  }, [state.preferences?.focusNotes]);

  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(clock);
  }, [active?.id, active?.status]);

  useEffect(() => () => audio.current?.close(), []);

  const course = state.courses.find((item) => item.id === courseId) || null;
  const lesson = course && suggestion?.courseId === course.id ? suggestion : null;
  const elapsed = active ? sessionElapsed(active, now) : 0;
  const cycleMs = cycle * 60000;
  const inCycle = Math.max(0, elapsed - offset);
  const remaining = Math.max(0, cycleMs - inCycle);
  const finished = Boolean(active) && remaining === 0;
  const progress = active ? Math.min(1, inCycle / cycleMs) : 0;
  const completedCycles = Math.floor(elapsed / cycleMs);
  const today = minutesByDay(state, 1)[0];
  const goal = state.plan?.availability?.[new Date().getDay()] || state.preferences?.dailyMinutes || 0;

  useEffect(() => {
    if (!finished || chimed.current) return;
    chimed.current = true;
    audio.current ||= createSoundscape();
    audio.current.chime();
    notify('Ciclo concluído. Que tal uma pausa de 5 minutos? A sessão continua aberta até você encerrar.');
  }, [finished, notify]);

  function sounds() {
    audio.current ||= createSoundscape();
    return audio.current;
  }

  function chooseSound(id) {
    setSound(id);
    sounds().setVolume(volume / 100);
    sounds().play(id);
    settingsActions?.setPreference?.('soundscape', id);
  }

  function changeVolume(value) {
    setVolume(value);
    sounds().setVolume(value / 100);
  }

  function chooseCycle(minutes) {
    setCycle(minutes);
    setManual(false);
    restartCycle();
  }

  function restartCycle() {
    setOffset(active ? elapsed : 0);
    chimed.current = false;
  }

  function saveNotes(value = notes) {
    if (!settingsActions?.setPreference) return;
    if (settingsActions.setPreference('focusNotes', value)) {
      setNotesDirty(false);
    }
  }

  function toggleShield(checked) {
    settingsActions?.setPreference?.('focusShield', checked);
  }

  function begin() {
    const label = intention.trim() || focus?.title || (lesson ? lesson.title : course?.title) || 'Sessão de foco';
    if (!actions.startSession({ courseId: course?.id || '', stepId: lesson?.lessonId || '', label, origin: 'focus' })) return;
    setLastSummary(null);
    setOffset(0);
    chimed.current = false;
    if (sound && sound !== 'off') {
      sounds().setVolume(volume / 100);
      sounds().play(sound);
    }
  }

  function finish() {
    if (notesDirty) saveNotes(notes);
    const result = actions.endSession(Date.now());
    if (!result?.session) return;
    sounds().play('off');
    setOffset(0);
    chimed.current = false;
    setLastSummary({
      label: result.session.label || 'Sessão de foco',
      durationMs: result.session.durationMs,
      blocks: Math.floor(result.session.durationMs / BLOCK_MS),
    });
    notify(
      account
        ? `Sessão registrada: ${formatSessionDuration(result.session.durationMs)}. O servidor confirma os blocos de ${TIME_BLOCK_MINUTES} minutos.`
        : `Sessão registrada: ${formatSessionDuration(result.session.durationMs)}. Nesta prévia o tempo fica local; entre na conta para o XP de tempo.`,
      { important: true },
    );
  }

  function openMaterial() {
    if (!course) return;
    if (course.pdf) open({ type: 'pdf', id: course.id });
    else if (lesson) open({ type: 'session', id: course.id, stepId: lesson.lessonId });
    else open({ type: 'course', id: course.id });
  }

  const digits = formatSessionDuration(active ? remaining : cycleMs);
  return <div className="focus-root">
    <header className="focus-heading">
      <div>
        <a className="back-link" href="#hoje"><Icon name="back"/>Voltar ao Início</a>
        <div className="focus-title-row">
          <h1 className="display">Sessão de foco</h1>
          <span className="soft-badge tone-mint">
            <span className="soft-dot" aria-hidden="true"/>
            {active ? (active.status === 'active' ? 'Em foco' : 'Pausada') : 'Pronta para começar'}
          </span>
        </div>
      </div>
      <div className="focus-goal">
        <span><small className="metric-label">Hoje</small><strong>{formatMinutes(today.minutes)}{goal ? ` / ${formatMinutes(goal)}` : ''}</strong></span>
        <span className="metric-icon"><Icon name="clock"/></span>
      </div>
    </header>

    {lastSummary && <section className="card-surface focus-summary-banner" role="status" aria-label="Resumo da sessão encerrada">
      <div className="focus-summary-copy">
        <span className="soft-badge tone-mint"><Icon name="check"/>Sessão encerrada</span>
        <strong>{lastSummary.label}</strong>
        <p className="muted-text">
          Tempo focado: <strong>{formatSessionDuration(lastSummary.durationMs)}</strong> · {lastSummary.blocks} {lastSummary.blocks === 1 ? `bloco de ${TIME_BLOCK_MINUTES} min elegível` : `blocos de ${TIME_BLOCK_MINUTES} min elegíveis`}.
        </p>
      </div>
      <div className="focus-summary-actions">
        {course && <Button secondary onClick={openMaterial}><Icon name="book"/>Marcar avanço no material</Button>}
        <Button ghost onClick={() => setLastSummary(null)}>Fechar</Button>
      </div>
    </section>}

    <div className="focus-grid">
      <div className="focus-main-col">
        <section className="card-surface focus-timer" aria-labelledby="focus-cycle-title">
          <div className="focus-cycles">
            <div className="focus-cycles-head">
              <span id="focus-cycle-title" className="metric-label">Ciclos sugeridos</span>
            </div>
            <div className="cycle-grid" role="group" aria-label="Duração do ciclo">
              {CYCLES.map((item) => <button key={item.minutes} type="button" className="cycle-pill" aria-pressed={!manual && cycle === item.minutes} onClick={() => chooseCycle(item.minutes)}>
                <strong>{item.minutes < 60 ? `${item.minutes} min` : '1h'}</strong><small>{item.title}</small>
              </button>)}
              <button type="button" className="cycle-pill" aria-pressed={manual} aria-expanded={manual} onClick={() => setManual(!manual)}>
                <strong><Icon name="tune"/>Manual</strong><small>Personalizar</small>
              </button>
            </div>
            {manual && <div className="cycle-custom">
              <label htmlFor="focus-custom">Duração personalizada (minutos)</label>
              <div className="cycle-stepper">
                <button type="button" className="icon-button" aria-label="Menos 5 minutos" onClick={() => setCustom(Math.max(5, custom - 5))}><Icon name="minus"/></button>
                <input id="focus-custom" type="number" min={1} max={180} value={custom} onChange={(event) => setCustom(Math.max(1, Math.min(180, Number(event.target.value) || 1)))}/>
                <button type="button" className="icon-button" aria-label="Mais 5 minutos" onClick={() => setCustom(Math.min(180, custom + 5))}><Icon name="plus"/></button>
                <Button secondary onClick={() => { setCycle(custom); restartCycle(); }}>Aplicar</Button>
              </div>
            </div>}
          </div>

          <div className="focus-dial">
            <svg viewBox="0 0 280 280" aria-hidden="true" focusable="false">
              <circle cx="140" cy="140" r={RADIUS} className="focus-dial-track"/>
              <circle cx="140" cy="140" r="98" className="focus-dial-well"/>
              <circle cx="140" cy="140" r={RADIUS} className="focus-dial-progress" strokeDasharray={CIRCUMFERENCE} strokeDashoffset={CIRCUMFERENCE * (1 - progress)}/>
            </svg>
            <div className="focus-dial-center">
              <span className="soft-badge tone-mint"><Icon name="timer"/>Ciclo {completedCycles + 1}</span>
              <strong className="focus-digits" role="timer" aria-label={active ? `Faltam ${digits} no ciclo` : `Ciclo de ${cycle} minutos`}>{digits}</strong>
              <small>{finished ? 'Ciclo concluído' : null} Pausa sugerida: <span className="tone-mint-text">5 min</span></small>
            </div>
          </div>

          <div className="focus-controls">
            {!active && <Button className="large" onClick={begin}><Icon name="play"/>Iniciar foco</Button>}
            {active && <Button className="large" secondary={active.status !== 'active'} onClick={actions.toggleSessionPause}><Icon name={active.status === 'active' ? 'pause' : 'play'}/>{active.status === 'active' ? 'Pausar' : 'Retomar'}</Button>}
            {active && <Button secondary onClick={restartCycle}><Icon name="restart"/>{finished ? 'Novo ciclo' : 'Reiniciar'}</Button>}
            {active && <Button secondary onClick={finish}><Icon name="check"/>Finalizar</Button>}
          </div>
        </section>
      </div>

      <div className="focus-side">
        <section className="card-surface focus-panel" aria-labelledby="focus-sound-title">
          <div className="card-heading">
            <div>
              <span className="card-icon tone-mint"><Icon name="headphones"/></span>
              <h2 id="focus-sound-title" className="title">Som ambiente</h2>
            </div>
          </div>
          <div className="sound-grid" role="group" aria-label="Som de fundo">
            {SOUNDSCAPES.map((item) => <button key={item.id} type="button" className="sound-chip" aria-pressed={sound === item.id} onClick={() => chooseSound(item.id)}>
              <Icon name={item.icon}/><span><strong>{item.title}</strong></span>
            </button>)}
          </div>
          <label className="volume-row"><Icon name="mute"/><span className="sr-only">Volume</span><input type="range" min={0} max={100} value={volume} onChange={(event) => changeVolume(Number(event.target.value))}/><Icon name="volume"/></label>
          <label className="focus-shield-row">
            <span><strong>Escudo de foco</strong></span>
            <input type="checkbox" role="switch" switch="" checked={shieldEnabled} title="Silencia avisos não essenciais enquanto a sessão estiver ativa." onChange={(event) => toggleShield(event.target.checked)}/>
          </label>
        </section>

        <section className="card-surface focus-panel" aria-labelledby="focus-material-title">
          <div className="card-heading">
            <div>
              <span className="card-icon"><Icon name="book"/></span>
              <h2 id="focus-material-title" className="title">Material da sessão</h2>
            </div>
          </div>
          {active
            ? <p className="muted-text">Sessão em andamento: <strong>{active.label}</strong></p>
            : <label className="field"><span className="sr-only">Material ou trilha</span>
              <select aria-label="Material ou trilha" value={courseId} onChange={(event) => setCourseId(event.target.value)}>
                <option value="">Estudo livre, sem material</option>
                {state.courses.map((item) => <option key={item.id} value={item.id}>{item.title}{subjectOf(state, item) ? ` · ${subjectOf(state, item).title}` : ''}</option>)}
              </select>
            </label>}
          {course && <div className="focus-material">
            <span className="reading-icon"><Icon name={course.pdf ? 'file' : 'book'}/></span>
            <span className="focus-material-copy">
              <strong>{lesson && !course.pdf ? lesson.title : course.title}</strong>
              <small>{materialType(course.type).title} · {course.pdf ? materialStanding(state, course).label : lesson ? `Próximo passo de ${course.title}` : 'Material da biblioteca'}</small>
            </span>
            <button type="button" className="text-button accent" onClick={openMaterial} aria-label={`Abrir ${course.title}`}>Abrir<Icon name="external"/></button>
          </div>}
          {!active && <label className="field"><span className="sr-only">Intenção desta sessão</span>
            <input aria-label="Intenção desta sessão" value={intention} maxLength={160} onChange={(event) => setIntention(event.target.value)} placeholder="Intenção desta sessão (opcional)"/>
          </label>}
        </section>

        <section className="card-surface focus-panel focus-zen-notes" aria-labelledby="focus-notes-title">
          <div className="card-heading">
            <div>
              <span className="card-icon tone-lume"><Icon name="notes"/></span>
              <h2 id="focus-notes-title" className="title">Anotações rápidas</h2>
            </div>
          </div>
          <label className="sr-only" htmlFor="zen-focus-notes">Anotações rápidas da sessão</label>
          <textarea
            id="zen-focus-notes"
            rows={4}
            maxLength={4000}
            value={notes}
            placeholder="Escreva uma nota…"
            onChange={(event) => { setNotes(event.target.value); setNotesDirty(true); }}
            onBlur={() => { if (notesDirty) saveNotes(); }}
          />
        </section>
      </div>
    </div>
  </div>;
}
