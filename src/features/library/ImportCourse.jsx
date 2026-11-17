import { useEffect, useMemo, useRef, useState } from 'react';
import ExtensionInvite from './ExtensionInvite.jsx';
import Icon from '../../ui/Icon.jsx';
import { Button } from '../../ui/ui.jsx';
import {
  allLessonIds, formatDuration,
  looksLikeExamCourse, normalizePayload,
} from '../../../public/import-domain.js';
import { completedUnitIds } from '../../../public/progress-domain.js';
import { materialSteps } from '../../../public/material-model.js';

// Fluxo de importação: extensão → revisar as aulas → adicionar à biblioteca.
// A revisão é a própria árvore de disciplinas; não existe formulário por aula.
// Nenhuma etapa concede XP: importar é organização.

const EXTRACTION_LABEL = {
  'structured-data': 'Dados estruturados da página',
  'page-outline': 'Estrutura visível da página',
  'page-snapshot': 'Página copiada da sua conta',
  'extension-capture': 'Lido pela extensão na sua conta',
  'pasted-text': 'Texto colado',
  'file-import': 'Arquivo enviado',
  'ai-assisted': 'Organizado por IA',
};

export default function ImportCourse({ state, actions, close, go, open, modal = {} }) {
  const updating = Boolean(modal.courseId);
  const existing = updating ? state.courses.find((course) => course.id === modal.courseId) : null;
  // Leitura enviada pela extensão: já chega estruturada, então vai direto à revisão.
  const captured = useMemo(() => {
    if (!modal.capture) return null;
    try { return { payload: normalizePayload(modal.capture) }; } catch (exception) { return { error: exception.message }; }
  }, [modal.capture]);
  const [phase, setPhase] = useState(captured?.payload ? 'review' : captured ? 'error' : 'intro');
  const [payload, setPayload] = useState(captured?.payload || null);
  const [selected, setSelected] = useState(() => new Set(captured?.payload ? allLessonIds(captured.payload) : []));
  const [expanded, setExpanded] = useState(() => new Set(captured?.payload ? captured.payload.disciplines.slice(0, 2).map((discipline) => discipline.id) : []));
  const [error, setError] = useState(captured?.error ? { message: captured.error, code: 'unparsed_text' } : null);
  const [recordNew, setRecordNew] = useState(true);
  const [edition, setEdition] = useState(existing?.edital?.edition || '');
  const [examPhase, setExamPhase] = useState(existing?.edital?.phase || '');
  const [imported, setImported] = useState(null);
  const heading = useRef(null);

  useEffect(() => {
    if (!captured) return;
    setPayload(captured.payload || null);
    setSelected(new Set(captured.payload ? allLessonIds(captured.payload) : []));
    setExpanded(new Set(captured.payload ? captured.payload.disciplines.slice(0, 2).map((discipline) => discipline.id) : []));
    setError(captured.error ? { message: captured.error, code: 'unparsed_text' } : null);
    setImported(null);
    setRecordNew(true);
    setPhase(captured.payload ? 'review' : 'error');
  }, [captured]);
  useEffect(() => {
    const node = heading.current;
    if (!node) return;
    node.tabIndex = -1;
    node.focus({ preventScroll: true });
  }, [phase]);

  const total = payload ? allLessonIds(payload).length : 0;
  const chosen = payload ? allLessonIds(payload).filter((id) => selected.has(id)).length : 0;
  // Curso que já está na biblioteca: aulas concluídas na plataforma desde a
  // última leitura podem ser registradas por você; as que já constavam
  // continuam como histórico sem XP.
  const matched = useMemo(() => (payload ? state.courses.find((course) => course.source?.identity === payload.identity) : null), [payload, state.courses]);
  const newlyDone = useMemo(() => {
    if (!payload || !matched) return [];
    const known = new Set(materialSteps(matched).map((step) => step.id));
    const done = completedUnitIds(state);
    return payload.disciplines
      .flatMap((discipline) => discipline.modules.flatMap((module) => module.lessons))
      .filter((lesson) => lesson.completedInSource && known.has(lesson.id) && !done.has(lesson.id));
  }, [payload, matched, state.progress]);
  const examLike = useMemo(() => payload && looksLikeExamCourse(payload), [payload]);

  function toggleLesson(id) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleMany(ids, value) {
    setSelected((previous) => {
      const next = new Set(previous);
      for (const id of ids) { if (value) next.add(id); else next.delete(id); }
      return next;
    });
  }

  function toggleExpanded(id) {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function importPayload(normalized, selectedIds) {
    if (!normalized) return;
    const ids = selectedIds || allLessonIds(normalized);
    if (!ids.length) {
      setError({ message: 'Nenhuma aula foi encontrada para adicionar.', code: 'import_failed' });
      setPhase('error');
      return;
    }
    try {
      const result = actions.importCourse(normalized, {
        selectedLessonIds: ids,
        mode: updating ? 'update' : 'create',
        courseId: updating ? modal.courseId : null,
        observedCompletionIds: recordNew ? newlyDone.map((lesson) => lesson.id) : [],
        edital: looksLikeExamCourse(normalized) && (edition || examPhase) ? { exam: 'OAB', edition: edition.trim(), phase: examPhase, checkedAt: new Date().toISOString() } : null,
      });
      if (!result) return;
      const next = result.state;
      const course = next.courses.find((item) => item.source?.identity === normalized.identity) || next.courses.at(-1);
      const record = next.imports.at(-1);
      setPayload(normalized);
      setSelected(new Set(ids));
      setImported({
        course,
        sourceCompleted: record?.sourceCompleted ?? normalized.completedCount ?? 0,
        observed: record?.observed ?? 0,
      });
      setPhase('done');
    } catch (exception) {
      setError({ message: exception.message, code: 'import_failed' });
      setPhase('error');
    }
  }

  function confirmImport() {
    if (!payload || !chosen) return;
    importPayload(payload, [...selected]);
  }

  // ---------- Etapas de interface ----------

  const introStep = phase === 'intro' && <>
    <span className="eyebrow">Biblioteca</span>
    <h2 id="dialog-title" className="headline" ref={heading}>{updating ? 'Atualizar a grade do curso' : 'Adicionar curso'}</h2>
    {updating && <p className="muted-text">Leia o curso novamente pela extensão. O Lume reconhece a nova leitura e preserva seu progresso.</p>}
    <ExtensionInvite/>
  </>;

  const reviewStep = phase === 'review' && payload && <>
    <span className="eyebrow">{payload.provider.id === 'unknown' ? EXTRACTION_LABEL[payload.extraction.kind] : `${payload.provider.label} · ${EXTRACTION_LABEL[payload.extraction.kind] || 'análise da fonte'}`}</span>
    <h2 id="dialog-title" className="headline" ref={heading}>{payload.title}</h2>
    <div className="import-badges">
      <span className={`import-badge ${payload.completeness === 'complete' ? 'tone-mint' : 'tone-warn'}`}>
        <Icon name={payload.completeness === 'complete' ? 'check' : 'help'}/>
        {payload.completeness === 'complete' ? 'Grade publicada pela fonte' : 'Grade parcial — confira antes de adicionar'}
      </span>
      <span className="import-badge neutral"><Icon name="book"/>{payload.disciplines.length} {payload.disciplines.length === 1 ? 'área' : 'áreas'} · {total} aulas</span>
    </div>
    {payload.completedCount > 0 && <p className="inline-note"><Icon name="check"/><span>{payload.completedCount} {payload.completedCount === 1 ? 'aula aparece concluída' : 'aulas aparecem concluídas'} na página lida. {newlyDone.length ? 'As que o Lume já conhecia entram como histórico, sem XP; veja abaixo as novas.' : 'Isso entra como histórico da fonte e não gera XP.'}</span></p>}
    {matched && newlyDone.length > 0 && <label className="inline-note import-observed">
      <input type="checkbox" checked={recordNew} onChange={(event) => setRecordNew(event.target.checked)}/>
      <span><strong>Registrar {newlyDone.length} {newlyDone.length === 1 ? 'aula concluída' : 'aulas concluídas'} na plataforma desde a última leitura.</strong> Elas entram com origem “plataforma” e podem gerar XP, que o servidor confere e limita por dia. Desmarque para guardá-las só como histórico.</span>
    </label>}
    {matched && !updating && <p className="inline-note"><Icon name="return"/><span>Este curso já está na sua biblioteca: a leitura atualiza a grade e preserva o seu progresso.</span></p>}
    {payload.warnings.length > 0 && <ul className="import-warning-list">{payload.warnings.map((warning) => <li key={warning}><Icon name="help"/><span>{warning}</span></li>)}</ul>}
    {payload.demo && <p className="inline-note"><Icon name="help"/><span>Dados de demonstração: esta grade não veio de uma análise real.</span></p>}

    <div className="import-toolbar">
      <div className="import-toolbar-actions">
        <button className="text-button" onClick={() => toggleMany(allLessonIds(payload), true)}>Selecionar todas</button>
        <button className="text-button" onClick={() => toggleMany(allLessonIds(payload), false)}>Limpar seleção</button>
      </div>
      <span className="import-count" role="status">{chosen} de {total} aulas selecionadas</span>
    </div>

    <div className="import-tree" aria-label="Áreas encontradas">
      {payload.disciplines.map((discipline) => {
        const lessonIds = discipline.modules.flatMap((module) => module.lessons.map((lesson) => lesson.id));
        const picked = lessonIds.filter((id) => selected.has(id)).length;
        const stateMixed = picked === 0 ? 'false' : picked === lessonIds.length ? 'true' : 'mixed';
        const isOpen = expanded.has(discipline.id);
        return <div className={`import-discipline ${isOpen ? 'is-open' : ''}`} key={discipline.id}>
          <div className="import-discipline-head">
            <button role="checkbox" aria-checked={stateMixed} aria-label={`Selecionar a área ${discipline.title}`} className="import-check" onClick={() => toggleMany(lessonIds, picked !== lessonIds.length)}>
              <Icon name={stateMixed === 'true' ? 'check' : stateMixed === 'mixed' ? 'minus' : 'plus'}/>
            </button>
            <button className="import-discipline-toggle" aria-expanded={isOpen} onClick={() => toggleExpanded(discipline.id)}>
              <span className="import-discipline-title">{discipline.title}</span>
              <small>{discipline.modules.length} {discipline.modules.length === 1 ? 'módulo' : 'módulos'} · {picked}/{lessonIds.length} aulas</small>
              <Icon name={isOpen ? 'chevron-up' : 'chevron-down'}/>
            </button>
          </div>
          {isOpen && <div className="import-modules">
            {discipline.modules.map((module) => {
              const moduleIds = module.lessons.map((lesson) => lesson.id);
              return <div className="import-module" key={module.id}>
                <div className="import-module-head">
                  <button role="checkbox" aria-checked={moduleIds.every((id) => selected.has(id)) ? 'true' : moduleIds.some((id) => selected.has(id)) ? 'mixed' : 'false'} aria-label={`Selecionar o módulo ${module.title}`} className="import-check small" onClick={() => toggleMany(moduleIds, !moduleIds.every((id) => selected.has(id)))}>
                    <Icon name={moduleIds.every((id) => selected.has(id)) ? 'check' : moduleIds.some((id) => selected.has(id)) ? 'minus' : 'plus'}/>
                  </button>
                  <strong>{module.title}</strong>
                </div>
                <ul className="import-lessons">
                  {module.lessons.map((lesson) => <li key={lesson.id}>
                    <button role="checkbox" aria-checked={selected.has(lesson.id) ? 'true' : 'false'} aria-label={`Incluir a aula ${lesson.title}`} className="import-check small" onClick={() => toggleLesson(lesson.id)}>
                      <Icon name={selected.has(lesson.id) ? 'check' : 'plus'}/>
                    </button>
                    <span className="import-lesson-title">{lesson.title}{lesson.completedInSource ? <small className="import-flag">concluída na fonte · não gera XP</small> : null}</span>
                    {lesson.duration ? <small className="import-lesson-time">{formatDuration(lesson.duration)}</small> : null}
                  </li>)}
                </ul>
              </div>;
            })}
          </div>}
        </div>;
      })}
    </div>

    {examLike && <details className="import-exam">
      <summary>Preparando para prova (opcional)</summary>
      <p className="quiet-note">O edital é uma referência separada da grade do curso. Sem edição e fase identificadas, o Lume não calcula o que falta para a prova.</p>
      <div className="form-grid">
        <label className="field">Edição do exame<input value={edition} onChange={(event) => setEdition(event.target.value)} placeholder="Ex.: 1º Exame de 2026" maxLength={40}/></label>
        <label className="field">Fase<select value={examPhase} onChange={(event) => setExamPhase(event.target.value)}><option value="">Não sei ainda</option><option value="1ª fase">1ª fase</option><option value="2ª fase">2ª fase</option></select></label>
      </div>
      <p className="quiet-note">A comparação com o edital oficial só aparece quando houver um edital verificado cadastrado. A grade importada nunca é apresentada como cobertura completa da prova.</p>
    </details>}

    <div className="dialog-actions">
      <Button className="full-width" onClick={confirmImport} disabled={!chosen}><Icon name="plus"/>{updating ? 'Atualizar curso' : `Adicionar ${chosen} ${chosen === 1 ? 'aula' : 'aulas'} à biblioteca`}</Button>
      <button className="text-button centered" onClick={() => { setPhase('intro'); setPayload(null); }}>Como importar outro curso</button>
    </div>
    <p className="quiet-note">Adicionar o curso não gera XP. O progresso das aulas é registrado por você e fica salvo na sua conta.</p>
  </>;

  const errorView = phase === 'error' && <div className="import-error">
    <span className="dialog-emblem tone-warn"><Icon name="help"/></span>
    <h2 id="dialog-title" className="headline" ref={heading}>{payload ? 'Não consegui adicionar o curso' : 'Não consegui ler a grade'}</h2>
    <p className="dialog-text">{error?.message}</p>
    {payload
      ? <Button onClick={() => setPhase('review')}><Icon name="return"/>Voltar à revisão</Button>
      : <ExtensionInvite/>}
    <button className="text-button centered" onClick={close}>Fechar e continuar depois</button>
  </div>;

  const doneView = phase === 'done' && <div className="import-done">
    <span className="dialog-emblem tone-mint"><Icon name="check"/></span>
    <span className="eyebrow">Importação concluída</span>
    <h2 id="dialog-title" className="headline" ref={heading}>{imported?.course.title || payload?.title}</h2>
    <p className="muted-text">{chosen} {chosen === 1 ? 'aula adicionada' : 'aulas adicionadas'} à sua biblioteca{updating ? '. Conclusões e marcadores anteriores foram preservados.' : '.'}</p>
    {imported?.observed > 0 && <p className="inline-note"><Icon name="spark"/><span>{imported.observed} {imported.observed === 1 ? 'conclusão registrada' : 'conclusões registradas'} com origem na plataforma. O XP, se houver, é calculado pelo servidor.</span></p>}
    {imported?.sourceCompleted - (imported?.observed || 0) > 0 && <p className="inline-note"><Icon name="check"/><span>{imported.sourceCompleted - (imported.observed || 0)} {imported.sourceCompleted - (imported.observed || 0) === 1 ? 'aula já constava como concluída' : 'aulas já constavam como concluídas'} na fonte. O progresso entrou no histórico sem conceder XP.</span></p>}
    <ul className="import-summary">
      <li><Icon name="book"/><span>{payload?.provider.id === 'unknown' ? `Origem: ${EXTRACTION_LABEL[payload?.extraction.kind] || 'conteúdo enviado'}` : `Plataforma: ${payload?.provider.label}`}</span></li>
      <li><Icon name="spark"/><span>Conteúdo identificado: {payload?.provider.id === 'unknown' ? 'grade fornecida por você' : EXTRACTION_LABEL[payload?.extraction.kind]}{payload?.completeness === 'partial' ? ' (grade parcial)' : ''}</span></li>
      <li><Icon name="focus"/><span>Progresso das aulas: {payload?.completedCount > 0 ? `${payload.completedCount} ${payload.completedCount === 1 ? 'aula já aparecia concluída' : 'aulas já apareciam concluídas'} na fonte e entrou como histórico, sem XP; o restante é registro manual` : 'registro manual · nenhuma integração de progresso ativa'}</span></li>
      <li><Icon name="check"/><span>XP concedido agora: 0 — importar organiza, não recompensa</span></li>
    </ul>
    <div className="dialog-actions">
      <Button className="full-width" onClick={() => { close(); if (imported?.course) open({ type: 'course', id: imported.course.id }); else go('biblioteca'); }}>Ver o curso<Icon name="arrow"/></Button>
      <Button secondary onClick={() => { close(); go('biblioteca'); }}>Voltar à biblioteca</Button>
    </div>
  </div>;

  return <div className="dialog-content import-dialog">
    {introStep}{reviewStep}{errorView}{doneView}
  </div>;
}
