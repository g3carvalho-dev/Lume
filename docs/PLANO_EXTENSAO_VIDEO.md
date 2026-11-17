# Plano de implementação — extensão que acompanha a aula

> Histórico: em 17/11/2026, os formulários de link público e “Colar a grade” foram aposentados. Adicionar curso e Atualizar grade passaram a oferecer o link da extensão e instruções de instalação e uso. As referências abaixo aos caminhos antigos foram substituídas pela importação pela extensão no Chrome ou no Edge do computador com a mesma conta do Lume. Regras vigentes em `REGRAS_DE_NEGOCIO.md`, §11.

Escrito em 16/11/2026 para ser executado por outro agente. Descreve **o que construir, onde e como verificar**. Não é regra de produto vigente: as regras entram em `docs/REGRAS_DE_NEGOCIO.md` à medida que cada fase for entregue, e este arquivo deve ser apagado ao fim da última fase.

Antes de começar, leia `AGENTS.md`, `docs/REGRAS_DE_NEGOCIO.md` (§4, §5 e §11), `extension/LEIAME.md` e os arquivos citados em cada fase.

---

## 1. Objetivo

Hoje a extensão (`extension/`) só lê a grade de um curso quando a pessoa clica no ícone. Ela passa a:

1. Ser oferecida dentro do Lume, numa tela de instalação, no fluxo de adicionar curso.
2. Perceber que a pessoa está assistindo a uma aula de um curso importado: vídeo tocando, pausado, terminado.
3. Contar esse tempo como sessão de estudo (pausou o vídeo, pausa o tempo).
4. Concluir a aula sozinha quando o critério for atingido.
5. Mostrar, na página da aula e no Lume, aula X de Y, seções feitas, o que falta e a estimativa de término.
6. Ter um popup refeito na identidade Norte.

## 2. Decisões da responsável (16/11/2026)

Estas decisões prevalecem sobre o texto antigo do código e da documentação. Não as reabra; se uma delas se mostrar inviável, pare e pergunte.

| Tema | Decisão |
| --- | --- |
| Permissão | A pessoa liga **cada plataforma** no popup (permissão opcional do Chrome por domínio do registro de provedores). Nada de acesso a qualquer site. |
| Tempo | Vídeo tocando conta como sessão de estudo; pausar o vídeo pausa o tempo. |
| Fim da aula | **Conclui sozinho, sem confirmação.** Substitui a regra "nada vindo da extensão é registrado sem a pessoa confirmar" para este caso. |
| Critério | Plataforma com leitor próprio (Gran): a aula conclui quando **a própria plataforma** marca todos os vídeos da aula como assistidos. Demais: quando o tempo **realmente tocado** chega a 90% da duração. Arrastar a barra não conta. |
| Onde aparece | Selo discreto do Lume na página da aula (contando/pausado, aula X de Y, recolhível) **e** a mesma sessão no timer do cabeçalho e na tela do curso do Lume. |
| Lume fechado | Deve funcionar **sem aba do Lume aberta**: a extensão fala direto com o servidor usando o login que já existe no navegador, sem guardar senha nem token. |
| Estimativa | Ritmo real dos últimos 14 dias naquele curso; reserva é a disponibilidade do Plano; sem nenhum dos dois, só as horas restantes. |
| Popup | Painel do curso atual (aula, progresso, tempo de hoje, estado) e interruptores de plataforma, na identidade Norte. A responsável considera o popup atual feio e desatualizado. |
| Instalação | A tela aponta para a ficha na Chrome Web Store: `https://chromewebstore.google.com/detail/lcjchobdkejffabkoclbdpalbbkelcic` |
| Teste real | "Funcional" = Gran **e** Udemy testados com conta real no Chrome. Demais plataformas: só páginas de exemplo, marcadas como não verificadas. |

## 3. Estado atual conferido no código

