import { useEffect, useRef, useState } from 'react';
import { Reorder, motion, useDragControls } from 'motion/react';
import {
  MAX_SUBTASKS, MAX_TASKS, TASK_PRIORITIES, flattenSubtasks, isOverdue, localDate,
  priorityLabel, sortTasks,
} from '../../../public/tasks-domain.js';
import Icon from '../../ui/Icon.jsx';
import { materialSteps } from '../../../public/material-model.js';
import { Button, Empty, stagger } from '../../ui/ui.jsx';
import SectionTabs from '../../app/SectionTabs.jsx';

// Lista de tarefas de estudo para uma prova. Criar e organizar não gera XP;
// concluir uma tarefa vinculada registra a aula, sem recompensa própria.
export function overdueMessage(count) {
  return count === 1
    ? 'Uma tarefa passou do prazo. Reorganize a semana para manter seu objetivo.'
    : `${count} tarefas passaram do prazo. Reorganize a semana para manter seu objetivo.`;
}

function dateLabel(value) {
  if (!value) return '';
  const date = new Date(`${value}T12:00:00`);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

const NO_SUBTASKS = [];

// Uma subtarefa: arrastar pela alça (ou setas do teclado nela), renomear no
// lugar com Enter/Esc, marcar, adicionar sub-subtarefa (1 nível) e remover.
function SubtaskItem({ task, item, index, count, actions, hidden, showDone, canNest = true, onDragEnd, onError }) {
  const controls = useDragControls();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.title);
  const [dragging, setDragging] = useState(false);
  const [addingChild, setAddingChild] = useState(false);
  const [childDraft, setChildDraft] = useState('');
  const children = item.subtasks || NO_SUBTASKS;
  const [childDragOrder, setChildDragOrder] = useState(null);
  const childDragRef = useRef(null);
  const childOrder = childDragOrder || children;

  function startEditing() {
    setName(item.title);
    setEditing(true);
  }
  function save() {
    if (name.trim() === item.title) {
      setEditing(false);
      return;
    }
    try {
      if (!actions.renameSubtask(task.id, item.id, name)) return;
      setEditing(false);
      onError('');
    } catch (exception) {
      onError(exception.message);
    }
  }
  function moveWithKeys(event) {
    const step = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (!step) return;
    event.preventDefault();
    const target = index + step;
    if (target >= 0 && target < count) actions.moveSubtask(task.id, item.id, target);
  }
  function reorderChildren(next) {
    childDragRef.current = next;
    setChildDragOrder(next);
  }
  function dropChild(child) {
    const nextIndex = (childDragRef.current || children).indexOf(child);
    childDragRef.current = null;
    setChildDragOrder(null);
    if (nextIndex >= 0 && nextIndex !== children.indexOf(child)) actions.moveSubtask(task.id, child.id, nextIndex);
  }
  function addChild(event) {
    event.preventDefault();
    try {
      if (!actions.addSubtask(task.id, childDraft, item.id)) return;
      setChildDraft('');
      setAddingChild(false);
      onError('');
    } catch (exception) {
      onError(exception.message);
    }
  }
  return <Reorder.Item as="li" hidden={hidden} value={item} dragListener={false} dragControls={controls} onDragStart={() => setDragging(true)} onDragEnd={() => { setDragging(false); onDragEnd(item); }} className={`subtask-entry ${item.done ? 'is-done' : ''} ${editing ? 'is-editing' : ''} ${dragging ? 'is-dragging' : ''}`}>
    <div className="subtask-row">
      {count > 1 && <button type="button" className="subtask-handle" title="Arraste ou use as setas para mover" aria-label={`Mover subtarefa ${item.title}`} onPointerDown={(event) => controls.start(event)} onKeyDown={moveWithKeys}><Icon name="grip"/></button>}
      {editing
        ? <span className="subtask">
          <input type="checkbox" checked={item.done} aria-label={item.title} onChange={() => actions.toggleSubtask(task.id, item.id)}/>
          <input
            className="subtask-rename"
            aria-label={`Novo nome da subtarefa ${item.title}`}
            maxLength={140}
            value={name}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            onBlur={save}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); save(); }
              if (event.key === 'Escape') { event.preventDefault(); setEditing(false); onError(''); }
            }}
          />
        </span>
        : <label className="subtask"><input type="checkbox" checked={item.done} onChange={() => actions.toggleSubtask(task.id, item.id)}/><span onDoubleClick={(event) => { event.preventDefault(); startEditing(); }}>{item.title}</span></label>}
      {canNest && !task.done && !item.done && !editing && children.length < MAX_SUBTASKS && (
        <button type="button" className="todo-icon-button" title="Adicionar sub-subtarefa" aria-label={`Adicionar sub-subtarefa em ${item.title}`} aria-expanded={addingChild} onClick={() => setAddingChild((value) => !value)}><Icon name="plus"/></button>
      )}
      {!editing && <button type="button" className="todo-icon-button" title="Renomear subtarefa" aria-label={`Renomear subtarefa ${item.title}`} onClick={startEditing}><Icon name="edit"/></button>}
      <button type="button" className="todo-icon-button is-danger" title="Remover subtarefa" aria-label={`Remover subtarefa ${item.title}`} onMouseDown={(event) => editing && event.preventDefault()} onClick={() => actions.removeSubtask(task.id, item.id)}><Icon name="close"/></button>
    </div>
    {canNest && (children.length > 0 || addingChild) && <div className="subtask-children">
      {children.length > 0 && <Reorder.Group as="ul" axis="y" className="subtask-list subtask-sublist" values={childOrder} onReorder={reorderChildren}>
        {childOrder.map((child, childIndex) => <SubtaskItem key={child.id} task={task} item={child} index={childIndex} count={childOrder.length} actions={actions} hidden={child.done && !showDone} showDone={showDone} canNest={false} onDragEnd={dropChild} onError={onError}/>)}
      </Reorder.Group>}
      {addingChild && <form className="subtask-form subtask-subform" onSubmit={addChild}>
        <Icon name="plus"/>
        <input aria-label={`Nova sub-subtarefa de ${item.title}`} maxLength={140} value={childDraft} autoFocus onChange={(event) => setChildDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setAddingChild(false); } }} placeholder="Sub-subtarefa, ex.: resumir inciso I"/>
        <button type="submit" className="subtask-add" disabled={!childDraft.trim()}>Adicionar</button>
      </form>}
    </div>}
  </Reorder.Item>;
}

