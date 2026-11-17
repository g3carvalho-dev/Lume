# Lume — Estado Atual e Pendências de Implementação

Atualizado em 16/11/2026. Este documento consolida **o que já existe e foi verificado** no código e **o que ainda falta implementar ou validar em produção**. Para as regras de domínio e de produto, consulte [Regras de Negócio Consolidadas](REGRAS_DE_NEGOCIO.md).

---

## 1. O que já está implementado e verificado localmente

| Área | Situação atual | Principais módulos |
| --- | --- | --- |
| **Contas e sessão** | Cadastro, login, saída, cookie `HttpOnly` (`SameSite=Strict`), limite de tentativas e recuperação de senha via Resend (`api/domain/email.js`) | `api/domain/auth.js`, `src/features/account/Auth.jsx` |
| **Onboarding v2** | Três jornadas retomáveis, escolha de meta diária, ambiente sonoro (`off`, `rain`, `pink`, `white`), primeiro material ou PDF e convite de amigos | `src/features/account/Onboarding.jsx`, `public/domain.js` |
| **Persistência da Biblioteca v3** | Leitura em `GET /api/library` e gravação transacional por entidade em `POST /api/library/actions` com revisão otimista e idempotência (`0012_library.sql`) | `api/domain/library-store.js`, `api/domain/library-actions.js`, `src/features/library/useLibraryPersistence.js` |
| **Materiais, PDFs, Slides e Disciplinas** | Cursos, livros, provas, projetos, slides com cobertura mínima de 80%, disciplinas (`study_subjects`) e PDFs com upload para R2/`data/media` e leitor `pdf.js` embutido (`0015_subjects_pdf.sql`); imagens e PDFs novos são otimizados no navegador, com rasterização opcional de digitalizações | `public/material-model.js`, `public/pdf-domain.js`, `public/compression-domain.js`, `src/lib/image-compress.js`, `src/features/library/pdf-compress.js`, `public/subject-domain.js`, `public/slides-domain.js` |
| **Armazenamento e otimização retroativa** | Tela de armazenamento com uso por origem, exclusão de anexos e “Otimizar” para PDFs da Biblioteca, anexos do Social, avatar, capa e imagens de slides existentes; substituição no R2 com cota e tamanho atualizados; imagens recomprimidas sob demanda e digitalizações só com confirmação | `src/features/settings/StoragePanel.jsx`, `api/domain/library-files.js` (`replacePdf`), `api/domain/social-feed.js` (`replaceSocialAttachment`), `api/domain/media.js`, `api/routes/library.js`, `api/routes/storage.js`, `api/routes/media.js` |
| **Importação e Extensão MV3** | Importação por link público, texto, página copiada ou captura da extensão (`extension/`); reimportação preserva IDs (`adoptExistingIds`); leitores de grade e de conclusão do Gran e da Udemy, sessão de vídeo e miniplayer opcional | `public/import-domain.js`, `public/providers/`, `api/domain/import-server.js`, `extension/` |
| **Início (`#hoje`) e Próxima Ação** | Próxima ação unificada (`nextAction`/`studyPlan`), tarefa em foco (`focusTaskId`), "Continuar" que abre o conteúdo direto (PDF na página em que parou; aula importada na plataforma, com o registro da aula), próximo marco só de Prova e Entrega e ritmo da semana | `src/features/library/Today.jsx`, `public/home-domain.js`, `public/study-plan.js` |
| **Timer do cabeçalho e leitura de PDF** | Timer discreto no cabeçalho (parado, em andamento, pausado) com ciclo, som ambiente Web Audio e material vinculado, desligável em Configurações › Ritmo de estudo (`focusTimer`); no celular, botão flutuante só com sessão em andamento e início pelo menu da conta. `#foco` abre o Início. O leitor de PDF registra tempo automaticamente com indicador visível, pausa após 5 minutos de inatividade, escolha quando há sessão pausada e preferência para desligar | `src/features/progress/HeaderTimer.jsx`, `src/features/progress/timer.css`, `src/features/library/useReadingSession.js`, `src/features/library/PdfReader.jsx`, `public/session-domain.js` |
| **Plano de Estudos: Tarefas e Calendário** | Abas Tarefas (padrão, `#plano`) e Calendário; cronograma derivado (`schedule-domain.js`) mostrado como aulas previstas na grade mensal do FullCalendar 7 (`Agenda.jsx`), com detalhe do dia (adiar, conflito de prazo) e atalho de disponibilidade no estado vazio; recorrência até 52 ocorrências, lembretes únicos (`agenda_reminders`) e tarefas com subtarefas | `src/features/plan/`, `src/features/agenda/`, `public/schedule-domain.js`, `public/agenda-domain.js`, `public/tasks-domain.js` |
| **XP v2, Níveis, Conquistas e Cargos** | Livro `xp_events` validado no servidor, bônus de curso (300 XP) e disciplina (200 XP), blocos de tempo (30 XP / 25 min, teto 120/dia), subtarefas (10 XP, teto 50/dia) e cargos como títulos | `public/xp-policy.js`, `api/domain/xp.js`, `api/domain/rewards.js`, `api/domain/library-time.js`, `api/domain/library-subtasks.js` |
| **Social: Amigos, Mensagens e Ranking** | Quatro abas com a mesma moldura e cartão rápido da pessoa (16/11/2026); aba Amigos com a lista primeiro e "Encontrar pessoas"; convites de 7 dias; perfil em duas colunas (abas Atividade e Publicações, lateral Nível, Conquistas e Amigos), publicação fixada e privacidade por seção conferida no servidor (16/11/2026); Mensagens em três regiões (lista com busca e filtro, conversa, detalhes com gestão de grupo), responder citando, reações, GIF e silenciar em conversas privadas e grupos; bloqueio; ranking em 3 abas. A colaboração em projetos foi aposentada (servidor sem uso) | `api/domain/friends.js`, `api/domain/messages.js`, `api/domain/message-extras.js`, `api/domain/groups.js`, `src/features/social/` |
| **Tela Social e feed entre amigos** | Substitui a entrada Amigos, preservando `#amigos`; publicações, PDFs/imagens privados, conquistas validadas, comentários, reações, exclusão e "Estudando agora" na lateral. Persistência em `0016_social_feed.sql`, sem XP social | `src/features/social/Friends.jsx`, `src/features/social/SocialFeed.jsx`, `src/features/social/friends.css`, `public/social-domain.js`, `api/domain/social-feed.js`, `api/routes/social-feed.js` |
| **Conforto Visual e Aparência** | Identidade Norte com uma só paleta (o campo `palette` fica só nos dados), temas escuro (padrão) e claro, tamanho de texto (`normal`/`large`), densidade e som ambiente | `src/styles/00-tokens.css`, `src/app/Shell.jsx`, `src/app/modals.jsx`, `public/settings-domain.js` |
| **Identidade Norte, etapa 1** | Tokens de cor do Norte, fontes locais (Bricolage Grotesque, Atkinson Hyperlegible Next, JetBrains Mono), estrela como logo e favicon, botões de 12px (primário dourado, secundário com contorno, terciário em texto), cabeçalho e barra inferior, Início com constelação do módulo, contagem regressiva das entregas e semana em pontos | `src/styles/00-tokens.css`, `src/styles/80-redesign-moderno.css`, `src/app/shell.css`, `src/ui/ui.jsx`, `src/features/library/Today.jsx`, `src/features/library/today.css`, `public/home-domain.js` |
| **Identidade Norte, etapa 2** | Biblioteca, Disciplinas, Plano, Calendário, Tarefas e Agendar: filtros em abas de 10px, números e datas em mono, prioridade por intensidade, cores de disciplina próprias e textos diretos (a Sessão de foco e a aba Agenda foram aposentadas em 15/11/2026) | `src/features/library/shelf.css`, `src/features/library/library.css`, `src/features/plan/schedule.css`, `src/features/plan/tasks.css`, `src/features/agenda/agenda.css`, `src/features/agenda/schedule-session.css` |
| **Identidade Norte, etapa 3** | Social, Mensagens, Ranking, Perfil, Conquistas, Configurações e Onboarding com textos diretos, linha própria do ranking e conquistas em dourado, bolha própria em azul-claro, capas sem foto (constelação), e-mail de recuperação e ícones do desktop (app e bandeja) com a estrela | `src/features/social/`, `src/features/settings/`, `src/features/account/Onboarding.jsx`, `src/ui/ui.jsx` (`Cover`), `api/domain/email.js`, `companion/build/icon.png`, `companion/assets/tray-*.png`, `companion/electron/` |
| **Backup e Mesclagem v3** | Exportação JSON v3 e restauração/mesclagem explícita com prévia | `public/backup-domain.js`, `public/merge-domain.js` |
| **Aplicativo de Desktop (`companion/`)** | Janela Electron completa, bandeja, lembretes minimizados, pareamento por código, presença opcional por allowlist, Rich Presence no Discord e atualizador | `companion/` |

