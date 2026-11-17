import { platforms } from './platforms.js';

const platformFor = value => {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && platforms.find(p => p.hosts.some(h => u.hostname === h || u.hostname.endsWith('.'+h)));
  } catch { return null; }
};
export const patterns = p => p.hosts.map(h => 'https://*.'+h+'/*');
const granted = p => chrome.permissions.contains({origins:patterns(p)});
const key = id => 'watch-tab-'+id;
const read = async id => (await chrome.storage.session.get(key(id)))[key(id)];
const write = (id,value) => chrome.storage.session.set({[key(id)]:value});
// A resolução de aulas usa somente o domínio e o caminho.
function lessonAddress(value) {
  const url = new URL(value);
  return url.origin + url.pathname;
}

export function installWatching(lumeBase) {
  async function api(path, payload, base) {
    const response = await fetch((base || await lumeBase())+'/api/extension/'+path,{
      credentials:'include', cache:'no-store', redirect:'error',
      ...(payload ? {method:'POST',headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)} : {}),
    });
    if(response.status===401) return {login:true};
    if(!response.ok) throw Error('Falha na conexão com o Lume.');
    return response.json();
  }
  const jobs = new Map();
  function serial(id, work) {
    const next=(jobs.get(id)||Promise.resolve()).catch(()=>{}).then(work);
    jobs.set(id,next);
    next.finally(()=>{if(jobs.get(id)===next) jobs.delete(id);}).catch(()=>{});
    return next;
  }
  async function finish(id) {
    const old=await read(id);
    if(old?.last && old.last.state!=='ended') {
      await api('watch',{...old.last,state:'ended',platformDone:null,eventId:crypto.randomUUID()},old.base);
      await notifyLume(old.base);
    }
    await chrome.storage.session.remove(key(id));
  }
  async function notifyLume(base) {
    const tabs = await chrome.tabs.query({url:base+'/*'});
    for (const tab of tabs) chrome.tabs.sendMessage(tab.id,{type:'watch-revision'}).catch(()=>{});
  }
  async function resolve(id,url) {
    url = lessonAddress(url);
    const current=await read(id), base=await lumeBase();
    if(current && (current.url!==url || current.base!==base)) await finish(id);
    const result=await api('lesson',{url},base);
    if(result.found) {
      const old=await read(id);
      await write(id,{...old,url,base,match:result});
    }
    return result;
  }
  async function handle(message,sender) {
    const id=sender.tab?.id;
    if(message.type==='watch-platforms' || message.type==='watch-panel') {
      if(sender.tab && message.type==='watch-panel') return {};
      const enabled=(await Promise.all(platforms.map(async p=>await granted(p) ? p.id : null))).filter(Boolean);
      if(message.type==='watch-platforms') return {enabled};
      const account=await api('status',{});
      const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
      const platform=platformFor(tab?.url);
      const data=platform && enabled.includes(platform.id) && !account.login ? await serial(tab.id,()=>resolve(tab.id,tab.url)) : {};
      return {account,enabled,...data};
    }
    const platform=platformFor(sender.url);
    if(!platform || !Number.isInteger(id) || sender.frameId!==0 || !await granted(platform)) return {disabled:true};
    return serial(id,async()=>{
      if(message.type==='watch-resolve') {
        if (new URL(message.pageUrl).origin!==new URL(sender.url).origin) return {found:false};
        return resolve(id,message.pageUrl);
      }
      const old=await read(id), event={...message.payload, pageUrl:lessonAddress(message.payload.pageUrl)};
      if(!old || old.url!==event.pageUrl || old.match.stepId!==event.stepId || old.match.courseId!==event.courseId) return {found:false};
      const result=await api('watch',event,old.base);
      if(result.login || result.disabled || result.found===false) await chrome.storage.session.remove(key(id));
      else {
        await write(id,{...old,last:event,lastSeen:Date.now(),match:{...old.match,...result}});
        await notifyLume(old.base);
      }
      return result;
    });
  }
  chrome.runtime.onMessage.addListener((message,sender,reply)=>{
    if(!['watch-event','watch-resolve','watch-platforms','watch-panel'].includes(message?.type)) return false;
    handle(message,sender).then(reply,()=>reply({error:true})); return true;
  });
  async function sync() {
    const scripts=await chrome.scripting.getRegisteredContentScripts();
    for(const p of platforms) {
      const id='lume-watch-'+p.id, matches=patterns(p);
      const registered=scripts.some(s=>s.id===id);
      if(await granted(p)) {
        if(registered) continue;
        await chrome.scripting.registerContentScripts([{id,matches,js:['watch.js'],runAt:'document_idle'}]);
        for(const tab of await chrome.tabs.query({url:matches})) {
          await chrome.scripting.executeScript({target:{tabId:tab.id},files:['watch.js']}).catch(()=>{});
        }
      } else if(registered) {
        await chrome.scripting.unregisterContentScripts({ids:[id]});
        // Mesmo depois de revogar o acesso ao endereço, ainda podemos avisar o script pelo id da aba.
        for(const tab of await chrome.tabs.query({})) {
          const old=await read(tab.id);
          if(platformFor(old?.url)?.id===p.id) await serial(tab.id,()=>finish(tab.id)).catch(()=>{});
          await chrome.tabs.sendMessage(tab.id,{type:'watch-stop',provider:p.id}).catch(()=>{});
        }
      }
    }
  }
  const reconcile=()=>serial('permissions',sync).catch(()=>{});
  chrome.permissions.onAdded.addListener(reconcile);
  chrome.permissions.onRemoved.addListener(reconcile);
  chrome.runtime.onInstalled.addListener(reconcile);
  chrome.runtime.onStartup.addListener(reconcile);
  // Um content script pode desaparecer sem evento final (aba descartada).
  // O alarme só encerra. Ele nunca inventa um batimento de reprodução.
  chrome.alarms.get('lume-watch-cleanup').then(alarm => {
    if (!alarm) return chrome.alarms.create('lume-watch-cleanup', {periodInMinutes:1});
  });
  chrome.alarms.onAlarm.addListener(async alarm=>{
    if(alarm.name!=='lume-watch-cleanup') return;
    for(const [storageKey,entry] of Object.entries(await chrome.storage.session.get(null))) {
      if(!storageKey.startsWith('watch-tab-') || entry.last?.state!=='playing' || Date.now()-entry.lastSeen < 300000) continue;
      const id=Number(storageKey.slice('watch-tab-'.length));
      serial(id,async()=>{ if ((await read(id))?.lastSeen===entry.lastSeen) await finish(id); }).catch(()=>{});
    }
  });
  chrome.tabs.onRemoved.addListener(id=>serial(id,()=>finish(id)).catch(()=>{}));
  chrome.tabs.onUpdated.addListener((id,change)=>{if(change.url || change.status==='loading') serial(id,async()=>{
    const old=await read(id);
    if(old && (change.status==='loading' || old.url!==lessonAddress(change.url))) await finish(id);
  }).catch(()=>{});});
}