// Subtarefas: resumo com barra, só as abertas à vista; as concluídas ficam
// recolhidas e o campo de nova subtarefa só aparece quando pedido.
function Subtasks({ task, actions }) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const items = task.subtasks || NO_SUBTASKS;
  const allItems = flattenSubtasks(items);
  const total = allItems.length;
  const done = allItems.filter((item) => item.done).length;
  // Ordem provisória só durante o arrasto; grava uma vez, ao soltar.
  const [dragOrder, setDragOrder] = useState(null);
  const dragRef = useRef(null);
  const order = dragOrder || items;
  function reorder(next) {
    dragRef.current = next;
    setDragOrder(next);
  }
  function drop(item) {
    const index = (dragRef.current || items).indexOf(item);
    dragRef.current = null;
    setDragOrder(null);
    if (index >= 0 && index !== items.indexOf(item)) actions.moveSubtask(task.id, item.id, index);
  }
  function add(event) {
    event.preventDefault();
    try {
      if (!actions.addSubtask(task.id, draft)) return;
      setDraft('');
      setError('');
    } catch (exception) {
      setError(exception.message);
    }
  }
  const percent = total ? Math.round(done / total * 100) : 0;
  return <div className={`todo-subtasks ${items.length ? 'has-items' : ''}`}>
    {total > 0 && <div className="subtask-summary">
      <span className={`subtask-meter ${done === total ? 'is-full' : ''}`} aria-hidden="true"><span style={{ width: `${percent}%` }}/></span>
      <span className="subtask-count">{done} de {total} {total === 1 ? 'subtarefa concluída' : 'subtarefas concluídas'}</span>
    </div>}
    {items.length > 0 && <Reorder.Group as="ul" axis="y" className="subtask-list" values={order} onReorder={reorder}>
      {order.map((item, index) => <SubtaskItem key={item.id} task={task} item={item} index={index} count={order.length} actions={actions} hidden={item.done && !showDone} showDone={showDone} onDragEnd={drop} onError={setError}/>)}
    </Reorder.Group>}
    {done > 0 && <button type="button" className="subtask-toggle" aria-expanded={showDone} onClick={() => setShowDone((value) => !value)}><Icon name="chevron"/>{showDone ? 'Ocultar concluídas' : `Ver ${done} ${done === 1 ? 'concluída' : 'concluídas'}`}</button>}
    {!task.done && items.length < MAX_SUBTASKS && (adding
      ? <form className="subtask-form" onSubmit={add}>
        <Icon name="plus"/>
        <input aria-label={`Nova subtarefa de ${task.title}`} maxLength={140} value={draft} autoFocus onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setAdding(false); } }} placeholder="Próximo passo pequeno, ex.: ler os artigos 5º a 7º"/>
        <button type="submit" className="subtask-add" disabled={!draft.trim()}>Adicionar</button>
      </form>
      : <button type="button" className="subtask-new" onClick={() => setAdding(true)}><Icon name="plus"/>Adicionar subtarefa</button>)}
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}