**Social publicado e verificado em produção (13/11/2026):** migração `0016_social_feed.sql` aplicada no D1 e nenhuma migração pendente. Versão `05cb8a69-7598-4560-b4c8-d0f676acc0d2` em `lumeacademy.site`, preparada em cópia isolada para preservar as alterações paralelas do Início. Conferidos o CSS publicado, a navegação Social, publicações, comentários, reação idempotente, PDF e PNG no R2, acesso entre amigos e revogação após remover a amizade, sem XP social. O teste autorizado utilizou duas contas temporárias e removeu contas, publicações e anexos ao terminar. Conquistas foram verificadas localmente; não se criaram recompensas artificiais em produção.

---

**Extensão, verificação local em 16/11/2026.** A versão descompactada 0.3.0 foi carregada no Chrome 157. Com uma conta descartável e todas as abas do Lume fechadas, o service worker obteve `authenticated: true` em `GET /api/me` usando `credentials: include` em localhost:4321. O aplicativo manteve o cookie HttpOnly e SameSite=Strict. Na aula real da Udemy, o vídeo fica no documento principal e a página consulta o currículo e os IDs das aulas concluídas por GET na mesma origem. No Gran, a página de videoaula expôs o reprodutor HTML5 no documento principal. A verificação dos players é distinta do teste de acompanhamento completo.

