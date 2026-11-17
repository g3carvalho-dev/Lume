import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { hasPreparation, courseProgress, courseStatus, materialType } from '../../../public/domain.js';
import { materialSteps } from '../../../public/material-model.js';
import { resumeMaterial } from '../../../public/study-plan.js';
import { courseSummary, isImportedCourse, sourceLabel } from '../../../public/import-domain.js';
import { slidePositionLabel, slidesSummary } from '../../../public/slides-domain.js';
import Icon from '../../ui/Icon.jsx';
import { Button, Empty, Heading, Progress, ease, enter } from '../../ui/ui.jsx';
import { isCompleted } from '../../../public/progress-domain.js';
import { materialStanding, subjectOf } from '../../../public/subject-domain.js';

const statuses = { all: 'Todos', active: 'Em andamento', new: 'Para começar', paused: 'Em pausa', completed: 'Concluídos' };

// Fecha um painel flutuante ao clicar fora ou apertar Esc.
function useDismiss(active, close) {
  const root = useRef(null);
  useEffect(() => {
    if (!active) return undefined;
    const outside = (event) => { if (!root.current?.contains(event.target)) close(); };
    const escape = (event) => { if (event.key === 'Escape') close(); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [active, close]);
  return root;
}

// Um só botão de entrada para os três jeitos de adicionar material.
function AddMenu({ open }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const close = useCallback(() => setMenuOpen(false), []);
  const root = useDismiss(menuOpen, close);
  // O foco volta ao botão antes do diálogo abrir: o item do menu deixa de existir
  // e o diálogo devolve o foco a quem o tinha ao abrir.
  const choose = (dialog) => { root.current?.querySelector('button[aria-haspopup]')?.focus(); setMenuOpen(false); open(dialog); };
  return <div className="add-menu" ref={root}>
    <Button aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}><Icon name="plus"/>Adicionar material<Icon name="chevron" className="add-menu-caret"/></Button>
    {menuOpen && <div className="add-menu-list" role="menu">
      <button type="button" role="menuitem" className="add-menu-item" onClick={() => choose({ type: 'new' })}><Icon name="layers"/>Adicionar curso</button>
      <button type="button" role="menuitem" className="add-menu-item" onClick={() => choose({ type: 'pdf-attach' })}><Icon name="book"/>Anexar PDF</button>
      <button type="button" role="menuitem" className="add-menu-item" onClick={() => choose({ type: 'manual' })}><Icon name="edit"/>Criar manualmente</button>
    </div>}
  </div>;
}

function CourseCard({ course, state, open, compact = false, icon = 'file' }) {
  const progress = courseProgress(state, course);
  const status = courseStatus(state, course);
  const imported = isImportedCourse(course);
  const summary = imported ? courseSummary(state, course) : null;
  const scope = imported ? `${summary.done} de ${summary.total} aulas` : `${progress.done} de ${progress.total} etapas`;
  const deck = slidesSummary(course);
  const reading = course.pdf ? materialStanding(state, course) : null;
  const subject = subjectOf(state, course);
  const shownScope = reading ? reading.label : scope;
  const percent = reading ? reading.percent : progress.percent;
  const label = `${course.title}, ${statuses[status]}, ${shownScope}`;

  if (compact) return <div className="course-card-wrap is-row"><button type="button" className={`reading-row ${state.selectedCourseId === course.id ? 'selected-course' : ''}`} onClick={() => open({ type: 'course', id: course.id })} aria-label={label}>
    <span className="reading-icon"><Icon name={icon}/></span>
    <span className="reading-copy"><strong>{course.title}</strong><small>{shownScope}{subject ? ` · ${subject.title}` : ''}{reading?.done ? ` · ${course.pdf.pages} p.` : ''}</small></span>
    <span className="reading-progress"><Progress value={percent} tone="mint" label={`Progresso de ${course.title}`}/><strong>{percent}%</strong></span>
    <Icon name="chevron" className="reading-chevron"/>
  </button></div>;

  return <div className="course-card-wrap">
    <motion.button
      {...enter}
      whileHover={{ y: -2 }}
      whileTap={{ scale: .99 }}
      className={`course-card stitch-course-card ${state.selectedCourseId === course.id ? 'selected-course' : ''}`}
      onClick={() => open({ type: 'course', id: course.id })}
      aria-label={label}
    >
      <div className="stitch-course-top">
        <div className="stitch-course-badges">
          <span className="soft-badge tone-lume">{subject ? subject.title : materialType(course.type).title}</span>
          <span className="stitch-course-scope">{shownScope}</span>
          {imported && <span className="soft-badge">{sourceLabel(course.source)}</span>}
          {deck.total > 0 && <span className="soft-badge">{deck.total} slides</span>}
        </div>
        <strong className={`stitch-course-percent status-${status}`}>{percent}%</strong>
      </div>
      <h3 className="title">{course.title}</h3>
      <p className="course-description">
        {course.resumeAt ? `Retomar em ${course.resumeAt}` : materialType(course.type).title}
        {course.example ? ' · Exemplo' : ''}
        {imported && summary.partial ? ' · grade parcial' : ''}
      </p>
      <div className="stitch-course-foot">
        <Progress value={percent} tone={status === 'completed' ? 'mint' : 'lume'} label={`Progresso de ${course.title}`}/>
        <div className="stitch-course-foot-row">
          <span className={`course-status status-${status}`}>{statuses[status]}</span>
          <span className="stitch-course-open">Acessar<Icon name="chevron"/></span>
        </div>
      </div>
    </motion.button>
  </div>;
}

const kinds = { all: 'Todas as frentes', courses: 'Cursos e trilhas', pdfs: 'PDFs e leituras' };

// Busca e um único botão de filtros: tipo, disciplina e situação ficam no painel.
function LibraryFilters({ state, search, setSearch, kind, setKind, filter, setFilter, subjectFilter, setSubjectFilter }) {
  const [panel, setPanel] = useState(false);
  const close = useCallback(() => setPanel(false), []);
  const root = useDismiss(panel, close);
  const active = (kind !== 'all') + (filter !== 'all') + Boolean(subjectFilter);
  return <div className="library-toolbar">
    <label className="search-field">
      <Icon name="search"/>
      <input
        type="search"
        id="course-search"
        placeholder="Buscar na biblioteca…"
        aria-label="Buscar um curso pelo nome"
        value={search}
        onChange={event => setSearch(event.target.value)}
      />
      {search && <button type="button" className="icon-button" onClick={() => { setSearch(''); document.getElementById('course-search').focus(); }} aria-label="Limpar busca"><Icon name="close"/></button>}
    </label>
    <div className="library-filter-menu" ref={root}>
      <button type="button" className={`filter-trigger ${active ? 'has-active' : ''}`} aria-haspopup="dialog" aria-expanded={panel} aria-label={active ? `Filtros, ${active} ativos` : 'Filtros'} onClick={() => setPanel((value) => !value)}>
        <Icon name="tune"/>{active > 0 && <span className="filter-trigger-count">{active}</span>}
      </button>
      {panel && <div className="library-filter-panel" role="dialog" aria-label="Filtros da biblioteca">
        <div className="filter-group">
          <span className="metric-label">Tipo</span>
          <div className="kind-tabs" role="group" aria-label="Mostrar cursos ou PDFs">
            {Object.entries(kinds).map(([id, title]) => <button key={id} type="button" className="kind-tab" aria-pressed={kind === id} onClick={() => setKind(id)}>
              <span>{title}</span>
              <span className="kind-count">{id === 'all' ? state.courses.length : state.courses.filter((course) => (id === 'pdfs') === Boolean(course.pdf)).length}</span>
            </button>)}
          </div>
        </div>
        {(state.subjects || []).length > 0 && <label className="filter-group subject-filter">
          <span className="metric-label">Disciplina</span>
          <select value={subjectFilter} onChange={(event) => setSubjectFilter(event.target.value)} aria-label="Filtrar por disciplina">
            <option value="">Todas as disciplinas</option>
            {state.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.title}</option>)}
            <option value="none">Sem disciplina</option>
          </select>
        </label>}
        <div className="filter-group">
          <span className="metric-label">Situação</span>
          <div className="kind-tabs" role="group" aria-label="Filtrar cursos por situação">
            {Object.entries(statuses).map(([id, title]) => <button key={id} type="button" className="kind-tab" aria-pressed={filter === id} onClick={() => setFilter(id)}>
              <span>{title}</span>
              <span className="kind-count">{id === 'all' ? state.courses.length : state.courses.filter(course => courseStatus(state, course) === id).length}</span>
            </button>)}
          </div>
        </div>
        {active > 0 && <button type="button" className="text-button accent" onClick={() => { setKind('all'); setFilter('all'); setSubjectFilter(''); }}>Limpar filtros</button>}
      </div>}
    </div>
  </div>;
}

