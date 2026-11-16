import { useState } from 'react';
import { api, apiError } from '../../lib/api.js';
import { invalidateResources, useResource } from '../../lib/resources.js';
import { REPORT_STATUS } from '../../../public/report-domain.js';
import Icon from '../../ui/Icon.jsx';
import { Button, Empty, Heading, Skeleton } from '../../ui/ui.jsx';

const CONTEXTS = { direct: 'Conversa direta', group: 'Grupo', post: 'Publicação' };

// Denúncias recebidas. Só a conta criadora do Lume abre esta tela; o servidor
// também recusa a leitura para qualquer outra conta.
export default function Reports({ account, notify }) {
  const [status, setStatus] = useState('open');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const resource = useResource(`/api/reports?status=${status}`, { enabled: Boolean(account?.isCreator), interval: 30000 });
  const reports = resource.data?.reports || [];

  if (!account?.isCreator) return <div className="personal-root">
    <Heading title="Denúncias">Esta área é da equipe do Lume.</Heading>
    <Empty icon="lock" title="Acesso restrito.">Só a conta criadora do Lume analisa denúncias.</Empty>
  </div>;

  async function review(report, next) {
    setError('');
    const previous = resource.data;
    resource.mutate((current) => current ? {
      ...current,
      open: current.open + (next === 'open' ? 1 : report.status === 'open' ? -1 : 0),
      reports: (current.reports || []).filter((item) => item.id !== report.id),
    } : current);
    try {
      const result = await api(`/api/reports/${encodeURIComponent(report.id)}`, { method: 'PATCH', body: { status: next } });
      if (!result.ok) throw new Error(apiError(result));
      notify(next === 'open' ? 'Denúncia reaberta.' : next === 'reviewed' ? 'Denúncia marcada como analisada.' : 'Denúncia arquivada.');
      invalidateResources('/api/reports');
      invalidateResources('/api/notifications');
    } catch (exception) {
      if (previous) resource.mutate(previous);
      setError(exception.message);
      notify(exception.message);
    }
  }

  return <div className="personal-root reports-root">
    <Heading eyebrow="só para a criadora do Lume" title="Denúncias">
      Denúncias de pessoas, conversas, grupos e publicações. Quem denunciou não é revelada à pessoa denunciada.
    </Heading>
    <div className="filter-tabs" role="group" aria-label="Situação das denúncias">
      {Object.entries(REPORT_STATUS).map(([id, label]) => <button key={id} type="button" className="filter-btn" aria-pressed={status === id} onClick={() => setStatus(id)}><span>{label}{id === 'open' && resource.data ? ` (${resource.data.open})` : ''}</span></button>)}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {resource.loading && !resource.data && <Skeleton rows={3} label="Carregando denúncias…"/>}
    {resource.error && <p className="form-error" role="alert">{resource.error}</p>}
    {resource.data && reports.length === 0 && <Empty icon="check" title="Nada por aqui.">Não há denúncias nesta situação.</Empty>}
    <ul className="reports-list">
      {reports.map((report) => <li key={report.id} className="card-surface report-card">
        <div className="report-card-head">
          <span className="soft-badge">{CONTEXTS[report.context] || report.context}</span>
          <strong>{report.reasonLabel}</strong>
          <time dateTime={report.at}>{new Date(report.at).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>
        </div>
        <p className="report-people"><Icon name="flag"/>Denunciada: <strong>{report.target.name}</strong> · {report.target.reportsAgainst} {report.target.reportsAgainst === 1 ? 'denúncia' : 'denúncias'} no total · Denunciou: {report.reporter.name}</p>
        {report.details && <p className="report-details">“{report.details}”</p>}
        {report.evidence.length > 0 && <ul className="report-evidence" aria-label="Cópia do conteúdo">
          {report.evidence.map((item, index) => <li key={index}><small>{item.from} · {new Date(item.at).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</small><span>{item.body}</span></li>)}
        </ul>}
        <div className="action-row">
          {report.status === 'open'
            ? <>
              <Button disabled={busy === report.id} onClick={() => review(report, 'reviewed')}><Icon name="check"/>Marcar como analisada</Button>
              <Button secondary disabled={busy === report.id} onClick={() => review(report, 'dismissed')}>Arquivar</Button>
            </>
            : <Button secondary disabled={busy === report.id} onClick={() => review(report, 'open')}>Reabrir</Button>}
        </div>
      </li>)}
    </ul>
  </div>;
}
