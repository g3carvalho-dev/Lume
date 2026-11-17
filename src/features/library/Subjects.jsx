import { useEffect, useRef, useState } from 'react';
import { SUBJECT_COLORS, SUBJECT_COLOR_LABELS, subjectOverview } from '../../../public/subject-domain.js';
import { materialType } from '../../../public/domain.js';
import Icon from '../../ui/Icon.jsx';
import { Button, Progress } from '../../ui/ui.jsx';

// Abre o ponto de retomada de um material: PDF no leitor, demais no diálogo.
function resumeTarget(course) {
  return course.pdf ? { type: 'pdf', id: course.id } : { type: 'course', id: course.id };
}

function resumeText(item) {
  return item.course.pdf && item.course.reading ? `${item.course.title} · p. ${item.course.reading.page}` : item.course.title;
}

function isFinished(overview) {
  return overview.total > 0 && overview.done === overview.total;
}

export function SubjectForm({ actions, notify, initial = null, onDone }) {
  const [title, setTitle] = useState(initial?.title || '');
  const [keywords, setKeywords] = useState((initial?.keywords || []).join(', '));
  const [color, setColor] = useState(initial?.color || 'lume');
  const [error, setError] = useState('');
  function submit(event) {
    event.preventDefault();
    try {
      const result = initial ? actions.updateSubject(initial.id, { title, keywords, color }) : actions.addSubject({ title, keywords, color });
      if (!result) return;
      setError('');
      notify(initial ? 'Disciplina atualizada.' : 'Disciplina criada. Vincule PDFs e outros materiais a ela.');
      onDone?.(result);
    } catch (exception) {
      setError(exception.message);
    }
  }
  return <form className="subject-form" onSubmit={submit}>
    <label className="field subject-form-name">Nome da disciplina
      <input value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Direito Penal" required autoFocus/>
    </label>
    <div className="subject-form-color">
      <span className="metric-label" id="subject-color-label">Cor de identificação</span>
      <div className="stitch-color-pills" role="radiogroup" aria-labelledby="subject-color-label">
        {SUBJECT_COLORS.map((item) => <button key={item} type="button" role="radio" aria-checked={color === item} aria-label={SUBJECT_COLOR_LABELS[item]} title={SUBJECT_COLOR_LABELS[item]} className={`stitch-color-dot color-${item} ${color === item ? 'is-selected' : ''}`} onClick={() => setColor(item)}>{color === item && <Icon name="check"/>}</button>)}
      </div>
    </div>
    <label className="field subject-form-keywords">Palavras-chave (opcional)
      <input value={keywords} maxLength={600} onChange={(event) => setKeywords(event.target.value)} placeholder="Ex.: inquérito, ação penal, prisão preventiva"/>
      <small className="field-hint">Ajudam o leitor inteligente a reconhecer páginas desta disciplina. Separe com vírgulas.</small>
    </label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="action-row subject-form-actions">
      <Button type="submit"><Icon name={initial ? 'check' : 'plus'}/>{initial ? 'Salvar disciplina' : 'Criar disciplina'}</Button>
      <Button secondary onClick={onDone}>Cancelar</Button>
    </div>
  </form>;
}

// Cartão do carrossel: título, avanço e o ponto de retomada no rodapé.
function SubjectCard({ overview, open }) {
  return <article className={`card-surface subject-card color-${overview.subject.color || 'lume'}`}>
    <h2 className="title"><button type="button" className="subject-title-link" onClick={() => open({ type: 'subject', id: overview.subject.id })}>{overview.subject.title}</button></h2>
    <p className="muted-text">{overview.total} {overview.total === 1 ? 'material' : 'materiais'} · {overview.done} {overview.done === 1 ? 'concluído' : 'concluídos'}{overview.pagesTotal ? ` · até p. ${overview.pagesReached} de ${overview.pagesTotal}` : ''}</p>
    <Progress value={overview.percent} tone="lume" label={`Avanço em ${overview.subject.title}`}/>
    <div className="subject-card-footer">
      {overview.resume
        ? <Button secondary className="subject-continue" onClick={() => open(resumeTarget(overview.resume.course))}><Icon name="play"/><span className="subject-continue-label">Continuar: {resumeText(overview.resume)}</span></Button>
        : overview.total === 0
          ? <div className="subject-empty">
            <Icon name="file"/>
            <span>Sem materiais vinculados</span>
            <button type="button" className="text-button subject-empty-action" onClick={() => open({ type: 'pdf-attach', subjectId: overview.subject.id })}>+ Vincular apostilas ou PDFs</button>
          </div>
          : <p className="quiet-note">Tudo concluído ou pausado nesta disciplina.</p>}
    </div>
  </article>;
}