export function Library({ state, open, actions }) {
  const [filter, setFilter] = useState('all');
  const [kind, setKind] = useState('all');
  const [search, setSearch] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');
  const [showFinished, setShowFinished] = useState(false);

  const query = search.toLocaleLowerCase('pt-BR');
  const courses = state.courses.filter(course => (filter === 'all' || courseStatus(state, course) === filter)
    && (kind === 'all' || (kind === 'pdfs') === Boolean(course.pdf))
    && (!subjectFilter || (subjectFilter === 'none' ? !course.subjectId : course.subjectId === subjectFilter))
    && course.title.toLocaleLowerCase('pt-BR').includes(query));
  // Concluídos saem de Cursos e Leituras e ficam recolhidos em "Concluídos".
  const done = (course) => courseStatus(state, course) === 'completed';
  const trails = courses.filter((course) => !course.pdf && !done(course));
  const readings = courses.filter((course) => course.pdf && !done(course));
  const finished = courses.filter(done);
  const filtering = Boolean(query) || filter !== 'all' || kind !== 'all' || Boolean(subjectFilter);
  // "Continuar de onde parei" segue a disciplina escolhida (regra em study-plan.js).
  const resume = resumeMaterial(state);
  const action = resume?.action || null;
  const selected = resume?.course || null;
  const next = action && { course: selected, step: materialSteps(selected).find((step) => step.id === action.lessonId) };
  const selectedDeck = selected ? slidesSummary(selected) : null;
  const selectedStanding = selected ? (selected.pdf ? materialStanding(state, selected) : null) : null;
  const selectedPercent = selected ? (selected.pdf ? selectedStanding.percent : courseProgress(state, selected).percent) : 0;
  const selectedSubject = selected ? subjectOf(state, selected) : null;

  return <div className="library-root">
    <Heading
      eyebrow="materiais"
      title="Biblioteca"
      actions={<AddMenu open={open}/>}
    >
      Seus cursos, livros e PDFs com o ponto exato de retomada.
    </Heading>

    {state.courses.length > 0 && <LibraryFilters state={state} search={search} setSearch={setSearch} kind={kind} setKind={setKind} filter={filter} setFilter={setFilter} subjectFilter={subjectFilter} setSubjectFilter={setSubjectFilter}/>}

    {state.courses.length === 0
      ? <FirstStudyArea actions={actions} open={open}/>
      : <>
      {resume?.subjectDone && <section className="library-resume" aria-labelledby="library-resume-title">
        <div className="library-section-label"><span><Icon name="play"/>Continuar de onde parei</span></div>
        <div className="card-surface resume-card">
          <div className="resume-copy">
            <div className="resume-meta"><span className="soft-badge tone-mint">{resume.subjectDone.title}</span></div>
            <h2 id="library-resume-title" className="title">Disciplina concluída</h2>
            <p className="muted-text">Todos os materiais de {resume.subjectDone.title} estão concluídos. Escolha um material de outra disciplina para continuar por ela.</p>
          </div>
          <div className="resume-actions">
            <Button secondary onClick={() => open({ type: 'subject', id: resume.subjectDone.id })}><Icon name="school"/>Abrir disciplina</Button>
          </div>
        </div>
      </section>}
      {selected && <section className="library-resume" aria-labelledby="library-resume-title">
        <div className="library-section-label">
          <span><Icon name="play"/>Continuar de onde parei</span>
        </div>
        <div className="card-surface resume-card">
          <div className="resume-copy">
            <div className="resume-meta">
              {selectedSubject && <span className="resume-subject">{selectedSubject.title}</span>}
              <span>{materialType(selected.type).title}{isImportedCourse(selected) ? ` · ${sourceLabel(selected.source)}` : ''}</span>
            </div>
            <h2 id="library-resume-title" className="title"><button type="button" className="resume-title-link" onClick={() => open({ type: 'course', id: selected.id })}>{selected.title}</button></h2>
            {next?.step && !selected.pdf && <p className="muted-text">Próximo passo: {next.step.title}</p>}
            {selected.pdf && <p className="muted-text">{selectedStanding.label}</p>}
            <div className="resume-progress"><Progress value={selectedPercent} tone="mint" label={`Progresso de ${selected.title}`}/><strong>{selectedPercent}%</strong></div>
          </div>
          <div className="resume-actions">
            {selected.pdf
              ? <Button onClick={() => open({ type: 'pdf', id: selected.id })}><Icon name="book"/>{selected.reading ? `Continuar na p. ${selected.reading.page}` : 'Abrir no leitor'}</Button>
              : <Button onClick={() => open({ type: 'session', id: selected.id })}><Icon name="play"/>Continuar meu próximo passo</Button>}
          </div>
        </div>
        {selectedDeck?.total > 0 && <button type="button" className="text-button accent resume-deck" onClick={() => open({ type: 'slides', id: selected.id })}><Icon name="book"/>Abrir apresentação · {slidePositionLabel(selectedDeck)}</button>}
        {isImportedCourse(selected) && <ImportedInspector course={selected} state={state}/>}
      </section>}

      {filtering && <div role="status" className="search-result-count">{courses.length} {courses.length === 1 ? 'material encontrado' : 'materiais encontrados'}</div>}

      {trails.length > 0 && <section className="library-section" aria-labelledby="library-courses-title">
        <div className="library-section-head">
          <span className="card-icon"><Icon name="layers"/></span>
          <div><h2 id="library-courses-title" className="title">Cursos e trilhas</h2><p className="card-subtitle">Aulas, etapas e projetos com o ponto de retomada.</p></div>
        </div>
        <div className="course-grid" id="library-results">{trails.map(course => <CourseCard key={course.id} course={course} state={state} open={open}/>)}</div>
      </section>}

      {readings.length > 0 && <section className="library-section" aria-labelledby="library-readings-title">
        <div className="library-section-head">
          <span className="card-icon"><Icon name="file"/></span>
          <div><h2 id="library-readings-title" className="title">Materiais e leituras</h2><p className="card-subtitle">PDFs anexados, com a página onde você parou.</p></div>
        </div>
        <div className="reading-list">{readings.map(course => <CourseCard key={course.id} course={course} state={state} open={open} compact/>)}</div>
      </section>}

      {finished.length > 0 && <section className="library-section library-finished" aria-labelledby="library-finished-title">
        <button type="button" className="finished-toggle" aria-expanded={showFinished} onClick={() => setShowFinished((value) => !value)}>
          <Icon name="chevron" className="finished-caret"/>
          <span className="card-icon tone-mint"><Icon name="check"/></span>
          <h2 id="library-finished-title" className="title">Concluídos</h2>
          <span className="metric-label">{finished.length} {finished.length === 1 ? 'material' : 'materiais'}</span>
        </button>
        {showFinished && <div className="reading-list">{finished.map(course => <CourseCard key={course.id} course={course} state={state} open={open} compact icon="check"/>)}</div>}
      </section>}

      {!courses.length && <Empty title="Nenhum material neste filtro." onAdd={() => open({ type: 'new' })}>Troque o filtro ou importe um curso pela extensão.</Empty>}
    </>}
  </div>;
}

