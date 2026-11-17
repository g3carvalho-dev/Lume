export function lessonProvider(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  if (/(^|\.)udemy\.com$/.test(url.hostname) && /^\/course\/[^/]+\/learn\/lecture\/\d+\/?$/.test(url.pathname)) return 'Udemy';
  if (/(^|\.)grancursosonline\.com\.br$/.test(url.hostname) && /^\/aluno\/curso\/video\/codigo\/[^/]+\/v\/[^/]+\/?$/.test(url.pathname)) return 'Gran';
  return null;
}

