import { useEffect, useState } from 'react';
import { formatDuration } from '../../../public/import-domain.js';
import Icon from '../../ui/Icon.jsx';
import { Button } from '../../ui/ui.jsx';

function SelectionBox({ ids, selected, label, toggleMany }) {
  const count = ids.filter(id => selected.has(id)).length;
  const checked = count === ids.length ? 'true' : count ? 'mixed' : 'false';
  return <button type="button" role="checkbox" aria-checked={checked} aria-label={label} className="import-review-check" onClick={() => toggleMany(ids, count !== ids.length)}>
    {checked !== 'false' && <Icon name={checked === 'mixed' ? 'minus' : 'check'}/>}
  </button>;
}

export default function ImportReview({ payload, selected, toggleLesson, toggleMany, newlyDone, recordNew, setRecordNew, matched, updating, onConfirm, onInstructions, heading, children }) {
  const modules = payload.disciplines.flatMap(discipline => discipline.modules);
  const lessons = modules.flatMap(module => module.lessons);
  const ids = lessons.map(lesson => lesson.id);
  const chosen = ids.filter(id => selected.has(id)).length;
  const [expanded, setExpanded] = useState(() => new Set([modules[0]?.id]));
  useEffect(() => { setExpanded(new Set([modules[0]?.id])); }, [payload]);
  const newIds = new Set(newlyDone.map(lesson => lesson.id));
  const selectedNew = newlyDone.filter(lesson => selected.has(lesson.id)).length;
  const historical = lessons.filter(lesson => selected.has(lesson.id) && lesson.completedInSource && !(recordNew && newIds.has(lesson.id))).length;
  const grouped = payload.disciplines.length > 1;
  const partial = payload.completeness !== 'complete';

  function toggleExpanded(id) {
    setExpanded(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return <>
    <header className="import-review-heading">
      <span className="eyebrow">{payload.provider.label} · Lido pela extensão</span>
      <h2 id="dialog-title" className="headline" ref={heading}>{payload.title}</h2>
    </header>

    <details className="import-review-details">
      <summary><Icon name="info"/><span>{partial ? 'Grade parcial · Confira antes de adicionar' : 'Grade lida · Confira antes de adicionar'}</span><strong>Entender</strong></summary>
      <div>
        <p>{partial ? 'A extensão pode ter encontrado apenas parte do curso. Confira os módulos e as aulas com a grade da plataforma. Se faltar conteúdo, expanda a grade na plataforma e faça uma nova leitura.' : 'Revise as aulas encontradas e selecione o conteúdo que deseja acompanhar no Lume.'}</p>
        {payload.warnings.length > 0 && <ul>{payload.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
        <p>Importar organiza sua biblioteca. Conclusões anteriores da plataforma entram como histórico, sem XP.</p>
      </div>
    </details>

    {payload.demo && <p className="inline-note"><Icon name="info"/><span>Dados de demonstração: esta grade não veio de uma leitura real.</span></p>}
    {matched && !updating && <p className="inline-note"><Icon name="return"/><span>Este curso já está na sua biblioteca: a leitura atualiza a grade e preserva o seu progresso.</span></p>}

    <section className="import-review-selection" aria-label="Seleção de conteúdo">
      <div className="import-review-selection-heading">
        <h3>Selecione o conteúdo</h3>
        <span><span className="mono">{modules.length}</span> {modules.length === 1 ? 'módulo' : 'módulos'} · <span className="mono">{lessons.length}</span> {lessons.length === 1 ? 'aula' : 'aulas'}</span>
      </div>
      <div className="import-review-tools">
        <button className="text-button" onClick={() => toggleMany(ids, true)}>Selecionar todas</button>
        <button className="text-button" onClick={() => toggleMany(ids, false)}>Limpar seleção</button>
      </div>

      <div className="import-review-groups">
        {payload.disciplines.map(discipline => {
          const disciplineIds = discipline.modules.flatMap(module => module.lessons.map(lesson => lesson.id));
          return <div className="import-review-group" key={discipline.id}>
            {grouped && <div className="import-review-group-heading">
              <SelectionBox ids={disciplineIds} selected={selected} label={`Selecionar a área ${discipline.title}`} toggleMany={toggleMany}/>
              <h4>{discipline.title}</h4>
            </div>}
            {discipline.modules.map(module => {
              const moduleIds = module.lessons.map(lesson => lesson.id);
              const picked = moduleIds.filter(id => selected.has(id)).length;
              const isOpen = expanded.has(module.id);
              return <div className="import-review-module" key={module.id}>
                <div className="import-review-module-heading">
                  <SelectionBox ids={moduleIds} selected={selected} label={`Selecionar o módulo ${module.title}`} toggleMany={toggleMany}/>
                  <button className="import-review-module-toggle" aria-expanded={isOpen} aria-controls={`import-module-${module.id}`} onClick={() => toggleExpanded(module.id)}>
                    <strong>{module.title}</strong>
                    <span className="import-review-module-count"><span className="mono">{picked}/{moduleIds.length}</span> {moduleIds.length === 1 ? 'aula' : 'aulas'}</span>
                    <Icon name={isOpen ? 'chevron-up' : 'chevron-down'}/>
                  </button>
                </div>
                <ul className="import-review-lessons" id={`import-module-${module.id}`} hidden={!isOpen}>
                  {isOpen && module.lessons.map(lesson => <li key={lesson.id}>
                    <button type="button" role="checkbox" aria-checked={selected.has(lesson.id)} aria-label={`Incluir a aula ${lesson.title}`} className="import-review-check" onClick={() => toggleLesson(lesson.id)}>
                      {selected.has(lesson.id) && <Icon name="check"/>}
                    </button>
                    <span className="import-review-lesson-title">{lesson.title}</span>
                    {lesson.duration > 0 && <small className="import-review-duration">{formatDuration(lesson.duration)}</small>}
                    {lesson.completedInSource && <span className="import-review-history-badge">{recordNew && newIds.has(lesson.id) ? 'Nova conclusão' : 'Histórico'}</span>}
                  </li>)}
                </ul>
              </div>;
            })}
          </div>;
        })}
      </div>
    </section>

    {historical > 0 && <p className="import-review-history"><Icon name="check"/><span><span className="mono">{historical}</span> {historical === 1 ? 'aula concluída na fonte entra' : 'aulas concluídas na fonte entram'} como histórico, sem XP.</span></p>}
    {matched && selectedNew > 0 && <label className="import-review-observed">
      <input type="checkbox" checked={recordNew} onChange={event => setRecordNew(event.target.checked)}/>
      <span><strong>Registrar {selectedNew} {selectedNew === 1 ? 'aula concluída' : 'aulas concluídas'} na plataforma desde a última leitura.</strong> Elas entram com origem “plataforma” e podem gerar XP, que o servidor confere e limita por dia. Desmarque para guardá-las só como histórico.</span>
    </label>}

    {children}

    <footer className="import-review-footer">
      <span className="import-review-count" role="status" aria-live="polite"><span className="mono">{chosen}</span> de <span className="mono">{lessons.length}</span> {lessons.length === 1 ? 'aula selecionada' : 'aulas selecionadas'}</span>
      <Button className="full-width" onClick={onConfirm} disabled={!chosen}><Icon name="plus"/>{updating ? 'Atualizar curso' : `Adicionar ${chosen} ${chosen === 1 ? 'aula' : 'aulas'} à biblioteca`}</Button>
      <button className="text-button centered" onClick={onInstructions}>Como importar outro curso</button>
    </footer>
  </>;
}