function FirstStudyArea({ actions, open }) {
  const [area, setArea] = useState('');
  const [firstStep, setFirstStep] = useState('');
  const [error, setError] = useState('');
  function submit(event) {
    event.preventDefault();
    const title = area.trim();
    if (!title) { setError('Diga qual área você quer estudar.'); return; }
    try {
      if (!actions.addMaterial({
        title,
        type: 'course',
        firstActivity: firstStep.trim() || `Encontrar meu primeiro material de ${title}`,
        planning: !firstStep.trim(),
      }, 'manual')) return;
      setError('');
    } catch (exception) {
      setError(exception.message);
    }
  }
  return <section className="card-surface settings-panel first-area" aria-labelledby="first-area-title">
    <span className="eyebrow">Seu primeiro passo</span>
    <h2 id="first-area-title" className="title">Qual área você quer estudar?</h2>
    <p className="muted-text">Digite a área de atuação. O Lume cria sua primeira trilha, sem conteúdo de exemplo e sem conceder XP.</p>
    <form className="form-stack" onSubmit={submit}>
      <label className="field">Área de atuação
        <input name="study-area" maxLength={100} value={area} onChange={event => setArea(event.target.value)} placeholder="Ex.: Direito, Programação, Inglês" autoComplete="off"/>
      </label>
      <label className="field">Primeiro passo (opcional)
        <input name="study-first-step" maxLength={180} value={firstStep} onChange={event => setFirstStep(event.target.value)} placeholder={area.trim() ? `Ex.: Encontrar um curso de ${area.trim()}` : 'Ex.: Encontrar meu primeiro material'}/>
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <Button type="submit"><Icon name="plus"/>Criar minha trilha</Button>
    </form>
    <p className="quiet-note">Já estuda em uma plataforma? <button className="text-button accent" type="button" onClick={() => open({ type: 'new' })}>Adicionar curso pela extensão<Icon name="arrow"/></button></p>
    <p className="quiet-note">Estuda por PDF? <button className="text-button accent" type="button" onClick={() => open({ type: 'pdf-attach' })}>Anexar um PDF, sem curso<Icon name="arrow"/></button></p>
  </section>;
}