function circularOffset(index, active, total) {
  let offset = index - active;
  const half = Math.floor(total / 2);
  if (offset > half) offset -= total;
  else if (offset < -half) offset += total;
  return offset;
}

// Carrossel 3D da Biblioteca: três cartões em evidência e os demais atrás,
// borrados. A navegação é infinita e aceita arrasto horizontal.
export function SubjectCarousel({ overviews, open, initialActive = 0 }) {
  const [active, setActive] = useState(() => Math.max(0, Math.min(initialActive, overviews.length - 1)));
  const drag = useRef(null);
  const lastInitial = useRef(initialActive);
  const total = overviews.length;

  useEffect(() => {
    setActive((current) => total ? Math.min(current, total - 1) : 0);
  }, [total]);

  useEffect(() => {
    if (lastInitial.current === initialActive) return;
    lastInitial.current = initialActive;
    setActive(Math.max(0, Math.min(initialActive, total - 1)));
  }, [initialActive, total]);

  function step(direction) {
    if (!total) return;
    setActive((current) => (current + direction + total) % total);
  }

  function onPointerDown(event) {
    if (event.button !== 0 || event.target.closest('a, button')) return;
    drag.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onPointerUp(event) {
    const start = drag.current;
    drag.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 40) step(dx < 0 ? 1 : -1);
  }

  return <div className="subjects-carousel">
    <div className="subjects-stage" role="region" aria-label="Disciplinas" aria-roledescription="carrossel" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => { drag.current = null; }}>
      {overviews.map((overview, index) => {
        const offset = circularOffset(index, active, total);
        const distance = Math.abs(offset);
        const visible = distance <= 2;
        const shift = offset === 0 ? 0 : Math.sign(offset) * (14 + (distance - 1) * 8.5);
        const scale = distance === 0 ? 1 : distance === 1 ? 0.94 : 0.78;
        return <div
          key={overview.subject.id}
          className={`subject-slide ${offset === 0 ? 'is-active' : distance === 1 ? 'is-near' : ''}`}
          style={{
            transform: `translateX(calc(-50% + ${shift}rem)) translateZ(${-distance * 70}px) rotateY(${offset * -7}deg) scale(${scale})`,
            zIndex: 10 - distance,
            opacity: visible ? 1 : 0,
            filter: distance <= 1 ? 'none' : `blur(${distance === 2 ? 3.5 : 6}px) brightness(0.68) saturate(0.8)`,
          }}
          aria-hidden={distance > 1 ? true : undefined}
          inert={distance > 1 ? '' : undefined}
        >
          <SubjectCard overview={overview} open={open}/>
        </div>;
      })}
    </div>
    {total > 1 && <>
      <button type="button" className="subjects-arrow is-prev" onClick={() => step(-1)} aria-label="Disciplinas anteriores"><Icon name="chevron-left"/></button>
      <button type="button" className="subjects-arrow is-next" onClick={() => step(1)} aria-label="Próximas disciplinas"><Icon name="chevron"/></button>
    </>}
    <p className="sr-only" aria-live="polite">Disciplina {active + 1} de {total}: {overviews[active]?.subject.title || ''}</p>
  </div>;
}

