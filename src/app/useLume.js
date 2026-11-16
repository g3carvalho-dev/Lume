import { useEffect, useMemo, useState } from 'react';
import { useXp } from '../features/progress/useXp.js';
import { useAccountSession } from '../features/account/useAccountSession.js';
import { useLibraryPersistence } from '../features/library/useLibraryPersistence.js';
import { createPlanActions } from '../features/plan/actions.js';
import { createAgendaActions } from '../features/agenda/actions.js';
import { createProgressActions } from '../features/progress/actions.js';
import { createLibraryActions } from '../features/library/actions.js';
import { createSettingsActions } from '../features/settings/actions.js';
import { createAccountActions } from '../features/account/actions.js';

// Composição do modelo: as telas recebem operações nomeadas, sem acesso ao
// setter, ao transporte ou à aplicação genérica de regras sobre o estado.
export function useLume(notify) {
  const [account, setAccount] = useState(null);
  const { xp, xpStatus, refreshXP } = useXp(account);
  const library = useLibraryPersistence(notify, refreshXP);
  const session = useAccountSession(account, setAccount, library);
  const { state, act, syncStatus, saveError, retrySave } = library;
  // Outra aba ou o aplicativo de desktop podem ter gravado: ao voltar para esta
  // aba, e a cada minuto com ela visível, a revisão é conferida antes de a pessoa
  // agir, para a próxima gravação não esbarrar numa revisão antiga.
  const { adopt } = library;
  useEffect(() => {
    if (!account) return undefined;
    let last = 0;
    const check = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < 5000) return;
      last = Date.now();
      adopt().catch(() => {});
    };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    const timer = setInterval(check, 60000);
    return () => { window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check); clearInterval(timer); };
  }, [account, adopt]);
  const planActions = useMemo(() => createPlanActions(act), [act]);
  const agendaActions = useMemo(() => createAgendaActions(act), [act]);
  const progressActions = useMemo(() => createProgressActions(act), [act]);
  const libraryActions = useMemo(() => createLibraryActions(act), [act]);
  const settingsActions = useMemo(() => createSettingsActions(act), [act]);
  const accountActions = useMemo(() => createAccountActions(act), [act]);
  return { state, agendaActions, planActions, progressActions, libraryActions, settingsActions, accountActions, account, ...session, syncStatus, saveError, retrySave, confirmSave: library.waitForSave, xp, xpStatus, refreshXP };
}