export function Steps({ course, state }) {
  return <ol className="course-step-list">{materialSteps(course).map((step, index) => {
    const done = isCompleted(state, step.id);
    const prepared = hasPreparation(state, step.id) && !done;
    return <li className={done ? 'completed-step' : prepared ? 'prepared-step' : ''} key={step.id}>
      <span className="step-number">{done ? <Icon name="check"/> : String(index + 1).padStart(2, '0')}</span>
      <span className="step-copy">{step.title}{prepared && <small className="preparation-label">Material preparado</small>}</span>
    </li>;
  })}</ol>;
}

// Resumo compacto no painel da biblioteca. A lista completa fica no diálogo do
// curso, para o painel continuar curto no celular.
function ImportedInspector({ course, state }) {
  const summary = courseSummary(state, course);
  return <div className="import-inspector">
    <p className="quiet-note">{sourceLabel(course.source)} · {summary.disciplines.length} {summary.disciplines.length === 1 ? 'área' : 'áreas'} · {summary.total} aulas selecionadas</p>
    {summary.next
      ? <p className="import-inspector-next"><Icon name="play"/><span>Próxima aula: <strong>{summary.next.title}</strong></span></p>
      : <p className="import-inspector-next"><Icon name="check"/><span>Áreas selecionadas concluídas. O curso inteiro pode ter mais conteúdo.</span></p>}
    <ul className="import-inspector-areas">
      {summary.disciplines.slice(0, 4).map((discipline) => <li key={discipline.id}><span>{discipline.title}</span><strong>{discipline.done}/{discipline.total}</strong></li>)}
    </ul>
    {summary.disciplines.length > 4 && <p className="quiet-note">+ {summary.disciplines.length - 4} áreas no detalhe do curso.</p>}
    {summary.partial && <p className="inline-note"><Icon name="help"/><span>Grade parcial: o curso pode ter mais conteúdo do que o encontrado.</span></p>}
  </div>;
}