// Painel da disciplina (sem id: criação). Reúne retomada, materiais,
// vínculos, PDF, edição e exclusão num só lugar.
export default function SubjectDialog({ state, id = '', actions, open, close, notify }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [linking, setLinking] = useState('');

  if (!id) return <div className="dialog-content subject-dialog">
    <span className="eyebrow">Disciplina</span>
    <h2 id="dialog-title" className="headline">Nova disciplina</h2>
    <p className="muted-text">Dê um nome e uma cor. Depois é só vincular PDFs e outros materiais.</p>
    <SubjectForm actions={actions} notify={notify} onDone={(result) => {
      const created = result?.state?.subjects?.at?.(-1);
      if (created?.id) open({ type: 'subject', id: created.id }); else close();
    }}/>
  </div>;

  const overview = subjectOverview(state, id);
  const subject = overview.subject;
  if (!subject) return <div className="dialog-content">
    <h2 id="dialog-title" className="title">Disciplina não encontrada.</h2>
    <Button onClick={close}>Voltar</Button>
  </div>;
  const finished = isFinished(overview);
  const unlinked = state.courses.filter((course) => !course.subjectId);

  if (editing) return <div className="dialog-content subject-dialog">
    <span className="eyebrow">Editar disciplina</span>
    <h2 id="dialog-title" className="headline">{subject.title}</h2>
    <SubjectForm actions={actions} notify={notify} initial={subject} onDone={() => setEditing(false)}/>
  </div>;

  return <div className="dialog-content subject-dialog">
    <span className={`eyebrow subject-dialog-eyebrow color-${subject.color || 'lume'}`}><span className="subject-chip-dot" aria-hidden="true"/>Disciplina{finished ? ' · concluída' : ''}</span>
    <h2 id="dialog-title" className="headline">{subject.title}</h2>
    <p className="muted-text">
      {overview.total ? `${overview.done} de ${overview.total} ${overview.total === 1 ? 'material concluído' : 'materiais concluídos'}` : 'Nenhum material vinculado ainda.'}
      {overview.pagesTotal ? ` · páginas abertas: até ${overview.pagesReached} de ${overview.pagesTotal}` : ''}
    </p>
    {overview.total > 0 && <Progress value={overview.percent} tone={finished ? 'mint' : 'lume'} label={`Avanço em ${subject.title}`}/>}

    {overview.resume
      ? <Button className="full-width" onClick={() => open(resumeTarget(overview.resume.course))}><Icon name="play"/>Continuar: {resumeText(overview.resume)}</Button>
      : finished && <p className="completed-message"><Icon name="check"/>Todos os materiais concluídos.</p>}

    <section className="subject-dialog-section" aria-labelledby="subject-materials-title">
      <div className="subject-dialog-head">
        <h3 id="subject-materials-title" className="metric-label">Materiais</h3>
      </div>
      {overview.materials.length
        ? <ul className="subject-material-list">{overview.materials.map((item) => <li key={item.course.id}>
          <div className="subject-material-head">
            <button type="button" className="text-button" onClick={() => open(resumeTarget(item.course))}><Icon name="book"/>{item.course.title}</button>
            <button type="button" className="text-button subtle" onClick={() => actions.linkSubject(item.course.id, '')} aria-label={`Desvincular ${item.course.title}`}>Desvincular</button>
          </div>
          <small>{materialType(item.course.type).title} · {item.label}{item.course.paused ? ' · pausado' : ''}</small>
          <Progress value={item.percent} tone={item.done ? 'mint' : 'lume'} label={`Avanço em ${item.course.title}`}/>
          {item.sections.length > 0 && <details className="subject-sections">
            <summary>{item.sections.length} {item.sections.length === 1 ? 'seção percorrida' : 'seções percorridas'}</summary>
            <ul>{item.sections.map((title, index) => <li key={`${title}-${index}`}>{title}</li>)}</ul>
          </details>}
        </li>)}</ul>
        : <p className="muted-text">Vincule PDFs e outros materiais da biblioteca a esta disciplina.</p>}
      {unlinked.length > 0 && <form className="subject-link" onSubmit={(event) => { event.preventDefault(); if (linking && actions.linkSubject(linking, subject.id)) setLinking(''); }}>
        <select value={linking} onChange={(event) => setLinking(event.target.value)} aria-label="Vincular material da biblioteca">
          <option value="">Vincular material da biblioteca…</option>
          {unlinked.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}
        </select>
        <Button secondary type="submit" disabled={!linking}>Vincular</Button>
      </form>}
    </section>

    <div className="subject-dialog-footer">
      {confirming
        ? <>
          <p className="field-hint">Excluir só desfaz os vínculos. Materiais, progresso e XP permanecem.</p>
          <Button className="danger" onClick={() => { if (actions.deleteSubject(subject.id)) { notify('Disciplina excluída. Os materiais continuam na biblioteca.'); close(); } }}><Icon name="trash"/>Confirmar exclusão</Button>
          <Button ghost onClick={() => setConfirming(false)}>Cancelar</Button>
        </>
        : <>
          <Button ghost onClick={() => setEditing(true)}><Icon name="edit"/>Editar</Button>
          <Button ghost onClick={() => setConfirming(true)}><Icon name="trash"/>Excluir disciplina</Button>
        </>}
    </div>
  </div>;
}
