import { useCallback, useEffect, useMemo, useState } from 'react';
import { COMPRESSION } from '../../../public/compression-domain.js';
import { formatBytes } from '../../../public/pdf-domain.js';
import { SOCIAL_IMAGE_BYTES, SOCIAL_PDF_BYTES } from '../../../public/social-domain.js';
import { api, apiError } from '../../lib/api.js';
import { compressImage } from '../../lib/image-compress.js';
import { analyzePdf, estimatePdfRaster, optimizePdfLossless, rasterizePdf } from '../library/pdf-compress.js';
import Icon from '../../ui/Icon.jsx';
import { Button, Heading } from '../../ui/ui.jsx';

function formatDate(iso) {
  if (!iso) return '';
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  return new Date(ts).toLocaleDateString('pt-BR');
}

export default function StoragePanel({ state, account, libraryActions, confirmSave, notify, open, go }) {
  const [storage, setStorage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('size');
  const [query, setQuery] = useState('');
  const [confirmItem, setConfirmItem] = useState(null);
  const [optimizeOffer, setOptimizeOffer] = useState(null);
  const [busyId, setBusyId] = useState('');
  const [optimizingId, setOptimizingId] = useState('');

  const load = useCallback(async () => {
    if (!account) return;
    setLoading(true);
    setError('');
    try {
      const result = await api('/api/storage');
      if (!result.ok) throw new Error(apiError(result));
      setStorage(result.data);
    } catch (err) {
      setError(err.message || 'Não foi possível carregar os dados de armazenamento.');
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => { load(); }, [load]);

  const subjectMap = useMemo(
    () => new Map((state?.subjects || []).map((item) => [item.id, item.title])),
    [state?.subjects],
  );

  const items = useMemo(() => {
    const list = storage?.items || [];
    const term = query.trim().toLowerCase();
    const filtered = list.filter((item) => {
      if (filter !== 'all' && item.kind !== filter) return false;
      if (term && !String(item.name || '').toLowerCase().includes(term) && !String(item.fileName || '').toLowerCase().includes(term)) return false;
      return true;
    });
    return [...filtered].sort((a, b) => (
      sort === 'recent'
        ? String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
        : (b.size - a.size) || String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
    ));
  }, [storage?.items, filter, query, sort]);

  if (!account) {
    return <div className="cfg-stack">
      <p className="inline-note"><Icon name="lock"/><span>Entre na sua conta para acompanhar o uso de armazenamento e gerenciar seus anexos. Na prévia local nenhum arquivo é enviado ao servidor.</span></p>
      <div><Button onClick={() => go('login')}>Entrar ou criar conta<Icon name="arrow"/></Button></div>
    </div>;
  }

  async function uploadOptimized(item, blob, after, before) {
    const path = item.kind === 'library'
      ? `/api/library/files/${encodeURIComponent(item.id)}/replace`
      : `/api/storage/items/social/${encodeURIComponent(item.id)}/replace`;
    const headers = {
      'Content-Type': blob.type || (item.kind === 'library' ? 'application/pdf' : 'application/octet-stream'),
    };
    if (item.kind !== 'library') headers['X-File-Name'] = encodeURIComponent(item.name || 'anexo');
    const response = await fetch(path, {
      method: 'PUT',
      credentials: 'same-origin',
      headers,
      body: blob,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(apiError({ data }) || 'Não foi possível substituir o anexo.');
    if (item.kind === 'social') {
      if (data.storage) setStorage(data.storage);
      else await load();
    } else {
      const size = Number(data?.size || after);
      if (item.materialId && size > 0) {
        const applied = libraryActions.setPdfSize(item.materialId, size);
        if (!applied) throw new Error('O PDF foi otimizado, mas a biblioteca não pôde ser atualizada agora.');
        await confirmSave?.();
      }
      await load();
    }
    setOptimizeOffer(null);
    notify(`${item.kind === 'library' ? 'PDF' : 'Anexo'} otimizado: ${formatBytes(before)} → ${formatBytes(after)}.`);
  }

  async function optimizeItem(item) {
    if (busyId || optimizingId) return;
    setOptimizingId(item.id);
    setError('');
    setOptimizeOffer(null);
    try {
      const url = item.kind === 'library'
        ? `/api/library/files/${encodeURIComponent(item.id)}`
        : `/api/social/posts/${encodeURIComponent(item.id)}/attachment`;
      const response = await fetch(url, { credentials: 'same-origin' });
      if (!response.ok) throw new Error('Não foi possível baixar o anexo para otimizar.');
      const blob = await response.blob();
      const type = item.kind === 'library' ? 'application/pdf' : (item.mimeType || blob.type || 'application/octet-stream');
      const file = new File([blob], item.fileName || item.name || 'anexo', { type });

      if (type.startsWith('image/')) {
        if (type === 'image/gif') {
          notify('GIFs animados não são otimizados para não perder a animação.');
          return;
        }
        const result = await compressImage(file, { maxBytes: SOCIAL_IMAGE_BYTES, maxWidth: 1920, maxHeight: 1920, force: true });
        if (!result.changed || result.after >= result.before) {
          notify('A imagem já está otimizada; não há redução disponível.');
          return;
        }
        await uploadOptimized(item, result.blob, result.after, result.before);
        return;
      }

      const analysis = await analyzePdf(file);
      const lossless = await optimizePdfLossless(file, analysis);
      if (lossless && lossless.after < lossless.before) {
        await uploadOptimized(item, lossless.blob, lossless.after, lossless.before);
        return;
      }
      const target = item.kind === 'library' ? (storage?.fileBytes || 0) : SOCIAL_PDF_BYTES;
      if (analysis.scan && analysis.pages <= COMPRESSION.pdfPagesLimit) {
        const estimate = await estimatePdfRaster(file, analysis, { targetBytes: target });
        if (estimate) {
          setOptimizeOffer({ item, file, analysis, estimate, target });
          return;
        }
      }
      notify('Este PDF já está otimizado; não há redução segura disponível.');
    } catch (err) {
      setError(err.message || 'Não foi possível otimizar este anexo.');
    } finally {
      setOptimizingId('');
    }
  }

  async function confirmRaster() {
    if (!optimizeOffer || optimizingId) return;
    const { item, file, analysis, target } = optimizeOffer;
    setOptimizeOffer(null);
    setOptimizingId(item.id);
    setError('');
    try {
      const result = await rasterizePdf(file, analysis, { targetBytes: target });
      await uploadOptimized(item, result.blob, result.after, result.before);
    } catch (err) {
      setError(err.message || 'Não foi possível reduzir este PDF.');
    } finally {
      setOptimizingId('');
    }
  }

  async function removeItem(item) {
    if (busyId || optimizingId) return;
    setBusyId(item.id);
    setError('');
    try {
      const inLibrary = item.kind === 'library'
        && item.materialId
        && (state?.courses || []).some((course) => course.id === item.materialId);
      if (inLibrary) {
        const applied = libraryActions.deleteMaterial(item.materialId);
        if (!applied) throw new Error('Não foi possível remover o material da biblioteca agora.');
        await confirmSave?.();
        await load();
      } else {
        const result = await api(`/api/storage/items/${item.kind}/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
        if (!result.ok) throw new Error(apiError(result));
        if (result.data?.storage) setStorage(result.data.storage);
        else await load();
      }
      setConfirmItem(null);
      notify(`Anexo excluído. ${formatBytes(item.size)} liberados.`);
    } catch (err) {
      setError(err.message || 'Não foi possível excluir este anexo.');
    } finally {
      setBusyId('');
    }
  }

  const limit = storage?.accountBytes || 0;
  const used = storage?.used || 0;
  const libBytes = storage?.breakdown?.libraryBytes || 0;
  const socialBytes = storage?.breakdown?.socialBytes || 0;
  const libPct = limit > 0 ? Math.min(100, (libBytes / limit) * 100) : 0;
  const socialPct = limit > 0 ? Math.min(Math.max(0, 100 - libPct), (socialBytes / limit) * 100) : 0;
  const totalCount = storage?.items?.length || 0;
  const libCount = storage?.breakdown?.libraryFiles || 0;
  const socialCount = storage?.breakdown?.socialFiles || 0;

  return <div className="cfg-stack">
    {loading && !storage && <p className="quiet-note">Carregando uso de armazenamento…</p>}
    {error && <p className="form-error" role="alert">{error}</p>}

    {storage && <>
      <div className="cfg-storage-summary">
        <div className="cfg-storage-top">
          <div>
            <p className="cfg-storage-headline">
              <span className="mono">{formatBytes(used)}</span> de <span className="mono">{formatBytes(limit)}</span> usados{' '}
              <span className="mono cfg-storage-pct">({storage.percent}%)</span>
            </p>
            {storage.overLimit && <p className="cfg-storage-alert is-over">Você ultrapassou o limite da faixa atual. Novos envios estão bloqueados até liberar espaço.</p>}
            {!storage.overLimit && storage.nearLimit && <p className="cfg-storage-alert">Você está perto do limite de armazenamento. Exclua anexos antigos para liberar espaço.</p>}
          </div>
          <span className="soft-badge mono">Faixa atual: {storage.label}</span>
        </div>

        <div className={`cfg-storage-bar ${storage.overLimit || storage.nearLimit ? 'is-warning' : ''}`} role="img" aria-label={`Uso de armazenamento: ${formatBytes(used)} de ${formatBytes(limit)}`}>
          {libPct > 0 && <span className="cfg-storage-seg is-library" style={{ width: `${libPct}%` }}/>}
          {socialPct > 0 && <span className="cfg-storage-seg is-social" style={{ width: `${socialPct}%` }}/>}
        </div>

        <div className="cfg-storage-legend">
          <span><i className="cfg-dot is-library"/>PDFs da Biblioteca: <strong className="mono">{formatBytes(libBytes)}</strong> ({libCount})</span>
          <span><i className="cfg-dot is-social"/>Anexos do Social: <strong className="mono">{formatBytes(socialBytes)}</strong> ({socialCount})</span>
        </div>
      </div>

      <div className="cfg-block">
        <div className="cfg-storage-controls">
          <div className="cfg-filter-row" role="tablist" aria-label="Filtrar anexos por origem">
            <button type="button" role="tab" aria-selected={filter === 'all'} className={`filter-btn ${filter === 'all' ? 'is-active' : ''}`} onClick={() => setFilter('all')}>Todos ({totalCount})</button>
            <button type="button" role="tab" aria-selected={filter === 'library'} className={`filter-btn ${filter === 'library' ? 'is-active' : ''}`} onClick={() => setFilter('library')}>PDFs da Biblioteca ({libCount})</button>
            <button type="button" role="tab" aria-selected={filter === 'social'} className={`filter-btn ${filter === 'social' ? 'is-active' : ''}`} onClick={() => setFilter('social')}>Anexos do Social ({socialCount})</button>
          </div>
          <div className="cfg-storage-search">
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar anexo…" aria-label="Buscar anexo por nome"/>
            <select className="cfg-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Ordenar anexos">
              <option value="size">Maior primeiro</option>
              <option value="recent">Mais recentes</option>
            </select>
          </div>
        </div>

        {items.length === 0
          ? <p className="quiet-note">{totalCount === 0 ? 'Nenhum anexo guardado na sua conta até agora.' : 'Nenhum anexo encontrado com este filtro.'}</p>
          : <ul className="cfg-storage-list">
              {items.map((item) => {
                const subjectName = item.subjectId ? subjectMap.get(item.subjectId) : '';
                const meta = item.kind === 'library'
                  ? ['Biblioteca', subjectName, formatDate(item.createdAt)].filter(Boolean).join(' · ')
                  : ['Social', formatDate(item.createdAt) ? `Publicação de ${formatDate(item.createdAt)}` : 'Publicação'].join(' · ');
                const confirming = confirmItem?.id === item.id && confirmItem?.kind === item.kind;
                return <li key={`${item.kind}-${item.id}`} className="cfg-storage-item">
                  <div className="cfg-storage-item-main">
                    <div className="cfg-storage-item-info">
                      <strong>{item.name}</strong>
                      <span>{meta}</span>
                    </div>
                    <span className="mono cfg-storage-size">{formatBytes(item.size)}</span>
                    <div className="cfg-storage-actions">
                      {item.kind === 'library' && item.materialId && <Button secondary onClick={() => open({ type: 'pdf', id: item.materialId })}>Abrir</Button>}
                      {item.kind === 'social' && <Button secondary onClick={() => go('amigos')}>Ver no Social</Button>}
                      {(item.kind === 'social' || item.status === 'ready') && <Button secondary disabled={Boolean(busyId || optimizingId)} onClick={() => optimizeItem(item)}>
                        {optimizingId === item.id ? 'Otimizando…' : 'Otimizar'}
                      </Button>}
                      <Button secondary className="is-danger-outline" disabled={Boolean(busyId || optimizingId)} onClick={() => setConfirmItem(confirming ? null : item)}>Excluir</Button>
                    </div>
                  </div>
                  {optimizeOffer?.item.kind === item.kind && optimizeOffer?.item.id === item.id && <div className="cfg-storage-confirm" role="region" aria-label="Confirmar redução para digitalização">
                    <p>
                      Este PDF é uma digitalização. Reduzir para cerca de <span className="mono">{formatBytes(optimizeOffer.estimate.estimatedBytes)}</span> rasteriza as páginas e remove texto selecionável, busca e marca-texto do arquivo. O original será substituído; o sumário e as marcações salvos no Lume continuam.
                    </p>
                    <div className="cfg-storage-actions">
                      <Button disabled={Boolean(optimizingId)} onClick={confirmRaster}>Reduzir digitalização</Button>
                      <Button ghost disabled={Boolean(optimizingId)} onClick={() => setOptimizeOffer(null)}>Manter como está</Button>
                    </div>
                  </div>}
                  {confirming && <div className="cfg-storage-confirm" role="region" aria-label="Confirmar exclusão">
                    <p>
                      Excluir <strong>{item.name}</strong> libera <span className="mono">{formatBytes(item.size)}</span>.{' '}
                      {item.kind === 'library' ? 'O material PDF será removido da sua Biblioteca.' : 'A publicação com este anexo será removida do Social.'}
                    </p>
                    <div className="cfg-storage-actions">
                      <Button className="is-danger-fill" disabled={busyId === item.id} onClick={() => removeItem(item)}>
                        {busyId === item.id ? 'Excluindo…' : 'Confirmar exclusão'}
                      </Button>
                      <Button ghost disabled={busyId === item.id} onClick={() => setConfirmItem(null)}>Cancelar</Button>
                    </div>
                  </div>}
                </li>;
              })}
            </ul>}

        <p className="quiet-note">Excluir um PDF por aqui remove também o material correspondente da sua Biblioteca e libera espaço imediatamente.</p>
      </div>
    </>}
  </div>;
}


export function StoragePage(props) {
  return <div className="personal-root">
    <Heading title="Armazenamento">Espaço ocupado pelos seus PDFs da Biblioteca e anexos do Social.</Heading>
    <section className="card-surface cfg-panel" aria-label="Gerenciamento de armazenamento">
      <StoragePanel {...props}/>
    </section>
  </div>;
}
