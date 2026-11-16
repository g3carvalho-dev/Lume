import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { api, apiError } from '../../lib/api.js';
import Icon from '../../ui/Icon.jsx';
import { Button, Empty, Heading, PersonAvatar, Skeleton, stagger } from '../../ui/ui.jsx';
import { useResource } from '../../lib/resources.js';

const TABS = [
  { id: 'level', label: 'Nível', icon: 'podium', short: 'Nível acumulado', hint: 'Maior nível e, depois, maior XP elegível acumulado.' },
  { id: 'courses', label: 'Cursos concluídos', icon: 'book', short: 'Cursos distintos concluídos', hint: 'Cursos distintos com todas as unidades obrigatórias concluídas.' },
  { id: 'effort', label: 'Empenho', icon: 'target', short: 'Empenho no período', hint: 'XP elegível no período, com minutos e conclusões como contexto.' },
];

const number = (value) => Number(value || 0).toLocaleString('pt-BR');

function dateLabel(day) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: '2-digit', month: 'short' }).format(new Date(`${day}T12:00:00Z`));
}

function periodText(period) {
  if (!period?.startDay) return '';
  const end = new Date(`${period.endDay}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  const endDay = `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, '0')}-${String(end.getUTCDate()).padStart(2, '0')}`;
  return `${period.kind === 'month' ? 'Mês' : 'Semana'} de ${dateLabel(period.startDay)} a ${dateLabel(endDay)}`;
}

// Valor principal e rótulo de cada classificação.
function primary(entry, tab) {
  if (tab === 'courses') return { value: number(entry.coursesCompleted), unit: entry.coursesCompleted === 1 ? 'curso' : 'cursos' };
  if (tab === 'effort') return { value: number(entry.periodXP), unit: 'XP' };
  return { value: number(entry.totalXP), unit: 'XP' };
}

function secondary(entry, tab) {
  if (tab === 'effort') return entry.minutes ? `${number(entry.minutes)} min` : '—';
  return `Nível ${entry.level}`;
}

function Podium({ entries, tab }) {
  // Ordem visual: 2º, 1º, 3º.
  const slots = [entries[1], entries[0], entries[2]].filter(Boolean);
  return <ol className="rk-podium" aria-label="Pódio">
    {slots.map((entry, index) => {
      const main = primary(entry, tab);
      return <motion.li key={entry.id} className={`rk-podium-card rank-${Math.min(entry.position, 3)} ${entry.isSelf ? 'is-self' : ''}`} {...stagger(index)}>
        <span className="rk-podium-position" aria-label={`Posição ${entry.position}`}>{entry.position}º</span>
        <PersonAvatar person={entry} className="rk-podium-avatar"/>
        <strong className="rk-podium-name">{entry.name}{entry.isSelf && <span className="rk-you">você</span>}</strong>
        <small className="rk-podium-sub">{secondary(entry, tab)}</small>
        <span className="rk-podium-value">{main.value}<small>{main.unit}</small></span>
      </motion.li>;
    })}
  </ol>;
}

export default function Ranking({ account, xp, refreshXP, notify, go }) {
  const [tab, setTab] = useState('level');
  const [period, setPeriod] = useState('week');
  const [menu, setMenu] = useState(false);
  const menuRoot = useRef(null);
  const timeZone = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; } })();
  const resource = useResource(`/api/ranking?tab=${tab}&period=${period}&timeZone=${encodeURIComponent(timeZone)}`, { enabled: Boolean(account) });
  const data = resource.data;
  const [actionError, setError] = useState('');
  const error = actionError || resource.error;
  const [busy, setBusy] = useState(false);
  const loading = resource.loading;

  const load = useCallback(async () => {
    if (!account) return;
    setError('');
    const result = await resource.refresh();
    if (!result.ok) setError(apiError(result));
  }, [account, resource.refresh]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!menu) return undefined;
    const outside = (event) => { if (!menuRoot.current?.contains(event.target)) setMenu(false); };
    const escape = (event) => { if (event.key === 'Escape') setMenu(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [menu]);

  async function join(optIn) {
    setError('');
    setMenu(false);
    const previous = resource.data;
    resource.mutate((current) => current ? { ...current, optIn } : current);
    try {
      const result = await api('/api/xp/settings', { method: 'PATCH', body: { rankingOptIn: optIn } });
      if (!result.ok) throw new Error(apiError(result));
      notify(optIn ? 'Você entrou no ranking de amigos. Só suas amizades veem.' : 'Você saiu do ranking. Seu XP e suas conquistas continuam guardados.');
      refreshXP?.();
      load();
    } catch (exception) {
      if (previous) resource.mutate(previous);
      setError(exception.message);
      notify(exception.message);
    }
  }

  if (!account) return <div className="personal-root">
    <Heading eyebrow="Comparação opcional entre amigos" title="Ranking">O ranking precisa de uma conta e de amizades. Na prévia, você pode explorar o resto do Lume.</Heading>
    <Empty icon="podium" title="Entre para participar.">O convite por link é o caminho para formar sua lista de amigos.</Empty>
    <Button onClick={() => go('login')}><Icon name="lock"/>Entrar na minha conta</Button>
  </div>;

  const entries = data?.entries || [];
  const self = data?.self;
  const current = TABS.find((item) => item.id === tab);
  const head = tab === 'courses' ? ['Nível', 'Cursos'] : tab === 'effort' ? ['Minutos', 'XP no período'] : ['Nível', 'XP'];

  return <div className="personal-root ranking-root rk-root">
    <header className="rk-header">
      <div>
        <h1 className="display">Ranking</h1>
        <p className="lead">Seu avanço e o dos seus amigos.</p>
        <p className="rk-scope"><Icon name="users"/>Só entre amigos</p>
      </div>
      <div className="rk-participation" ref={menuRoot}>
        <Button secondary aria-haspopup="dialog" aria-expanded={menu} onClick={() => setMenu((value) => !value)}><Icon name="settings"/>Participação</Button>
        {menu && <div className="rk-popover" role="dialog" aria-label="Participação no ranking">
          <h2 className="title">{self?.optedIn ? 'Você está no ranking de amigos.' : 'Você ainda não aparece no ranking.'}</h2>
          <p className="muted-text">{self?.optedIn
            ? 'Só quem está na sua lista de amigos vê esta classificação. Sair não apaga XP, nível nem conquistas.'
            : 'A participação é opcional e reversível. Sem entrar, seu XP continua privado e você pode estudar normalmente.'}</p>
          <Button secondary onClick={() => join(!self?.optedIn)} disabled={busy || loading}>
            <Icon name={self?.optedIn ? 'lock' : 'users'}/>{busy ? 'Atualizando…' : self?.optedIn ? 'Sair do ranking' : 'Participar do ranking'}
          </Button>
        </div>}
      </div>
    </header>

    {self && !self.optedIn && <section className="card-surface rk-optin" aria-label="Participação no ranking">
      <span className="pace-icon"><Icon name="podium"/></span>
      <p><strong>Você ainda não aparece no ranking.</strong> Participar é opcional e reversível; sem entrar, seu XP continua privado.</p>
      <Button onClick={() => join(true)} disabled={busy || loading}><Icon name="users"/>Participar do ranking</Button>
    </section>}

    <div className="rk-tabs" role="tablist" aria-label="Classificação do ranking">
      {TABS.map((item) => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className="rk-tab" onClick={() => setTab(item.id)}><Icon name={item.icon}/>{item.label}</button>)}
    </div>
    <div className="rk-subhead">
      <span className="rk-subhead-label" title={current.hint}>{current.short}{tab === 'effort' && data?.period ? ` · ${periodText(data.period)}` : ''}</span>
      {tab === 'effort' && <label className="rk-period"><span className="sr-only">Período</span>
        <select value={period} onChange={(event) => setPeriod(event.target.value)} aria-label="Período">
          <option value="week">Semana atual</option>
          <option value="month">Mês atual</option>
        </select>
      </label>}
      {data && <span className="rk-count">{entries.length} {entries.length === 1 ? 'participante' : 'participantes'}</span>}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}

    {loading && !data && <Skeleton label="Carregando o ranking…" rows={4}/>}
    {!loading && data && entries.length === 0 && <Empty icon="users" title="Ninguém participando ainda.">Convide amigos e combine de entrar no ranking. Quem não entrar não aparece, e isso não muda o XP de ninguém.</Empty>}

    {entries.length > 0 && <>
      <Podium entries={entries} tab={tab}/>
      <section aria-labelledby="rk-full-title" className="rk-full">
        <h2 id="rk-full-title" className="title">Classificação completa</h2>
        <div className="rk-table-wrap">
          <table className="rk-table" aria-label={`Ranking por ${current.label}`}>
            <thead><tr><th scope="col">Posição</th><th scope="col">Pessoa</th><th scope="col">{head[0]}</th><th scope="col" className="is-num">{head[1]}</th></tr></thead>
            <tbody>
              {entries.map((entry) => <tr key={entry.id} className={`rk-row ${entry.isSelf ? 'is-self' : ''}`}>
                <td className={`rk-position ${entry.position <= 3 ? `top-${entry.position}` : ''}`}><span className="sr-only">Posição </span>{entry.position}º</td>
                <td><span className="rk-person"><PersonAvatar person={entry} className="ranking-avatar"/><strong>{entry.name}</strong>{entry.isSelf && <span className="rk-you">você</span>}</span></td>
                <td className="rk-sub">{secondary(entry, tab)}</td>
                <td className="is-num rk-value">{primary(entry, tab).value}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </section>
    </>}

    <details className="card-surface rk-rules">
      <summary><h2 className="title">Como funciona a classificação</h2><Icon name="chevron-down"/></summary>
      <ul className="ranking-rule-list">
        <li><strong>Nível:</strong> maior nível; empate vai para quem tem mais XP elegível acumulado.</li>
        <li><strong>Cursos:</strong> quantidade de cursos distintos com todas as unidades obrigatórias concluídas; repetir o mesmo curso não conta duas vezes.</li>
        <li><strong>Empenho:</strong> XP elegível obtido no período. Minutos, aulas, leituras e entregas aparecem como contexto, não como um índice opaco.</li>
        <li>O ranking usa apenas XP confirmado pelo servidor; saldo legado, tarefas de prova e presença não entram.</li>
        <li>Empates nos critérios compartilham a posição. Não há desempate por cliques, mensagens ou presença.</li>
      </ul>
    </details>
  </div>;
}