- `extension/manifest.json` (v0.2.1): permissões `activeTab`, `scripting`, `storage`; `host_permissions` só para as origens do Lume; `bridge.js` é o único content script e roda só no Lume.
- `extension/src/capture.js` → `extension/capture.js` (gerado por `npm run extension:build`, esbuild; `tests/unit/extension-build.test.js` falha se estiver desatualizado). Nunca edite o gerado.
- `extension/background.js` entrega a leitura a uma **aba do Lume** (`chrome.tabs.sendMessage` → `bridge.js` → `postMessage`). Não há chamada HTTP da extensão ao servidor.
- `src/lib/extension.js` (`listenForExtension`) e `src/app/App.jsx:60-78` tratam dois tipos: `capture` (abre a revisão) e `complete` (abre a aula para confirmar, via `findLessonByUrl` de `public/import-domain.js:506`).
- Menções à extensão na interface: só textos em `src/features/library/ImportCourse.jsx` (linhas ~270, ~281 e ~409-416), que mandam instalar pela pasta `extension/`.
- "Continuar" (`src/features/library/Today.jsx:114`) e o registro da aula (`src/features/progress/StudyDialog.jsx:207-241`) abrem `lesson.url || course.url` em nova aba. `StudyDialog.jsx:239-241` afirma que "o Lume não observa o vídeo em outra aba" e "nenhuma integração de progresso ativa".
- Sessões: `public/session-domain.js`. `SESSION_ORIGINS = declared | focus | reading | companion`. Há **uma** `activeSession` por conta; sessões encerradas vão para `studySessions`. `closeStaleSession` encerra sessão ativa sem batimento há 5 min.
- XP de tempo: `api/domain/library-time.js` concede blocos a partir de `studySessions` encerradas, exigindo `durationMs <= relógio + 5 s`.
- Conclusão: evento em `state.progress`; `origin: 'integration'` é elegível a XP (`api/domain/library-actions.js:31`). **Só conclusão `manual` pode ser desfeita** (`library-actions.js:130`).
- Gravação: `applyLibraryActions(db, userId, { id, revision, actions })` em `api/domain/library-actions.js`, com revisão otimista (`library_conflict`, 409) e idempotência pelo `id`.
- Rotas com `origin: true` passam por `sameOrigin` (`api/http.js:67`), que **recusa** `Origin: chrome-extension://…`.
- Cookie de sessão: `lume_session`, `HttpOnly; SameSite=Strict` (`api/domain/auth.js:161`).
- Provedores: `public/providers/registry.js`. Só `grancursos.js` tem `readers.page`. `udemy.js` tem `readers: {}`.
- Empacotamento da loja: `scripts/package-extension.mjs` remove endereços locais do manifesto e o bloco `data-dev` do popup, e falha se sobrar `localhost`.
- A extensão **nunca foi carregada num Chrome real** (`extension/LEIAME.md`). Só a leitura do Gran pela API foi conferida com conta real, em 01/11/2026.

## 4. Antes de escrever código

1. A `main` tem alterações não commitadas de outro trabalho (privacidade do perfil; inclui `migrations/0026_profile_pins.sql` ainda não versionado). **Não toque nelas.** Crie uma branch a partir da `main` e trabalhe só nos arquivos deste plano.
2. Não faça deploy, migração remota, release nem envio à loja. Isso é decisão da responsável.
3. Um commit por fase, com a linha `Novidade:` no corpo quando a fase mudar algo visível (formato em `AGENTS.md`, área `extensao` ou `site`).

## 5. Fase 0 — verificações que decidem a arquitetura

Faça estas três verificações antes da Fase 2. Registre o resultado no próprio PR.

### 0.1 O cookie de login acompanha pedidos da extensão?

A decisão "sem aba do Lume aberta" depende de o service worker da extensão conseguir chamar `https://lumeacademy.site/api/...` com `credentials: 'include'` e o Chrome enviar o cookie `SameSite=Strict`. A expectativa é que sim, porque a extensão tem `host_permissions` para a origem, mas **isto não foi verificado**.