### Extensão 0.3.0 — roteiro em contas reais

Extensão descompactada no Chrome do computador com destino em localhost:4173 e banco de teste separado. O popup mostrou a conta local. Os dois players ficam no documento principal. Ao tentar abrir as aulas autenticadas em um quadro de outro site local, ambos recusaram a incorporação. **Miniplayer nesta página** mantém o player no canto ao rolar a plataforma. **Assistir sobre o Lume** usa a janela flutuante nativa quando o player permite. Ambos os modos têm teste com o vídeo de exemplo no Chrome.

| Passo no Chrome com conta real | Gran | Udemy |
| --- | --- | --- |
| 1. Ligar o domínio e aceitar o pedido | Pendente | Pendente |
| 2. Ler e confirmar a importação | 427 aulas, 31 disciplinas | 70 aulas, grade lida pela API |
| 3. Continuar abre a aula correta | Aula 3, Plano de Estudos com Rodrigo Lima | Introdução, aula 46219471 |
| 4. Tocar e conferir selo e timer | Pendente | Pendente |
| 5. Pausar e conferir os dois | Pendente | Pendente |
| 6. Avançar pela barra sem concluir | Pendente | Pendente |
| 7. Concluir durante a reprodução e conferir o XP único | Pendente | Pendente |
| 8. Mudar de aula sem recarregar | Pendente | Pendente |
| 9. Fechar a aba durante a reprodução | Pendente | Pendente |
| 10. Repetir com o Lume fechado | Cookie verificado, reprodução pendente | Cookie verificado, reprodução pendente |
| 11. Sair da conta e conferir o selo | Pendente | Pendente |
| 12. Revogar a plataforma | Pendente | Pendente |

Em Chrome 157, o GET da extensão chegou sem Origin. A versão local utiliza POST para as consultas de conta e de aula, com a mesma validação de origem. A API preserva os GET previstos. O vídeo original de teste exercita a reprodução, a pausa, o salto pela barra, o fim e a navegação em página de exemplo. Os testes da API cobrem XP e preferência desligada. As demais plataformas seguem sem verificação com conta real. A versão com as novas permissões ainda precisa ser submetida à revisão da loja. [Popup da versão descompactada no Chrome de teste](extensao-popup.png).

A suíte de domínio e contratos passou em Node e workerd locais. Os testes da extensão no navegador passaram, incluindo os dois modos do miniplayer, a restauração do player e a estimativa na tela do curso. Na suíte geral, dois testes preexistentes de navegação (Plano e jornada de onboarding) procuram o nome acessível “Plano de Estudos”, enquanto o link da barra anuncia “Plano”.

