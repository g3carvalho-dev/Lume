import { useEffect, useRef, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import { Button, PersonAvatar, Skeleton } from '../../ui/ui.jsx';
import { api, apiError } from '../../lib/api.js';
import { invalidateResources, useResource } from '../../lib/resources.js';
import { COMPRESSION } from '../../../public/compression-domain.js';
import { SOCIAL_POST_LIMIT, SOCIAL_COMMENT_LIMIT, SOCIAL_IMAGE_BYTES, SOCIAL_PDF_BYTES, socialText } from '../../../public/social-domain.js';
import { formatBytes } from '../../../public/pdf-domain.js';
import { compressImage } from '../../lib/image-compress.js';
import { analyzePdf, estimatePdfRaster, optimizePdfLossless, pdfFileFrom, rasterizePdf } from '../library/pdf-compress.js';
import { warmProfileProps } from './prefetch.js';

const LABELS = { post: ['message', 'Entre amigos'], question: ['help', 'Dúvida rápida'], material: ['file', 'Material compartilhado'], image: ['image', 'Foto / Print'], achievement: ['trophy', 'Conquista'] };

function isPdfFile(file) {
  return Boolean(file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')));
}

export function SocialAvatar({ person, size = '' }) {
  return <PersonAvatar person={person} className={`social-avatar ${size}`}/>;
}

function PostTime({ at }) {
  const date = new Date(at);
  return <time dateTime={at} title={date.toLocaleString('pt-BR')}><Icon name="clock"/>{date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} · {date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</time>;
}

function Composer({ account, avatar, xp, onPosted }) {
  const [body, setBody] = useState('');
  const [kind, setKind] = useState('post');
  const [file, setFile] = useState(null);
  const [pickAchievement, setPickAchievement] = useState(false);
  const [achievementId, setAchievementId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [compression, setCompression] = useState(null);
  const [rasterPlan, setRasterPlan] = useState(null);
  const [useRaster, setUseRaster] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [progress, setProgress] = useState(null);
  const requestId = useRef(crypto.randomUUID());
  const fileInput = useRef(null);
  const imageInput = useRef(null);
  const achievements = xp?.achievements || [];

  useEffect(() => {
    if (!file?.type.startsWith('image/')) { setPreview(''); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function clearAttachment() {
    setFile(null);
    setPreview('');
    setAnalysis(null);
    setCompression(null);
    setRasterPlan(null);
    setUseRaster(false);
    setProgress(null);
  }

  async function choose(event) {
    const picked = event.target.files?.[0];
    event.target.value = '';
    if (!picked) return;
    const pdf = isPdfFile(picked);
    if (!pdf && !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(picked.type)) {
      setError('Escolha um PDF, PNG, JPG, WebP ou GIF.');
      return;
    }
    const sourceLimit = pdf ? COMPRESSION.pdfSourceBytes : COMPRESSION.imageSourceBytes;
    if (picked.size > sourceLimit) {
      setError(pdf
        ? `O PDF tem ${formatBytes(picked.size)}; para otimizar no navegador o máximo é ${formatBytes(sourceLimit)}.`
        : `A imagem tem ${formatBytes(picked.size)}; para otimizar no navegador o máximo é ${formatBytes(sourceLimit)}.`);
      return;
    }

    clearAttachment();
    setPickAchievement(false);
    setAchievementId('');
    setError('');
    setOptimizing(true);
    try {
      if (!pdf) {
        const result = await compressImage(picked, {
          maxBytes: SOCIAL_IMAGE_BYTES,
          maxWidth: 1920,
          maxHeight: 1920,
          sourceBytes: COMPRESSION.imageSourceBytes,
        });
        const attachment = result.changed
          ? new File([result.blob], picked.name, { type: result.blob.type || picked.type })
          : picked;
        setFile(attachment);
        setCompression(result.changed ? {
          kind: 'image',
          before: result.before,
          after: result.after,
          gain: (result.before - result.after) / result.before,
        } : null);
        return;
      }

      setFile(picked);
      const analyzed = await analyzePdf(picked);
      setAnalysis(analyzed);
      const lossless = await optimizePdfLossless(picked, analyzed);
      if (lossless) setCompression({ ...lossless, kind: 'pdf' });
      const bestSize = lossless?.after ?? picked.size;
      if (analyzed.scan && analyzed.pages <= COMPRESSION.pdfPagesLimit && bestSize > SOCIAL_PDF_BYTES) {
        const estimate = await estimatePdfRaster(picked, analyzed, { targetBytes: SOCIAL_PDF_BYTES });
        if (estimate) setRasterPlan(estimate);
      }
    } catch (exception) {
      setError(exception.message || 'Não foi possível otimizar este anexo.');
      if (pdf) clearAttachment();
    } finally {
      setOptimizing(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (busy || optimizing) return;
    setBusy(true); setError('');
    try {
      let attachment = file;
      if (isPdfFile(file)) {
        if (useRaster && rasterPlan && analysis) {
          setProgress({ done: 0, total: analysis.pages });
          const raster = await rasterizePdf(file, analysis, {
            targetBytes: SOCIAL_PDF_BYTES,
            onProgress: (done, total) => setProgress({ done, total }),
          });
          attachment = pdfFileFrom(raster, file.name);
        } else if (compression?.kind === 'pdf' && compression.blob) {
          attachment = pdfFileFrom(compression, file.name);
        }
      }

      const maxBytes = isPdfFile(file) ? SOCIAL_PDF_BYTES : SOCIAL_IMAGE_BYTES;
      if (attachment && attachment.size > maxBytes) {
        throw new Error(isPdfFile(file)
          ? 'O PDF final passa de 10 MB. Marque a redução para digitalização ou escolha outro arquivo.'
          : 'A imagem final passa de 2 MB. Escolha outra imagem.');
      }

      const form = new FormData();
      form.set('id', requestId.current); form.set('body', body); form.set('kind', kind);
      if (achievementId) form.set('achievementId', achievementId);
      if (attachment) form.set('attachment', attachment);
      const response = await fetch('/api/social/posts', { method: 'POST', credentials: 'same-origin', body: form });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(apiError({ data }));
      setBody(''); clearAttachment(); setAchievementId(''); setPickAchievement(false); setKind('post');
      requestId.current = crypto.randomUUID();
      onPosted();
    } catch (exception) { setError(exception.message); }
    finally { setBusy(false); setProgress(null); }
  }

  const pdfSelected = isPdfFile(file);
  const finalSize = pdfSelected
    ? (useRaster && rasterPlan ? rasterPlan.estimatedBytes : compression?.kind === 'pdf' ? compression.after : file?.size || 0)
    : file?.size || 0;
  const finalLimit = pdfSelected ? SOCIAL_PDF_BYTES : SOCIAL_IMAGE_BYTES;
  const canAttach = !file || finalSize <= finalLimit;
  const rasterGain = rasterPlan ? Math.round(rasterPlan.gain * 100) : 0;

  return <section className="card-surface social-composer" aria-label="Criar publicação">
    <form onSubmit={submit}>
      <div className="social-compose-body">
        <SocialAvatar person={{ name: account.name, avatar }}/>
        <label className="field social-compose-field"><span className="sr-only">Sua publicação</span>
          <textarea value={body} onChange={event => setBody(event.target.value)} placeholder="No que você está focando hoje? Conte para seus amigos…" rows={3} maxLength={SOCIAL_POST_LIMIT} disabled={busy || optimizing}/>
        </label>
      </div>
      {file && <div className="social-draft-attachment">
        {preview ? <img className="social-draft-image" src={preview} alt="Prévia do anexo"/> : <Icon name="file"/>}
        <span>
          <strong>{file.name}</strong>
          <small>{compression ? `${formatBytes(compression.before)} → ${formatBytes(finalSize)}` : formatBytes(finalSize)}</small>
        </span>
        <button type="button" className="icon-button" onClick={clearAttachment} disabled={busy} aria-label="Remover anexo"><Icon name="close"/></button>
      </div>}
      {optimizing && <p className="quiet-note" role="status">Otimizando anexo no seu navegador…</p>}
      {progress && <p className="quiet-note" role="status">Comprimindo página {progress.done} de {progress.total}…</p>}
      {compression?.kind === 'image' && <p className="quiet-note">Imagem otimizada: {formatBytes(compression.before)} → {formatBytes(compression.after)} ({Math.round(compression.gain * 100)}% menor).</p>}
      {compression?.kind === 'pdf' && <p className="quiet-note">PDF otimizado sem perda: {formatBytes(compression.before)} → {formatBytes(compression.after)} ({Math.round(compression.gain * 100)}% menor).</p>}
      {rasterPlan && <label className="compress-option">
        <input type="checkbox" checked={useRaster} onChange={(event) => setUseRaster(event.target.checked)} disabled={busy || optimizing}/>
        <span>Reduzir tamanho para digitalização
          <small>Estimativa: {formatBytes(rasterPlan.estimatedBytes)} (cerca de {rasterGain}% menor). O texto deixa de ser selecionável; busca, marca-texto e sumário não funcionam.</small>
        </span>
      </label>}
      {file && !canAttach && !optimizing && (rasterPlan
        ? <p className="quiet-note">Marque a opção de digitalização para o anexo caber em {formatBytes(finalLimit)}.</p>
        : <p className="form-error">O anexo passa de {formatBytes(finalLimit)} e a compressão sem perda não foi suficiente. Escolha outro arquivo.</p>)}
      {pickAchievement && <label className="field social-achievement-select">Conquista para compartilhar
        <select value={achievementId} disabled={busy} onChange={event => setAchievementId(event.target.value)}>
          <option value="">{achievements.length ? 'Escolha uma conquista' : 'Você ainda não tem conquistas validadas'}</option>
          {achievements.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
      </label>}
      <div className="social-compose-footer">
        <div className="social-attach-actions">
          <button type="button" className="chip-button" onClick={() => fileInput.current?.click()} disabled={busy || optimizing}><Icon name="file"/>Arquivo / Resumo</button>
          <button type="button" className="chip-button" aria-pressed={pickAchievement} onClick={() => { setPickAchievement(value => !value); clearAttachment(); setAchievementId(''); }} disabled={busy || optimizing}><Icon name="trophy"/>Conquista</button>
          <button type="button" className="chip-button" onClick={() => imageInput.current?.click()} disabled={busy || optimizing}><Icon name="image"/>Foto / Print</button>
          <label className="social-kind"><span className="sr-only">Tipo de publicação</span><select value={kind} onChange={event => setKind(event.target.value)} disabled={busy || optimizing}><option value="post">Publicação</option><option value="question">Dúvida rápida</option></select></label>
        </div>
        <Button type="submit" disabled={busy || optimizing || !canAttach || (!socialText(body) && !file && !achievementId)}>{busy ? (progress ? 'Comprimindo…' : 'Publicando…') : 'Postar'}<Icon name="arrow"/></Button>
      </div>
      <input ref={fileInput} type="file" accept="application/pdf" className="sr-only" aria-label="Anexar PDF à publicação" onChange={choose} disabled={busy || optimizing}/>
      <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" aria-label="Anexar foto à publicação" onChange={choose} disabled={busy || optimizing}/>
      <div className="social-compose-hint"><span><Icon name="lock"/>Visível para seus amigos · PDF até 30 MB (10 MB após otimizar) ou imagem até 12 MB (2 MB após otimizar)</span><span>{body.length}/{SOCIAL_POST_LIMIT}</span></div>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  </section>;
}

function Comments({ post, refresh }) {
  const [cursor, setCursor] = useState('');
  const [older, setOlder] = useState([]);
  const path = `/api/social/posts/${post.id}/comments`;
  const resource = useResource(`${path}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(crypto.randomUUID());
  const comments = [...older, ...(resource.data?.comments || [])];

  async function send(event) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const result = await api(path, { method: 'POST', body: { id: requestId.current, body } });
      if (!result.ok) throw new Error(apiError(result));
      setBody(''); requestId.current = crypto.randomUUID();
      // Volta à primeira página para evitar esconder comentários novos.
      setCursor(''); setOlder([]);
      invalidateResources(path); refresh();
    } catch (exception) { setError(exception.message); }
    finally { setBusy(false); }
  }

  async function remove(comment) {
    setBusy(true); setError('');
    try {
      const result = await api(`${path}/${comment.id}`, { method: 'DELETE' });
      if (!result.ok) throw new Error(apiError(result));
      setOlder(items => items.filter(item => item.id !== comment.id));
      await resource.refresh(); refresh();
    } catch (exception) { setError(exception.message); }
    finally { setBusy(false); }
  }

  return <div className="social-comments">
    {resource.loading && !resource.data && <Skeleton rows={1} label="Carregando comentários…"/>}
    {comments.map(comment => <div className="social-comment" key={comment.id}>
      <SocialAvatar person={comment.author} size="small"/>
      <div><div className="social-comment-heading"><strong>{comment.author.name}</strong><PostTime at={comment.at}/></div><p>{comment.body}</p></div>
      {comment.canDelete && <button type="button" className="icon-button" aria-label={`Excluir comentário de ${comment.author.name}`} disabled={busy} onClick={() => remove(comment)}><Icon name="trash"/></button>}
    </div>)}
    {resource.data?.nextCursor && <button type="button" className="text-button" onClick={() => { setOlder(comments); setCursor(resource.data.nextCursor); }}>Mais comentários</button>}
    <form className="social-comment-form" onSubmit={send}>
      <label className="field"><span className="sr-only">Comentar publicação de {post.author.name}</span><textarea rows={2} value={body} maxLength={SOCIAL_COMMENT_LIMIT} placeholder="Deixe um comentário…" disabled={busy} onChange={event => setBody(event.target.value)}/></label>
      <Button secondary type="submit" disabled={busy || !socialText(body)}>{busy ? 'Enviando…' : 'Comentar'}</Button>
    </form>
    {(error || resource.error) && <p className="form-error" role="alert">{error || resource.error}</p>}
  </div>;
}

function PostCard({ post, refresh, go }) {
  const [showComments, setShowComments] = useState(post.comments > 0);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [imageFailed, setImageFailed] = useState(false);
  const [icon, label] = LABELS[post.kind] || LABELS.post;

  async function react() {
    setBusy(true); setError('');
    try {
      const result = await api(`/api/social/posts/${post.id}/reaction`, { method: post.reacted ? 'DELETE' : 'PUT' });
      if (!result.ok) throw new Error(apiError(result));
      await refresh();
    } catch (exception) { setError(exception.message); }
    finally { setBusy(false); }
  }

  async function remove() {
    setBusy(true); setError('');
    try {
      const result = await api(`/api/social/posts/${post.id}`, { method: 'DELETE' });
      if (!result.ok) throw new Error(apiError(result));
      await refresh();
    } catch (exception) { setError(exception.message); }
    finally { setBusy(false); }
  }

  return <article className={`card-surface social-post is-${post.kind}`} aria-label={`Publicação de ${post.author.name}`}>
    <header className="social-post-heading">
      <button type="button" className="social-author" {...warmProfileProps(post.author)} onClick={() => go(post.author.handle ? `perfil?u=${post.author.handle}` : post.canDelete ? 'perfil' : `perfil?id=${encodeURIComponent(post.author.id)}`)} aria-label={`Ver perfil de ${post.author.name}`}>
        <SocialAvatar person={post.author}/><span><strong>{post.author.name}</strong><PostTime at={post.at}/></span>
      </button>
      <span className={`social-post-kind ${post.kind === 'achievement' ? 'is-reward' : ''}`}><Icon name={icon}/>{label}</span>
      {post.canDelete && <button type="button" className="icon-button" onClick={() => setConfirming(value => !value)} aria-label="Excluir publicação" disabled={busy}><Icon name="trash"/></button>}
    </header>
    {post.body && <p className="social-post-body">{post.body}</p>}
    {post.attachment && (post.attachment.type.startsWith('image/')
      ? imageFailed ? <p className="quiet-note">Imagem indisponível.</p> : <a href={post.attachment.url} target="_blank" rel="noreferrer" className="social-post-image"><img src={post.attachment.url} alt={post.attachment.name} loading="lazy" onError={() => setImageFailed(true)}/></a>
      : <div className="social-file"><span className="social-file-icon"><Icon name="file"/></span><span className="social-file-copy"><strong>{post.attachment.name}</strong><small>PDF · {formatBytes(post.attachment.size)}</small></span><div className="social-file-actions"><a className="button secondary" href={post.attachment.url} target="_blank" rel="noreferrer">Abrir</a><a className="button secondary" href={`${post.attachment.url}?download=1`} download><Icon name="download"/>Baixar</a></div></div>)}
    {post.achievement && <div className="social-achievement"><span className="social-achievement-icon"><Icon name="trophy"/></span><div><span className="metric-label">Conquista validada</span><strong>{post.achievement.title}</strong><p>{post.achievement.criterion}</p></div><Icon name="check"/></div>}
    {post.kind === 'achievement' && !post.achievement && <p className="quiet-note">Esta conquista foi corrigida e não está mais disponível.</p>}
    <div className="social-post-actions">
      <button type="button" className={`social-reaction ${post.reacted ? 'is-selected' : ''}`} aria-pressed={post.reacted} onClick={react} disabled={busy}><Icon name={post.kind === 'achievement' ? 'spark' : 'heart'}/>{post.kind === 'achievement' ? 'Parabenizar' : 'Curtir'}<span>{post.reactions}</span></button>
      <button type="button" className="text-button" aria-expanded={showComments} onClick={() => setShowComments(value => !value)}><Icon name="message"/>{post.comments} {post.comments === 1 ? 'comentário' : 'comentários'}</button>
    </div>
    {confirming && <div className="social-delete-confirm"><p>Excluir esta publicação e seus comentários?</p><div className="action-row"><Button className="danger-button" onClick={remove} disabled={busy}>Sim, excluir publicação</Button><Button secondary onClick={() => setConfirming(false)} disabled={busy}>Manter publicação</Button></div></div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {showComments && <Comments post={post} refresh={refresh}/>}
  </article>;
}

function FeedPage({ cursor, last, onMore, go }) {
  const resource = useResource(`/api/social/feed${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { interval: 45000 });
  const refresh = async () => { invalidateResources('/api/social/posts/'); return resource.refresh(); };
  return <div className="social-feed-page">
    {resource.loading && !resource.data && <Skeleton rows={3} label="Carregando publicações…"/>}
    {resource.error && <div className="form-error form-error-block" role="alert">{resource.error}<Button secondary onClick={resource.refresh}>Tentar novamente</Button></div>}
    {resource.data?.posts.map(post => <PostCard key={post.id} post={post} refresh={refresh} go={go}/>)}
    {!cursor && resource.data?.posts.length === 0 && !resource.error && <section className="card-surface social-feed-empty"><span className="social-empty-icon"><Icon name="message"/></span><h2 className="title">As próximas conversas começam aqui.</h2><p>Compartilhe uma dúvida, um resumo ou uma conquista. As publicações aparecem só para você e seus amigos.</p></section>}
    {last && resource.data?.nextCursor && <Button secondary className="social-load-more" onClick={() => onMore(resource.data.nextCursor)}>Ver mais publicações<Icon name="chevron-down"/></Button>}
  </div>;
}

export default function SocialFeed({ account, avatar, xp, notify, go }) {
  const [cursors, setCursors] = useState(['']);
  function posted() {
    setCursors(['']); invalidateResources('/api/social/feed');
    notify('Publicação compartilhada com seus amigos.');
  }
  return <div className="social-feed-column">
    <Composer account={account} avatar={avatar} xp={xp} onPosted={posted}/>
    <section className="social-feed" aria-label="Publicações entre amigos">{cursors.map((cursor, index) => <FeedPage key={cursor} cursor={cursor} last={index === cursors.length - 1} onMore={next => setCursors(items => [...items, next])} go={go}/>)}</section>
  </div>;
}