- Como testar: extensão carregada sem compactação, Lume local em `localhost:4173` com conta logada, e um `fetch` do service worker para `GET /api/library` (com a regra de origem da Fase 3 já aplicada, ou temporariamente relaxada só no ambiente local).
- Se o cookie **não** for enviado: pare e pergunte à responsável. A alternativa conhecida é o pareamento por código que o aplicativo de desktop já usa (`api/domain/companion.js`, `createPairCode`/`redeemPairCode`, `bearerToken` em `api/http.js`), mas ela guarda um token na extensão, o que contraria o que foi combinado. Não adote sem confirmação.

### 0.2 Onde fica o `<video>` no Gran e na Udemy?

Com a responsável logada, descubra em cada plataforma se o `<video>` está no documento principal, num quadro da mesma origem ou num quadro de outra origem (player de terceiros). O content script só alcança a origem autorizada. Player em quadro de outra origem exige autorizar também essa origem; documente o domínio e inclua-o na lista de origens do provedor (campo novo `playerHosts`, ver Fase 2).

### 0.3 O link da aula abre a aula certa?

A responsável relatou que "não redireciona para o vídeo", mas nunca testou com curso real. Importe um curso do Gran pela extensão e clique em "Continuar": confira se `lesson.url` (`.../aluno/curso/video/codigo/<código>/v/<id_video>`) abre o vídeo certo. Corrija o que estiver errado em `public/providers/grancursos.js`. Aulas com `url: ''` (lista de vídeos não lida) caem em `course.url`; isso é esperado e deve continuar.

## 6. Fase 1 — tela de instalação e popup novo

Entrega independente das demais; pode ser publicada sozinha.

### 6.1 Saber se a extensão está instalada

- `extension/bridge.js`: ao carregar, anuncie-se à página (`postMessage` com `source: 'lume-extension'`, `type: 'hello'`, `version` do manifesto) e responda a um `ping` da página com o mesmo `hello`. Mantenha a checagem `event.source === window` e a origem.
- `src/lib/extension.js`: acrescente `useExtension()` devolvendo `{ installed, version }`. Envia `ping` ao montar e escuta `hello`. Sem resposta em ~1 s, `installed: false`.
- Endereço da loja: uma constante só, num módulo de domínio novo `public/extension-domain.js` (`EXTENSION_STORE_URL`, versão mínima suportada e os textos de capacidade). Use o endereço da §2, sem `authuser` nem `hl`.

### 6.2 Tela de instalação

Componente novo em `src/features/library/` (por exemplo `ExtensionInvite.jsx`), com estilo em `src/features/library/*.css` já importado por `src/styles/lume.css`. Não acrescente `@import` em componente.

Aparece em três lugares de `ImportCourse.jsx`:

1. Na etapa do link, como cartão fixo abaixo das abas "Link do curso / Colar a grade".
2. Quando o provedor detectado tem `capabilities.requiresLogin` (hoje a condição está fixa em `['grancursos', 'estrategia']`; troque pela capacidade do registro).
3. Na tela de erro (`protected`, `no_syllabus`, `unparsed_text`), **substituindo** a lista que manda abrir a pasta `extension/`.

Estados do cartão:

- **Não instalada, Chrome ou Edge no computador:** o que ela faz em duas frases, botão "Instalar a extensão" (abre a loja em nova aba) e "Já instalei" (refaz o `ping`).
- **Instalada:** "Extensão instalada" e os três passos de uso (abrir o curso logado, clicar no ícone, revisar aqui).
- **Navegador sem suporte** (Firefox, Safari, celular) **ou aplicativo de desktop** (Electron não roda a extensão): diga que ela funciona no Chrome e no Edge do computador e mantenha o caminho de colar a grade.
- **Versão antiga instalada** (abaixo da mínima): peça para atualizar.

Texto em português do Brasil, voz direta, sem prometer rastreamento que a plataforma não tem: use as capacidades do provedor (`readsCompletion`, `requiresLogin`).

### 6.3 Popup

