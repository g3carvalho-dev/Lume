# Proposta: moderação de denúncias

Estado: **proposta para aprovação** (15/11/2026). Nada aqui está implementado. A execução começa depois da reestruturação do Social, porque a seleção de mensagens mexe na tela de Mensagens que está sendo refeita. Depois de executada, as decisões entram em [Regras de Negócio §10](REGRAS_DE_NEGOCIO.md) e este arquivo é removido.

## Problema

A tela `#denuncias` hoje mostra só o nome das duas pessoas, uma cópia curta de mensagens (em grupo, só as da pessoa denunciada, sem as falas em volta) e duas saídas que dão no mesmo: "analisada" e "arquivar". Não há o que fazer com uma denúncia.

## Decisões da responsável

1. **Acesso:** só a conta criadora (`LUME_CREATOR_EMAIL`), como hoje. A tela aparece no menu da conta só para ela.
2. **Contexto:** quem denuncia marca uma ou várias mensagens; o sistema copia também as mensagens em volta, de todas as pessoas da conversa, no momento da denúncia. A administradora vê só essa cópia, nunca a conversa inteira.
3. **O que pode ser denunciado:** conversa privada, mensagem em grupo e publicação (já existem); mais comentário do feed, perfil e um grupo inteiro.
4. **Medidas:** advertência, remoção do conteúdo, suspensão por período e banimento.
5. **Suspensão bloqueia só o social.** A pessoa continua estudando; não publica, não comenta, não reage, não envia mensagens e não aparece no ranking enquanto durar.
6. **Banimento bloqueia a entrada e preserva os dados.** Sessões abertas caem, o mesmo e-mail não recadastra, a pessoa some do social dos outros. A administradora pode reverter.
7. **Encerramento:** "resolvida", que exige registrar a providência, ou "improcedente", com nota opcional.
8. **Retorno a quem denunciou:** aviso genérico no sino de que a denúncia foi analisada, sem dizer a medida.
9. **Contestação:** uma por medida. A pessoa escreve sua versão uma vez; a administradora mantém ou reverte.
10. **Visibilidade:** conteúdo removido vira "removido pela moderação". Suspensão e banimento não são anunciados a ninguém.
11. **O que a administradora vê de cada pessoa:** id, @usuário, link do perfil, data de cadastro, última atividade e histórico de moderação. **E-mail não é exibido.**

Continua valendo: quem denuncia nunca é revelada à pessoa denunciada.

## Tela de moderação

- **Fila:** denúncias abertas primeiro, com filtro por situação (abertas, resolvidas, improcedentes) e por tipo. Cada linha mostra motivo, tipo, quem foi denunciada, quantas denúncias ela já recebeu e há quanto tempo está aberta. Contestações pendentes aparecem na mesma fila, marcadas.
- **Caso:** ao abrir uma denúncia,
  - as duas pessoas, cada uma com id, @usuário, link do perfil, cadastro e última atividade;
  - o motivo e o texto de quem denunciou;
  - a cópia do contexto, com as mensagens marcadas em destaque e as vizinhas em volta, com autor e hora;
  - o histórico de moderação da pessoa denunciada (denúncias recebidas, medidas, contestações) e, resumido, o de quem denunciou (quantas fez e quantas foram improcedentes);
  - as ações.
- **Ações:** advertir, remover o conteúdo, suspender (1, 7 ou 30 dias), banir, marcar improcedente. Cada medida pede um motivo, que é o texto mostrado à pessoa. Aplicar uma medida encerra a denúncia como resolvida. Suspender e banir pedem confirmação.
- **Pessoa:** uma visão por pessoa reúne o histórico e permite encerrar antes do prazo uma suspensão ou reverter um banimento.

## Para quem usa

- **Denunciar:** em Mensagens, um modo de seleção permite marcar várias mensagens antes de abrir o diálogo; no feed, cada publicação e cada comentário têm a opção; perfil e cartão da pessoa têm "Denunciar perfil"; o painel de detalhes do grupo tem "Denunciar grupo".
- **Quem recebe uma medida:** aviso no sino com a medida, o motivo e o prazo, e o campo de contestação. Durante a suspensão, as telas sociais explicam por que publicar e escrever estão indisponíveis e até quando.
- **Quem é banida:** ao tentar entrar, vê que a conta foi encerrada pela moderação e como contestar. Detalhe a resolver em [Pontos em aberto](#pontos-em-aberto).

## Servidor: o que é novo

Nada disso existe hoje; tudo exige migração nova e rotas restritas à conta criadora.

| Peça | Descrição |
| --- | --- |
| Medidas | Registro por pessoa: tipo, motivo, início, fim, quem aplicou, denúncia de origem, revertida em |
| Contestações | Uma por medida, com texto, data e decisão |
| Remoção de conteúdo | Marca de removido em publicação, comentário, mensagem privada e de grupo; a cópia da denúncia preserva o original |
| Suspensão | Conferida no servidor em publicar, comentar, reagir, enviar mensagem e no ranking |
| Banimento | Conferido na entrada, na validação de sessão e no cadastro |
| Denúncia | Contextos novos (comentário, perfil, grupo), várias mensagens marcadas, cópia do entorno, situação "resolvida"/"improcedente" e nota |
| Avisos | Tipos novos no sino: medida aplicada, denúncia analisada, contestação decidida |
| Registro de ações | Toda ação da administradora fica gravada com data |

Denúncias antigas com situação "analisada" ou "arquivada" são preservadas e exibidas com o rótulo antigo.

## Etapas sugeridas

1. **Servidor: medidas, suspensão, banimento e histórico**, com testes e o roteiro de contrato.
2. **Tela de moderação:** fila, caso, ações e visão por pessoa.
3. **Denunciar com contexto:** seleção de várias mensagens e cópia do entorno; comentário, perfil e grupo.
4. **Avisos e contestação:** sino, telas de quem foi suspensa ou banida, contestação e decisão.
5. **Documentação:** Regras de Negócio §10, `AGENTS.md` e novidade.

## Pontos em aberto

1. **Contestação de quem foi banida.** Ela não consegue entrar, então não vê o sino. Recomendação: a tela de entrada mostra o motivo e um campo de contestação único, ligado à conta, sem abrir sessão.
2. **Tamanho do entorno.** Recomendação: até 10 mensagens antes e 10 depois do trecho marcado, com limite de 20 mensagens marcadas.
3. **Imagem e GIF como prova.** Mensagens vão ganhar imagem e GIF. Recomendação: a cópia guarda a referência ao arquivo, e remover a mensagem não apaga o arquivo enquanto a denúncia estiver aberta.
4. **Ranking durante a suspensão.** Recomendação: a pessoa some das classificações dos outros, mas continua acumulando XP pelo estudo; volta a aparecer ao fim do prazo.
5. **Grupo denunciado.** Recomendação: as medidas possíveis são remover o grupo ou agir sobre quem o criou; não há "suspender grupo".
6. **Denúncias repetidas de má-fé.** Fora desta proposta; o histórico de quem denuncia já permite perceber o padrão.
7. **Prazo de guarda** das cópias de mensagens em denúncias encerradas. Recomendação: decidir antes de sair do alfa; por ora ficam guardadas.
