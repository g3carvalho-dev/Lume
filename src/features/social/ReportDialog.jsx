import { useState } from 'react';
import { api, apiError } from '../../lib/api.js';
import { REPORT_DETAILS_LIMIT, REPORT_REASONS } from '../../../public/report-domain.js';
import { Button, Dialog } from '../../ui/ui.jsx';
import Icon from '../../ui/Icon.jsx';

const CONTEXT_COPY = {
  direct: 'Enviar uma cópia das últimas mensagens desta conversa',
  group: 'Enviar uma cópia das mensagens dessa pessoa neste grupo',
  post: 'Enviar uma cópia do texto da publicação',
};

// Denúncia de uma pessoa. Vai para a conta criadora do Lume; a pessoa denunciada
// não é avisada. `canBlock` oferece bloquear na mesma hora.
export default function ReportDialog({ target, context, groupId = '', subjectId = '', canBlock = false, onClose, onDone }) {
  const reportingPost = context === 'post';
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [includeContext, setIncludeContext] = useState(true);
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    if (!reason) { setError('Escolha o motivo da denúncia.'); return; }
    setBusy(true); setError('');
    try {
      const result = await api('/api/reports', { method: 'POST', body: { context, targetId: target.id, groupId: groupId || undefined, subjectId: subjectId || undefined, reason, details, includeContext } });
      if (!result.ok) throw new Error(apiError(result));
      let blocked = false;
      if (alsoBlock) {
        const block = await api(`/api/blocks/${encodeURIComponent(target.id)}`, { method: 'POST' });
        blocked = block.ok;
      }
      onDone({ blocked });
      onClose();
    } catch (exception) {
      setError(exception.message);
    } finally {
      setBusy(false);
    }
  }

  return <Dialog onClose={onClose} identity="report">
    <form className={`report-dialog${reportingPost ? ' dialog-content report-post-dialog' : ''}`} onSubmit={submit}>
      {reportingPost ? <header className="report-heading">
        <h2 id="dialog-title" className="headline">Denunciar publicação</h2>
        <p className="muted-text">Publicação de {target.name}</p>
      </header> : <>
        <h2 id="dialog-title" className="title">Denunciar {target.name}</h2>
        <p className="muted-text"><Icon name="lock"/> A denúncia vai para a equipe do Lume. {target.name} não é avisada e não vê quem denunciou.</p>
      </>}
      <fieldset className="report-reasons">
        <legend className={reportingPost ? 'report-legend' : 'metric-label'}>Qual é o motivo?</legend>
        <div className="report-reason-grid">{Object.entries(REPORT_REASONS).map(([id, label]) => <label key={id} className="report-reason">
          <input type="radio" name="report-reason" value={id} checked={reason === id} onChange={() => { setReason(id); if (error === 'Escolha o motivo da denúncia.') setError(''); }} disabled={busy}/>
          <span>{label}</span>
        </label>)}</div>
      </fieldset>
      <label className="field">{reportingPost ? <span className="report-details-label">Detalhes <span>opcional</span></span> : 'Detalhes (opcional)'}
        <textarea rows={3} maxLength={REPORT_DETAILS_LIMIT} value={details} disabled={busy} onChange={(event) => setDetails(event.target.value)} placeholder="Conte o que aconteceu, se quiser."/>
      </label>
      <label className="report-check"><input type="checkbox" checked={includeContext} onChange={(event) => setIncludeContext(event.target.checked)} disabled={busy}/><span>{CONTEXT_COPY[context]}</span></label>
      {canBlock && <label className="report-check"><input type="checkbox" checked={alsoBlock} onChange={(event) => setAlsoBlock(event.target.checked)} disabled={busy}/><span>Bloquear {target.name} também</span></label>}
      {reportingPost && <p className="report-privacy"><Icon name="lock"/><span>Só a equipe do Lume recebe a denúncia. A pessoa denunciada não será avisada nem verá quem enviou.</span></p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <Button secondary type="button" onClick={onClose} disabled={busy}>Cancelar</Button>
        <Button type="submit" disabled={busy}>{busy ? 'Enviando…' : 'Enviar denúncia'}</Button>
      </div>
    </form>
  </Dialog>;
}