// Menu "…" da tarefa: prioridade, agendar e remover num só lugar.
function TaskMenu({ task, onPriority, onSchedule, onRemove }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => { if (!root.current?.contains(event.target)) setOpen(false); };
    const escape = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  return <div className="todo-menu" ref={root}>
    <button type="button" className="todo-icon-button" aria-label={`Mais ações de ${task.title}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}><Icon name="more"/></button>
    {open && <div className="todo-menu-list" role="menu">
      {!task.done && <label className="todo-menu-field">Prioridade
        <select aria-label={`Prioridade de ${task.title}`} value={String(task.priority || 0)} onChange={(event) => onPriority(event.target.value)}>
          {TASK_PRIORITIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>}
      {onSchedule && <button type="button" role="menuitem" className="todo-menu-item" aria-label={`Agendar tarefa ${task.title}`} onClick={() => { setOpen(false); onSchedule(); }}><Icon name="calendar"/>Agendar</button>}
      <button type="button" role="menuitem" className="todo-menu-item is-danger" aria-label={`Remover tarefa ${task.title}`} onClick={() => { setOpen(false); onRemove(); }}><Icon name="trash"/>Remover</button>
    </div>}
  </div>;
}

export default function Tasks({ state, actions, notify, onSchedule }) {
  const [title, setTitle] = useState('');
  const [courseId, setCourseId] = useState('');
  const [lessonId, setLessonId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState('0');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const today = localDate();
  const tasks = sortTasks(state.tasks || [], today);
  const pending = tasks.filter((task) => !task.done);
  const overdue = pending.filter((task) => isOverdue(task, today)).length;
  const done = tasks.filter((task) => task.done);
  const courses = new Map(state.courses.map((course) => [course.id, course.title]));
  const lessons = new Map(state.courses.flatMap((course) => materialSteps(course).map((step) => [step.id, step.title])));
  const chosenCourse = state.courses.find((course) => course.id === courseId);

  function submit(event) {
    event.preventDefault();
    if (!title.trim()) {
      setError('Dê um nome para a tarefa.');
      return;
    }
    try {
      if (!actions.addTask({ title, courseId, lessonId, dueDate, priority })) return;
      setTitle('');
      setLessonId('');
      setDueDate('');
      setPriority('0');
      setError('');
      notify('Tarefa adicionada. Só a conclusão de uma aula vinculada pode gerar sua recompensa.');
    } catch (exception) {
      setError(exception.message);
    }
  }

  function toggle(task) {
    if (task.done) {
      if (!actions.reopenTask(task.id)) return;
      notify('Tarefa reaberta. A aula e sua recompensa foram preservadas.');
      return;
    }
    const now = new Date().toISOString();
    const result = actions.completeTask(task.id, now);
    if (!result?.added) return;
    notify(`Tarefa concluída: ${task.title}.${task.lessonId ? ' A conclusão da aula vinculada foi registrada.' : ''}`);
  }

  function remove(task) {
    if (!actions.removeTask(task.id)) return;
    notify('Tarefa removida.');
  }

  function taskRow(task, index) {
    const course = task.courseId ? courses.get(task.courseId) : '';
    const late = isOverdue(task, today);
    return <motion.li className={`todo-item ${task.done ? 'is-done' : ''} ${late ? 'is-late' : ''} priority-${task.priority || 0}`} key={task.id} {...stagger(index)}>
      <button
        type="button"
        role="checkbox"
        aria-checked={task.done ? 'true' : 'false'}
        aria-label={task.done ? `Reabrir tarefa ${task.title}` : `Concluir tarefa ${task.title}`}
        className="todo-check"
        onClick={() => toggle(task)}
      >
        <Icon name="check"/>
      </button>
      <span className="todo-copy">
        <strong>{task.title}</strong>
        <span className="todo-chips">
          {!task.done && task.priority > 0 && <span className="todo-chip todo-priority">Prioridade {priorityLabel(task.priority).toLowerCase()}</span>}
          {late && <span className="todo-chip todo-late">Atrasada</span>}
          {task.dueDate && <span className="todo-chip">{dateLabel(task.dueDate)}</span>}
          {course && <span className="todo-chip">{course}</span>}
          {task.lessonId && lessons.get(task.lessonId) && <span className="todo-chip">{lessons.get(task.lessonId)}</span>}
        </span>
      </span>
      <TaskMenu task={task} onPriority={(value) => actions.setTaskPriority(task.id, value)} onSchedule={onSchedule && (() => onSchedule(task))} onRemove={() => remove(task)}/>
      <Subtasks task={task} actions={actions}/>
    </motion.li>;
  }

  const [filter, setFilter] = useState('all');
  const dueToday = pending.filter((task) => task.dueDate === today).length;
  const linked = pending.filter((task) => task.lessonId).length;
  const filters = {
    all: ['Todas', pending.length],
    late: ['Atrasadas', overdue],
    today: ['Para hoje', dueToday],
    linked: ['Com aula vinculada', linked],
  };
  const shown = pending.filter((task) => filter === 'all'
    || (filter === 'late' && isOverdue(task, today))
    || (filter === 'today' && task.dueDate === today)
    || (filter === 'linked' && task.lessonId));

  return <div className="personal-root plan-root tasks-root">
    <header className="plan-heading">
      <div>
        <h1 className="display">Tarefas</h1>
        <p className="tasks-count">{pending.length} {pending.length === 1 ? 'tarefa pendente' : 'tarefas pendentes'}{overdue > 0 ? ` · ${overdue} ${overdue === 1 ? 'atrasada' : 'atrasadas'}` : ''}</p>
      </div>
      <div className="page-heading-actions">
        <Button aria-expanded={creating} onClick={() => setCreating((value) => !value)}><Icon name="plus"/>Nova tarefa</Button>
      </div>
    </header>
    <SectionTabs route="tarefas"/>

    <div className="tasks-column">
      {creating && <section className="card-surface tasks-new" aria-labelledby="task-new-title">
        <h2 id="task-new-title" className="sr-only">Nova tarefa</h2>
        <form className="form-stack" onSubmit={submit}>
          <label className="field">Tarefa
            <input name="task-title" maxLength={180} value={title} autoFocus onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Resolver 20 questões de constitucional" autoComplete="off"/>
          </label>
          <label className="field">Curso ou prova (opcional)
            <select name="task-course" value={courseId} onChange={(event) => { setCourseId(event.target.value); setLessonId(''); }}>
              <option value="">Sem vínculo</option>
              {state.courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}
            </select>
          </label>
          {chosenCourse && <label className="field">Aula ou etapa (opcional)
            <select name="task-lesson" value={lessonId} onChange={(event) => setLessonId(event.target.value)}>
              <option value="">Curso inteiro</option>
              {materialSteps(chosenCourse).map((step) => <option key={step.id} value={step.id}>{step.title}</option>)}
            </select>
          </label>}
          <div className="form-grid todo-form-row">
            <label className="field">Prazo (opcional)
              <input name="task-due" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)}/>
            </label>
            <label className="field">Prioridade
              <select name="task-priority" value={priority} onChange={(event) => setPriority(event.target.value)}>
                {TASK_PRIORITIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <Button type="submit" className="full-width" disabled={(state.tasks || []).length >= MAX_TASKS}><Icon name="plus"/>Adicionar tarefa</Button>
        </form>
      </section>}

      <section className="card-surface tasks-board" aria-labelledby="todo-pending-title">
        <div className="tasks-board-head">
          <h2 id="todo-pending-title" className="title"><Icon name="list"/>Para fazer</h2>
          {pending.length > 0 && <button type="button" className="tasks-filter-toggle" aria-expanded={showFilters || filter !== 'all'} onClick={() => setShowFilters((value) => !value)}><Icon name="tune"/>Filtrar{filter !== 'all' ? `: ${filters[filter][0]}` : ''}</button>}
        </div>
        {(showFilters || filter !== 'all') && pending.length > 0 && <div className="tasks-filters" role="group" aria-label="Filtrar tarefas">
          {Object.entries(filters).map(([id, [label, count]]) => <button key={id} type="button" className="kind-tab" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}<span className="kind-count">{count}</span></button>)}
        </div>}
        {pending.length
          ? shown.length
            ? <ul className="todo-list">{shown.map(taskRow)}</ul>
            : <p className="muted-text tasks-empty">Nenhuma tarefa neste filtro.</p>
          : <Empty icon="list" title="Sem tarefas pendentes.">Defina a próxima ação concreta da sua preparação em Nova tarefa.</Empty>}
      </section>

      {done.length > 0 && <details className="card-surface tasks-done" aria-labelledby="todo-done-title" open>
        <summary><h2 id="todo-done-title" className="title"><Icon name="check"/>Concluídas <span className="shelf-count">{done.length}</span></h2><Icon name="chevron-down"/></summary>
        <ul className="todo-list">{done.map(taskRow)}</ul>
      </details>}
    </div>
  </div>;
}
