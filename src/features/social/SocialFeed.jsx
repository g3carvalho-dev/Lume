import { useEffect, useRef, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import { Button, PersonAvatar, Skeleton } from '../../ui/ui.jsx';
import { api, apiError } from '../../lib/api.js';
import { invalidateResources, mutateResource, useResource } from '../../lib/resources.js';
import { COMPRESSION } from '../../../public/compression-domain.js';
import { SOCIAL_POST_LIMIT, SOCIAL_COMMENT_LIMIT, SOCIAL_IMAGE_BYTES, SOCIAL_PDF_BYTES, socialText } from '../../../public/social-domain.js';
import { formatBytes } from '../../../public/pdf-domain.js';
import { compressImage } from '../../lib/image-compress.js';
import { analyzePdf, estimatePdfRaster, optimizePdfLossless, pdfFileFrom, rasterizePdf } from '../library/pdf-compress.js';
import { PersonButton } from './PersonCard.jsx';
import EmojiButton from './EmojiPicker.jsx';
import ReportDialog from './ReportDialog.jsx';

// Só dois tipos se escolhem ao publicar: cabem lado a lado, sem menu.
const KINDS = [['post', 'users', 'Entre amigos'], ['question', 'help', 'Dúvida rápida']];
const LABELS = { post: ['message', 'Entre amigos'], question: ['help', 'Dúvida rápida'], material: ['file', 'Material compartilhado'], image: ['image', 'Foto / Print'], achievement: ['trophy', 'Conquista'] };

function isPdfFile(file) {
  return Boolean(file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')));
}

function toggleReactionSummary(summary = [], emoji, mine) {
  const existing = summary.find((item) => item.emoji === emoji);
  if (mine) {
    return summary
      .map((item) => (item.emoji === emoji ? { ...item, count: item.count - 1, mine: false } : item))
      .filter((item) => item.count > 0);
  }
  if (existing) {
    return summary.map((item) => (item.emoji === emoji ? { ...item, count: item.count + 1, mine: true } : item));
  }
  return [...summary, { emoji, count: 1, mine: true }];
}

export function SocialAvatar({ person, size = '' }) {
  return <PersonAvatar person={person} className={`social-avatar ${size}`}/>;
}

function PostTime({ at }) {
  const date = new Date(at);
  return <time dateTime={at} title={date.toLocaleString('pt-BR')}><Icon name="clock"/>{date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} · {date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</time>;
}

export function Composer({ account, avatar, xp, onPosted, note = '' }) {
  const [body, setBody] = useState('');
  const [kind, setKind] = useState('post');
  const [file, setFile] = useState(null);
  const [gif, setGif] = useState(null);
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
    setGif(null);
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

      const draftId = requestId.current;
      const draftBody = body;
      const draftKind = kind;
      const draftGif = gif;
      const draftAchievementId = achievementId;
      const draftFile = file;
      const draftPreview = preview;
      const achievementObj = draftAchievementId ? achievements.find((item) => item.id === draftAchievementId) : null;
      const optimisticPost = {
        id: draftId,
        kind: draftAchievementId ? 'achievement' : attachment ? (isPdfFile(attachment) ? 'material' : 'image') : draftKind,
        body: draftBody.trim(),
        gif: draftGif?.url || '',
        attachment: attachment ? {
          name: attachment.name,
          type: attachment.type || (isPdfFile(attachment) ? 'application/pdf' : 'image/png'),
          size: attachment.size,
          url: draftPreview || '',
        } : null,
        achievement: achievementObj ? { id: achievementObj.id, title: achievementObj.title, criterion: achievementObj.criterion } : null,
        at: new Date().toISOString(),
        author: { id: account.id, name: account.name, avatar },
        canDelete: true,
        comments: 0,
        reactionSummary: [],
      };

      const form = new FormData();
      form.set('id', draftId); form.set('body', draftBody); form.set('kind', draftKind);
      if (draftAchievementId) form.set('achievementId', draftAchievementId);
      if (attachment) form.set('attachment', attachment);
      if (draftGif) form.set('gifUrl', draftGif.url);

      if (!attachment) {
        mutateResource('/api/social/feed', (previous) => previous ? { ...previous, posts: [optimisticPost, ...(previous.posts || []).filter((item) => item.id !== draftId)] } : previous);
        setBody(''); clearAttachment(); setGif(null); setAchievementId(''); setPickAchievement(false); setKind('post');
        requestId.current = crypto.randomUUID();
      }

      try {
        const response = await fetch('/api/social/posts', { method: 'POST', credentials: 'same-origin', body: form });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(apiError({ data }));
        if (attachment) {
          setBody(''); clearAttachment(); setGif(null); setAchievementId(''); setPickAchievement(false); setKind('post');
          requestId.current = crypto.randomUUID();
        }
        onPosted();
      } catch (exception) {
        if (!attachment) {
          mutateResource('/api/social/feed', (previous) => previous ? { ...previous, posts: (previous.posts || []).filter((item) => item.id !== draftId) } : previous);
          setBody((current) => current || draftBody);
          setKind(draftKind);
          if (draftGif) setGif((current) => current || draftGif);
          if (draftAchievementId) { setPickAchievement(true); setAchievementId(draftAchievementId); }
          if (draftFile) setFile((current) => current || draftFile);
        }
        throw exception;
      }
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

  const busyAny = busy || optimizing;
  return <section className="card-surface social-composer sf-composer" aria-label="Criar publicação">
    <form onSubmit={submit}>
      <div className="sf-composer-head">
        <SocialAvatar person={{ name: account.name, avatar }}/>
        <strong>{account.name}</strong>
        <div className="sf-kind" role="radiogroup" aria-label="Tipo de publicação">
          {KINDS.map(([value, icon, label]) => <button key={value} type="button" role="radio" aria-checked={kind === value} className={`sf-kind-option ${kind === value ? 'active' : ''}`} onClick={() => setKind(value)} disabled={busyAny}>
            <Icon name={icon}/>{label}
          </button>)}
        </div>
      </div>
      <label className="field social-compose-field"><span className="sr-only">Sua publicação</span>
        <textarea value={body} onChange={event => setBody(event.target.value)} placeholder="O que você quer compartilhar?" rows={3} maxLength={SOCIAL_POST_LIMIT} disabled={busyAny}/>
      </label>
      {file && <div className="social-draft-attachment">
        {preview ? <img className="social-draft-image" src={preview} alt="Prévia do anexo"/> : <Icon name="file"/>}
        <span>
          <strong>{file.name}</strong>
          <small>{compression ? `${formatBytes(compression.before)} → ${formatBytes(finalSize)}` : formatBytes(finalSize)}</small>
        </span>
        <button type="button" className="icon-button" onClick={clearAttachment} disabled={busy} aria-label="Remover anexo"><Icon name="close"/></button>
      </div>}
      {gif && <div className="social-draft-attachment">
        <img className="social-draft-image" src={gif.preview} alt="Prévia do GIF"/>
        <span><strong>GIF</strong><small>{gif.title || 'Anexado à publicação'}</small></span>
        <button type="button" className="icon-button" onClick={() => setGif(null)} disabled={busy} aria-label="Remover GIF"><Icon name="close"/></button>
      </div>}
      {optimizing && <p className="quiet-note" role="status">Otimizando anexo no seu navegador…</p>}
      {progress && <p className="quiet-note" role="status">Comprimindo página {progress.done} de {progress.total}…</p>}
      {compression?.kind === 'image' && <p className="quiet-note">Imagem otimizada: {formatBytes(compression.before)} → {formatBytes(compression.after)} ({Math.round(compression.gain * 100)}% menor).</p>}
      {compression?.kind === 'pdf' && <p className="quiet-note">PDF otimizado sem perda: {formatBytes(compression.before)} → {formatBytes(compression.after)} ({Math.round(compression.gain * 100)}% menor).</p>}
      {rasterPlan && <label className="compress-option">
        <input type="checkbox" checked={useRaster} onChange={(event) => setUseRaster(event.target.checked)} disabled={busyAny}/>
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
      <div className="sf-composer-bar">
        <div className="sf-tools">
          <button type="button" className="sf-tool" onClick={() => fileInput.current?.click()} disabled={busyAny}><Icon name="file"/>Arquivo</button>
          <button type="button" className="sf-tool" onClick={() => imageInput.current?.click()} disabled={busyAny}><Icon name="image"/>Foto</button>
          <button type="button" className="sf-tool" aria-pressed={pickAchievement} onClick={() => { setPickAchievement(value => !value); clearAttachment(); setGif(null); setAchievementId(''); }} disabled={busyAny}><Icon name="trophy"/>Conquista</button>
          <EmojiButton className="sf-tool" label="Emoji" disabled={busyAny} onEmoji={(emoji) => setBody((value) => `${value}${emoji}`.slice(0, SOCIAL_POST_LIMIT))}><Icon name="smile"/>Emoji</EmojiButton>
          <EmojiButton className="sf-tool" label="GIF" disabled={busyAny} onGif={(item) => { clearAttachment(); setPickAchievement(false); setAchievementId(''); setGif(item); }}><span className="sf-gif-tag">GIF</span>GIF</EmojiButton>
        </div>
        <span className="sf-count" aria-label={`${body.length} de ${SOCIAL_POST_LIMIT} caracteres`}>{body.length > SOCIAL_POST_LIMIT * 0.8 ? `${body.length}/${SOCIAL_POST_LIMIT}` : ''}</span>
        <Button type="submit" disabled={busyAny || !canAttach || (!socialText(body) && !file && !achievementId && !gif)}>{busy ? (progress ? 'Comprimindo…' : 'Publicando…') : 'Publicar'}<Icon name="arrow"/></Button>
      </div>
      <input ref={fileInput} type="file" accept="application/pdf" className="sr-only" aria-label="Anexar PDF à publicação" onChange={choose} disabled={busyAny}/>
      <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" aria-label="Anexar foto à publicação" onChange={choose} disabled={busyAny}/>
      {note && <p className="sf-composer-note quiet-note">{note}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  </section>;
}

// Reações em emoji: cada emoji vira uma pílula com a contagem; a pessoa liga e
// desliga o seu. O botão com carinha abre o seletor.
function Reactions({ summary, onToggle, disabled, label }) {
  return <div className="sf-reactions">
    {summary.map((item) => <button key={item.emoji} type="button" className={`sf-reaction ${item.mine ? 'is-mine' : ''}`} aria-pressed={item.mine} aria-label={`${item.emoji} ${item.count}${item.mine ? ', você reagiu' : ''}`} disabled={disabled} onClick={() => onToggle(item.emoji, item.mine)}><span aria-hidden="true">{item.emoji}</span>{item.count}</button>)}
    <EmojiButton className="sf-reaction sf-reaction-add" label={`Reagir${label ? ` a ${label}` : ''}`} disabled={disabled} align="left" onEmoji={(emoji) => onToggle(emoji, summary.some((item) => item.emoji === emoji && item.mine))}><Icon name="smile-plus"/></EmojiButton>
  </div>;
}

function CommentForm({ post, path, parent = null, me, mutateComments, mutatePost, onDone, compact = false }) {
  const [body, setBody] = useState('');
  const [gif, setGif] = useState(null);
  const [error, setError] = useState('');
  const requestId = useRef(crypto.randomUUID());
  async function send(event) {
    event.preventDefault();
    if (!socialText(body) && !gif) return;
    setError('');
    const draftId = requestId.current;
    const draftBody = body;
    const draftGif = gif;
    const optimisticComment = {
      id: draftId,
      body: draftBody.trim(),
      gif: draftGif?.url || '',
      parentId: parent?.id || '',
      at: new Date().toISOString(),
      author: me,
      canDelete: true,
      reactionSummary: [],
    };

    mutateComments((previous) => previous ? { ...previous, comments: [...(previous.comments || []), optimisticComment] } : { comments: [optimisticComment] });
    mutatePost(post.id, (item) => ({ ...item, comments: (item.comments || 0) + 1 }));
    setBody(''); setGif(null);
    requestId.current = crypto.randomUUID();
    onDone?.();

    try {
      const result = await api(path, { method: 'POST', body: { id: draftId, body: draftBody, parentId: parent?.id, gifUrl: draftGif?.url } });
      if (!result.ok) throw new Error(apiError(result));
      invalidateResources(path);
    } catch (exception) {
      mutateComments((previous) => previous ? { ...previous, comments: (previous.comments || []).filter((item) => item.id !== draftId) } : previous);
      mutatePost(post.id, (item) => ({ ...item, comments: Math.max(0, (item.comments || 1) - 1) }));
      setBody((current) => current || draftBody);
      if (draftGif) setGif((current) => current || draftGif);
      setError(exception.message);
    }
  }
  const name = parent ? parent.author.name : post.author.name;
  return <form className={`sf-comment-form ${compact ? 'is-reply' : ''}`} onSubmit={send}>
    {gif && <div className="sf-comment-gif"><img src={gif.preview} alt="Prévia do GIF"/><button type="button" className="icon-button" aria-label="Remover GIF" onClick={() => setGif(null)}><Icon name="close"/></button></div>}
    <div className="sf-comment-input">
      <label className="sf-comment-field"><span className="sr-only">{parent ? `Responder a ${name}` : `Comentar publicação de ${name}`}</span>
        <textarea rows={1} value={body} maxLength={SOCIAL_COMMENT_LIMIT} autoFocus={compact} placeholder={parent ? `Responder a ${name}…` : 'Escreva um comentário…'} onChange={event => setBody(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form.requestSubmit(); } }}/>
      </label>
      <EmojiButton className="sf-icon-tool" label="Emoji no comentário" align="right" onEmoji={(emoji) => setBody((value) => `${value}${emoji}`.slice(0, SOCIAL_COMMENT_LIMIT))}><Icon name="smile"/></EmojiButton>
      <EmojiButton className="sf-icon-tool sf-icon-gif" label="GIF no comentário" align="right" onGif={setGif}><span className="sf-gif-tag">GIF</span></EmojiButton>
      <button type="submit" className="sf-icon-tool sf-send" aria-label={parent ? 'Enviar resposta' : 'Comentar'} disabled={!socialText(body) && !gif}><Icon name="send"/></button>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
  </form>;
}

function CommentItem({ comment, post, path, refresh, busy, onRemove, onReact, onReply, go, isReply = false }) {
  return <div className={`sf-comment ${isReply ? 'is-reply' : ''}`}>
    <PersonButton person={comment.author} go={go} className="sf-comment-who"><SocialAvatar person={comment.author} size="small"/></PersonButton>
    <div className="sf-comment-main">
      <div className="sf-bubble">
        <div className="social-comment-heading"><strong>{comment.author.name}</strong><PostTime at={comment.at}/></div>
        {comment.body && <p>{comment.body}</p>}
        {comment.gif && <img className="sf-comment-image" src={comment.gif} alt="GIF" loading="lazy"/>}
      </div>
      <div className="sf-comment-actions">
        <Reactions summary={comment.reactionSummary} disabled={busy} label={`comentário de ${comment.author.name}`} onToggle={(emoji, mine) => onReact(comment, emoji, mine)}/>
        <button type="button" className="sf-link" onClick={() => onReply(comment)}>Responder</button>
        {comment.canDelete && <button type="button" className="sf-link is-danger" aria-label={`Excluir comentário de ${comment.author.name}`} disabled={busy} onClick={() => onRemove(comment)}>Excluir</button>}
      </div>
    </div>
  </div>;
}

function Comments({ post, me, mutatePost, refresh, go }) {
  const [cursor, setCursor] = useState('');
  const [older, setOlder] = useState([]);
  const [replyTo, setReplyTo] = useState('');
  const path = `/api/social/posts/${post.id}/comments`;
  const resource = useResource(`${path}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
  const [error, setError] = useState('');
  const comments = [...older, ...(resource.data?.comments || [])];
  const roots = comments.filter((comment) => !comment.parentId);
  const repliesOf = (id) => comments.filter((comment) => comment.parentId === id);

  async function remove(comment) {
    setError('');
    const prevData = resource.data;
    const prevOlder = older;
    const removedCount = comments.filter((item) => item.id === comment.id || item.parentId === comment.id).length || 1;
    setOlder((items) => items.filter((item) => item.id !== comment.id && item.parentId !== comment.id));
    resource.mutate((previous) => previous ? { ...previous, comments: (previous.comments || []).filter((item) => item.id !== comment.id && item.parentId !== comment.id) } : previous);
    mutatePost(post.id, (item) => ({ ...item, comments: Math.max(0, (item.comments || removedCount) - removedCount) }));
    try {
      const result = await api(`${path}/${comment.id}`, { method: 'DELETE' });
      if (!result.ok) throw new Error(apiError(result));
      invalidateResources(path);
    } catch (exception) {
      setOlder(prevOlder);
      if (prevData) resource.mutate(prevData);
      mutatePost(post.id, (item) => ({ ...item, comments: (item.comments || 0) + removedCount }));
      setError(exception.message);
    }
  }

  async function react(comment, emoji, mine) {
    setError('');
    const prevData = resource.data;
    const prevOlder = older;
    const updateComment = (item) => (item.id === comment.id ? { ...item, reactionSummary: toggleReactionSummary(item.reactionSummary, emoji, mine) } : item);
    setOlder((items) => items.map(updateComment));
    resource.mutate((previous) => previous ? { ...previous, comments: (previous.comments || []).map(updateComment) } : previous);
    try {
      const result = await api(`${path}/${comment.id}/reaction?emoji=${encodeURIComponent(emoji)}`, { method: mine ? 'DELETE' : 'PUT' });
      if (!result.ok) throw new Error(apiError(result));
    } catch (exception) {
      setOlder(prevOlder);
      if (prevData) resource.mutate(prevData);
      setError(exception.message);
    }
  }

  const afterSend = () => { setReplyTo(''); };
  return <div className="social-comments sf-comments">
    {resource.loading && !resource.data && <Skeleton rows={1} label="Carregando comentários…"/>}
    {roots.map((comment) => <div className="sf-thread" key={comment.id}>
      <CommentItem comment={comment} post={post} path={path} refresh={refresh} go={go} busy={false} onRemove={remove} onReact={react} onReply={(target) => setReplyTo(target.id)}/>
      {(repliesOf(comment.id).length > 0 || replyTo === comment.id) && <div className="sf-replies">
        {repliesOf(comment.id).map((reply) => <CommentItem key={reply.id} comment={reply} post={post} path={path} refresh={refresh} go={go} busy={false} isReply onRemove={remove} onReact={react} onReply={() => setReplyTo(comment.id)}/>)}
        {replyTo === comment.id && <CommentForm post={post} path={path} parent={comment} me={me} mutateComments={resource.mutate} mutatePost={mutatePost} compact onDone={afterSend}/>}
      </div>}
    </div>)}
    {resource.data?.nextCursor && <button type="button" className="text-button" onClick={() => { setOlder(comments); setCursor(resource.data.nextCursor); }}>Mais comentários</button>}
    <CommentForm post={post} path={path} me={me} mutateComments={resource.mutate} mutatePost={mutatePost} onDone={afterSend}/>
    {(error || resource.error) && <p className="form-error" role="alert">{error || resource.error}</p>}
  </div>;
}

// No perfil, `onPin` liga a opção de fixar (só nas próprias publicações) e
// `post.readOnly` deixa a publicação só para leitura (quem não é amigo).
export function PostCard({ post, me, mutatePost, removePost, restorePost, refresh, go, notify, onPin = null }) {
  const [showComments, setShowComments] = useState(post.comments > 0 && !post.readOnly);
  const [confirming, setConfirming] = useState(false);
  const [menu, setMenu] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [error, setError] = useState('');
  const [imageFailed, setImageFailed] = useState(false);
  const menuRoot = useRef(null);
  const [icon, label] = LABELS[post.kind] || LABELS.post;

  useEffect(() => {
    if (!menu) return undefined;
    const outside = (event) => { if (!menuRoot.current?.contains(event.target)) setMenu(false); };
    const escape = (event) => { if (event.key === 'Escape') setMenu(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [menu]);

  async function react(emoji, mine) {
    setError('');
    const previousSummary = post.reactionSummary || [];
    mutatePost(post.id, (item) => ({ ...item, reactionSummary: toggleReactionSummary(item.reactionSummary, emoji, mine) }));
    try {
      const result = await api(`/api/social/posts/${post.id}/reaction?emoji=${encodeURIComponent(emoji)}`, { method: mine ? 'DELETE' : 'PUT' });
      if (!result.ok) throw new Error(apiError(result));
    } catch (exception) {
      mutatePost(post.id, (item) => ({ ...item, reactionSummary: previousSummary }));
      setError(exception.message);
      notify(exception.message);
    }
  }

  async function remove() {
    setError('');
    setConfirming(false);
    const snapshot = removePost(post.id);
    try {
      const result = await api(`/api/social/posts/${post.id}`, { method: 'DELETE' });
      if (!result.ok) throw new Error(apiError(result));
    } catch (exception) {
      restorePost(snapshot);
      setError(exception.message);
      notify(exception.message);
    }
  }

  return <article className={`card-surface social-post sf-post is-${post.kind}`} aria-label={`Publicação de ${post.author.name}`}>
    <header className="sf-post-head">
      <PersonButton person={{ ...post.author, isSelf: post.canDelete }} go={go} className="social-author" label={`Abrir cartão de ${post.author.name}`}>
        <SocialAvatar person={post.author}/><span><strong>{post.author.name}</strong><PostTime at={post.at}/></span>
      </PersonButton>
      {post.pinned && <span className="social-post-kind is-pinned"><Icon name="pin"/>Fixada</span>}
      {post.kind !== 'post' && <span className={`social-post-kind ${post.kind === 'achievement' ? 'is-reward' : ''}`}><Icon name={icon}/>{label}</span>}
      <span className="sf-menu" ref={menuRoot}>
        <button type="button" className="icon-button" aria-label="Mais ações da publicação" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(value => !value)}><Icon name="more"/></button>
        {menu && <div className="sf-menu-list" role="menu">
          {onPin && post.canPin && <button type="button" role="menuitem" className="sf-menu-item" onClick={() => { setMenu(false); onPin(post, !post.pinned); }}><Icon name="pin"/>{post.pinned ? 'Desafixar do perfil' : 'Fixar no perfil'}</button>}
          {post.canDelete
            ? <button type="button" role="menuitem" className="sf-menu-item is-danger" onClick={() => { setMenu(false); setConfirming(true); }}><Icon name="trash"/>Excluir publicação</button>
            : <button type="button" role="menuitem" className="sf-menu-item is-danger" onClick={() => { setMenu(false); setReporting(true); }}><Icon name="flag"/>Denunciar publicação</button>}
        </div>}
      </span>
      {reporting && <ReportDialog target={post.author} context="post" subjectId={post.id} onClose={() => setReporting(false)} onDone={() => notify('Denúncia enviada. A equipe do Lume vai analisar.')}/>}
    </header>
    {post.body && <p className="social-post-body">{post.body}</p>}
    {post.gif && <img className="sf-post-gif" src={post.gif} alt="GIF da publicação" loading="lazy"/>}
    {post.attachment && (post.attachment.type.startsWith('image/')
      ? imageFailed ? <p className="quiet-note">Imagem indisponível.</p> : <a href={post.attachment.url} target="_blank" rel="noreferrer" className="social-post-image"><img src={post.attachment.url} alt={post.attachment.name} loading="lazy" onError={() => setImageFailed(true)}/></a>
      : <div className="social-file"><span className="social-file-icon"><Icon name="file"/></span><span className="social-file-copy"><strong>{post.attachment.name}</strong><small>PDF · {formatBytes(post.attachment.size)}</small></span><div className="social-file-actions"><a className="button secondary" href={post.attachment.url} target="_blank" rel="noreferrer">Abrir</a><a className="button secondary" href={`${post.attachment.url}?download=1`} download><Icon name="download"/>Baixar</a></div></div>)}
    {post.achievement && <div className="social-achievement"><span className="social-achievement-icon"><Icon name="trophy"/></span><div><span className="metric-label">Conquista validada</span><strong>{post.achievement.title}</strong><p>{post.achievement.criterion}</p></div><Icon name="check"/></div>}
    {post.kind === 'achievement' && !post.achievement && <p className="quiet-note">Esta conquista foi corrigida e não está mais disponível.</p>}
    {post.readOnly
      ? <div className="sf-post-actions is-read-only">
        {(post.reactionSummary || []).map((item) => <span key={item.emoji} className="sf-reaction is-static" aria-label={`${item.emoji} ${item.count}`}><span aria-hidden="true">{item.emoji}</span>{item.count}</span>)}
        <span className="sf-link"><Icon name="message"/>{post.comments} {post.comments === 1 ? 'comentário' : 'comentários'}</span>
        <span className="quiet-note sf-read-only-note">Só amigos reagem e comentam.</span>
      </div>
      : <div className="sf-post-actions">
        <Reactions summary={post.reactionSummary || []} label={`publicação de ${post.author.name}`} onToggle={react}/>
        <button type="button" className="sf-link sf-comment-toggle" aria-expanded={showComments} onClick={() => setShowComments(value => !value)}><Icon name="message"/>Comentar<span> · {post.comments} {post.comments === 1 ? 'comentário' : 'comentários'}</span></button>
      </div>}
    {confirming && <div className="social-delete-confirm"><p>Excluir esta publicação e seus comentários?</p><div className="action-row"><Button className="danger-button" onClick={remove}>Sim, excluir publicação</Button><Button secondary onClick={() => setConfirming(false)}>Manter publicação</Button></div></div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {showComments && !post.readOnly && <Comments post={post} me={me} mutatePost={mutatePost} refresh={refresh} go={go}/>}
  </article>;
}

function FeedPage({ cursor, last, me, onMore, go, notify }) {
  const resource = useResource(`/api/social/feed${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { interval: 45000 });
  const refresh = async () => { invalidateResources('/api/social/posts/'); return resource.refresh(); };
  const mutatePost = (postId, updater) => resource.mutate((previous) => previous ? { ...previous, posts: (previous.posts || []).map((item) => (item.id === postId ? updater(item) : item)) } : previous);
  const removePost = (postId) => {
    const snapshot = resource.data;
    resource.mutate((previous) => previous ? { ...previous, posts: (previous.posts || []).filter((item) => item.id !== postId) } : previous);
    return snapshot;
  };
  const restorePost = (snapshot) => { if (snapshot) resource.mutate(snapshot); };
  return <div className="social-feed-page">
    {resource.loading && !resource.data && <Skeleton rows={3} label="Carregando publicações…"/>}
    {resource.error && <div className="form-error form-error-block" role="alert">{resource.error}<Button secondary onClick={resource.refresh}>Tentar novamente</Button></div>}
    {resource.data?.posts.map(post => <PostCard key={post.id} post={post} me={me} mutatePost={mutatePost} removePost={removePost} restorePost={restorePost} refresh={refresh} go={go} notify={notify}/>)}
    {!cursor && resource.data?.posts.length === 0 && !resource.error && <section className="card-surface social-feed-empty"><span className="social-empty-icon"><Icon name="message"/></span><h2 className="title">As próximas conversas começam aqui.</h2><p>Compartilhe uma dúvida, um resumo ou uma conquista. No Feed, as publicações aparecem só para você e seus amigos.</p></section>}
    {last && resource.data?.nextCursor && <Button secondary className="social-load-more" onClick={() => onMore(resource.data.nextCursor)}>Ver mais publicações<Icon name="chevron-down"/></Button>}
  </div>;
}

export default function SocialFeed({ account, avatar, xp, notify, go }) {
  const [cursors, setCursors] = useState(['']);
  const me = { id: account.id, name: account.name, avatar };
  function posted() {
    setCursors(['']); invalidateResources('/api/social/feed');
    notify('Publicação compartilhada com seus amigos.');
  }
  return <div className="social-feed-column">
    <Composer account={account} avatar={avatar} xp={xp} onPosted={posted}/>
    <section className="social-feed" aria-label="Publicações entre amigos">{cursors.map((cursor, index) => <FeedPage key={cursor} cursor={cursor} last={index === cursors.length - 1} me={me} onMore={next => setCursors(items => [...items, next])} go={go} notify={notify}/>)}</section>
  </div>;
}
