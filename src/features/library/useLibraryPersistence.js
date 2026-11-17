import { useCallback, useRef, useState } from 'react';
import { createInitialState } from '../../../public/domain.js';
import { libraryActions } from '../../../public/library-actions.js';
import { closeStaleSession } from '../../../public/session-domain.js';
import { api, apiError } from '../../lib/api.js';
import { clearResources } from '../../lib/resources.js';

// As requisições são serializadas somente em memória. Falhas interrompem novos
// envios; repetir conserva a identidade da operação cujo resultado é incerto.
//
// Outra instância da mesma conta (outra aba, o aplicativo de desktop) também
// grava e avança a revisão. Por isso: (1) ao voltar à aba, e a cada minuto com a
// aba visível e sem gravação pendente, a revisão é conferida e o estado do
// servidor é adotado se mudou; (2) gravações de fundo, que a pessoa não pediu
// (batimento da sessão de estudo, fechamento de sessão esquecida), não bloqueiam
// em conflito: o estado do servidor é adotado e a gravação é descartada, porque a
// outra instância já está registrando a mesma sessão. Ações da pessoa continuam
// pedindo recarga em conflito, sem mescla automática.
export function useLibraryPersistence(notify, onSaved) {
  const [state, renderState] = useState(createInitialState);
  const [syncStatus, setSyncStatus] = useState('local');
  const [saveError, setSaveError] = useState('');
  const current = useRef(state);
  const confirmed = useRef(state);
  const connected = useRef(false);
  const revision = useRef(0);
  const generation = useRef(0);
  const sequence = useRef(0);
  const pending = useRef(Promise.resolve());
  const failed = useRef(null);
  const blocked = useRef('');
  const settled = useRef(0);
  const actRef = useRef(null);
  const saved = useRef(onSaved);
  saved.current = onSaved;
  const publish = useCallback((value) => { current.current = value; renderState(value); }, []);
  const invalidate = useCallback(() => { generation.current += 1; }, []);
  const unavailable = useCallback(() => setSyncStatus('error'), []);

  const load = useCallback(async (signal) => {
    const token = ++generation.current;
    connected.current = false;
    clearResources();
    failed.current = null;
    blocked.current = '';
    setSaveError('');
    setSyncStatus('loading');
    const result = await api('/api/library', { signal });
    if (token !== generation.current) return false;
    if (!result.ok) {
      const message = apiError(result);
      blocked.current = message;
      setSaveError(message);
      notify(message);
      throw new Error(message);
    }
    revision.current = result.data.revision;
    confirmed.current = result.data.state;
    publish(result.data.state);
    connected.current = true;
    setSyncStatus('saved');
    // Sessão esquecida aberta vira registro com o tempo já acumulado.
    actRef.current?.((state) => {
      const next = closeStaleSession(state);
      return next === state ? null : { state: next };
    }, { background: true });
    return true;
  }, [notify, publish]);

  // Lê a biblioteca e adota a revisão do servidor se ela mudou. Só publica se
  // nenhuma gravação desta aba começou enquanto a leitura acontecia.
  const adopt = useCallback(async () => {
    if (!connected.current || blocked.current) return false;
    const startedAt = sequence.current;
    const result = await api('/api/library');
    if (!result.ok || !connected.current || blocked.current) return false;
    if (sequence.current !== startedAt || settled.current !== startedAt) return false;
    if (result.data.revision <= revision.current) return false;
    revision.current = result.data.revision;
    confirmed.current = result.data.state;
    publish(result.data.state);
    setSyncStatus('saved');
    return true;
  }, [publish]);

  const send = useCallback(async (operation, token, order, background = false) => {
    if (token !== generation.current) return;
    const body = { ...operation, revision: operation.revision ?? revision.current };
    try {
      const result = await api('/api/library/actions', { method: 'POST', body });
      if (token !== generation.current) return;
      if (!result.ok) throw Object.assign(new Error(apiError(result)), { status: result.status });
      revision.current = result.data.revision;
      confirmed.current = result.data.state;
      if (order === sequence.current) {
        publish(result.data.state);
        setSyncStatus('saved');
      }
      failed.current = null;
      blocked.current = '';
      setSaveError('');
      // A sequência intermediária não precisa reler XP: a última gravação
      // consulta o livro já com todas as operações anteriores confirmadas.
      if (order === sequence.current) await saved.current();
    } catch (error) {
      if (token !== generation.current) return;
      // Conflito numa gravação de fundo: outra instância gravou antes. Adota o
      // estado do servidor e segue, sem bloquear nem avisar.
      if (background && error.status === 409) {
        const fresh = await api('/api/library');
        if (token !== generation.current) return;
        if (fresh.ok) {
          revision.current = fresh.data.revision;
          confirmed.current = fresh.data.state;
          if (order === sequence.current) {
            publish(fresh.data.state);
            setSyncStatus('saved');
          }
          return;
        }
      }
      generation.current += 1;
      const rejected = error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status);
      failed.current = rejected ? null : body;
      if (rejected && error.status !== 409) {
        publish(confirmed.current);
        blocked.current = '';
        setSaveError('');
        setSyncStatus('saved');
        notify(error.message);
        return;
      }
      const message = error.status === 409
        ? 'A biblioteca mudou. Recarregue os dados e repita sua ação.'
        : 'Não foi possível confirmar a gravação. Tente novamente antes de continuar.';
      blocked.current = message;
      setSaveError(message);
      setSyncStatus('error');
      notify(message);
    } finally {
      if (order > settled.current) settled.current = order;
    }
  }, [notify, publish]);

  const act = useCallback((rule, { background = false } = {}) => {
    if (blocked.current) { notify(blocked.current); return null; }
    const previous = current.current;
    const result = rule(previous);
    const next = result?.state;
    if (!next || next === previous) return result;
    publish(next);
    if (!connected.current) return result;
    const actions = libraryActions(previous, next);
    if (!actions.length) return result;
    const token = generation.current;
    const order = ++sequence.current;
    setSyncStatus('saving');
    const operation = { id: crypto.randomUUID(), actions };
    pending.current = pending.current.catch(() => {}).then(() => send(operation, token, order, background));
    return result;
  }, [notify, publish, send]);
  actRef.current = act;

  const retrySave = useCallback(async () => {
    if (!connected.current) return;
    if (failed.current) await send(failed.current, generation.current, sequence.current);
    if (!failed.current) await load();
  }, [load, send]);

  const waitForSave = useCallback(async () => {
    await pending.current;
    if (blocked.current) throw new Error('Resolva a gravação pendente antes de sair.');
    return current.current;
  }, []);

  const reset = useCallback(() => {
    invalidate();
    clearResources();
    connected.current = false;
    failed.current = null;
    blocked.current = '';
    setSaveError('');
    const initial = createInitialState();
    confirmed.current = initial;
    publish(initial);
    setSyncStatus('local');
  }, [invalidate, publish]);

  return { state, act, syncStatus, saveError, retrySave, load, reset, invalidate, unavailable, waitForSave, adopt };
}
