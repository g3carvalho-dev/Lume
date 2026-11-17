import { providerForUrl } from '../../public/providers/registry.js';
import { mergePlayed, newPlayedRanges, limitPlayed, coverageSeconds, WATCH_HEARTBEAT_MS } from '../../public/watch-domain.js';
import { READING_IDLE_MS } from '../../public/session-domain.js';
function mainVideo(doc) {
  const candidates = [...doc.querySelectorAll('video')];
  for (const frame of doc.querySelectorAll('iframe')) {
    if (frame.contentDocument) candidates.push(...frame.contentDocument.querySelectorAll('video'));
  }
  return candidates.filter(v => v.duration > 0 && Number.isFinite(v.duration) && v.getBoundingClientRect().width > 0)
    .sort((a,b) => b.clientWidth*b.clientHeight - a.clientWidth*a.clientHeight)[0];
}

export function observeLesson(send, makeBadge) {
  const provider = providerForUrl(location.href);
  if (provider.id === 'unknown') return;
  let url = '', match, video, source, stream, baseline = [], previousState, stalled, lastSent = 0, hiddenAt = 0;
  const coverage = new Map();
  let finalChecks = [];
  let generation = 0, queue = Promise.resolve(), badge, stopped = false, nextLookup = 0;
  let nextAccountCheck = 0;
  const events = ['play','playing','pause','waiting','stalled','ended','ratechange','seeking','seeked','volumechange','loadedmetadata','emptied'];
  const pageAddress = () => location.origin + location.pathname;
  function detach() {
    if (video) for (const event of events) video.removeEventListener(event, mediaEvent);
    for (const timer of finalChecks) clearTimeout(timer);
    finalChecks = [];
    video = null; source = ''; previousState = ''; stalled = false; baseline = []; hiddenAt = 0;
    badge?.remove(); badge = null;
  }
  function mediaEvent(event) {
    if (['waiting','stalled','seeking'].includes(event.type)) stalled = true;
    if (['playing','seeked'].includes(event.type)) stalled = false;
    scan(true);
  }
  async function platformMark(context) {
    if (!provider.readers.lesson) return null;
    try {
      return await provider.readers.lesson({ ...context, pageUrl: location.href, origin: location.origin,
        fetchJson: async path => {
          const address = new URL(path, location.origin);
          if (address.origin !== location.origin) return null;
          const r = await fetch(address, { credentials:'same-origin', cache:'no-store', redirect:'error', headers: { accept:'application/json', 'x-requested-with':'XMLHttpRequest' } });
          return r.ok ? r.json() : null;
        } });
    } catch { return null; }
  }
  function sample(force) {
    const now = Date.now(), hidden = document.hidden && video.ownerDocument.pictureInPictureElement !== video && (video.muted || video.volume === 0);
    hiddenAt = hidden ? hiddenAt || now : 0;
    const idle = hidden && now - hiddenAt >= READING_IDLE_MS;
    const state = video.ended ? 'ended' : video.paused || video.seeking || video.readyState < 3 || stalled || idle ? 'paused' : 'playing';
    if (!force && state === previousState && (state !== 'playing' || now - lastSent < WATCH_HEARTBEAT_MS)) return;
    const played = video.played, intervals = [];
    for (let i=0; i<played.length; i++) intervals.push([played.start(i),played.end(i)]);
    const key = JSON.stringify([match.courseId, match.stepId, match.videoKey || match.stepId]);
    const added = previousState === 'playing' ? newPlayedRanges(intervals, baseline) : [];
    const ranges = mergePlayed(coverage.get(key) || [], added, video.duration);
    coverage.set(key, ranges);
    baseline = intervals;
    const context = match, token = generation;
    const checkMark = previousState == null || state === 'ended' || (state === 'playing' && now-lastSent >= WATCH_HEARTBEAT_MS);
    if (state === 'ended' && previousState !== 'ended' && provider.readers.lesson) {
      // Algumas plataformas atualizam a marca pouco depois do evento ended.
      finalChecks = [1500, 5500].map(delay => setTimeout(() => {
        if (!stopped && match === context && video?.ended) scan(true);
      }, delay));
    }
    const payload = { pageUrl:url, courseId:match.courseId, stepId:match.stepId, streamId:stream,
      videoKey:match.videoKey || match.stepId, state, duration:video.duration, coveredSeconds:coverageSeconds(ranges),
      ranges:limitPlayed(ranges,96), rate:video.playbackRate, eventId:crypto.randomUUID() };
    previousState = state; lastSent = now;
    queue = queue.catch(()=>{}).then(async () => {
      if (stopped || token !== generation) return;
      if (checkMark) payload.platformDone = await platformMark(context);
      const result = await send({type:'watch-event',payload});
      if (stopped || token !== generation) return;
      if (result?.disabled || result?.found === false) { match=null; detach(); nextLookup=result.disabled ? Date.now()+60000 : Infinity; return; }
      if (result?.login) { coverage.clear(); badge?.show({login:true},video); match=null; nextLookup=Date.now()+30000; return; }
      if (result?.stats) {
        badge ||= makeBadge?.();
        badge?.show({...match,...result,completed:result.lesson.completed}, video);
      }
    }).catch(()=> { if(token === generation) previousState = undefined; });
  }
  function scan(force = false) {
    if (stopped) return;
    if (url !== pageAddress() || (!match && Date.now() >= nextLookup)) {
      const token = ++generation;
      const changedUrl = url !== pageAddress();
      url=pageAddress(); match=null;
      if (changedUrl) detach();
      nextLookup=Infinity;
      send({type:'watch-resolve', pageUrl:url}).then(result=>{
        if (stopped || generation !== token) return;
        if (result?.found) { match=result; previousState=null; nextAccountCheck=Date.now()+60000; scan(); }
        else {
          if (!result?.login) detach();
          nextLookup = result?.found === false && !result.disabled ? Infinity : Date.now()+30000;
        }
      }).catch(()=>{nextLookup=Date.now()+30000;});
      return;
    }
    if (!match) return;
    if (previousState === 'paused' && Date.now() >= nextAccountCheck) {
      nextAccountCheck = Date.now()+60000;
      const token = generation;
      send({type:'watch-resolve', pageUrl:url}).then(result => {
        if (stopped || token !== generation) return;
        if (result?.login) {
          coverage.clear();
          badge?.show({login:true},video);
          match=null;
          nextLookup=Date.now()+30000;
        } else if (result?.found === false) {
          detach();
          match=null;
          nextLookup=result.disabled ? Date.now()+60000 : Infinity;
        }
      }).catch(()=>{});
    }
    const candidate = mainVideo(document);
    if (!candidate) { if(video) { stalled=true; sample(true); detach(); } return; }
    if (candidate !== video || candidate.currentSrc !== source) {
      const previousStream = video && stream;
      detach(); video=candidate; source=video.currentSrc; stream=previousStream || crypto.randomUUID(); previousState=null;
      for (const event of events) video.addEventListener(event,mediaEvent);
      force=true;
    }
    sample(force);
  }
  const observer = new MutationObserver(()=>{ if (!video?.isConnected || pageAddress() !== url) scan(); });
  observer.observe(document.documentElement,{childList:true,subtree:true});
  const poll = setInterval(()=>scan(),1000);
  const refresh = () => {
    if (!document.hidden && !match) nextLookup = 0;
    scan(true);
  };
  document.addEventListener('visibilitychange',refresh);
  function stop() {
    stopped=true; ++generation; detach(); clearInterval(poll); observer.disconnect();
    document.removeEventListener('visibilitychange',refresh);

  }
  scan();
  return stop;
}