Refaça `extension/popup.html` e `extension/popup.js` com os tokens de `src/styles/00-tokens.css` (os valores atuais do popup já vêm de lá; confira se continuam iguais) e as fontes de `extension/fonts/`. Largura de 360 px.

Nesta fase o popup tem:

- Cabeçalho com a estrela e "Lume".
- Estado da conta: "Entre no Lume" com botão que abre o site, ou o nome da pessoa (só depois da Fase 3; até lá, omita).
- Ação principal conforme a aba ativa: em página de plataforma conhecida, "Ler este curso"; fora, um texto curto explicando onde usar.
- "Concluí esta aula" continua existindo até a Fase 3 substituí-lo.
- Área de status com `role="status"`.
- Linha de privacidade curta, coerente com o que a extensão faz **nesta** fase.
- O seletor de destino (`data-dev`) continua só no pacote de desenvolvimento; `scripts/package-extension.mjs` precisa continuar removendo-o e falhando se sobrar `localhost`.

### 6.4 Verificação da Fase 1

- Unitário para `public/extension-domain.js` (inclua o arquivo no script `test` de `package.json`).
- E2E em `tests/e2e/capture.spec.js`: cartão em cada estado (simule `hello` com `postMessage`, como os testes atuais simulam a leitura) e tela de erro sem menção à pasta `extension/`.
- `npm run extension:build`, `npm test`, `npm run build`, `npm run test:e2e`.
- Abra o popup num Chrome real e confira o visual; capture a tela para o PR.

## 7. Fase 2 — permissão por plataforma, observador de vídeo e selo

### 7.1 Manifesto

- `optional_host_permissions`: gere a lista a partir de `PROVIDERS[].hosts` (e `playerHosts`, se a verificação 0.2 exigir), no formato `https://*.dominio/*`. A lista do manifesto não pode divergir do registro: estenda `tests/unit/extension-build.test.js` para falhar se divergir, ou gere o manifesto no `scripts/build-extension.mjs`.
- Acrescente a permissão `alarms` se o service worker precisar de batimento próprio (ver 7.3).
- Suba a versão para `0.3.0`. A descrição continua com no máximo 132 caracteres e precisa deixar de dizer "não lê vídeo" (ela passa a observar se o vídeo toca; continua sem ler o conteúdo).

### 7.2 Ligar e desligar plataformas

No popup, uma lista de plataformas do registro com interruptor. Ligar chama `chrome.permissions.request({ origins })` (precisa partir de um clique) e, concedida, registra o content script com `chrome.scripting.registerContentScripts` para aquelas origens. Desligar remove o registro e chama `chrome.permissions.remove`. Reaja a `chrome.permissions.onRemoved` (a pessoa pode revogar pelo Chrome). Na página de uma plataforma ainda desligada, o popup oferece "Acompanhar aulas em <plataforma>".

### 7.3 Observador (`extension/src/watch.js` → `extension/watch.js`)

Mesmo esquema do leitor: fonte ESM em `extension/src/`, gerado por `npm run extension:build`, versionado e conferido pelo teste de build. A lógica pura (acúmulo de tempo tocado, decisão de critério) fica em `public/watch-domain.js`, importada pelo content script **e** pelo servidor; não duplique regra.

O observador:

- Encontra o `<video>` principal (o maior visível com duração conhecida; reavalie quando o DOM mudar, porque as plataformas trocam o elemento ao mudar de aula sem recarregar a página). Observe também mudanças de endereço (`history.pushState`).
- Escuta `play`, `playing`, `pause`, `waiting`, `ended`, `ratechange`, `seeking` e usa `video.played` (intervalos realmente tocados) para medir cobertura. Como `played` zera quando a fonte é trocada, acumule a união dos intervalos por vídeo.
- Trata como **pausado**: vídeo pausado ou travado em carregamento, e vídeo sem som tocando em aba oculta por mais de 5 minutos (mesma ideia de `READING_IDLE_MS` do leitor de PDF). Não trate aba oculta com som como pausa: muita gente só ouve a aula.
- Envia ao service worker eventos pequenos: `{ pageUrl, videoKey, state: 'playing' | 'paused' | 'ended', duration, coveredSeconds, rate }`, na mudança de estado e a cada 30 s enquanto toca.
- **Não lê nem envia** quadros, áudio, legendas, título de vídeo que não seja da grade, cookies ou tokens.
- Não age em página que não corresponda a uma aula de curso importado: o service worker pergunta ao servidor (rota de resolução, Fase 3) e, sem aula correspondente, o observador fica inerte e não desenha nada.

