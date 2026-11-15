import { useEffect, useState } from 'react';
import { COMPRESSION } from '../../../public/compression-domain.js';
import { PDF_PLANS, formatBytes, suggestSubject } from '../../../public/pdf-domain.js';
import { discardPdf, inspectPdf, storageInfo, uploadPdf } from './pdf-client.js';
import { analyzePdf, estimatePdfRaster, optimizePdfLossless, pdfFileFrom, rasterizePdf } from './pdf-compress.js';
import Icon from '../../ui/Icon.jsx';
import { Button } from '../../ui/ui.jsx';

const NEW = '__nova';

// Anexar um PDF como material de estudo, sem curso nem link. O arquivo é lido
// no navegador (páginas, sumário, primeiras páginas) para sugerir a disciplina
// e só então enviado ao servidor, privado da conta. Anexar não gera XP.
export default function AttachPdf({ state, actions, close, notify, open, go, account, subjectId: preset = '' }) {
  const [file, setFile] = useState(null);
  const [info, setInfo] = useState(null);
  const [title, setTitle] = useState('');
  const [subjectId, setSubjectId] = useState(preset);
  const [chosen, setChosen] = useState(Boolean(preset));
  const [newSubject, setNewSubject] = useState('');
  const [status, setStatus] = useState('idle');
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [storage, setStorage] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [compression, setCompression] = useState(null);
  const [rasterPlan, setRasterPlan] = useState(null);
  const [useRaster, setUseRaster] = useState(false);
  const [progress, setProgress] = useState(null);
  useEffect(() => {
    if (!account) return undefined;
    let alive = true;
    storageInfo().then((value) => { if (alive) setStorage(value); }).catch(() => {});
    return () => { alive = false; };
  }, [account]);

  const suggestion = info ? suggestSubject(state.subjects, { title: info.title || title, name: file?.name || '', outline: info.outline, text: info.text }) : null;
  const limit = storage?.fileBytes || PDF_PLANS.free.fileBytes;

  if (!account) return <div className="dialog-content">
    <span className="dialog-emblem"><Icon name="book"/></span>
    <h2 id="dialog-title" className="title">Entre na conta para anexar PDFs.</h2>
    <p className="dialog-text">O PDF fica guardado no servidor, privado da sua conta, para você abrir no site e no aplicativo de desktop. A prévia sem conta não guarda arquivos.</p>
    <Button className="full-width" onClick={() => { close(); go('login'); }}>Entrar ou criar conta<Icon name="arrow"/></Button>
  </div>;

  async function pick(picked) {
    setError('');
    setInfo(null);
    setAnalysis(null);
    setCompression(null);
    setRasterPlan(null);
    setUseRaster(false);
    setProgress(null);
    setFile(picked);
    if (!picked) return;
    if (picked.type && picked.type !== 'application/pdf' && !/\.pdf$/i.test(picked.name)) { setError('Escolha um arquivo PDF.'); return; }
    if (picked.size > COMPRESSION.pdfSourceBytes) {
      setError(`O PDF tem ${formatBytes(picked.size)}; para otimizar no navegador o máximo é ${formatBytes(COMPRESSION.pdfSourceBytes)}.`);
      return;
    }
    setStatus('reading');
    try {
      const read = await inspectPdf(picked);
      setInfo(read);
      setTitle((current) => current || read.title || picked.name.replace(/\.pdf$/i, ''));
      if (!chosen) {
        const best = suggestSubject(state.subjects, { title: read.title, name: picked.name, outline: read.outline, text: read.text });
        if (best) setSubjectId(best.subject.id);
      }

      const analyzed = await analyzePdf(picked);
      setAnalysis(analyzed);
      const lossless = await optimizePdfLossless(picked, analyzed);
      if (lossless) setCompression(lossless);
      const bestSize = lossless?.after ?? picked.size;
      if (analyzed.scan && analyzed.pages <= COMPRESSION.pdfPagesLimit && bestSize > limit) {
        const estimate = await estimatePdfRaster(picked, analyzed, { targetBytes: limit });
        if (estimate) setRasterPlan(estimate);
      }
    } catch {
      setError('Não foi possível ler este PDF. Ele pode estar corrompido ou protegido por senha.');
    } finally {
      setStatus('idle');
    }
  }

  function choose(event) {
    pick(event.target.files?.[0] || null);
  }

  function drop(event) {
    event.preventDefault();
    setDragging(false);
    if (busy) return;
    const picked = event.dataTransfer?.files?.[0] || null;
    if (picked) pick(picked);
  }

  async function submit(event) {
    event.preventDefault();
    if (!file || !info) { setError('Escolha um PDF.'); return; }
    if (subjectId === NEW && !newSubject.trim()) { setError('Dê um nome à nova disciplina.'); return; }
    setError('');
    const fileId = crypto.randomUUID();
    try {
      let selected = compression;
      if (useRaster && rasterPlan && analysis) {
        setStatus('compressing');
        setProgress({ done: 0, total: analysis.pages });
        selected = await rasterizePdf(file, analysis, {
          targetBytes: limit,
          onProgress: (done, total) => setProgress({ done, total }),
        });
      }

      const finalFile = selected ? pdfFileFrom(selected, file.name) : file;
      const pages = selected?.pages ?? info.pages;
      const outline = selected?.outline ?? info.outline;
      if (finalFile.size > limit) {
        setError(`O PDF final tem ${formatBytes(finalFile.size)}; o limite do seu plano é ${formatBytes(limit)} por arquivo. Divida o arquivo ou libere espaço.`);
        setStatus('idle');
        setProgress(null);
        return;
      }

      setStatus('uploading');
      const uploaded = await uploadPdf(finalFile, fileId);
      const result = actions.addPdf({
        title,
        file: { fileId, name: file.name, size: uploaded.size, pages, outline, uploadedAt: new Date().toISOString() },
        subjectId: subjectId === NEW ? '' : subjectId,
        newSubject: subjectId === NEW ? newSubject : '',
      });
      if (!result) { await discardPdf(fileId); setStatus('idle'); return; }
      notify('PDF anexado. Ele abre no leitor do Lume e guarda a página em que você parar.');
      close();
      open({ type: 'pdf', id: result.state.selectedCourseId });
    } catch (exception) {
      await discardPdf(fileId);
      setError(exception.message);
      setStatus('idle');
    } finally {
      setProgress(null);
    }
  }

  const busy = status !== 'idle';
  const bestSize = compression?.after ?? file?.size ?? 0;
  const canFit = Boolean(file) && (useRaster && rasterPlan ? rasterPlan.estimatedBytes <= limit : bestSize <= limit);
  const rasterGain = rasterPlan ? Math.round(rasterPlan.gain * 100) : 0;
  return <div className="dialog-content course-editor attach-pdf">
    <span className="eyebrow">Estudo por PDF, sem curso</span>
    <h2 id="dialog-title" className="headline">Anexar PDF</h2>
    <p className="muted-text">Apostilas, livros e resumos em PDF viram material da biblioteca, com leitor próprio e retomada na página em que você parou.</p>
    <form className="form-stack" onSubmit={submit}>
      <div className="field">
        <span id="attach-pdf-label">Arquivo PDF</span>
        <label
          className={`pdf-file-picker${dragging ? ' dragging' : ''}${file ? ' has-file' : ''}${busy ? ' disabled' : ''}`}
          onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={drop}
        >
          <input
            type="file"
            className="sr-only"
            accept="application/pdf,.pdf"
            aria-labelledby="attach-pdf-label"
            onChange={choose}
            disabled={busy}
          />
          <span className="pdf-file-picker-icon" aria-hidden="true">
            <Icon name={file ? 'file' : 'upload'}/>
          </span>
          <span className="pdf-file-picker-body">
            <strong className="pdf-file-picker-name">{file ? file.name : 'Escolher arquivo PDF'}</strong>
            <span className="pdf-file-picker-hint">
              {file
                ? `${formatBytes(file.size)}${compression ? ` → ${formatBytes(compression.after)}` : ''}`
                : `Arraste aqui ou clique para selecionar · até ${formatBytes(COMPRESSION.pdfSourceBytes)} para otimizar`}
            </span>
          </span>
          <span className="button secondary pdf-file-picker-btn" aria-hidden="true">
            {file ? 'Trocar' : 'Selecionar'}
          </span>
        </label>
      </div>
      {status === 'reading' && <p className="quiet-note" role="status">Lendo e otimizando o PDF no seu navegador…</p>}
      {status === 'compressing' && progress && <p className="quiet-note" role="status">Comprimindo página {progress.done} de {progress.total}…</p>}
      {info && <p className="inline-note"><Icon name="book"/><span>{info.pages} {info.pages === 1 ? 'página' : 'páginas'} · {formatBytes(file.size)}{compression ? ` (${formatBytes(compression.after)} depois de otimizar)` : ''}{info.outline.length ? ` · sumário com ${info.outline.length} itens` : ' · sem sumário no arquivo'}</span></p>}
      {compression && <p className="inline-note"><Icon name="check"/><span>Otimizado sem perda: {formatBytes(compression.before)} → {formatBytes(compression.after)} ({Math.round(compression.gain * 100)}% menor).</span></p>}
      {rasterPlan && <label className="compress-option">
        <input type="checkbox" checked={useRaster} onChange={(event) => setUseRaster(event.target.checked)} disabled={busy}/>
        <span>Reduzir tamanho para digitalização
          <small>Estimativa: {formatBytes(rasterPlan.estimatedBytes)} (cerca de {rasterGain}% menor). O texto deixa de ser selecionável; busca, marca-texto e sumário não funcionam.</small>
        </span>
      </label>}
      {!canFit && info && !busy && (rasterPlan
        ? <p className="quiet-note">Marque a opção de digitalização para o PDF caber no limite de {formatBytes(limit)}.</p>
        : <p className="form-error">A compressão sem perda não foi suficiente para caber em {formatBytes(limit)}. Divida o arquivo ou libere espaço.</p>)}
      <label className="field">Título
        <input value={title} maxLength={100} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Apostila de Direito Penal" disabled={busy}/>
      </label>
      <label className="field">Disciplina
        <select value={subjectId} onChange={(event) => { setSubjectId(event.target.value); setChosen(true); }} disabled={busy}>
          <option value="">Sem disciplina</option>
          {(state.subjects || []).map((subject) => <option key={subject.id} value={subject.id}>{subject.title}</option>)}
          <option value={NEW}>Nova disciplina…</option>
        </select>
      </label>
      {subjectId === NEW && <label className="field">Nome da nova disciplina
        <input value={newSubject} maxLength={80} onChange={(event) => setNewSubject(event.target.value)} placeholder="Ex.: Direito Penal" disabled={busy}/>
      </label>}
      {suggestion && subjectId === suggestion.subject.id && !chosen && <p className="quiet-note">Disciplina sugerida pelo texto do PDF ({suggestion.hits.slice(0, 3).join(', ')}). Troque se não for essa.</p>}
      <p className="quiet-note">Anexar não concede XP. Concluir a leitura do PDF inteiro vale como leitura concluída, uma vez.
        {storage ? ` Uso da conta: ${formatBytes(storage.used)} de ${formatBytes(storage.accountBytes)} (faixa ${storage.label}); até ${formatBytes(storage.fileBytes)} por arquivo.` : ''}</p>
      {error && <div className="form-error-block" role="alert">
        <p className="form-error">{error}</p>
        {error.includes('armazenamento') && <Button ghost type="button" onClick={() => { close(); go('armazenamento'); }}>Gerenciar armazenamento<Icon name="arrow"/></Button>}
      </div>}
      <div className="dialog-actions">
        <Button type="submit" disabled={busy || !info || !canFit}><Icon name="plus"/>{status === 'uploading' ? 'Enviando…' : status === 'compressing' ? 'Comprimindo…' : 'Anexar PDF'}</Button>
        <Button ghost onClick={close} disabled={busy}>Cancelar</Button>
      </div>
    </form>
  </div>;
}
