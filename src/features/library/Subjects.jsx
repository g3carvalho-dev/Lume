import { useEffect, useRef, useState } from 'react';
import { SUBJECT_COLORS, SUBJECT_COLOR_LABELS, subjectOverview } from '../../../public/subject-domain.js';
import { materialType } from '../../../public/domain.js';
import Icon from '../../ui/Icon.jsx';
import { Button, Heading, Progress } from '../../ui/ui.jsx';

// Abre o ponto de retomada de um material: PDF no leitor, demais no diálogo.
function resumeTarget(course) {
  return course.pdf ? { type: 'pdf', id: course.id } : { type: 'course', id: course.id };
}

function resumeText(item) {
  return item.course.pdf && item.course.reading ? `${item.course.title} · p. ${item.course.reading.page}` : item.course.title;
}

export function SubjectForm({ actions, notify, initial = null, onDone, onCancel = null }) {
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
      if (!initial) { setTitle(''); setKeywords(''); setColor('lume'); }
      notify(initial ? 'Disciplina atualizada.' : 'Disciplina criada. Vincule PDFs e outros materiais a ela.');
      onDone?.();
    } catch (exception) {
      setError(exception.message);
    }
  }
  return <form className="form-stack subject-form" onSubmit={submit}>
    <label className="field">Nome da disciplina
      <input value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Direito Penal" required/>
    </label>
    <label className="field">Palavras-chave (opcional)
      <input value={keywords} maxLength={600} onChange={(event) => setKeywords(event.target.value)} placeholder="Ex.: inquérito, ação penal, prisão preventiva"/>
    </label>
    <div className="stitch-color-row">
      <span>Cor de identificação</span>
      <div className="stitch-color-pills" role="radiogroup" aria-label="Cor da disciplina">
        {SUBJECT_COLORS.map((item) => <button key={item} type="button" role="radio" aria-checked={color === item} aria-label={SUBJECT_COLOR_LABELS[item]} title={SUBJECT_COLOR_LABELS[item]} className={`stitch-color-dot color-${item} ${color === item ? 'is-selected' : ''}`} onClick={() => setColor(item)}>{color === item && <Icon name="check"/>}</button>)}
      </div>
    </div>
    <p className="quiet-note">As palavras-chave ajudam o leitor inteligente a reconhecer páginas desta disciplina. Separe com vírgulas.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="action-row">
      <Button type="submit"><Icon name={initial ? 'check' : 'plus'}/>{initial ? 'Salvar disciplina' : 'Criar disciplina'}</Button>
      {initial ? <Button ghost onClick={onDone}>Cancelar</Button> : onCancel ? <Button ghost type="button" onClick={onCancel}>Cancelar</Button> : null}
    </div>
  </form>;
}

