// Gerado por scripts/build-extension.mjs a partir de extension/src/watch.js. Não edite: rode npm run extension:build.
(() => {
  // public/providers/alura.js
  function identify() {
    return null;
  }
  var alura_default = {
    id: "alura",
    label: "Alura",
    aliases: [],
    hosts: ["alura.com.br"],
    structure: "cursos, módulos e aulas",
    art: "code",
    syllabus: "structured",
    note: "Cursos avulsos e formações publicam parte da ementa na página. Trilhas fechadas podem aparecer incompletas.",
    capabilities: { syllabus: "partial", progress: "lesson-flags", resume: false, requiresLogin: false },
    identify,
    readers: {}
  };

  // public/providers/coursera.js
  function identify2(url) {
    const found = /^(\/learn\/[^/]+)/i.exec(url.pathname);
    if (!found) return null;
    return { courseExternalId: found[1].split("/").pop(), canonicalUrl: `${url.origin}${found[1]}` };
  }
  var coursera_default = {
    id: "coursera",
    label: "Coursera",
    aliases: [],
    hosts: ["coursera.org"],
    structure: "semanas e aulas",
    art: "language",
    syllabus: "structured",
    note: "Parte do programa é publicada na página do curso. A duração real pode variar por turma.",
    capabilities: { syllabus: "partial", progress: "lesson-flags", resume: false, requiresLogin: false },
    identify: identify2,
    readers: {}
  };

  // public/providers/dio.js
  function identify3() {
    return null;
  }
  var dio_default = {
    id: "dio",
    label: "DIO",
    aliases: [],
    hosts: ["dio.me"],
    structure: "bootcamps e módulos",
    art: "code",
    syllabus: "page",
    note: "Bootcamps públicos listam módulos; o detalhe das aulas pode exigir cadastro.",
    capabilities: { syllabus: "partial", progress: "lesson-flags", resume: false, requiresLogin: false },
    identify: identify3,
    readers: {}
  };

  // public/providers/estrategia.js
  function identify4() {
    return null;
  }
  var estrategia_default = {
    id: "estrategia",
    label: "Estratégia Concursos",
    aliases: ["Estratégia", "Estrategia"],
    hosts: ["estrategiaconcursos.com.br"],
    structure: "disciplinas e assuntos",
    art: "nature",
    syllabus: "page",
    note: "O Lume lê apenas a página pública do curso. A grade completa costuma exigir acesso à conta: abra o curso logado e use a extensão do Lume, ou copie a página e cole.",
    capabilities: { syllabus: "partial", progress: "lesson-flags", resume: false, requiresLogin: true },
    identify: identify4,
    readers: {}
  };

  // public/providers/kit.js
  var clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
  function toSeconds(text) {
    const value = clean(text).toLowerCase();
    const clock = value.match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/);
    if (clock) return Number(clock[1] || 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
    const hours = value.match(/^(\d+)\s*h(?:\s*(\d+)\s*(?:min|m))?$/);
    if (hours) return Number(hours[1]) * 3600 + Number(hours[2] || 0) * 60;
    const minutes = value.match(/^(\d+)\s*(?:min|mins|minutos?)$/);
    return minutes ? Number(minutes[1]) * 60 : null;
  }
  async function mapLimited(items, limit, task) {
    const results = new Array(items.length);
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        results[index] = await task(items[index]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
  }
  function hostMatches(hostname, hosts) {
    const name = String(hostname || "").toLowerCase().replace(/^www\./, "");
    return hosts.some((known) => name === known || name.endsWith(`.${known}`));
  }

  // public/providers/grancursos.js
  var COURSE_PATH = /^\/aluno\/curso\/(?:video\/)?codigo\/([^/]+)/i;
  var CONCURRENCY = 6;
  function identify5(url) {
    const code = COURSE_PATH.exec(url.pathname)?.[1];
    if (!code) return null;
    return { courseExternalId: code, canonicalUrl: `${url.origin}/aluno/curso/video/codigo/${code}` };
  }
  var seconds = (video) => Number(video?._tempo_duracao) || toSeconds(video?.st_tempo_duracao) || 0;
  function videoId(url) {
    const part = /\/v\/([^/]+)/.exec(url.pathname)?.[1];
    try {
      return part ? decodeURIComponent(part) : "";
    } catch {
      return "";
    }
  }
  async function readLesson({ pageUrl, origin, externalId, fetchJson }) {
    const url = new URL(pageUrl);
    const course = identify5(url);
    if (!course || url.origin !== origin || !/^\d+\/\d+$/.test(externalId || "")) return null;
    const [subject, lesson] = externalId.split("/");
    const items = await fetchJson(`/aluno/curso/listar-conteudo-aula/codigo/${course.courseExternalId}/tipo/video/disciplina/${subject}/conteudo/${lesson}?audiobooks=true`);
    if (!Array.isArray(items) || !items.some((item) => item.id_video === videoId(url)) || !items.every((item) => typeof item.visualizado === "boolean")) return null;
    return items.every((item) => item.visualizado);
  }
  async function readPage({ pageUrl, origin, fetchJson, report = () => {
  }, limits = {} }) {
    let url;
    try {
      url = new URL(pageUrl);
    } catch {
      return null;
    }
    if (url.origin !== origin) return null;
    const course = identify5(url);
    if (!course) return null;
    const maxDisciplines = limits.disciplines || 40;
    const base = `/aluno/curso/listar-conteudo-aula/codigo/${course.courseExternalId}/tipo/video`;
    const query = "?audiobooks=true";
    const subjects = await fetchJson(`${base}${query}`);
    if (!Array.isArray(subjects) || !subjects.length) return null;
    const truncated = subjects.length > maxDisciplines;
    const disciplines = [];
    let unread = 0;
    for (const [index, subject] of subjects.slice(0, maxDisciplines).entries()) {
      const name = clean(subject?.nome).slice(0, 150);
      if (!name || subject?.id == null) continue;
      report(`Lendo a disciplina ${index + 1} de ${Math.min(subjects.length, maxDisciplines)}…`);
      const path = `${base}/disciplina/${encodeURIComponent(subject.id)}`;
      const items = await fetchJson(`${path}${query}`);
      if (!Array.isArray(items) || !items.length) continue;
      const videoLists = await mapLimited(items, CONCURRENCY, (item) => fetchJson(`${path}/conteudo/${encodeURIComponent(item.id)}${query}`).catch(() => null));
      const lessons = items.map((item, position) => {
        const videos = Array.isArray(videoLists[position]) ? videoLists[position].filter((video) => video?.id_video) : null;
        const progress2 = item?.progressoConteudo;
        const title = clean(`Aula ${item?.index ?? position + 1}${clean(item?.desc) ? ` - ${clean(item.desc)}` : ""}`).slice(0, 200);
        const externalId = item?.id != null ? `${subject.id}/${item.id}` : "";
        if (!videos?.length) {
          unread += 1;
          return { title, externalId, url: "", duration: null, completed: Number(progress2?.qtdAulas) > 0 && Number(progress2?.qtdAulasAssistidas) >= Number(progress2?.qtdAulas) };
        }
        const total = videos.reduce((sum, video) => sum + seconds(video), 0);
        return {
          title,
          externalId,
          ...videos.length > 1 ? { videoIds: videos.map((video) => String(video.id_video)) } : {},
          url: `${origin}/aluno/curso/video/codigo/${course.courseExternalId}/v/${encodeURIComponent(videos[0].id_video)}`,
          duration: total || null,
          completed: videos.every((video) => video.visualizado === true)
        };
      });
      disciplines.push({ title: name, externalId: String(subject.id), modules: [{ title: "Aulas", lessons }] });
    }
    if (!disciplines.length) return null;
    return {
      disciplines,
      truncated,
      unread,
      externalId: course.courseExternalId,
      notes: ["Lido pela extensão do Lume na grade que o Gran entrega à página aberta com a sua conta. Cada aula do Gran entra como uma aula; ela conta como concluída quando todos os vídeos dela aparecem como assistidos."],
      warnings: unread ? [`${unread} ${unread === 1 ? "aula veio" : "aulas vieram"} sem a lista de vídeos: a conclusão segue a contagem do Gran e o link ficou vazio.`] : []
    };
  }
  var grancursos_default = {
    id: "grancursos",
    label: "Gran Cursos Online",
    aliases: ["Gran Cursos", "Gran"],
    hosts: ["grancursosonline.com.br"],
    structure: "disciplinas e assuntos",
    art: "nature",
    syllabus: "page",
    note: "A página pública costuma mostrar as disciplinas do pacote. Módulos e aulas detalhados normalmente ficam na área autenticada: abra o curso logado e use a extensão do Lume, ou copie a página e cole, ou envie o texto.",
    capabilities: { syllabus: "full", progress: "lesson-flags", resume: false, requiresLogin: true },
    identify: identify5,
    videoId,
    readers: { page: readPage, lesson: readLesson }
  };

  // public/providers/hotmart.js
  function identify6() {
    return null;
  }
  var hotmart_default = {
    id: "hotmart",
    label: "Hotmart",
    aliases: [],
    hosts: ["hotmart.com"],
    structure: "módulos e aulas",
    art: "design",
    syllabus: "manual",
    note: "Páginas de produto raramente publicam a grade. Prefira colar a ementa ou enviar um arquivo.",
    capabilities: { syllabus: "none", progress: "lesson-flags", resume: false, requiresLogin: true },
    identify: identify6,
    readers: {}
  };

  // public/providers/rocketseat.js
  function identify7() {
    return null;
  }
  var rocketseat_default = {
    id: "rocketseat",
    label: "Rocketseat",
    aliases: [],
    hosts: ["rocketseat.com.br"],
    structure: "trilhas, módulos e projetos",
    art: "code",
    syllabus: "page",
    note: "A trilha pública lista módulos e aulas; o conteúdo em vídeo exige acesso próprio.",
    capabilities: { syllabus: "partial", progress: "lesson-flags", resume: false, requiresLogin: false },
    identify: identify7,
    readers: {}
  };

  // public/providers/udemy.js
  function identify8(url) {
    const found = /^(\/course\/[^/]+)/i.exec(url.pathname);
    if (!found) return null;
    return { courseExternalId: found[1].split("/").pop(), canonicalUrl: `${url.origin}${found[1]}` };
  }
  function courseNumber(origin) {
    const prefix = origin + "/api-2.0/courses/";
    const entries = globalThis.performance?.getEntriesByType?.("resource") || [];
    for (const entry of entries.slice().reverse()) {
      if (!entry.name.startsWith(prefix)) continue;
      const id = /^(\d+)\/subscriber-curriculum-items\//.exec(entry.name.slice(prefix.length))?.[1];
      if (id) return id;
    }
    return null;
  }
  async function progress(fetchJson, courseId) {
    if (!/^\d+$/.test(courseId || "")) return null;
    const result = await fetchJson(`/api-2.0/users/me/subscribed-courses/${courseId}/progress/?fields[course]=completed_lecture_ids`);
    return Array.isArray(result?.completed_lecture_ids) ? new Set(result.completed_lecture_ids.map(String)) : null;
  }
  async function readPage2({ pageUrl, origin, fetchJson }) {
    const course = identify8(new URL(pageUrl)), id = courseNumber(origin);
    if (!course || !id || new URL(pageUrl).origin !== origin) return null;
    const completed = await progress(fetchJson, id);
    if (!completed) return null;
    const path = `/api-2.0/courses/${id}/subscriber-curriculum-items/`;
    let url = path + "?curriculum_types=chapter,lecture&page_size=200&fields[lecture]=title,asset,is_published&fields[chapter]=title&fields[asset]=time_estimation,asset_type";
    const modules = [], visited = /* @__PURE__ */ new Set();
    let module, count = 0;
    while (url && count < 600 && visited.size < 16 && !visited.has(url)) {
      visited.add(url);
      const data = await fetchJson(url);
      if (!Array.isArray(data?.results)) return null;
      for (const item of data.results) {
        if (!item.title || item.is_published === false) continue;
        if (item._class === "chapter") {
          module = { title: item.title, lessons: [] };
          modules.push(module);
        }
        if (item._class !== "lecture" || !Number.isSafeInteger(item.id)) continue;
        if (!module) {
          module = { title: "Aulas", lessons: [] };
          modules.push(module);
        }
        module.lessons.push({
          title: item.title,
          externalId: String(item.id),
          duration: item.asset?.time_estimation || null,
          url: `${course.canonicalUrl}/learn/lecture/${item.id}`,
          completed: completed.has(String(item.id))
        });
        count++;
      }
      const next = data.next && new URL(data.next, origin);
      if (next && (next.origin !== origin || next.pathname !== path)) return null;
      url = next ? next.pathname + next.search : "";
    }
    return { externalId: id, truncated: Boolean(url), disciplines: [{ title: "Conteúdo do curso", modules }], notes: ["Aulas e seções da grade da Udemy. Exercícios e questionários ficam na plataforma."] };
  }
  async function readLesson2({ pageUrl, courseExternalId, externalId, origin, fetchJson }) {
    const url = new URL(pageUrl);
    const id = /\/learn\/lecture\/(\d+)/.exec(url.pathname)?.[1];
    if (url.origin !== origin || !id || externalId && externalId !== id) return null;
    const completed = await progress(fetchJson, /^\d+$/.test(courseExternalId || "") ? courseExternalId : courseNumber(origin));
    return completed ? completed.has(id) : null;
  }
  var udemy_default = {
    id: "udemy",
    label: "Udemy",
    aliases: [],
    hosts: ["udemy.com"],
    structure: "seções e aulas",
    art: "design",
    syllabus: "structured",
    note: "O catálogo publica título e parte do currículo em dados estruturados. Aulas pagas não são acessíveis ao Lume.",
    capabilities: { syllabus: "partial", progress: "lesson-flags", resume: false, requiresLogin: false },
    identify: identify8,
    readers: { page: readPage2, lesson: readLesson2 }
  };

  // public/providers/registry.js
  var PROVIDERS = Object.freeze([grancursos_default, estrategia_default, alura_default, rocketseat_default, udemy_default, coursera_default, dio_default, hotmart_default]);
  var UNKNOWN_PROVIDER = Object.freeze({
    id: "unknown",
    label: "Fonte não reconhecida",
    aliases: [],
    hosts: [],
    structure: "conteúdo",
    art: "nature",
    syllabus: "page",
    note: "Fonte sem adaptador próprio. O Lume tenta ler dados estruturados e a estrutura visível da página, sem ler o que já foi concluído; se não bastar, use texto ou arquivo.",
    capabilities: Object.freeze({ syllabus: "partial", progress: "none", resume: false, requiresLogin: false }),
    identify: () => null,
    readers: Object.freeze({})
  });
  function providerForHost(hostname) {
    return PROVIDERS.find((item) => hostMatches(hostname, item.hosts)) || UNKNOWN_PROVIDER;
  }
  function providerForUrl(value) {
    let url;
    try {
      url = new URL(String(value || "").trim());
    } catch {
      return UNKNOWN_PROVIDER;
    }
    if (!["http:", "https:"].includes(url.protocol)) return UNKNOWN_PROVIDER;
    return providerForHost(url.hostname);
  }

  // public/watch-domain.js
  var WATCH_HEARTBEAT_MS = 3e4;
  function mergePlayed(previous, played, duration) {
    const ranges = [...previous, ...played].filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a).map(([a, b]) => [Math.max(0, a), Math.min(duration, b)]).sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const [a, b] of ranges) {
      if (b <= a) continue;
      const last = merged.at(-1);
      if (last && a <= last[1]) last[1] = Math.max(last[1], b);
      else merged.push([a, b]);
    }
    return merged;
  }
  var coverageSeconds = (ranges) => ranges.reduce((total, [a, b]) => total + b - a, 0);
  function limitPlayed(ranges, limit) {
    if (ranges.length <= limit) return ranges;
    return [...ranges].sort(([a, b], [c, d]) => d - c - (b - a)).slice(0, limit).sort(([a], [b]) => a - b);
  }
  function newPlayedRanges(current, previous) {
    const added = [];
    for (const [start, end] of current) {
      let cursor = start;
      for (const [a, b] of previous) {
        if (a >= end) break;
        if (a > cursor) added.push([cursor, Math.min(a, end)]);
        cursor = Math.max(cursor, b);
        if (cursor >= end) break;
      }
      if (cursor < end) added.push([cursor, end]);
    }
    return added;
  }

  // public/session-domain.js
  var MAX_SESSION_MS = 12 * 60 * 60 * 1e3;
  var STALE_SESSION_MS = 5 * 60 * 1e3;
  var READING_IDLE_MS = 5 * 60 * 1e3;
  function clampDuration(value) {
    if (!Number.isFinite(value) || value <= 0) return 0;
    return Math.min(Math.round(value), MAX_SESSION_MS);
  }
  function sessionElapsed(session, now = Date.now()) {
    if (!session) return 0;
    const base = clampDuration(session.accumulatedMs);
    if (session.status !== "active") return base;
    return clampDuration(base + Math.max(0, now - Date.parse(session.lastTickAt)));
  }
  function formatSessionDuration(milliseconds) {
    const seconds2 = Math.max(0, Math.floor(Number(milliseconds || 0) / 1e3));
    const hours = Math.floor(seconds2 / 3600);
    const minutes = Math.floor(seconds2 % 3600 / 60);
    const rest = seconds2 % 60;
    if (hours) return `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
    return `${minutes}:${String(rest).padStart(2, "0")}`;
  }

  // extension/src/observe-lesson.js
  function mainVideo(doc) {
    const candidates = [...doc.querySelectorAll("video")];
    for (const frame of doc.querySelectorAll("iframe")) {
      if (frame.contentDocument) candidates.push(...frame.contentDocument.querySelectorAll("video"));
    }
    return candidates.filter((v) => v.duration > 0 && Number.isFinite(v.duration) && v.getBoundingClientRect().width > 0).sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
  }
  function observeLesson(send, makeBadge) {
    const provider = providerForUrl(location.href);
    if (provider.id === "unknown") return;
    let url = "", match, video, source, stream, baseline = [], previousState, stalled, lastSent = 0, hiddenAt = 0;
    const coverage = /* @__PURE__ */ new Map();
    let finalChecks = [];
    let generation = 0, queue = Promise.resolve(), badge, stopped = false, nextLookup = 0;
    let nextAccountCheck = 0;
    const events = ["play", "playing", "pause", "waiting", "stalled", "ended", "ratechange", "seeking", "seeked", "volumechange", "loadedmetadata", "emptied"];
    const pageAddress = () => location.origin + location.pathname;
    function detach() {
      if (video) for (const event of events) video.removeEventListener(event, mediaEvent);
      for (const timer of finalChecks) clearTimeout(timer);
      finalChecks = [];
      video = null;
      source = "";
      previousState = "";
      stalled = false;
      baseline = [];
      hiddenAt = 0;
      badge?.remove();
      badge = null;
    }
    function mediaEvent(event) {
      if (["waiting", "stalled", "seeking"].includes(event.type)) stalled = true;
      if (["playing", "seeked"].includes(event.type)) stalled = false;
      scan(true);
    }
    async function platformMark(context) {
      if (!provider.readers.lesson) return null;
      try {
        return await provider.readers.lesson({
          ...context,
          pageUrl: location.href,
          origin: location.origin,
          fetchJson: async (path) => {
            const address = new URL(path, location.origin);
            if (address.origin !== location.origin) return null;
            const r = await fetch(address, { credentials: "same-origin", cache: "no-store", redirect: "error", headers: { accept: "application/json", "x-requested-with": "XMLHttpRequest" } });
            return r.ok ? r.json() : null;
          }
        });
      } catch {
        return null;
      }
    }
    function sample(force) {
      const now = Date.now(), hidden = document.hidden && video.ownerDocument.pictureInPictureElement !== video && (video.muted || video.volume === 0);
      hiddenAt = hidden ? hiddenAt || now : 0;
      const idle = hidden && now - hiddenAt >= READING_IDLE_MS;
      const state = video.ended ? "ended" : video.paused || video.seeking || video.readyState < 3 || stalled || idle ? "paused" : "playing";
      if (!force && state === previousState && (state !== "playing" || now - lastSent < WATCH_HEARTBEAT_MS)) return;
      const played = video.played, intervals = [];
      for (let i = 0; i < played.length; i++) intervals.push([played.start(i), played.end(i)]);
      const key = JSON.stringify([match.courseId, match.stepId, match.videoKey || match.stepId]);
      const added = previousState === "playing" ? newPlayedRanges(intervals, baseline) : [];
      const ranges = mergePlayed(coverage.get(key) || [], added, video.duration);
      coverage.set(key, ranges);
      baseline = intervals;
      const context = match, token = generation;
      const checkMark = previousState == null || state === "ended" || state === "playing" && now - lastSent >= WATCH_HEARTBEAT_MS;
      if (state === "ended" && previousState !== "ended" && provider.readers.lesson) {
        finalChecks = [1500, 5500].map((delay) => setTimeout(() => {
          if (!stopped && match === context && video?.ended) scan(true);
        }, delay));
      }
      const payload = {
        pageUrl: url,
        courseId: match.courseId,
        stepId: match.stepId,
        streamId: stream,
        videoKey: match.videoKey || match.stepId,
        state,
        duration: video.duration,
        coveredSeconds: coverageSeconds(ranges),
        ranges: limitPlayed(ranges, 96),
        rate: video.playbackRate,
        eventId: crypto.randomUUID()
      };
      previousState = state;
      lastSent = now;
      queue = queue.catch(() => {
      }).then(async () => {
        if (stopped || token !== generation) return;
        if (checkMark) payload.platformDone = await platformMark(context);
        const result = await send({ type: "watch-event", payload });
        if (stopped || token !== generation) return;
        if (result?.disabled || result?.found === false) {
          match = null;
          detach();
          nextLookup = result.disabled ? Date.now() + 6e4 : Infinity;
          return;
        }
        if (result?.login) {
          coverage.clear();
          badge?.show({ login: true }, video);
          match = null;
          nextLookup = Date.now() + 3e4;
          return;
        }
        if (result?.stats) {
          badge ||= makeBadge?.();
          badge?.show({ ...match, ...result, completed: result.lesson.completed }, video);
        }
      }).catch(() => {
        if (token === generation) previousState = void 0;
      });
    }
    function scan(force = false) {
      if (stopped) return;
      if (url !== pageAddress() || !match && Date.now() >= nextLookup) {
        const token = ++generation;
        const changedUrl = url !== pageAddress();
        url = pageAddress();
        match = null;
        if (changedUrl) detach();
        nextLookup = Infinity;
        send({ type: "watch-resolve", pageUrl: url }).then((result) => {
          if (stopped || generation !== token) return;
          if (result?.found) {
            match = result;
            previousState = null;
            nextAccountCheck = Date.now() + 6e4;
            scan();
          } else {
            if (!result?.login) detach();
            nextLookup = result?.found === false && !result.disabled ? Infinity : Date.now() + 3e4;
          }
        }).catch(() => {
          nextLookup = Date.now() + 3e4;
        });
        return;
      }
      if (!match) return;
      if (previousState === "paused" && Date.now() >= nextAccountCheck) {
        nextAccountCheck = Date.now() + 6e4;
        const token = generation;
        send({ type: "watch-resolve", pageUrl: url }).then((result) => {
          if (stopped || token !== generation) return;
          if (result?.login) {
            coverage.clear();
            badge?.show({ login: true }, video);
            match = null;
            nextLookup = Date.now() + 3e4;
          } else if (result?.found === false) {
            detach();
            match = null;
            nextLookup = result.disabled ? Date.now() + 6e4 : Infinity;
          }
        }).catch(() => {
        });
      }
      const candidate = mainVideo(document);
      if (!candidate) {
        if (video) {
          stalled = true;
          sample(true);
          detach();
        }
        return;
      }
      if (candidate !== video || candidate.currentSrc !== source) {
        const previousStream = video && stream;
        detach();
        video = candidate;
        source = video.currentSrc;
        stream = previousStream || crypto.randomUUID();
        previousState = null;
        for (const event of events) video.addEventListener(event, mediaEvent);
        force = true;
      }
      sample(force);
    }
    const observer = new MutationObserver(() => {
      if (!video?.isConnected || pageAddress() !== url) scan();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    const poll = setInterval(() => scan(), 1e3);
    const refresh = () => {
      if (!document.hidden && !match) nextLookup = 0;
      scan(true);
    };
    document.addEventListener("visibilitychange", refresh);
    function stop() {
      stopped = true;
      ++generation;
      detach();
      clearInterval(poll);
      observer.disconnect();
      document.removeEventListener("visibilitychange", refresh);
    }
    scan();
    return stop;
  }

  // extension/src/page-miniplayer.js
  function openPageMiniplayer(video, onClose) {
    const playerDoc = video.ownerDocument;
    const frame = playerDoc !== document && playerDoc.defaultView.frameElement || video.closest('.video-js, [data-purpose="video-player"], [data-purpose="video-player-container"]') || video;
    const doc = frame.ownerDocument;
    const bounds = frame.getBoundingClientRect();
    const ratio = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9;
    const placeholder = doc.createElement("div");
    if (!["absolute", "fixed"].includes(doc.defaultView.getComputedStyle(frame).position)) {
      Object.assign(placeholder.style, { width: "100%", maxWidth: bounds.width + "px", height: bounds.height + "px" });
      frame.before(placeholder);
    }
    const size = "min(360px, 44vw, " + Math.round(55 * ratio) + "vh)";
    const styles = {
      position: "fixed",
      top: "12px",
      right: "12px",
      bottom: "auto",
      left: "auto",
      width: size,
      height: "auto",
      "min-height": "0",
      "min-width": "0",
      "max-height": "none",
      "max-width": "none",
      "aspect-ratio": String(ratio),
      "object-fit": "contain",
      "z-index": "2147483645"
    };
    for (const side of ["top", "right", "bottom", "left"]) {
      styles["margin-" + side] = "0";
      styles["padding-" + side] = "0";
    }
    const original = Object.keys(styles).map((key) => [key, frame.style.getPropertyValue(key), frame.style.getPropertyPriority(key)]);
    const nativeControls = video.controls;
    let popover = false;
    if (frame.showPopover && !frame.hasAttribute("popover") && !doc.fullscreenElement) {
      frame.setAttribute("popover", "manual");
      try {
        frame.showPopover();
        popover = true;
      } catch {
        frame.removeAttribute("popover");
      }
    }
    for (const [key, value] of Object.entries(styles)) frame.style.setProperty(key, value, "important");
    if (frame === video) video.controls = true;
    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      if (popover) {
        if (frame.matches(":popover-open")) frame.hidePopover();
        frame.removeAttribute("popover");
      }
      for (const [key, value, priority] of original) {
        if (value) frame.style.setProperty(key, value, priority);
        else frame.style.removeProperty(key);
      }
      if (frame === video) video.controls = nativeControls;
      placeholder.remove();
      doc.removeEventListener("keydown", escape, true);
      if (playerDoc !== doc) playerDoc.removeEventListener("keydown", escape, true);
      onClose();
    }
    function escape(event) {
      if (event.key === "Escape") close();
    }
    doc.addEventListener("keydown", escape, true);
    if (playerDoc !== doc) playerDoc.addEventListener("keydown", escape, true);
    return close;
  }

  // extension/src/watch-badge.js
  function watchBadge() {
    const host = document.createElement("aside");
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>
    :host { all:initial; position:fixed; right:16px; bottom:16px; z-index:2147483646; color-scheme:dark }
    section { background:#141b2a; color:#eef2f7; border:1px solid #3a4868; border-radius:14px; padding:10px 14px; max-width:230px; font:15px 'Atkinson Hyperlegible Next',system-ui,sans-serif; box-shadow:0 4px 16px #0005 }
    button { color:inherit; background:transparent; border:0; cursor:pointer; font:inherit; padding:2px; display:flex; align-items:center; gap:8px }
    b {color:#f6c165} small {display:block;margin-top:6px} time {font-family:'JetBrains Mono',monospace}
    progress {width:100%;height:5px;accent-color:#9ec5ff} [hidden]{display:none}
  </style><section><button type="button"><b>✦</b><span>Lume</span><time></time></button><div><small></small><progress max="100"></progress><button type="button" class="on-page" aria-pressed="false">Miniplayer nesta página</button><button type="button" class="mini">Assistir sobre o Lume ↗</button><small role="status"></small></div></section>`;
    const button = root.querySelector("button"), details = root.querySelector("div");
    const time = root.querySelector("time"), label = root.querySelector("span");
    let session = null, collapsed = false;
    let player = null;
    const mini = root.querySelector(".mini"), feedback = root.querySelector("[role=status]");
    const pageMini = root.querySelector(".on-page");
    let closePageMini;
    pageMini.onclick = () => {
      if (closePageMini) {
        closePageMini();
        return;
      }
      closePageMini = openPageMiniplayer(player, () => {
        closePageMini = null;
        pageMini.textContent = "Miniplayer nesta página";
        pageMini.setAttribute("aria-pressed", "false");
      });
      pageMini.textContent = "Voltar ao tamanho original";
      pageMini.setAttribute("aria-pressed", "true");
    };
    mini.onclick = async () => {
      try {
        const doc = player.ownerDocument;
        if (doc.pictureInPictureElement === player) await doc.exitPictureInPicture();
        else {
          closePageMini?.();
          await player.requestPictureInPicture();
          const result = await chrome.runtime.sendMessage({ type: "watch-open-lume" });
          if (!result?.ok) {
            feedback.textContent = "Miniplayer aberto. Entre no Lume para ver a aula.";
            return;
          }
        }
        updateMini();
      } catch {
        feedback.textContent = "O player bloqueou a janela flutuante. Use “Miniplayer nesta página”.";
      }
    };
    function updateMini() {
      mini.disabled = !player?.ownerDocument.pictureInPictureEnabled || player.disablePictureInPicture || !player.requestPictureInPicture;
      mini.textContent = player?.ownerDocument.pictureInPictureElement === player ? "Fechar miniplayer" : "Assistir sobre o Lume ↗";
      mini.hidden = mini.disabled;
      feedback.textContent = "";
    }
    const renderToggle = () => {
      details.hidden = collapsed;
      button.setAttribute("aria-expanded", String(!collapsed));
      button.title = collapsed ? "Expandir o selo do Lume" : "Recolher o selo do Lume";
    };
    chrome.storage.local.get("watchCollapsed").then((value) => {
      collapsed = Boolean(value.watchCollapsed);
      renderToggle();
    });
    button.onclick = () => {
      collapsed = !collapsed;
      renderToggle();
      chrome.storage.local.set({ watchCollapsed: collapsed });
    };
    const tick = () => {
      time.textContent = session ? formatSessionDuration(sessionElapsed(session)) : "";
    };
    const timer = setInterval(tick, 1e3);
    const faces = [["Atkinson Hyperlegible Next", "atkinson-hyperlegible-next"], ["JetBrains Mono", "jetbrains-mono"]].map(([family, file]) => new FontFace(family, `url("${chrome.runtime.getURL("fonts/" + file + "-latin.woff2")}")`));
    for (const face of faces) face.load().then((font) => {
      if (host.isConnected) document.fonts.add(font);
    }).catch(() => {
    });
    return {
      show(result, video) {
        if (player !== video) {
          closePageMini?.();
          player?.removeEventListener("leavepictureinpicture", updateMini);
          player = video;
          player?.addEventListener("leavepictureinpicture", updateMini);
          updateMini();
        }
        session = result.session?.origin === "watching" && result.session.stepId === result.stepId ? result.session : null;
        label.textContent = result.login ? "Entre no Lume para contar o tempo" : result.completed ? "Aula concluída" : session?.status === "active" ? "Contando" : result.otherSession ? "Timer já em uso" : "Pausado";
        root.querySelector("small").textContent = result.stats ? `Aula ${result.index} de ${result.stats.total}` : "";
        const bar = root.querySelector("progress");
        bar.hidden = !result.stats;
        if (result.stats) bar.value = 100 * result.stats.completed / (result.stats.total || 1);
        tick();
        if (!host.isConnected) document.documentElement.append(host);
        const bounds = video?.getBoundingClientRect();
        host.style.bottom = bounds && bounds.right > innerWidth - host.offsetWidth - 20 && bounds.bottom > innerHeight - host.offsetHeight - 26 ? Math.max(72, innerHeight - bounds.bottom + 74) + "px" : "16px";
      },
      remove() {
        closePageMini?.();
        clearInterval(timer);
        player?.removeEventListener("leavepictureinpicture", updateMini);
        host.remove();
        for (const face of faces) document.fonts.delete(face);
      }
    };
  }

  // extension/src/watch.js
  if (!globalThis.lumeStopWatch && window === top) {
    const stop = observeLesson((message) => chrome.runtime.sendMessage(message), watchBadge);
    if (stop) {
      let cleanup = function() {
        stop();
        chrome.runtime.onMessage.removeListener(control);
        delete globalThis.lumeStopWatch;
      }, control = function(message) {
        if (message?.type === "watch-stop" && message.provider === provider.id) cleanup();
      };
      const provider = providerForUrl(location.href);
      globalThis.lumeStopWatch = cleanup;
      chrome.runtime.onMessage.addListener(control);
    }
  }
})();
