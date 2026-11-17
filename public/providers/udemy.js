// Udemy.
//
// Conferido numa aula autenticada no Chrome em 16/11/2026: a página pede
// subscriber-curriculum-items em páginas de 200 e progress.completed_lecture_ids.

// O curso é o primeiro segmento depois de /course/: aulas abertas dentro dele
// apontam para o mesmo curso.
function identify(url) {
  const found = /^(\/course\/[^/]+)/i.exec(url.pathname);
  if (!found) return null;
  return { courseExternalId: found[1].split('/').pop(), canonicalUrl: `${url.origin}${found[1]}` };
}

function courseNumber(origin) {
  const prefix = origin + '/api-2.0/courses/';
  const entries = globalThis.performance?.getEntriesByType?.('resource') || [];
  for (const entry of entries.slice().reverse()) {
    if (!entry.name.startsWith(prefix)) continue;
    const id = /^(\d+)\/subscriber-curriculum-items\//.exec(entry.name.slice(prefix.length))?.[1];
    if (id) return id;
  }
  return null;
}

async function progress(fetchJson, courseId) {
  if (!/^\d+$/.test(courseId || '')) return null;
  const result = await fetchJson(`/api-2.0/users/me/subscribed-courses/${courseId}/progress/?fields[course]=completed_lecture_ids`);
  return Array.isArray(result?.completed_lecture_ids) ? new Set(result.completed_lecture_ids.map(String)) : null;
}

async function readPage({pageUrl,origin,fetchJson}) {
  const course = identify(new URL(pageUrl)), id = courseNumber(origin);
  if (!course || !id || new URL(pageUrl).origin !== origin) return null;
  const completed = await progress(fetchJson,id);
  if (!completed) return null;
  const path = `/api-2.0/courses/${id}/subscriber-curriculum-items/`;
  let url = path+'?curriculum_types=chapter,lecture&page_size=200&fields[lecture]=title,asset,is_published&fields[chapter]=title&fields[asset]=time_estimation,asset_type';
  const modules=[], visited=new Set();
  let module, count=0;
  while (url && count<600 && visited.size<16 && !visited.has(url)) {
    visited.add(url);
    const data=await fetchJson(url);
    if (!Array.isArray(data?.results)) return null;
    for (const item of data.results) {
      if (!item.title || item.is_published===false) continue;
      if (item._class==='chapter') { module={title:item.title,lessons:[]}; modules.push(module); }
      if (item._class!=='lecture' || !Number.isSafeInteger(item.id)) continue;
      if (!module) { module={title:'Aulas',lessons:[]}; modules.push(module); }
      module.lessons.push({title:item.title,externalId:String(item.id),duration:item.asset?.time_estimation || null,
        url:`${course.canonicalUrl}/learn/lecture/${item.id}`,completed:completed.has(String(item.id))});
      count++;
    }
    const next=data.next && new URL(data.next,origin);
    if (next && (next.origin!==origin || next.pathname!==path)) return null;
    url=next ? next.pathname+next.search : '';
  }
  return {externalId:id,truncated:Boolean(url),disciplines:[{title:'Conteúdo do curso',modules}],notes:['Aulas e seções da grade da Udemy. Exercícios e questionários ficam na plataforma.']};
}

async function readLesson({pageUrl,courseExternalId,externalId,origin,fetchJson}) {
  const url=new URL(pageUrl);
  const id=/\/learn\/lecture\/(\d+)/.exec(url.pathname)?.[1];
  if(url.origin!==origin || !id || (externalId && externalId!==id)) return null;
  const completed=await progress(fetchJson,/^\d+$/.test(courseExternalId || '') ? courseExternalId : courseNumber(origin));
  return completed ? completed.has(id) : null;
}

export default {
  id: 'udemy',
  label: 'Udemy',
  aliases: [],
  hosts: ['udemy.com'],
  structure: 'seções e aulas',
  art: 'design',
  syllabus: 'structured',
  note: 'O catálogo publica título e parte do currículo em dados estruturados. Aulas pagas não são acessíveis ao Lume.',
  capabilities: { syllabus: 'partial', progress: 'lesson-flags', resume: false, requiresLogin: false },
  identify,
  readers: {page:readPage, lesson:readLesson},
};
