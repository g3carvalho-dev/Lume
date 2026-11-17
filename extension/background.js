import { installWatching } from './watch-background.js';

// Entrega a leitura ao Lume. Fica aqui, e não no popup, porque o popup fecha
// assim que a aba do Lume ganha o foco.
async function lumeBase() {
  const { lumeTarget } = await chrome.storage.local.get('lumeTarget');
  const origins = chrome.runtime.getManifest().host_permissions;
  const local = lumeTarget === 'local' && origins.find(pattern => pattern.startsWith('http:'));
  return new URL(local || origins.find(pattern => pattern.startsWith('https:'))).origin;
}

async function findOrOpenLume(base) {
  const found = await chrome.tabs.query({ url: `${base}/*` });
  if (found.length) return found[0];
  return chrome.tabs.create({ url: `${base}/#biblioteca`, active: false });
}

function sendToTab(tabId, payload, kind) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: 'lume-capture', kind, payload }, (answer) => {
      if (chrome.runtime.lastError) resolve({ ok: false, reason: 'no_bridge' });
      else resolve(answer || { ok: false, reason: 'no_answer' });
    });
  });
}

async function deliver(payload, kind = 'capture') {
  const base = await lumeBase();
  const tab = await findOrOpenLume(base);
  // A aba recém-aberta ainda não tem a ponte: tenta de novo por alguns segundos.
  let result = { ok: false, reason: 'no_bridge' };
  for (let attempt = 0; attempt < 12; attempt += 1) {
    result = await sendToTab(tab.id, payload, kind);
    if (result.ok || result.reason !== 'no_bridge') break;
    // Uma aba aberta antes da instalação ou recarga ainda não tem a ponte.
    if (attempt === 0) {
      try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['bridge.js'] }); }
      catch { /* Uma aba nova ainda pode estar navegando. */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  if (result.ok) {
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
  }
  return result;
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type === 'watch-open-lume' && sender.tab?.id && sender.frameId===0) {
    deliver({url:sender.url},'complete').then(reply,()=>reply({ok:false}));
    return true;
  }
  if (message?.type !== 'deliver') return false;
  deliver(message.payload, message.kind).then(reply, () => reply({ ok: false, reason: 'error' }));
  return true;
});

installWatching(lumeBase);
