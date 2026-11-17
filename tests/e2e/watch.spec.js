import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';

test('vídeo real em página de exemplo: selo, pausa, avanço pela barra, fim e troca de aula',async({page})=>{
  const base='https://cursos.alura.com.br', first=base+'/course/teste/task/1';
  const media = readFileSync('tests/fixtures/watch.webm').toString('base64');
  await page.route(base+'/**',route=>route.fulfill({contentType:'text/html',
    body:`<video width="128" height="72" muted preload="auto" src="data:video/webm;base64,${media}"></video>`}));
  await page.goto(first);
  await page.evaluate(()=>{
    window.events=[];
    const attach=Element.prototype.attachShadow;
    Element.prototype.attachShadow=function(options){const root=attach.call(this,options);window.badge=root;return root;};
    window.chrome ||= {};
    window.chrome.runtime={getURL:file=>location.origin+'/'+file,
      onMessage:{addListener(fn){window.stopWatch=fn;},removeListener(){}},
      async sendMessage(message){
        const match={found:true,courseId:'curso',stepId:'aula',index:1,stats:{total:2,completed:0}};
        if(message.type==='watch-resolve') return location.pathname.endsWith('/1') ? match : {found:false};
        if(message.type==='watch-open-lume') { window.openedLesson=true; return {ok:true}; }
        const event=message.payload;window.events.push(event);
        return {...match,lesson:{completed:false},session:event.state==='ended' ? null : {origin:'watching',stepId:'aula',status:event.state==='playing'?'active':'paused',lastTickAt:new Date().toISOString(),accumulatedMs:0}};
      }};
    window.chrome.storage={local:{get:async()=>({}),set:async()=>{}}};
  });
  await page.addScriptTag({path:'extension/watch.js'});
  await expect.poll(()=>page.evaluate(()=>window.badge?.host.isConnected)).toBe(true);
  await expect.poll(()=>page.evaluate(()=>window.badge.textContent.includes('Aula 1 de 2'))).toBe(true);
  const video=page.locator('video');
  const playerBefore = await video.evaluate(v => ({source:v.currentSrc, width:v.getBoundingClientRect().width, controls:v.controls}));
  await page.evaluate(() => window.badge.querySelector('.on-page').click());
  await expect(video).toHaveCSS('position','fixed');
  await expect.poll(()=>video.evaluate(v=>v.controls)).toBe(true);
  await page.keyboard.press('Escape');
  expect(await video.evaluate(v=>({source:v.currentSrc,width:v.getBoundingClientRect().width,controls:v.controls}))).toEqual(playerBefore);
  await video.evaluate(async v => {
    await v.play();
    await new Promise(resolve => v.requestVideoFrameCallback(resolve));
    v.pause();
  });
  await expect.poll(()=>page.evaluate(()=>window.events.some(e=>e.state==='playing'))).toBe(true);
  await expect.poll(()=>page.evaluate(()=>window.events.at(-1).state)).toBe('paused');
  const mini = await page.evaluate(() => {
    const bounds = window.badge.querySelector('.mini').getBoundingClientRect();
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  });
  await page.mouse.click(mini.x, mini.y);
  await expect.poll(()=>page.evaluate(()=>Boolean(document.pictureInPictureElement && window.openedLesson))).toBe(true);
  await page.evaluate(()=>document.exitPictureInPicture());
  await video.evaluate(async v => {
    const sought = new Promise(resolve => v.addEventListener('seeked',resolve,{once:true}));
    v.currentTime = v.duration - .2;
    await sought;
    if (v.currentTime < 1) throw Error('O vídeo de exemplo precisa permitir avanço pela barra.');
    await v.play();
  });
  await expect.poll(()=>page.evaluate(()=>window.events.at(-1).state)).toBe('ended');
  expect(await page.evaluate(()=>window.events.at(-1).coveredSeconds)).toBeLessThan(1.7);
  await page.evaluate(()=>history.pushState({},'', '/course/teste/task/2'));
  await expect.poll(()=>page.evaluate(()=>window.badge.host.isConnected)).toBe(false);
});