O service worker (MV3) pode ser encerrado a qualquer momento: guarde o estado por aba em `chrome.storage.session` e não dependa de variável em memória.

### 7.4 Selo na página

Desenhado pelo content script dentro de um **Shadow DOM fechado**, para não herdar nem vazar CSS da plataforma. Canto inferior direito, recolhível (lembra o estado em `chrome.storage.local`), arrastável não é necessário.

- Estados: contando (tempo da sessão em `--font-mono`), pausado, "entre no Lume para contar o tempo", aula concluída.
- Conteúdo: estrela, tempo, "Aula 12 de 40", barra fina de progresso do curso, botão de recolher.
- Sem animação chamativa; o selo não pode cobrir os controles do player (se colidir, suba-o).
- Cores e fontes: os mesmos tokens do popup. As fontes vêm de `extension/fonts/` como `web_accessible_resources`, restritas às origens autorizadas.

### 7.5 Verificação da Fase 2

- Unitários de `public/watch-domain.js`: união de intervalos, arrastar a barra não aumenta a cobertura, velocidade 2x, troca de vídeo na mesma página, limiar de 90%.
- E2E: página de exemplo em `tests/fixtures/` com um `<video>` curto de verdade (gere um arquivo mínimo e sem som; não use material de terceiros), injetando `extension/watch.js` com `chrome.runtime` simulado, no padrão que `capture.spec.js` já usa para o leitor. Verifique eventos de tocar, pausar, arrastar e terminar, e o selo em cada estado.
- No celular não há extensão: não marque esses testes com `@celular`.

## 8. Fase 3 — servidor: sessão de vídeo e conclusão automática

### 8.1 Regra de origem para a extensão

- `api/config.js`: variável `EXTENSION_ORIGINS` (mesmo nome no Node e no Worker), lista de origens `chrome-extension://<id>`. Padrão de produção: `chrome-extension://lcjchobdkejffabkoclbdpalbbkelcic`. No servidor local (`isLocalHost`), aceite qualquer `chrome-extension://`, porque o id da extensão sem compactação varia por máquina.
- `api/app.js`: nova opção de rota `origin: 'extension'`, que aceita a mesma origem **ou** uma origem da lista. As rotas existentes continuam com `origin: true`; **não** afrouxe `sameOrigin`.
- Só as rotas `/api/extension/*` abaixo usam a opção nova. A extensão não ganha acesso a `/api/library/actions` nem a nenhuma outra rota.

### 8.2 Rotas (`api/routes/extension.js`, regras em `api/domain/watch.js`)

Todas exigem conta (`auth`) e têm `rateLimit` próprio por conta.

- `GET /api/extension/status` → `{ signedIn, name, minVersion }`. Sem conta, responde 401 com `code` estável; o popup e o selo mostram "Entre no Lume".
- `GET /api/extension/lesson?url=` → resolve a página para uma aula usando `findLessonByUrl` sobre o estado da conta e devolve `{ courseId, stepId, courseTitle, lessonTitle, externalId, provider, stats }`, com `stats` vindo da função da Fase 4. Sem correspondência, `{ found: false }`. O endereço da página é dado sensível: não o registre em log.
- `POST /api/extension/watch` → recebe o evento do observador (`courseId`, `stepId`, `videoKey`, `state`, `duration`, `coveredSeconds`, `platformDone`, `eventId`) e devolve `{ session, lesson: { completed }, stats }`.

