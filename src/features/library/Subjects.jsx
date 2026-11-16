import { useState } from 'react';
import { SUBJECT_COLORS, SUBJECT_COLOR_LABELS, subjectOverview, subjectsOverview } from '../../../public/subject-domain.js';
import { materialType } from '../../../public/domain.js';
import Icon from '../../ui/Icon.jsx';
import { Button, Empty, Heading, Progress } from '../../ui/ui.jsx';

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

function SubjectForm({ actions, notify, initial = null, onDone }) {
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

function SubjectCard({ overview, open }) {
  const { subject } = overview;
  const finished = isFinished(overview);
  return <li>
    <button type="button" className={`subject-card color-${subject.color || 'lume'}${finished ? ' is-finished' : ''}`} onClick={() => open({ type: 'subject', id: subject.id })}>
      <span className="subject-card-top">
        <strong className="subject-card-title">{subject.title}</strong>
        {finished ? <Icon name="check"/> : <span className="subject-card-percent mono">{overview.percent}%</span>}
      </span>
      <span className="subject-card-meta">{overview.total ? `${overview.done} de ${overview.total} ${overview.total === 1 ? 'material' : 'materiais'}` : 'Sem materiais'}{overview.pagesTotal ? ` · p. ${overview.pagesReached}/${overview.pagesTotal}` : ''}</span>
      <Progress value={overview.percent} tone={finished ? 'mint' : 'lume'} label={`Avanço em ${subject.title}`}/>
    </button>
  </li>;
}

// Aba Disciplinas da Biblioteca: só mostra o que está em andamento e o que já
// terminou. Vincular PDFs e materiais acontece na aba Materiais; o painel de
// cada disciplina cuida do resto (retomar, editar, excluir).
export function SubjectsPage({ state, open }) {
  const overviews = subjectsOverview(state);
  const finished = overviews.filter(isFinished);
  const ongoing = overviews.filter((item) => !isFinished(item));
  return <div className="subjects-root">
    <Heading eyebrow="disciplinas" title="Disciplinas" actions={<Button onClick={() => open({ type: 'subject' })}><Icon name="plus"/>Nova disciplina</Button>}>
      Suas matérias, o que está em andamento e o que já terminou.
    </Heading>
    {overviews.length === 0
      ? <Empty title="Nenhuma disciplina ainda." >Crie uma disciplina e vincule seus PDFs e materiais a ela pela aba Materiais.</Empty>
      : <>
        {ongoing.length > 0 && <section className="subject-group" aria-labelledby="subjects-ongoing-title">
          <div className="subject-group-head"><h2 id="subjects-ongoing-title" className="title">Em andamento</h2><span className="metric-label mono">{ongoing.length}</span></div>
          <ul className="subject-grid">{ongoing.map((overview) => <SubjectCard key={overview.subject.id} overview={overview} open={open}/>)}</ul>
        </section>}
        {finished.length > 0 && <section className="subject-group" aria-labelledby="subjects-finished-title">
          <div className="subject-group-head"><span className="card-icon tone-mint"><Icon name="check"/></span><h2 id="subjects-finished-title" className="title">Concluídas</h2><span className="metric-label mono">{finished.length}</span></div>
          <ul className="subject-grid">{finished.map((overview) => <SubjectCard key={overview.subject.id} overview={overview} open={open}/>)}</ul>
        </section>}
      </>}
    <p className="quiet-note">Disciplinas organizam a biblioteca e não geram XP. O XP vem de concluir aulas, leituras e entregas.</p>
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
        : <p className="muted-text">Vincule PDFs e materiais pela aba Materiais ou aqui, escolhendo um que já está na biblioteca.</p>}
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
