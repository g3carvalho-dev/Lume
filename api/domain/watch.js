import { AppError } from '../errors.js';
import { readLibrary } from './library-store.js';
import { applyLibraryActions } from './library-actions.js';
import { libraryActions } from '../../public/library-actions.js';
import { completeLesson, findLessonByUrl, isImportedCourse } from '../../public/import-domain.js';
import { providerForUrl } from '../../public/providers/registry.js';
import { materialSteps } from '../../public/material-model.js';
import { isCompleted } from '../../public/progress-domain.js';
import { closeStaleSession, startSession, resumeSession, touchSession, pauseSession, endSession, STALE_SESSION_MS } from '../../public/session-domain.js';
import { courseStats, courseEstimateText } from '../../public/course-stats-domain.js';
import { acceptedCoverage, coverageSeconds, limitPlayed, mergePlayed, watchCompleted } from '../../public/watch-domain.js';

function resolve(state, url) {
  const provider = providerForUrl(url);
  if (provider.id === 'unknown' || typeof url !== 'string' || url.length > 2048) return null;
  const found = findLessonByUrl(state, url);
  if (!found || !isImportedCourse(found.course) || found.course.example || found.course.source.demo || found.course.source.provider !== provider.id) return null;
  const videoKey = provider.videoId?.(new URL(url)) || found.lesson.id;
  return { ...found, provider, videoKey };
}

function describe(state, found, now) {
  const { course, lesson, provider, videoKey } = found;
  const stats = courseStats(state, course.id, now);
  const active = state.activeSession;
  const session = active?.origin === 'watching' && active.courseId === course.id && active.stepId === lesson.id ? active : null;
  return { found:true, courseId:course.id, stepId:lesson.id, courseTitle:course.title, lessonTitle:lesson.title,
    externalId:lesson.externalId || '', courseExternalId:course.source.externalId, provider:provider.id, videoKey,
    index:materialSteps(course).findIndex(item=>item.id===lesson.id)+1, stats, estimate:courseEstimateText(stats),
    session, otherSession:Boolean(active && !session), lesson:{completed:isCompleted(state,lesson.id)} };
}

export async function resolveWatchLesson(db,userId,url,now=Date.now()) {
  const {state}=await readLibrary(db,userId);
  if(state.preferences.watchLessons === false) return {found:false,disabled:true};
  const found=resolve(state,url);
  return found ? describe(state,found,now) : {found:false};
}

function sessionForEvent(state, event, found, old, now) {
  const active = state.activeSession;
  if (active && active.origin !== 'watching') return state;
  const same = active && active.courseId === found.course.id && active.stepId === found.lesson.id;
  const owner = same && active.id === old?.session_id && old?.stream_id === event.streamId;
  if (event.state === 'playing') {
    if (owner) return active.status === 'paused' ? resumeSession(state,now) : touchSession(state,now);
    // A pessoa encerrou a sessão no cabeçalho ou outra aba assumiu o vídeo.
    if (old?.stream_id === event.streamId && old.session_id && old.last_state === 'playing') return state;
    return startSession(state,{courseId:found.course.id,stepId:found.lesson.id,label:found.lesson.title,origin:'watching'},now);
  }
  if (!owner) return state;
  return event.state === 'ended' ? endSession(state,now).state : pauseSession(state,now);
}

const upsert = `INSERT INTO watch_progress
  (user_id,material_id,unit_id,video_key,duration_seconds,covered_seconds,playing_seconds,stream_id,last_state,saw_pending,session_id,updated_at,completed_at,ranges_json)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(user_id,material_id,unit_id,video_key) DO UPDATE SET duration_seconds=excluded.duration_seconds,
  covered_seconds=excluded.covered_seconds,playing_seconds=excluded.playing_seconds,stream_id=excluded.stream_id,
  last_state=excluded.last_state,saw_pending=excluded.saw_pending,session_id=excluded.session_id,
  updated_at=excluded.updated_at,completed_at=COALESCE(watch_progress.completed_at,excluded.completed_at),ranges_json=excluded.ranges_json`;

