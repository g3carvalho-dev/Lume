import { useEffect, useRef, useState } from 'react';
import {
  READING_IDLE_MS, formatSessionDuration, sessionElapsed,
} from '../../../public/session-domain.js';

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'];

// Tempo de leitura do PDF. A sessão é automática, visível e pausável; o tempo
// parado não conta e uma sessão pausada de outro material pede uma escolha.
export function useReadingSession({
  course, state, actions, enabled = true, ready = true, notify = () => {},
}) {
  const [now, setNow] = useState(() => Date.now());
  const [conflict, setConflict] = useState(null);
  const [pausedBy, setPausedBy] = useState('');
  const [ignored, setIgnored] = useState(false);
  const activeRef = useRef(state.activeSession);
  const enabledRef = useRef(enabled);
  const ignoredRef = useRef(ignored);
  const ownedRef = useRef('');
  const pausedByRef = useRef('');
  const lastActivity = useRef(Date.now());

  activeRef.current = state.activeSession;
  enabledRef.current = enabled;
  ignoredRef.current = ignored;
  pausedByRef.current = pausedBy;

  useEffect(() => {
    if (!state.activeSession) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state.activeSession?.id]);

  function adopt(session) {
    ownedRef.current = session?.id || '';
    lastActivity.current = Date.now();
    pausedByRef.current = '';
    setPausedBy('');
  }

  function startReading() {
    const result = actions.startSession({
      courseId: course.id,
      label: `Leitura — ${course.title}`,
      origin: 'reading',
    });
    const session = result?.state?.activeSession;
    if (session) adopt(session);
  }

  useEffect(() => {
    const active = activeRef.current;
    if (!ownedRef.current || active?.id !== ownedRef.current || active.courseId === course.id) return;
    const result = actions.endSession(Date.now());
    if (result?.session) notify(`Leitura registrada: ${formatSessionDuration(result.session.durationMs)}.`);
    ownedRef.current = '';
    pausedByRef.current = '';
    setPausedBy('');
    setConflict(null);
  }, [course.id, actions, notify]);

  useEffect(() => {
    if (!ready || !enabled || ignored) return;
    const active = activeRef.current;
    if (active) {
      if (active.status === 'paused') setConflict({ session: active });
      else setConflict(null);
      return;
    }
    setConflict(null);
    startReading();
    // A identidade da sessão criada é capturada no próprio startReading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course.id, ready, enabled, ignored, state.activeSession?.id]);

  useEffect(() => {
    if (!enabled && ownedRef.current) {
      const active = activeRef.current;
      if (active?.id === ownedRef.current) {
        const result = actions.endSession(Date.now());
        if (result?.session) notify(`Leitura encerrada: ${formatSessionDuration(result.session.durationMs)}.`);
      }
      ownedRef.current = '';
      pausedByRef.current = '';
      setPausedBy('');
    }
  }, [enabled, actions, notify]);

  useEffect(() => () => {
    const id = ownedRef.current;
    const active = activeRef.current;
    if (!id || active?.id !== id) return;
    const result = actions.endSession(Date.now());
    if (result?.session) notify(`Leitura registrada: ${formatSessionDuration(result.session.durationMs)}.`);
  }, [actions, notify]);

  useEffect(() => {
    if (!enabled || ignored) return undefined;
    const mark = () => {
      lastActivity.current = Date.now();
      const active = activeRef.current;
      if (pausedByRef.current === 'idle' && active?.id === ownedRef.current && active.status === 'paused') {
        actions.toggleSessionPause();
        pausedByRef.current = '';
        setPausedBy('');
      }
    };
    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, mark, { capture: true, passive: true });
    return () => {
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, mark, { capture: true });
    };
  }, [enabled, ignored, actions]);

  useEffect(() => {
    if (!enabled || ignored) return undefined;
    const check = () => {
      const active = activeRef.current;
      if (!ownedRef.current || active?.id !== ownedRef.current || active.status !== 'active') return;
      if (Date.now() - lastActivity.current < READING_IDLE_MS) return;
      actions.toggleSessionPause();
      pausedByRef.current = 'idle';
      setPausedBy('idle');
    };
    const timer = setInterval(check, 15000);
    return () => clearInterval(timer);
  }, [enabled, ignored, actions]);

  useEffect(() => {
    if (!enabled || ignored) return undefined;
    const visibility = () => {
      const active = activeRef.current;
      if (!ownedRef.current || active?.id !== ownedRef.current) return;
      if (document.hidden) {
        if (active.status === 'active') {
          actions.toggleSessionPause();
          pausedByRef.current = 'hidden';
          setPausedBy('hidden');
        }
      } else if (pausedByRef.current === 'hidden' && active.status === 'paused') {
        actions.toggleSessionPause();
        lastActivity.current = Date.now();
        pausedByRef.current = '';
        setPausedBy('');
      }
    };
    document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  }, [enabled, ignored, actions]);

  function togglePause() {
    const active = activeRef.current;
    if (!active || active.id !== ownedRef.current) return;
    if (active.status === 'active') {
      actions.toggleSessionPause();
      pausedByRef.current = 'user';
      setPausedBy('user');
    } else {
      actions.toggleSessionPause();
      lastActivity.current = Date.now();
      pausedByRef.current = '';
      setPausedBy('');
    }
  }

  function resolveConflict(choice) {
    const paused = conflict?.session;
    setConflict(null);
    if (!paused) return;
    if (choice === 'resume') {
      actions.toggleSessionPause();
      lastActivity.current = Date.now();
      if (paused.origin === 'reading' && paused.courseId === course.id) adopt(paused);
      return;
    }
    if (choice === 'switch') {
      startReading();
      return;
    }
    setIgnored(true);
  }

  function enable() {
    setIgnored(false);
    setConflict(null);
  }

  const active = state.activeSession;
  const owned = Boolean(active && active.id === ownedRef.current);
  const elapsed = active ? sessionElapsed(active, now) : 0;
  const status = !enabled
    ? ''
    : ignored
      ? 'Leitura sem registro'
      : owned
        ? active?.status === 'active'
          ? 'Lendo'
          : pausedBy === 'idle' ? 'Pausado por inatividade' : pausedBy === 'hidden' ? 'Pausado ao sair da aba' : 'Leitura pausada'
        : active
          ? active.origin === 'reading' ? 'Outra leitura em andamento' : 'Tempo no foco'
          : '';

  return {
    active,
    owned,
    elapsed,
    status,
    pausedBy,
    conflict,
    ignored,
    togglePause,
    resolveConflict,
    enable,
  };
}
