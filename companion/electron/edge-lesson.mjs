import { app, screen } from 'electron';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { presentPlayer } from './present-player.mjs';
import { lessonProvider } from './lesson-provider.mjs';

const observer = readFileSync(new URL('./edge-observer.js', import.meta.url), 'utf8');

export function edgeLesson(window, url, tracking, callbacks) {
  const modulePath = app.isPackaged ? join(process.resourcesPath, 'webview2', 'lume_webview.node')
    : fileURLToPath(new URL('../build/udemy-runtime/lume_webview.node', import.meta.url));
  const runtime = createRequire(import.meta.url)(modulePath);
  const profile = join(app.getPath('userData'), 'Udemy');
  mkdirSync(profile, {recursive:true});
  const host = runtime.open(window.getNativeWindowHandle().readBigUInt64LE(), realpathSync.native(profile));
  const pending = new Map();
  let closed = false, ready = false, sequence = 0, revision = 0, activeWorld, loading, address = url, bounds;
  let enteredFullscreen = false;
  function cdp(method, params = {}) {
    if (closed || !ready) return Promise.reject(Error('Player indisponível.'));
    const id = ++sequence;
    return new Promise((resolve,reject) => {
      pending.set(id,{resolve,reject});
      runtime.cdp(host, id, method, JSON.stringify(params));
    });
  }
  async function evaluate(contextId, expression) {
    const {result, exceptionDetails} = await cdp('Runtime.evaluate',{contextId, expression, returnByValue:true, awaitPromise:true});
    if (exceptionDetails) throw Error('O documento da aula mudou.');
    return result.value;
  }
  async function initialize(version) {
    const {frameTree} = await cdp('Page.getFrameTree');
    if (lessonProvider(frameTree.frame.url) !== 'Udemy') return;
    const frameId = frameTree.frame.id;
    const {executionContextId:id} = await cdp('Page.createIsolatedWorld',{frameId, worldName:'LumeVideo'});
    if (version !== revision || closed) return;
    await presentPlayer({
      async insertCSS(text) {
        await cdp('DOM.enable'); await cdp('CSS.enable');
        const {styleSheetId} = await cdp('CSS.createStyleSheet',{frameId});
        await cdp('CSS.setStyleSheetText',{styleSheetId,text});
      },
      executeJavaScriptInIsolatedWorld: (_world, [{code}]) => evaluate(id, code)
    }, 'Udemy');
    await evaluate(id, 'if (!globalThis.lumeEdgeObserver) {' + observer + '\n}');
    if (revision === version) activeWorld = id;
  }
  function setBounds(box) {
    bounds = box;
    if (!ready) return;
    const scale = screen.getDisplayMatching(window.getBounds()).scaleFactor;
    const rect = Object.fromEntries(Object.entries(box).map(([key,n])=>[key, Math.round(n*scale)]));
    runtime.bounds(host, rect.x, rect.y, rect.width, rect.height);
  }
  function clearWorld() { ++revision; activeWorld = undefined; loading = undefined; }
  function end() {
    if (closed) return;
    closed = true;
    clearInterval(pump);
    runtime.close(host);
    if (enteredFullscreen && !window.isDestroyed()) window.setFullScreen(false);
    for (const request of pending.values()) request.reject(Error('Player fechado.'));
    pending.clear();
    tracking.navigate();
    callbacks.unavailable();
  }
  function handle(data) {
    if (data.id) {
      const request = pending.get(data.id);
      if (!request) return;
      pending.delete(data.id);
      if (data.type === 'error') request.reject(Error('O documento da aula mudou.')); else request.resolve(JSON.parse(data.value));
      return;
    }
    if (data.type === 'ready') { ready = true; if (bounds) setBounds(bounds); runtime.navigate(host,url); }
    if (data.type === 'navigating') { clearWorld(); tracking.navigate(); }
    if (data.type === 'source') { address = data.value; callbacks.source(address); }
    if (data.type === 'document') clearWorld();
    if (data.type === 'unavailable') { end(); return; }
    if (data.type === 'load-error') callbacks.unavailable();
    if (data.type === 'fullscreen') {
      const active = data.value === 'on';
      if (active) enteredFullscreen = !window.isFullScreen();
      if (enteredFullscreen) window.setFullScreen(active);
      if (!active) enteredFullscreen = false;
      callbacks.fullscreen(active);
    }
  }
  // Os callbacks COM e o Electron compartilham a thread de interface. Consuma
  // os resultados no loop do Node, sem executar JavaScript dentro de um callback COM.
  const pump = setInterval(() => {
    for (const event of runtime.drain(host)) { if (!closed) handle(event); }
  }, 40);
  return {
    getURL: () => address,
    setBounds,
    async details(readDetails) {
      if (closed || !ready || lessonProvider(address) !== 'Udemy') return {};
      if (!activeWorld) {
        const version = revision;
        loading ||= initialize(version).finally(() => { if (revision === version) loading = undefined; });
        await loading;
      }
      const id = activeWorld;
      if (!id) return {};
      const {details,messages} = await evaluate(id, '({details: ('+readDetails.toString()+')("Udemy"),messages:globalThis.lumeEdgeObserver.drain()})');
      for (const {id:messageId,message} of messages) {
        if (id !== activeWorld) break;
        const result = await Promise.resolve(tracking.handle(message)).catch(()=>({error:true}));
        await evaluate(id,'globalThis.lumeEdgeObserver.reply('+JSON.stringify(messageId)+','+JSON.stringify(result)+')');
      }
      return details;
    },
    close() {
      end();
    }
  };
}
