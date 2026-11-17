// Tela Início (#hoje) na identidade Norte: saudação direta, "você parou aqui"
// com a constelação do módulo atual, o que vem aí em contagem regressiva, a
// lista do dia, a semana em pontos de luz e os amigos ativos. Tudo derivado do
// estado real; sem dados, ficam os estados vazios.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { studyRhythm, hasPreparation } from '../../../public/domain.js';
import { materialLesson } from '../../../public/material-model.js';
import { isImportedCourse } from '../../../public/import-domain.js';
import { nextAction } from '../../../public/study-plan.js';
import { focusedTask, isOverdue, priorityLabel, taskAgenda } from '../../../public/tasks-domain.js';
import { formatMinutes, localDay } from '../../../public/session-domain.js';
import { WEEKDAYS, daysUntil, moduleTrail, shortDate, trailWindow, upcomingDeadlines, weekLights } from '../../../public/home-domain.js';
import { XP_VALUES, completionKindForCourse, isEligibleCourse } from '../../../public/xp-policy.js';
import { materialStanding, subjectOf } from '../../../public/subject-domain.js';
import { readingLabel } from '../../../public/pdf-domain.js';
import { overdueMessage } from '../plan/Tasks.jsx';
import Icon from '../../ui/Icon.jsx';
import { Button, Progress, STAR_PATH, Star } from '../../ui/ui.jsx';
import { ActiveFriendList, useActiveFriends } from '../social/ActiveFriends.jsx';

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

function useWidth(fallback) {
  const ref = useRef(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(200, Math.round(entry.contentRect.width))));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

// Altura relativa de cada ponto: fixa pela posição da aula, para a forma não mudar ao avançar.
const HEIGHTS = [0.72, 0.44, 0.64, 0.26, 0.56, 0.3, 0.58, 0.22, 0.5, 0.36, 0.68];

// Constelação do módulo: concluídas = pontos azul-claros ligados por linha,
// atual = estrela dourada, futuras = pontos vazados com linha tracejada.
function Constellation({ trail, label }) {
  const [ref, width] = useWidth(640);
  const narrow = width < 440;
  const height = narrow ? 64 : 96;
  const radius = narrow ? 5 : 6;
  const star = narrow ? 30 : 42;
  const visible = trailWindow(trail.nodes, trail.current, narrow ? 7 : 11);
  const pad = star / 2;
  const step = visible.length > 1 ? (width - pad * 2) / (visible.length - 1) : 0;
  const points = visible.map((node, index) => ({
    ...node,
    x: visible.length > 1 ? pad + step * index : width / 2,
    y: pad + (height - pad * 2) * HEIGHTS[node.index % HEIGHTS.length],
  }));
  const currentAt = points.findIndex((point) => point.state === 'current');
  const line = (list) => list.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  const walked = currentAt >= 0 ? points.slice(0, currentAt + 1) : [];
  const ahead = currentAt >= 0 ? points.slice(currentAt) : points;
  return <div ref={ref} className="constellation">
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label={label}>
      {walked.length > 1 && <polyline points={line(walked)} className="constellation-walked"/>}
      {ahead.length > 1 && <polyline points={line(ahead)} className="constellation-ahead"/>}
      {points.map((point) => point.state === 'current'
        ? <path key={point.id} d={STAR_PATH} className="constellation-star" transform={`translate(${(point.x - star / 2).toFixed(1)} ${(point.y - star / 2).toFixed(1)}) scale(${star / 24})`}/>
        : <circle key={point.id} cx={point.x.toFixed(1)} cy={point.y.toFixed(1)} r={radius} className={point.state === 'done' ? 'constellation-done' : 'constellation-todo'}/>)}
    </svg>
  </div>;
}

function headlineFor({ focus, action, trail, unit }) {
  if (focus) return `Seu foco agora: ${focus.title}.`;
  if (action?.pdf) {
    return action.pdf.started
      ? `Você está na página ${action.pdf.page} de ${action.pdf.pages}.`
      : `${plural(action.pdf.pages, 'página', 'páginas')} pra ler em ${action.courseTitle}.`;
  }
  if (action) {
    const remaining = trail?.module ? trail.remaining : action.remaining;
    const what = trail?.module ? 'o módulo' : 'o material';
    return remaining === 1 ? `Falta 1 ${unit} pra fechar ${what}.` : `Faltam ${remaining} ${unit}s pra fechar ${what}.`;
  }
  return 'Adicione um material e a próxima aula aparece aqui.';
}