**Player no desktop.** O teste nativo `node scripts/test-player-desktop.mjs` reproduz um vídeo de exemplo na área de aula e volta ao Lume para os formatos de link do Gran e da Udemy. No Gran autenticado, a responsável confirmou vídeo com som. O player original, com a barra de controles, ocupou toda a área de aula (1240 × 732 na janela de teste). Na Udemy, a reprodução protegida no Electron ainda precisa de verificação em conta real.

## 2. O que falta verificar em produção (`lumeacademy.site`)

1. **Arquivos da biblioteca e mídia de perfil:**
   - Validar os fluxos reais de avatares, capas, imagens de slides e PDFs da biblioteca no bucket R2 `lume-media` (`env.MEDIA`), bem como o `Content-Type` JavaScript para o worker `pdf.worker.*.mjs`. A verificação de anexos do Social em produção não substitui a conferência dessas rotas próprias.
   - Conferir em produção a compressão de imagens e PDFs novos, inclusive a rasterização de digitalizações: entrada de até 30 MB, resultado dentro da cota de 10 MB, leitura correta e nenhum XP gerado.
   - Conferir a otimização retroativa pelo Armazenamento: substituição de PDF da Biblioteca e de anexo do Social no R2, tamanho e cota atualizados, leitura do PDF preservada e nenhum XP gerado.
   - Conferir a otimização de avatar, capa e imagens de slides existentes: URL atualizada no perfil/apresentação, imagem anterior removida do R2 e layout preservado.
   - Conferir o registro automático ao abrir PDF: indicador de tempo, pausa após 5 minutos sem interação, escolha diante de sessão pausada e blocos de 25 minutos no servidor.
2. **Entrega real de e-mail transacional (Resend):**
   - Confirmar a verificação do domínio `lumeacademy.site` no painel do Resend e testar o recebimento real do e-mail de recuperação de senha em produção.
3. **Orçamento de CPU do Cloudflare Workers Free (`BCRYPT_ROUNDS=6`):**
   - Medir cadastro, login e redefinição de senha no Worker publicado (incluindo partidas frias) para confirmar ausência de erros `exceededCpu`.
4. **Perfil e privacidade por seção (16/11/2026):**
   - Aplicar a migração `0026_profile_pins.sql` no D1 remoto antes de publicar e conferir, com contas reais, o perfil visto pela dona, por uma amiga, por uma conta sem vínculo e com bloqueio, inclusive anexos de publicação visível a Todos.

---

## 3. O que falta implementar (Backlog de Produto)

1. **Gestão completa da conta e privacidade (LGPD):**
   - Alteração de senha e de e-mail com a sessão aberta (encerrando outras sessões ativas).
   - Listagem e revogação remota de sessões ativas.
   - Página de Termos de Uso, Política de Privacidade geral e botão de exclusão definitiva da conta (apagando ou anonimizando dados, mensagens, amizades e arquivos R2).
2. **Extensão do navegador em plataformas adicionais e cursos grandes:**
   - Testar a extensão MV3 carregada no Chrome real com contas reais além do Gran (Estratégia, Alura, Coursera, Rocketseat, DIO, Hotmart) e criar leitores dedicados conforme necessário.
   - Ampliar ou paginar o limite atual de 600 unidades por operação na importação para suportar cursos preparatórios extensos.
3. **Escolha de conquistas em destaque no perfil:**
   - Permitir selecionar quais conquistas aparecem em destaque na vitrine do perfil social (hoje o bloco Conquistas e o bloco de nível mostram as desbloqueadas mais recentes).
   - Anexar a uma publicação um cartão de material da biblioteca (título, tipo e progresso, sem o arquivo): exige coluna nova em `social_posts`, leitura do material e do progresso no servidor ao publicar, seletor no compositor e cartão no Feed e no perfil.
4. **Segurança social e reconhecimento entre amigos:**
   - Mecanismo de denúncia de abuso em mensagens diretas.
   - Imagem em mensagens (privadas e grupos): decidido que entra na cota unificada, mas falta definir como liberar o espaço, já que mensagens não são apagadas e apagar um grupo deixaria o arquivo órfão.
   - Reações a conquistas compartilhadas já existem no feed Social; não há reações diretamente na vitrine do perfil.
5. **Assinatura de código do instalador Windows (`companion/`):**
   - Configurar certificado (`CSC_LINK` e `CSC_KEY_PASSWORD`) no GitHub Actions para evitar o aviso do Windows SmartScreen no `Lume-setup.exe`.
