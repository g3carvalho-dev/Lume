import { platforms } from './platforms.js';

const button = document.getElementById('read');
const status = document.getElementById('status');
const target = document.getElementById('target');

const say = (text) => { status.textContent = text; };

// O pacote da loja não tem a escolha de destino: vale sempre o Lume publicado.
if (target) {
  chrome.storage.local.get('lumeTarget').then(({ lumeTarget }) => { if (lumeTarget) target.value = lumeTarget; });
  target.addEventListener('change', async () => { await chrome.storage.local.set({ lumeTarget: target.value }); await panel(); });
}

const REASONS = {
  no_lessons: 'Não achei uma lista de aulas nesta página. Abra a tela com o índice do curso (módulos e aulas) e tente de novo.',
  no_bridge: 'Não consegui falar com o Lume. Abra o Lume no navegador, entre na sua conta e tente de novo.',
  not_found: 'O Lume não achou esta aula nos seus cursos. Leia o curso primeiro, com o botão acima.',
  timeout: 'O Lume não respondeu. Confira se ele está aberto e com a sua conta ativa.',
  not_signed_in: 'Entre na sua conta do Lume e envie de novo.',
};

async function read() {
  button.disabled = true;
  say('Lendo a página…');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:/i.test(tab.url || '')) { say('Abra a página de um curso para ler.'); return; }

    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['capture.js'] });
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: (options) => globalThis.LumeCapture.run(options),
      args: [{ pageUrl: tab.url, pageTitle: tab.title || '' }],
    });
    // O índice pode estar num quadro interno: vale o resultado com mais aulas.
    const best = results
      .map((entry) => entry.result)
      .filter((result) => result?.ok)
      .sort((a, b) => b.stats.lessons - a.stats.lessons)[0];
    if (!best) { say(REASONS.no_lessons); return; }

    say(`Encontrei ${best.stats.lessons} aulas, ${best.stats.completed} concluídas. Enviando ao Lume…`);
    const answer = await chrome.runtime.sendMessage({ type: 'deliver', payload: best.payload });
    if (answer?.ok) say('Enviado. Revise o curso na janela do Lume.');
    else say(REASONS[answer?.reason] || 'Não consegui entregar ao Lume. Tente de novo.');
  } catch {
    say('Não consegui ler esta página. Abra a grade do curso na plataforma e tente novamente. Algumas páginas bloqueiam a leitura por extensões.');
  } finally {
    button.disabled = false;
  }
}

const completeButton = document.getElementById('complete');

// Avisa o Lume de que esta aula acabou. Quem registra a conclusão é a pessoa, na
// tela de confirmação que o Lume abre; a extensão só aponta a aula pelo endereço.
async function complete() {
  completeButton.disabled = true;
  say('Procurando esta aula no Lume…');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || !/^https?:/i.test(tab.url)) { say('Abra a página da aula para concluir.'); return; }
    const answer = await chrome.runtime.sendMessage({ type: 'deliver', kind: 'complete', payload: { url: tab.url, title: tab.title || '' } });
    if (answer?.ok) say('Confirme a conclusão na janela do Lume.');
    else say(REASONS[answer?.reason] || 'Não consegui avisar o Lume. Tente de novo.');
  } catch {
    say('Não consegui avisar o Lume. Tente de novo.');
  } finally {
    completeButton.disabled = false;
  }
}

// A leitura de um curso grande leva um ou dois minutos: mostra onde está.
chrome.runtime.onMessage.addListener((message) => { if (message?.type === 'lume-progress' && button.disabled) say(message.text); });

button.addEventListener('click', read);
completeButton.addEventListener('click', complete);

async function showPlatform() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https?:/i.test(tab.url)) return;
  const host = new URL(tab.url).hostname;
  const provider = platforms.find(({ hosts }) => hosts.some(domain => host === domain || host.endsWith(`.${domain}`)));
  if (!provider) return;
  document.getElementById('platform').textContent = provider.label;
  document.getElementById('hint').textContent = 'Abra a lista de aulas e mantenha este painel aberto até a revisão aparecer no Lume.';
  document.getElementById('actions').hidden = false;
}
showPlatform().catch(() => say('Abra novamente o painel na página do curso.'));

async function panel() {
  const result = await chrome.runtime.sendMessage({type:'watch-panel'}) || {};
  const account = document.getElementById('account');
  account.replaceChildren();
  if (result.account?.login) {
    const link = document.createElement('a');
    const origins = chrome.runtime.getManifest().host_permissions;
    const local = target?.value === 'local' && origins.find(origin => origin.startsWith('http:'));
    link.href = new URL(local || origins.find(origin => origin.startsWith('https:'))).origin;
    link.target = '_blank'; link.rel='noreferrer'; link.textContent='Entre no Lume';
    account.append(link);
  } else account.textContent = result.account?.name || 'Lume indisponível. Confira a conexão.';
  const info = document.getElementById('lesson');
  info.hidden = !result.found;
  if (result.found) {
    const status = result.lesson?.completed ? 'Aula concluída' : result.session?.status === 'active' ? 'Contando' : 'Pausado';
    info.textContent = [result.lessonTitle, status, `Aula ${result.index} de ${result.stats.total}`, `${result.stats.completed} aulas e ${result.stats.modules.completed}/${result.stats.modules.total} módulos concluídos`, `${result.stats.todayMinutes} min hoje`, result.estimate].join(' · ');
  }
  const list = document.getElementById('platforms');
  list.replaceChildren();
  for (const p of platforms) {
    const origins = p.hosts.map(host => 'https://*.'+host+'/*');
    const label=document.createElement('label'), box=document.createElement('input');
    box.type='checkbox'; box.setAttribute('role','switch');
    const title = document.createElement('span');
    title.textContent = p.label;
    label.append(title,box); list.append(label);
    box.checked = await chrome.permissions.contains({origins});
    box.setAttribute('aria-label', 'Acompanhar aulas em ' + p.label);
    if (!box.checked && document.getElementById('platform').textContent === p.label) title.textContent = 'Acompanhar aulas em ' + p.label;
    box.addEventListener('change', async () => {
      try {
        const accepted = box.checked ? await chrome.permissions.request({origins}) : await chrome.permissions.remove({origins});
        if (!accepted) say('A permissão da plataforma não mudou.');
      } catch { say('Não foi possível alterar a permissão da plataforma.'); }
      box.checked=await chrome.permissions.contains({origins});
      await panel();
    });
  }
}
panel().catch(()=>say('Não foi possível consultar a conta local ou publicada.'));