`watch.js` monta as operações e chama `applyLibraryActions` internamente, lendo a revisão atual e **repetindo uma vez** em `library_conflict` (é gravação de fundo: adota o estado do servidor, como `act(..., { background: true })` faz no cliente). O `eventId` do evento vira o `id` da operação, para a repetição ser idempotente.

### 8.3 Sessão de estudo

- `public/session-domain.js`: acrescente `'watching'` a `SESSION_ORIGINS` e reutilize `startSession`, `pauseSession`, `resumeSession`, `touchSession` e `endSession`. Não crie outro modelo de sessão.
- `playing` inicia ou retoma a sessão `watching` daquela aula; `paused` pausa; `ended` ou troca de aula encerra (vai para `studySessions` e o XP de tempo sai pelo caminho existente em `library-time.js`, sem regra nova).
- **Sessão de outra origem em andamento** (timer do cabeçalho, leitura de PDF): não a substitua nem crie uma segunda. O vídeo só alimenta a evidência de conclusão (8.4); o tempo continua sendo o da sessão que a pessoa iniciou.
- **Batimento:** hoje `App.jsx` mantém o batimento de qualquer sessão ativa. Para `origin: 'watching'` quem bate é a extensão; a aba do Lume **não** pode manter viva uma sessão de vídeo, senão fechar a aba da aula deixaria o tempo correndo. Sem batimento por 5 minutos, `closeStaleSession` encerra com o acumulado, como já faz.
- A sessão `watching` aparece em "Estudando agora" pelo mesmo critério das outras (`isSessionLive`); respeite as preferências de privacidade existentes.

### 8.4 Evidência e conclusão

- Migração nova (o próximo número livre; `0026_profile_pins.sql` já existe no diretório de trabalho, então confira antes e não edite migração existente). Tabela `watch_progress`: `user_id`, `material_id`, `unit_id`, `video_key`, `duration_seconds`, `covered_seconds`, `playing_seconds` (relógio do servidor entre eventos `playing`), `updated_at`, `completed_at`. Chave por conta, aula e vídeo.
- O servidor não confia cegamente no número da extensão: `covered_seconds` aceito nunca passa de `playing_seconds × 2 + tolerância` (2x é a velocidade máxima considerada) nem da duração. O horário é sempre o do servidor.
- **Plataforma sem leitor próprio:** conclui quando a cobertura aceita chega a 90% da duração (`WATCH_COMPLETION_RATIO` em `public/watch-domain.js`; não espalhe o número).
- **Plataforma com leitor de aula (Gran):** acrescente ao provedor um leitor `readers.lesson(ctx)` que, na página da aula, consulta só com `GET` a mesma rota de vídeos que `readers.page` já usa e diz se **todos** os vídeos daquela aula (`externalId` = `<disciplina>/<aula>`) estão `visualizado === true`. O observador consulta ao terminar um vídeo e envia `platformDone`. Para valer, a extensão precisa ter visto a aula como **não concluída** nesta mesma sessão e depois como concluída: aula que já estava assistida antes não gera conclusão aqui (isso continua sendo papel da reimportação, que registra histórico sem XP).
- Concluir = evento de progresso `origin: 'integration'`, pelo mesmo caminho de `recordCompletion`, no mesmo batch em que a sessão é atualizada. XP, bônus de curso e de disciplina saem pelas regras existentes (`rewards.js`); não crie evento de XP novo nem altere `public/xp-policy.js`.
- Repetição não duplica: aula já concluída responde `completed: true` sem novo evento.

### 8.5 No Lume