export function Home({ state, open, go, planActions, notify, account }) {
  const action = nextAction(state);
  const plan = studyRhythm(state);
  const agenda = taskAgenda(state);
  const unit = action?.imported ? 'aula' : 'etapa';
  const prepare = action && !action.imported && plan.prepareFirst && !hasPreparation(state, action.lessonId);
  const course = action ? state.courses.find((item) => item.id === action.courseId) : null;
  const focus = focusedTask(state);
  const focusCourse = focus?.courseId ? state.courses.find((item) => item.id === focus.courseId) : null;
  const focusLesson = focusCourse && focus.lessonId ? materialLesson(focusCourse, focus.lessonId) : null;
  const trail = action && !action.pdf ? moduleTrail(state, action) : null;
  const gamified = state.preferences?.gamification !== false;
  const reward = gamified && course && isEligibleCourse(course) ? XP_VALUES[completionKindForCourse(course)] : 0;

  function completeTask(task) {
    const now = new Date().toISOString();
    const result = planActions.completeTask(task.id, now);
    if (!result?.added) return;
    notify(`Tarefa concluída: ${task.title}.${task.lessonId ? ' A conclusão da aula vinculada foi registrada.' : ''}`);
  }

  // "Continuar" abre o conteúdo direto. PDF abre no leitor na página em que
  // parou; aula de curso importado abre na plataforma (o mesmo clique abre o
  // registro da aula, como em "Concluir e abrir a próxima"); material sem link
  // abre o registro do passo, que é o próprio conteúdo dele no Lume.
  function openLesson(target, lessonId) {
    const link = lessonLink(target, lessonId);
    if (link) window.open(link, '_blank', 'noopener,noreferrer');
    open({ type: 'session', id: target.id, stepId: lessonId });
  }

  function toggleFocus(task) {
    if (focus?.id === task.id) {
      if (planActions.clearTaskFocus()) notify(`${task.title} saiu do foco. O Início volta a sugerir pelo roteiro.`);
      return;
    }
    if (planActions.focusTask(task.id)) notify(`Foco agora: ${task.title}.`);
  }

  const wide = useWideRail();
  const [showActive, setShowActive] = useState(() => {
    try {
      return localStorage.getItem('lume:today-active-rail') !== 'false';
    } catch {
      return true;
    }
  });
  function toggleActive() {
    setShowActive((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('lume:today-active-rail', String(next));
      } catch {
        // Ignora falha de armazenamento em navegação privada.
      }
      return next;
    });
  }
  const { friends, active: activeFriends, loaded: friendsLoaded } = useActiveFriends(account);

  const today = localDay();
  const firstName = (account?.name || '').split(' ')[0];
  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Boa noite' : hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  const pdfPercent = action?.pdf ? materialStanding(state, course).percent : 0;
  const subject = course ? subjectOf(state, course) : null;
  const trailLabel = trail
    ? `${trail.module || action.courseTitle}: ${plural(trail.done, `${unit} concluída`, `${unit}s concluídas`)} de ${trail.nodes.length}; a atual é ${action.title}.`
    : '';

  return <div className={`study-root today-root ${showActive ? 'has-active-panel' : ''}`}>
    <div className="today-workspace-main">
      <section className="today-welcome" aria-labelledby="today-title">
        <h1 id="today-title" className="sr-only">Início</h1>
        <div className="today-date">
          <div className="today-date-meta">
            <span>{shortDate(today)}</span>
          </div>
          {!showActive && <button
            type="button"
            className="today-active-toggle"
            aria-expanded="false"
            aria-controls="active-rail-panel"
            onClick={toggleActive}
            title="Mostrar Ativos agora"
          >
            <Icon name="users"/>
            <span>Ativos</span>
            {account && friendsLoaded && <>
              <span className={`today-active-dot ${activeFriends.length ? 'is-live' : ''}`} aria-hidden="true"/>
              <span className="today-active-count">{activeFriends.length}</span>
            </>}
          </button>}
        </div>
        <p className="today-greeting">{greeting}{firstName ? `, ${firstName}` : ''}.<span>{headlineFor({ focus, action, trail, unit })}</span></p>
      </section>

      <div className="today-main">
        <section className={`card-surface next-action today-resume ${focus ? 'is-focus' : ''}`} aria-labelledby="next-title">
          {focus ? <>
            <div className="today-resume-top">
              <span className="today-resume-label">Foco agora · escolhido por você</span>
              <span className="today-resume-meta">{taskMeta(focus)}</span>
            </div>
            <h2 id="next-title" className="today-resume-title">{focus.title}</h2>
            {action && <p className="today-resume-sub">Roteiro: próxima {unit} é <strong>{action.title}</strong> ({action.courseTitle}).</p>}
            <div className="next-linked-material">
              <span className="next-linked-icon"><Icon name="book"/></span>
              <div className="next-linked-copy">
                <strong>{focusCourse ? focusCourse.title : 'Sem curso vinculado.'}</strong>
                <small>{focusLesson ? `Aula vinculada: ${focusLesson.title}` : focus.subtasks?.length ? `${focus.subtasks.filter((item) => item.done).length} de ${focus.subtasks.length} subtarefas concluídas` : 'Estude pelo seu material e marque ao finalizar'}</small>
              </div>
            </div>
            <div className="action-row">
              {focusLesson
                ? <>
                  <Button onClick={() => openLesson(focusCourse, focusLesson.id)}><Icon name={lessonLink(focusCourse, focusLesson.id) ? 'external' : 'play'}/>Abrir a aula</Button>
                  <Button secondary onClick={() => completeTask(focus)}><Icon name="check"/>Concluir tarefa</Button>
                </>
                : <Button onClick={() => completeTask(focus)}><Icon name="check"/>Concluir tarefa</Button>}
              <Button ghost onClick={() => toggleFocus(focus)}>Tirar do foco</Button>
            </div>
          </> : action?.pdf ? <>
            <div className="today-resume-top">
              <span className="today-resume-label">você parou aqui</span>
              <span className="today-resume-meta">{action.pdf.started ? `p. ${action.pdf.page}/${action.pdf.pages}` : `${action.pdf.pages} p.`} · {action.minutes} min · estimativa</span>
            </div>
            <h2 id="next-title" className="today-resume-title">{action.pdf.started ? `Continuar ${action.courseTitle} na página ${action.pdf.page}` : `Começar ${action.courseTitle}`}</h2>
            <p className="today-resume-sub">{[subject?.title, action.pdf.started ? readingLabel(course.reading, action.pdf.pages) : 'Leitura em PDF · ainda não aberto', action.pdf.section].filter(Boolean).join(' · ')}</p>
            <div className="today-reading">
              <Progress value={pdfPercent} max={100} tone="mint" label={`Avanço em ${action.courseTitle}`}/>
              <span>{pdfPercent}% lido</span>
            </div>
            <p className="today-reason"><strong>{action.reason.label}.</strong> {action.reason.detail}</p>
            <div className="action-row">
              <Button onClick={() => open({ type: 'pdf', id: action.courseId })}><Icon name="book"/>{action.pdf.started ? `Continuar na p. ${action.pdf.page}` : 'Abrir no leitor'}</Button>
              {reward > 0 && <span className="today-reward">+{reward} xp ao concluir a leitura</span>}
              <a className="text-link today-swap-link" href="#biblioteca">Trocar material</a>
            </div>
          </> : action ? <>
            <div className="today-resume-top">
              <span className="today-resume-label">você parou aqui</span>
              <span className="today-resume-meta">{unit} {trail.position}/{trail.total} · {action.minutes} min{action.durationKnown ? '' : ' · estimativa'}</span>
            </div>
            <h2 id="next-title" className="today-resume-title">{action.title}</h2>
            <p className="today-resume-sub">{[action.courseTitle, trail.module].filter(Boolean).join(' · ')}</p>
            <Constellation trail={trail} label={trailLabel}/>
            <p className="today-reason"><strong>{action.reason.label}.</strong> {action.reason.detail}{action.partial ? ' Grade parcial.' : ''}</p>
            <div className="action-row">
              {prepare
                ? <Button onClick={() => open({ type: 'session', id: action.courseId, preparation: true })}><Icon name="book"/>Preparar o material</Button>
                : <Button onClick={() => openLesson(course, action.lessonId)}><Icon name={lessonLink(course, action.lessonId) ? 'external' : 'play'}/>Continuar {unit} {trail.position}</Button>}
              {reward > 0 && <span className="today-reward">+{reward} xp ao concluir</span>}
              <a className="text-link today-swap-link" href="#biblioteca">Trocar material</a>
            </div>
          </> : <>
            <div className="today-resume-top">
              <span className="today-resume-label">comece por aqui</span>
            </div>
            <h2 id="next-title" className="today-resume-title">Nenhum material em andamento.</h2>
            <p className="today-resume-sub">Importe um curso pela extensão, anexe um PDF ou crie um material. A próxima aula aparece aqui com o tempo sugerido.</p>
            <div className="action-row">
              <Button onClick={() => go('biblioteca')}><Icon name="plus"/>Ir para a biblioteca</Button>
            </div>
          </>}
        </section>

        <div className="today-lower-grid">
          <section className="card-surface today-tasks" aria-labelledby="today-tasks-title">
            <div className="today-card-head">
              <h2 id="today-tasks-title" className="title">Para hoje <span className="today-count">{agenda.pending}</span></h2>
              <a className="text-link" href="#tarefas">Ver plano<Icon name="arrow"/></a>
            </div>
            {agenda.overdue > 0 && <p className="inline-note todo-overdue-note" role="status"><Icon name="flag"/><span>{overdueMessage(agenda.overdue)}</span></p>}
            {agenda.next.length
              ? <ul className="today-task-list">{agenda.next.map((task) => {
                const late = isOverdue(task);
                return <li key={task.id} className={`todo-item ${focus?.id === task.id ? 'is-focus' : ''}`}>
                  <button
                    type="button"
                    aria-pressed={focus?.id === task.id}
                    title={focus?.id === task.id ? 'Tirar do foco' : 'Focar no Início'}
                    aria-label={focus?.id === task.id ? `Tirar ${task.title} do foco` : `Focar em ${task.title} no Início`}
                    className="todo-focus"
                    onClick={() => toggleFocus(task)}
                  >
                    <Icon name="focus"/>
                  </button>
                  <span className="todo-copy">
                    <strong>{task.title}</strong>
                    <small className="todo-meta">{focus?.id === task.id ? 'em foco · ' : ''}{task.dueDate ? shortDate(task.dueDate) : 'sem prazo'}</small>
                  </span>
                  <span className="today-task-right">
                    {(late || task.priority > 0) && <span className={`task-priority ${late ? 'p-late' : `p-${task.priority}`}`}>{late ? 'Atrasada' : priorityLabel(task.priority)}</span>}
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked="false"
                      title="Concluir"
                      aria-label={`Concluir tarefa ${task.title}`}
                      className="todo-check today-task-done"
                      onClick={() => completeTask(task)}
                    >
                      <Icon name="check"/>
                    </button>
                  </span>
                </li>;
              })}</ul>
              : <p className="muted-text">Sem tarefas pendentes para hoje.</p>}
          </section>

          <WeekRadar state={state} today={today}/>
        </div>
      </div>
    </div>
    {showActive && <ActiveRail
      wide={wide}
      account={account}
      go={go}
      friends={friends}
      activeFriends={activeFriends}
      loaded={friendsLoaded}
      onHide={toggleActive}
    />}
  </div>;
}