export async function applyWatchEvent(db,userId,event,now=Date.now()) {
  if (!event || !/^[a-zA-Z0-9_-]{1,100}$/.test(event.eventId || '') || !/^[a-zA-Z0-9_-]{1,100}$/.test(event.streamId || '')
    || !['playing','paused','ended'].includes(event.state) || !Number.isFinite(event.duration) || event.duration<=0 || event.duration>86400
    || !Number.isFinite(event.coveredSeconds) || event.coveredSeconds<0
    || (event.ranges !== undefined && (!Array.isArray(event.ranges) || event.ranges.length > 96
      || event.ranges.some(range => !Array.isArray(range) || range.length !== 2 || !range.every(Number.isFinite)))))
    throw new AppError('Evento de vídeo inválido.','invalid_watch',400);
  for (let attempt=0;attempt<2;attempt++) {
    const {state,revision}=await readLibrary(db,userId);
    if (state.preferences.watchLessons === false) return {disabled:true};
    const found=resolve(state,event.pageUrl);
    if (!found || found.course.id!==event.courseId || found.lesson.id!==event.stepId || found.videoKey!==event.videoKey) return {found:false};
    const ids=[userId,event.courseId,event.stepId,event.videoKey];
    const old=await db.first('SELECT * FROM watch_progress WHERE user_id=? AND material_id=? AND unit_id=? AND video_key=?',ids);
    const same=old?.stream_id===event.streamId;
    // Duas abas podem mostrar a mesma aula. Um player pausado ou um segundo
    // batimento não deve roubar a sessão da aba que está contando o tempo.
    if (old && !same && old.last_state === 'playing' && now-old.updated_at < STALE_SESSION_MS
        && state.activeSession?.id === old.session_id && state.activeSession.status === 'active') return describe(state,found,now);
    const elapsed=same && old.last_state==='playing' ? Math.max(0,now-old.updated_at) : 0;
    const playing=(old?.playing_seconds || 0)+(elapsed<=STALE_SESSION_MS ? elapsed/1000 : 0);
    const duration=Math.max(event.duration,old?.duration_seconds || 0);
    const ranges = limitPlayed(mergePlayed(JSON.parse(old?.ranges_json || '[]'),event.ranges || [],duration),512);
    const reported = event.ranges ? coverageSeconds(ranges) : event.coveredSeconds;
    const covered=Math.max(old?.covered_seconds || 0,acceptedCoverage(reported,duration,playing));
    const continued = same && now-old.updated_at <= STALE_SESSION_MS
      && (old.last_state !== 'ended' || (event.state === 'ended' && now-old.updated_at <= 10000));
    const pending=(continued && Boolean(old.saw_pending)) || event.platformDone===false;
    const completed=watchCompleted({platformReader:Boolean(found.provider.readers.lesson), seenPending:pending, platformDone:event.platformDone, covered,duration});
    let next=sessionForEvent(closeStaleSession(state,now),event,found,old,now);
    if (completed) next=completeLesson(next,event.courseId,event.stepId,{origin:'integration',now:new Date(now).toISOString()}).state;
    const actions=libraryActions(state,next);
    const own=next.activeSession?.origin==='watching' && next.activeSession.courseId===event.courseId && next.activeSession.stepId===event.stepId;
    const extra=[[upsert,[...ids,duration,covered,playing,event.streamId,event.state,Number(pending),own ? next.activeSession.id : same ? old.session_id : null,now,completed ? now : null,JSON.stringify(ranges)]]];
    try {
      const result=await applyLibraryActions(db,userId,{id:event.eventId,revision,actions},{now,extra});
      return describe(result.state,found,now);
    } catch(error) { if(error.code!=='library_conflict' || attempt) throw error; }
  }
}