- `HeaderTimer.jsx`: mostre a sessão `watching` (rótulo "Assistindo — <aula>"), sem botões de iniciar e pausar, porque quem controla é o vídeo. Encerrar manualmente continua possível.
- `useLibraryPersistence` já adota a revisão nova ao voltar o foco e a cada minuto; não crie outro mecanismo de sincronização.
- `StudyDialog.jsx:239-241`: com a extensão instalada e a plataforma ligada, troque os textos que dizem que o Lume não observa o vídeo. Sem extensão, mantenha-os e ofereça o cartão da Fase 1.
- Preferência nova em `public/settings-domain.js` e em Configurações › Ritmo de estudo: "Acompanhar aulas pela extensão" (ligada por padrão). Desligada, as rotas de `watch` respondem sem gravar.
- O botão "Concluí esta aula" do popup e o tipo `complete` de `listenForExtension` continuam como reserva para plataformas em que o vídeo não é detectado.

### 8.6 Verificação da Fase 3

- Unitários com `applyMigrations` e `sqliteAdapter`: iniciar, pausar, retomar e encerrar; teto de cobertura pelo relógio; conclusão aos 90%; `platformDone` sem ter visto "não concluída" não conclui; repetição idempotente; conflito de revisão; sessão de foco em andamento não é substituída; preferência desligada; XP concedido uma única vez.
- Regra de origem: `chrome-extension://` fora da lista recebe 403; da lista, passa; rotas antigas continuam recusando.
- `tests/contract/scenario.js`: acrescente o roteiro das três rotas, para rodar igual no Node e no Worker.
- Inclua cada teste novo no script `test` de `package.json`.

## 9. Fase 4 — números do curso e estimativa

Função pura nova (em `public/study-plan.js` ou num módulo `public/course-stats-domain.js`), usada pelo servidor (rota `lesson`), pela tela do curso e pelo popup:

`courseStats(state, courseId, now)` devolve:

- aulas: total, concluídas, restantes;
- seções: total e concluídas, por módulo e por disciplina (uma seção está concluída quando todas as aulas selecionadas dela estão; leia por `materialStructure`, não grave nada no material);
- minutos restantes conhecidos e quantas aulas restantes não têm duração (para estas, use a média das durações conhecidas do curso; sem nenhuma, `sessionMinutes`), sempre rotulado como estimativa;
- ritmo: média de minutos por dia nos últimos 14 dias, só de sessões **deste curso** (`studySessions` com `courseId`, mais a sessão ativa);
- término estimado e a base usada: `'pace'` quando houver pelo menos 3 dias com estudo e 60 minutos no período; senão `'plan'`, com a data que `public/schedule-domain.js` já calcula; senão `null`, e a interface mostra só as horas restantes.

Os limiares (14 dias, 3 dias, 60 minutos) são proposta deste plano, não decisão da responsável: deixe-os como constantes nomeadas e cite-os na entrega.

Onde aparece: tela do curso no Lume, popup e selo (o selo mostra só "Aula X de Y" e a barra). Textos: "Faltam 28 aulas · cerca de 14 h", "No seu ritmo, você termina por volta de 12 de dezembro". Nunca apresente a estimativa como prazo nem como cobrança, e não descreva tempo assistido como prova de aprendizado.

Verificação: unitários cobrindo curso sem durações, sem histórico, com histórico curto, com plano e com tudo concluído; e2e da tela do curso.

## 10. Fase 5 — Udemy, testes reais e textos

### 10.1 Udemy

`public/providers/udemy.js` não tem leitor próprio. Com a responsável logada num curso dela, observe quais pedidos `GET` a própria página faz para montar a grade e o progresso, e escreva `readers.page` (e `readers.lesson`, se a plataforma expuser a marca de aula concluída) no mesmo molde de `grancursos.js`: só `GET`, mesma origem, sem ler cookie. **Não escreva o leitor de memória nem a partir de documentação de terceiros**; o formato tem de ser conferido na página real e a data registrada no cabeçalho do arquivo. Se a Udemy não expuser a marca por aula, ela fica no critério de 90% de tempo tocado, e isso deve constar nas capacidades do provedor.

### 10.2 Roteiro de teste real (Gran e Udemy)

Extensão carregada sem compactação num Chrome real, apontando para o Lume **local** (não use produção para o teste). A responsável faz o login nas plataformas; o agente não digita senha.

