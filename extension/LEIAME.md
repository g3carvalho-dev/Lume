# Extensão do Lume

No Chrome ou no Edge do computador, abra um curso com a sua conta e escolha **Ler este curso** no ícone do Lume. Revise as aulas e adicione à biblioteca. A primeira importação preserva as conclusões anteriores como histórico. Em leituras seguintes, a revisão permite registrar novas conclusões.

## Acompanhar uma aula

1. Entre no Lume no mesmo perfil do navegador. No popup, em **Acompanhar aulas**, ligue a plataforma e aceite o pedido de acesso do navegador.
2. Abra uma aula importada. O selo do Lume mostra a posição no curso e o tempo da sessão. Pausar o vídeo pausa o tempo. Uma sessão de leitura ou foco já aberta conserva a prioridade.
3. Para consultar a grade enquanto assiste, escolha **Miniplayer nesta página** no selo. O vídeo fica no canto da página. Use **Voltar ao tamanho original** ou Esc para devolvê-lo ao lugar. Se o player oferecer janela flutuante nativa, **Assistir sobre o Lume** mantém o vídeo visível enquanto você usa o Lume em outra aba. Mantenha a aba da plataforma aberta.
4. Desligue a plataforma no popup para remover o acesso. Para desligar o acompanhamento em toda a conta, use **Configurações › Ritmo de estudo**.

No Gran e na Udemy, a extensão consulta as marcas da própria plataforma e aguarda a passagem de pendente para concluída. No Gran é preciso concluir todos os vídeos da aula. Nas demais plataformas reconhecidas, uma aula pode concluir aos 90% dos trechos tocados, com validação pelo relógio do servidor. O avanço pela barra pula trechos. O botão **Concluí esta aula** permite abrir o registro manual quando o player não é reconhecido.

## Instalação e desenvolvimento

Em **Biblioteca › Adicionar curso**, o cartão leva à ficha na Chrome Web Store. O acompanhamento exige a versão 0.3.0 ou posterior. A disponibilização dessa versão depende da revisão da loja. Celular e aplicativo de desktop podem usar a grade colada.

Para testar a versão local, abra `chrome://extensions` ou `edge://extensions`, ative **Modo do desenvolvedor**, escolha **Carregar sem compactação** e selecione a pasta `extension/`. Se ela já estiver carregada, clique em **Recarregar** e recarregue as abas de estudo. Na versão de desenvolvimento, o seletor de destino no popup oferece **Lume local**.

`npm run extension:build` gera o leitor e o observador a partir de `extension/src/`. `npm run extension:package` monta o ZIP de distribuição só com o destino publicado. As permissões são descritas em [LOJA.md](LOJA.md), e a [política de privacidade](../public/privacidade-extensao.html) explica os dados enviados. Os resultados com contas reais e os testes que ainda faltam estão em [Implementação](../docs/IMPLEMENTACAO.md).