export function SubjectDetail({ state, id, actions, open, notify, close }) {
  const overview = subjectOverview(state, id);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [linking, setLinking] = useState('');
  const subject = overview.subject;
  if (!subject) return <section className="card-surface settings-panel">
    <h2 className="title">Disciplina não encontrada.</h2>
    <Button onClick={close}>Fechar</Button>
  </section>;
  const unlinked = state.courses.filter((course) => !course.subjectId);
  return <div className="subject-detail">
    <Heading eyebrow="Disciplina" title={subject.title} actions={<Button secondary onClick={close}><Icon name="back"/>Fechar</Button>}>
      {overview.total ? `${overview.done} de ${overview.total} materiais concluídos.` : 'Nenhum material vinculado ainda.'}
      {overview.pagesTotal ? ` Páginas abertas nos PDFs: até ${overview.pagesReached} de ${overview.pagesTotal}.` : ''}
    </Heading>

    {overview.resume && <section className="card-surface subject-resume" aria-labelledby="subject-resume-title">
      <span className="pill"><Icon name="return"/>Retomar de onde parou</span>
      <h2 id="subject-resume-title" className="headline">{resumeText(overview.resume)}</h2>
      {overview.resume.course.reading?.section && <p className="muted-text">{overview.resume.course.reading.section}</p>}
      <div className="action-row"><Button onClick={() => open(resumeTarget(overview.resume.course))}><Icon name="play"/>Continuar</Button></div>
    </section>}

    <section className="card-surface subject-materials" aria-labelledby="subject-materials-title">
      <h2 id="subject-materials-title" className="title">Materiais</h2>
      {overview.materials.length ? <ul className="subject-material-list">{overview.materials.map((item) => <li key={item.course.id}>
        <div className="subject-material-head">
          <button type="button" className="text-button" onClick={() => open(resumeTarget(item.course))}><Icon name="book"/>{item.course.title}</button>
          <small>{materialType(item.course.type).title} · {item.label}{item.course.paused ? ' · pausado' : ''}</small>
        </div>
        <Progress value={item.percent} tone={item.done ? 'mint' : 'lume'} label={`Avanço em ${item.course.title}`}/>
        {item.sections.length > 0 && <details className="subject-sections">
          <summary>{item.sections.length} {item.sections.length === 1 ? 'seção percorrida' : 'seções percorridas'}</summary>
          <ul>{item.sections.map((title, index) => <li key={`${title}-${index}`}>{title}</li>)}</ul>
        </details>}
        <button type="button" className="text-button subtle" onClick={() => actions.linkSubject(item.course.id, '')}>Desvincular</button>
      </li>)}</ul> : <p className="muted-text">Anexe um PDF ou vincule um material que já está na biblioteca.</p>}
      {unlinked.length > 0 && <form className="subject-link" onSubmit={(event) => { event.preventDefault(); if (linking && actions.linkSubject(linking, subject.id)) setLinking(''); }}>
        <label className="field">Vincular material da biblioteca
          <select value={linking} onChange={(event) => setLinking(event.target.value)}>
            <option value="">Escolha um material…</option>
            {unlinked.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}
          </select>
        </label>
        <Button secondary type="submit" disabled={!linking}><Icon name="plus"/>Vincular</Button>
      </form>}
      <p className="quiet-note">Seções percorridas vêm do sumário do PDF até a página mais adiante aberta. É um mapa de retomada, não prova de leitura.</p>
    </section>

    <section className="card-surface subject-settings" aria-labelledby="subject-settings-title">
      <h2 id="subject-settings-title" className="title">Ajustes da disciplina</h2>
      {editing
        ? <SubjectForm actions={actions} notify={notify} initial={subject} onDone={() => setEditing(false)}/>
        : <>
          <p className="muted-text">{subject.keywords.length ? `Palavras-chave: ${subject.keywords.join(', ')}.` : 'Sem palavras-chave.'}</p>
          <div className="action-row">
            <Button secondary onClick={() => setEditing(true)}><Icon name="edit"/>Editar</Button>
            {confirming
              ? <><Button className="danger" onClick={() => { if (actions.deleteSubject(subject.id)) { notify('Disciplina excluída. Os materiais continuam na biblioteca.'); close(); } }}><Icon name="trash"/>Confirmar exclusão</Button><Button ghost onClick={() => setConfirming(false)}>Cancelar</Button></>
              : <Button ghost onClick={() => setConfirming(true)}><Icon name="trash"/>Excluir disciplina</Button>}
          </div>
          {confirming && <p className="quiet-note" role="status">Excluir só desfaz os vínculos. Materiais, progresso e XP permanecem.</p>}
        </>}
    </section>
  </div>;
}

function SubjectCard({ overview, open }) {
  return <article className={`card-surface subject-card color-${overview.subject.color || 'lume'}`}>
    <h2 className="title"><button type="button" className="text-link subject-title-link" onClick={() => open({ type: 'subject', id: overview.subject.id })}>{overview.subject.title}</button></h2>
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