1. Ligar a plataforma no popup e ver o pedido de permissão do Chrome.
2. Ler o curso e importar pela revisão.
3. No Lume, "Continuar" abre a aula certa.
4. Tocar o vídeo: selo contando; timer do cabeçalho do Lume mostra a mesma sessão.
5. Pausar: os dois pausam em até poucos segundos.
6. Arrastar a barra até o fim: a aula **não** conclui.
7. Assistir até o critério: a aula conclui sozinha, o XP aparece uma vez e os números do curso avançam.
8. Passar para a próxima aula sem recarregar a página: a sessão troca de aula.
9. Fechar a aba da aula com o vídeo tocando: a sessão encerra sozinha em até 5 minutos.
10. Repetir os passos 4 a 7 com o Lume fechado.
11. Sair da conta do Lume: o selo pede login e nada é gravado.
12. Desligar a plataforma no popup: o selo some e nenhum pedido é feito.

Registre o resultado de cada passo, por plataforma, em `docs/IMPLEMENTACAO.md`. O que falhar e não for corrigido entra como pendência, não como concluído.

### 10.3 Textos e documentação

Atualize junto com o código, não depois:

- `docs/REGRAS_DE_NEGOCIO.md`: §11 (extensão acompanha vídeo, permissão por plataforma, critério de conclusão, exceção à regra de confirmação), origem `'watching'` nas sessões e a observação de que conclusão `integration` não pode ser desfeita.
- `docs/IMPLEMENTACAO.md`: o que foi entregue, o que foi verificado com conta real e o que ficou só com páginas de exemplo.
- `AGENTS.md`: o parágrafo "Extensão do navegador" (novo content script, rotas `/api/extension/*`, `EXTENSION_ORIGINS`).
- `extension/LEIAME.md` e `public/privacidade-extensao.html`: hoje prometem "só age quando você clica" e "não lê vídeo". Passam a dizer exatamente o que é observado (se o vídeo toca, pausa ou termina, a posição e a duração), em quais sites (só os que a pessoa ligar), o que é enviado e para onde, e o que continua fora (conteúdo do vídeo, áudio, senha, cookie).
- Rascunho da justificativa de permissões para a revisão da loja, num arquivo `extension/LOJA.md` (o empacotador já o ignora). Enviar à loja é da responsável.
- Apague este arquivo ao concluir.

## 11. Pontos em aberto para a responsável

Não decida sozinho; pergunte quando chegar ao ponto.

1. **Desfazer conclusão automática.** Hoje só conclusão manual pode ser desfeita. Uma aula concluída pelo vídeo ficaria sem "desfazer". Manter assim ou permitir desfazer também as de origem `integration` vindas do vídeo?
2. **Cookie da extensão (verificação 0.1).** Se o Chrome não enviar o cookie, a alternativa guarda um token na extensão.
3. **Preferência ligada por padrão.** Este plano propõe "Acompanhar aulas pela extensão" ligada; confirme.
4. **Limiares da estimativa** (14 dias, 3 dias com estudo, 60 minutos).
5. **Player em outro domínio** (verificação 0.2): autorizar o domínio do player aumenta o pedido de permissão que a pessoa vê.

## 12. Limites que a entrega deve declarar

- Fora do Gran, o tempo tocado é informado pela extensão. O servidor limita pelo relógio, mas não tem como saber se a pessoa estava assistindo. Vídeo deixado rodando conclui a aula.
- No Gran, quem atesta a conclusão é a plataforma; o Lume só repete a marca.
- Plataformas além de Gran e Udemy usam a detecção genérica de vídeo e não foram vistas com conta real.
- A extensão funciona no Chrome e no Edge do computador. Não funciona no celular nem dentro do aplicativo de desktop.
- A mudança de permissões exige nova revisão na Chrome Web Store; até a versão nova ser aprovada, quem instalar pela loja recebe a versão antiga, sem acompanhamento de vídeo. A tela de instalação precisa lidar com isso pela versão mínima (6.1).