function WeekRadar({ state, today }) {
  const { items, session } = upcomingDeadlines(state, today);
  const nextMilestone = items[0] || null;
  const milestoneDays = nextMilestone ? daysUntil(nextMilestone.date, today) : 0;
  const week = weekLights(state);
  return <section className="card-surface today-radar" aria-labelledby="radar-title">
    <div className="today-radar-milestone">
      <div className="today-card-head">
        <h2 id="radar-title" className="metric-label">Próximo marco</h2>
        <a className="text-link" href="#agenda">Calendário</a>
      </div>
      {nextMilestone
        ? <a className="countdown is-next radar-milestone-link" href={nextMilestone.href}>
          <span className="countdown-number" aria-hidden="true">{milestoneDays}</span>
          <span className="countdown-copy">
            <span className="countdown-when">{milestoneDays === 0 ? 'é hoje' : milestoneDays === 1 ? 'dia restante' : 'dias restantes'} · {shortDate(nextMilestone.date)}{nextMilestone.start ? ` · ${nextMilestone.start}` : ''}</span>
            <strong>{nextMilestone.title}</strong>
          </span>
        </a>
        : <p className="muted-text radar-empty">Nenhuma prova ou entrega marcada.</p>}
      {session && <p className="today-upcoming-foot">próxima sessão · <a className="text-link" href={`#agenda?data=${encodeURIComponent(session.date)}`}>{shortDate(session.date)}{session.start ? ` ${session.start}` : ''} · {session.title}</a></p>}
    </div>

    <div className="today-radar-divider" role="separator"/>

    <div className="today-radar-week" aria-labelledby="week-title">
      <div className="today-card-head">
        <h3 id="week-title" className="metric-label">Sua semana</h3>
        <span className="week-total">{formatMinutes(week.total)}</span>
      </div>
      <ol className="week-dots" aria-label={`Minutos de estudo nesta semana: ${week.days.filter((day) => day.state !== 'future').map((day) => `${WEEKDAYS[new Date(`${day.date}T12:00:00`).getDay()]} ${day.minutes}`).join(', ')}`}>
        {week.days.map((day) => {
          const label = day.state === 'today' ? 'hoje' : WEEKDAYS[new Date(`${day.date}T12:00:00`).getDay()];
          return <li key={day.date} className={`week-day is-${day.state}`} title={day.state === 'future' ? label : `${label}: ${formatMinutes(day.minutes)}`}>
            {day.state === 'today' ? <Star size={20}/> : <span className="week-dot" aria-hidden="true"/>}
            <span>{label}</span>
          </li>;
        })}
      </ol>
      <p className="week-note">{week.lit ? `${plural(week.lit, 'dia aceso', 'dias acesos')} nesta semana.` : 'Nenhum dia aceso ainda nesta semana.'}</p>
    </div>
  </section>;
}

