# Verificação final da entrega 8

Código revisado: `7cf5c6343987f501f45f760984dbc2e126adb06e`. Runtime: Node.js 22.23.3 em macOS.

Implementação e documentação: Codex. Revisão: dois agentes Codex independentes do implementador. Não houve revisão humana do código.

- 27 testes passaram no código final; [checkout isolado](evidence/coordenador-clone-limpo.txt).
- [Parecer A](reviews/08-a.json) e [parecer B](reviews/08-b.json), com sondagens independentes, limites e sugestões.
- [Transcrição HTTP real](evidence/coordenador-http.json): 29 etapas verificadas, com requests, respostas e invariantes.
- [Screenshot](evidence/screen.jpg), [resposta expandida](evidence/response.jpg) e [GIF da execução real](evidence/flow.gif).

O GIF foi codificado dos frames de screencast do navegador durante a execução das chamadas locais; não é uma montagem ou simulação. Os dados são fictícios. O portal apenas apresenta respostas da API e compara invariantes. Os limites de persistência, autenticação e operação estão no README. Os testes e capturas não representam deploy ou funcionamento em produção.

![Respostas reais da API](evidence/screen.jpg)

![Gravação do fluxo HTTP](evidence/flow.gif)

## Ajuste após a primeira revisão do Opus

O Opus pediu que peça não exigida pela campanha não bloqueasse também depois da aprovação. A política agora usa exclusivamente `campaign.requiredPieces`. Inclusão e substituição de roteiro, capa ou outra peça opcional nunca bloqueiam; versão nova obrigatória suspende até a versão atual ser aprovada. Não existe conjunto histórico de opcionais a revisar. Duas novas revisões Codex, 27 testes em checkout isolado e 29 etapas HTTP reais conferiram a correção, incluindo opcionais durante a suspensão e duas obrigatórias substituídas. Comentários continuam presos à versão e ao segundo original.

A nota original registrada na Conty descrevia a interpretação anterior de opcionais depois da aprovação. O recibo foi preservado; o README atual e [a nota da correção](correcao-pecas-opcionais.md) explicam a mudança feita após o pedido do Opus. A reavaliação do ajuste pelo Opus foi concluída e está vinculada abaixo.

## Registro na Conty

Status observado: **Entrega registrada**, em 2026-10-09T19:46:42.120Z.

- [Link enviado](https://github.com/Otavio-Machado-Santos/conty-revisao-video).
- [Página do desafio](https://challenge.appconty.com/desafios/revisao-video).
- [Recibo e texto persistidos](evidence/conty-recibo.json).
- [Screenshot real do registro](evidence/conty-recibo.jpg).

O registro confirma o envio do link; a avaliação da Conty e o ranking dependem da auditoria da organização. Não é uma aprovação técnica pelo avaliador.

## Revisão adicional por Claude Opus 5.5

Após as nove entregas terem sido publicadas e registradas, Claude Code executou a validação solicitada com um subagente independente por desafio, usando `claude-opus-5-5`. Esta entrega recebeu **approved** sobre o código `7cf5c6343987f501f45f760984dbc2e126adb06e`.

- [Parecer, comandos, resultados, sugestões e limites](reviews/claude-opus55.json).
- [Prova do modelo e dos subagentes](reviews/claude-modelo.json).


Na primeira rodada, o Opus pediu um ajuste P2 nesta entrega. Codex corrigiu o comportamento, obteve duas novas revisões independentes, validou em checkout isolado, gravou novamente o fluxo HTTP e publicou a correção. O Opus reavaliou o commit novo e aprovou. O [parecer inicial com o pedido de ajuste](reviews/claude-primeira-rodada.json) foi preservado.

O modelo foi conferido nos eventos reais da CLI. O coordenador conferiu os hashes e consolidou o parecer final efetivamente emitido para cada commit; os arquivos de prova distinguem a rodada dos nove e as reavaliações. A revisão é assistida por IA, sem revisão humana; a avaliação oficial da Conty continua pendente.
