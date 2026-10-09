# Verificação e histórico da entrega 8

## Correção de peças opcionais

A branch `fix/pecas-opcionais`, baseada na publicação `b8f0fdc123556fe4c94d0c6791e8394d0ff96154`, corrige o P2 apontado pela revisão real de Claude Opus 5.5. Aprovação e bloqueios usam exclusivamente as peças exigidas da campanha, inclusive depois da primeira aprovação. Peça obrigatória nova suspende a aprovação; peça opcional nova não a suspende. O histórico artificial de peças a revisar foi removido.

Codex implementou a correção e seus testes. **27/27 testes** passaram em Node.js 22.23.3, incluindo cinco testes HTTP com servidores reais. As regressões novas ou corrigidas haviam produzido oito falhas no domínio anterior. Veja a [nota da correção](correcao-pecas-opcionais.md), o [log atual](evidence/test.txt) e a [evidência estruturada](evidence/pecas-opcionais.json).

Este candidato aguarda revisão independente e nova rodada real de Claude. A publicação, os pareceres, as capturas e o recibo apresentados abaixo se referem à entrega anterior. Nenhum novo envio à Conty ou captura global foi realizado nesta correção.

## Validação da publicação anterior

Código revisado: `7ab6ea31c6e5bd69565345dffdf7e35bd263ad21`. Runtime: Node.js 22.23.3 em macOS.

Implementação e documentação: Codex. Revisão: dois agentes Codex independentes do implementador. Não houve revisão humana do código.

- 22 testes passaram no código anteriormente publicado; [checkout isolado](evidence/coordenador-clone-limpo.txt).
- [Parecer A](reviews/08-a.json) e [parecer B](reviews/08-b.json), com sondagens independentes, limites e sugestões.
- [Transcrição HTTP real](evidence/coordenador-http.json): 21 etapas verificadas, com requests, respostas e invariantes.
- [Screenshot](evidence/screen.jpg), [resposta expandida](evidence/response.jpg) e [GIF da execução real](evidence/flow.gif).

O GIF foi codificado dos frames de screencast do navegador durante a execução das chamadas locais; não é uma montagem ou simulação. Os dados são fictícios. O portal apenas apresenta respostas da API e compara invariantes. As integrações externas são mockadas quando previsto no enunciado. Os limites de persistência, autenticação e operação estão no README. Os testes e capturas não representam deploy ou funcionamento em produção.

![Respostas reais da API](evidence/screen.jpg)

![Gravação do fluxo HTTP](evidence/flow.gif)

## Registro na Conty

Status observado: **Entrega registrada**, em 2026-10-09T19:46:42.120Z.

- [Link enviado](https://github.com/Otavio-Machado-Santos/conty-revisao-video).
- [Página do desafio](https://challenge.appconty.com/desafios/revisao-video).
- [Recibo e texto persistidos](evidence/conty-recibo.json).
- [Screenshot real do registro](evidence/conty-recibo.jpg).

O registro confirma o envio do link; a avaliação da Conty e o ranking dependem da auditoria da organização. Não é uma aprovação técnica pelo avaliador.
