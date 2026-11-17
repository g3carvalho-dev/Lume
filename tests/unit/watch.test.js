import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {applyMigrations,sqliteAdapter} from '../../api/adapters/sqlite.js';
import {readLibrary} from '../../api/domain/library-store.js';
import {applyLibraryActions} from '../../api/domain/library-actions.js';
import {applyWatchEvent,resolveWatchLesson} from '../../api/domain/watch.js';
import {libraryActions} from '../../public/library-actions.js';
import {applyCourseImport,normalizePayload} from '../../public/import-domain.js';
import {mergePlayed,newPlayedRanges,coverageSeconds,acceptedCoverage,watchCompleted} from '../../public/watch-domain.js';
import {startSession} from '../../public/session-domain.js';
import {extensionOrigin} from '../../api/http.js';
import {readConfig} from '../../api/config.js';

test('intervalos tocados: repetição, salto, outro vídeo e velocidade dupla',()=>{
  const ranges=mergePlayed([[0,10],[8,12]],[[8,15],[95,100]],100);
  assert.deepEqual(ranges,[[0,15],[95,100]]);
  assert.equal(coverageSeconds(ranges),20);
  assert.deepEqual(mergePlayed([],[[0,2]],30),[[0,2]]);
  assert.deepEqual(newPlayedRanges([[0,20],[40,55]],[[0,5],[7,11],[30,45]]),[[5,7],[11,20],[45,55]]);
  assert.ok(acceptedCoverage(100,100,10)<25);
  assert.equal(acceptedCoverage(100,100,50),100);
  assert.equal(watchCompleted({duration:100,covered:89.9}),false);
  assert.equal(watchCompleted({duration:100,covered:90}),true);
});

async function setup(t,provider='alura',change) {
  const sqlite=new DatabaseSync(':memory:'); t.after(()=>sqlite.close());
  applyMigrations(sqlite,fileURLToPath(new URL('../../migrations/',import.meta.url)));
  const db=sqliteAdapter(sqlite);
  await db.run("INSERT INTO users(id,name,email,password_hash,created_at) VALUES ('u','Teste','u@example.test','x','2026-01-01')");
  const initial=await readLibrary(db,'u'), now=Date.now();
  const url=provider==='grancursos' ? 'https://www.grancursosonline.com.br/aluno/curso/video/codigo/c/v/abc' : 'https://cursos.alura.com.br/course/teste/task/1';
  const result=normalizePayload({title:'Teste',provider:{id:provider},sourceUrl:url,disciplines:[{title:'Área',modules:[{title:'Módulo',lessons:[{externalId:'1/1',title:'Uma aula',url,duration:100}]}]}]});
  let next=applyCourseImport(initial.state,result);
  if(change) next=change(next);
  await applyLibraryActions(db,'u',{id:'seed',revision:initial.revision,actions:libraryActions(initial.state,next)},{now:now-1000});
  const lesson=await resolveWatchLesson(db,'u',url,now);
  const base={...lesson,pageUrl:url,streamId:'tab',duration:100,coveredSeconds:0};
  const event=(state,seconds,patch={})=>applyWatchEvent(db,'u',{...base,eventId:crypto.randomUUID(),state,...patch},now+1000*seconds);
  return {db,event,url};
}

test('relógio do servidor, pausa, retomada, encerramento e XP idempotente',async t=>{
  const {db,event}=await setup(t);
  assert.equal((await event('playing',0,{coveredSeconds:100})).lesson.completed,false);
  assert.equal((await event('paused',10,{coveredSeconds:100})).session.accumulatedMs,10000);
  await event('playing',100);
  const last={eventId:'final',coveredSeconds:91};
  assert.equal((await event('ended',140,last)).lesson.completed,true);
  await event('ended',155,last);
  const {state}=await readLibrary(db,'u');
  assert.equal(state.activeSession,null);
  assert.equal(state.studySessions[0].durationMs,50000);
  assert.equal(state.progress.filter(e=>e.origin==='integration').length,1);
  assert.equal((await db.first("SELECT count(*) AS n FROM xp_events WHERE kind='lesson'")).n,1);
  assert.ok((await db.first('SELECT COUNT(*) AS n FROM xp_events')).n>0);
});

test('marca da plataforma exige observar pendente na mesma reprodução',async t=>{
  const {event}=await setup(t,'grancursos');
  assert.equal((await event('playing',0,{platformDone:true})).lesson.completed,false);
  await event('playing',1,{platformDone:false});
  assert.equal((await event('ended',3,{platformDone:true,streamId:'outra'})).lesson.completed,false);
  await event('ended',3);
  await event('playing',4,{platformDone:false,streamId:'outra'});
  assert.equal((await event('ended',5,{platformDone:true,streamId:'outra'})).lesson.completed,true);
});

test('visitas em dias diferentes somam só trechos distintos do mesmo vídeo',async t=>{
  const {event}=await setup(t);
  await event('playing',0,{ranges:[]});
  assert.equal((await event('ended',50,{ranges:[[0,50]]})).lesson.completed,false);
  await event('playing',86400,{streamId:'visita2',ranges:[]});
  assert.equal((await event('playing',86430,{streamId:'visita2',ranges:[[10,40]]})).lesson.completed,false);
  assert.equal((await event('ended',86470,{streamId:'visita2',ranges:[[10,40],[50,90]]})).lesson.completed,true);
});

test('preserva o timer manual e respeita a preferência desligada',async t=>{
  const {db,event}=await setup(t,'alura',s=>startSession(s,{origin:'focus'}));
  await event('playing',1);
  assert.equal((await readLibrary(db,'u')).state.activeSession.origin,'focus');
  const off=await setup(t,'alura',s=>({...s,preferences:{...s.preferences,watchLessons:false}}));
  const before=await readLibrary(off.db,'u');
  assert.deepEqual(await off.event('playing',1),{disabled:true});
  assert.equal((await readLibrary(off.db,'u')).revision,before.revision);
});

test('o batch repete uma vez quando outra gravação avança a revisão',async t=>{
  const {db,event}=await setup(t);
  const batch=db.batch; let conflicted=false;
  db.batch=async statements=>{
    if(!conflicted && statements.some(([sql])=>sql.includes('INSERT INTO watch_progress'))) {
      conflicted=true;
      await db.run("UPDATE account_documents SET revision=revision+1 WHERE user_id='u'");
    }
    return batch(statements);
  };
  assert.equal((await event('playing',0)).session.origin,'watching');
  assert.equal(conflicted,true);
  assert.equal((await db.first('SELECT count(*) AS n FROM watch_progress')).n,1);
});

test('origem da loja ou da configuração é exata; ids de desenvolvimento só no localhost',()=>{
  const url=new URL('https://lumeacademy.site/api/extension/status');
  const request=origin=>new Request(url,{headers:{Origin:origin}});
  const config=readConfig(), allowed=config.extensionOrigins[0], other='chrome-extension://'+'a'.repeat(32);
  assert.ok(extensionOrigin(request(allowed),url,config));
  assert.equal(extensionOrigin(request(other),url,config),false);
  assert.ok(extensionOrigin(request(other),new URL('http://localhost:4173'),config));
  assert.equal(extensionOrigin(request('null'),url,config),false);
});