const RAIL_QUERY = '(min-width: 1200px)';

function useWideRail() {
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(RAIL_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(RAIL_QUERY);
    const update = () => setWide(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return wide;
}

// Barra lateral "Ativos agora": amigos com presença recente (sessão de foco aberta,
// aplicativo de desktop ou site aberto) e a matéria que estudam, quando compartilham.
// Em telas largas monta direto no body (fora da transição de página) em altura total,
// sem deslocar o cabeçalho nem outras páginas; em telas estreitas fica no fim da página.
function ActiveRail({ wide, account, go, friends, activeFriends, loaded, onHide }) {
  const rail = <aside id="active-rail-panel" className={`active-rail ${wide ? 'is-docked' : ''}`} aria-labelledby="active-rail-title">
    <div className="active-rail-head">
      <div className="active-rail-heading">
        <Icon name="users"/>
        <h2 id="active-rail-title" className="active-rail-title">Ativos agora</h2>
      </div>
      <div className="active-rail-actions">
        {account && loaded && <span className="active-rail-badge">{activeFriends.length}</span>}
        <button
          type="button"
          className="active-rail-hide"
          onClick={onHide}
          title="Ocultar ativos"
          aria-label="Ocultar Ativos agora"
        >
          <Icon name="close"/>
        </button>
      </div>
    </div>
    <ActiveFriendList account={account} go={go} friends={friends} active={activeFriends} loaded={loaded} empty="Nenhum amigo ativo agora."/>
    {account && <div className="active-rail-foot">
      <a className="text-link" href="#amigos">Ver todos os amigos{friends.length ? ` (${friends.length})` : ''}</a>
    </div>}
  </aside>;

  return wide ? createPortal(rail, document.body) : rail;
}

// Link da aula na plataforma, só para curso importado (o mesmo que o registro da aula oferece).
function lessonLink(course, lessonId) {
  if (!isImportedCourse(course)) return '';
  return materialLesson(course, lessonId)?.url || course.url || '';
}

function taskMeta(task) {
  const late = isOverdue(task);
  return [
    task.priority > 0 ? `prioridade ${priorityLabel(task.priority).toLowerCase()}` : '',
    late ? 'atrasada' : '',
    task.dueDate ? `${late ? 'venceu' : 'vence'} ${shortDate(task.dueDate)}` : 'sem prazo',
  ].filter(Boolean).join(' · ');
}
