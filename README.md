# Revisão de vídeo por versão

> **Se você veio pela nota da Conty (09/10):** a nota foi registrada antes da correção [`7cf5c63`](docs/correcao-pecas-opcionais.md) e descreve a regra antiga. A regra atual é esta: peça que a campanha não exige nunca bloqueia a aprovação, nem antes nem depois dela; só uma versão nova de peça exigida suspende a aprovação até ser aprovada. A suíte tem **27 testes** (a nota cita 22). O fluxo HTTP tem **29 etapas** na captura do coordenador ([docs/evidence/coordenador-http.json](docs/evidence/coordenador-http.json)) e **16** em `npm run demo` (a nota cita 21).

A API impede a aprovação da entrega enquanto alguma peça exigida pela campanha está ausente ou sua versão atual não foi aprovada. Uma substituição de peça exigida suspende a aprovação anterior. Peças opcionais não bloqueiam em nenhum momento. Comentários em segundos pertencem à versão do vídeo em que foram feitos.

Comece por [a política central](src/domain.js), pelos [testes de domínio](test/domain.test.js) e pelo [contrato original](docs/enunciado.txt).

## Executar

Node.js 22; nenhuma dependência externa.

```sh
npm ci
npm test
npm start
```

A API escuta somente em `http://127.0.0.1:3008`. `PORT` permite outra porta. Em outro terminal, `npm run demo` executa e verifica um fluxo HTTP completo contra a API em execução. O comando grava as requisições e respostas reais em [docs/evidence/http-flow.json](docs/evidence/http-flow.json). Use `API_URL` para apontar para outra instância.

## Contrato HTTP

Todos os corpos de entrada são JSON, com `Content-Type: application/json`. As duas rotas de aprovação aceitam `POST` sem corpo.

| Método e rota | Corpo / resultado |
| --- | --- |
| `GET /health` | `{ "status": "ok" }` |
| `POST /campaigns` | `{ "requiredPieces": ["video", "caption"] }`; retorna campanha, `201` |
| `GET /campaigns/:id` | Campanha e peças exigidas |
| `POST /deliveries` | `{ "campaignId": "campaign-..." }`; retorna entrega, `201` |
| `GET /deliveries/:id` | Estado, bloqueios, versões completas, comentários e histórico |
| `POST /deliveries/:id/pieces/:piece/versions` | Asset e duração quando vídeo; retorna versão, `201` |
| `GET /deliveries/:id/pieces/:piece/versions/:versionId` | Versão exata e seus comentários |
| `POST /deliveries/:id/pieces/:piece/versions/:versionId/approve` | Aprova exclusivamente a versão atual, `200` |
| `POST /deliveries/:id/approve` | Aprova a entrega se não houver bloqueios; senão, `409` |
| `POST /deliveries/:id/pieces/video/versions/:versionId/comments` | `{ "second": 12.5, "body": "Trocar esta cena." }`; retorna comentário, `201` |

`piece` aceita `script`, `video`, `cover` ou `caption`. `requiredPieces` contém de uma a quatro peças distintas. A campanha é imutável após a criação.

Uma nova versão de vídeo:

```json
{
  "asset": { "type": "url", "value": "https://example.com/video-v1.mp4" },
  "durationSeconds": 30
}
```

`asset.type` aceita `url`, `file` fictício ou `text`; vídeo exige `url` ou `file`. Os assets são referências, sem download ou upload real. A duração do vídeo é metadado informado e precisa ser finita e positiva. `second` aceita valores fracionários e os limites `0` e `durationSeconds`; valores fora desse intervalo são rejeitados.

Quando a legenda está ausente, mesmo com vídeo aprovado:

```json
{
  "error": {
    "code": "approval_blocked",
    "message": "Entrega não pode ser aprovada: há peças obrigatórias ausentes ou versões aguardando aprovação.",
    "details": {
      "blockers": [{ "piece": "caption", "reason": "required_piece_missing" }]
    }
  }
}
```

Um comentário retornado tem `versionId`, `second`, `body` e `createdAt`. `GET` da versão antiga continua mostrando esse comentário após uma nova versão; a nova começa com `comments: []`.

Erros têm `{ "error": { "code", "message", "details?" } }`: entrada inválida `400`, corpo acima de 64 KiB `413`, tipo de conteúdo incorreto `415`, recurso ausente `404`, aprovação pendente ou versão antiga `409`. Aprovar novamente uma versão atual ou uma entrega já aprovada é idempotente e não repete o histórico.

## Por que a regra funciona

`approvalBlockers` percorre exclusivamente `campaign.requiredPieces` e considera apenas a última versão de cada peça exigida. Não há condição especial de campanha de vídeo espalhada nas rotas. Assim, uma campanha só de vídeo aprova sem roteiro, capa ou legenda; inclusão, substituição ou aprovação de peça opcional não muda a aprovação da entrega, antes ou depois da primeira aprovação.

As duas cláusulas do enunciado são aplicadas juntas: “Peça que a campanha não pediu não bloqueia” vale em todos os momentos; a invalidação por versão nova se aplica às peças exigidas, que compõem o objeto da aprovação. Portanto, substituir uma obrigatória exige aprovar sua versão atual; substituir uma opcional permanece livre. A campanha define esse conjunto como dado, sem uma exceção dependente do histórico.

O primeiro `POST /approve` concede a aprovação da entrega quando todas as versões atuais exigidas estão aprovadas. Depois disso, uma versão nova obrigatória suspende o status até a versão atual ser aprovada. Durante várias mudanças, a política continua olhando todas as exigências e suas versões atuais: revisar apenas uma não libera outra obrigatória pendente. Quando todas estão aprovadas, a aprovação concedida é restaurada automaticamente. Não existe conjunto histórico de peças opcionais a revisar. Eventos de invalidação e restauração são registrados somente quando o status realmente muda.

A versão anterior nunca é apagada, sua aprovação não migra para a seguinte e aprová-la depois da substituição retorna `stale_version`. Cada comentário referencia sua versão e é validado contra a duração daquela versão. A API retorna cópias dos dados para impedir alterações acidentais fora do serviço. Eventos de criação, envio, comentário, aprovação e invalidação são anexados ao histórico; não há operação de edição ou exclusão.

## Validação e limites

`npm test` executou **27 testes** em Node.js **22.23.3**, com **27 aprovados** e nenhuma falha. O log está em [docs/evidence/test.txt](docs/evidence/test.txt). A suíte cobre as 15 combinações de peças obrigatórias e suas opcionais, inclusão e substituição opcionais antes e após aprovação, estados equivalentes obtidos em ordens diferentes, substituição obrigatória, múltiplas mudanças durante suspensão, versão obsoleta recusada, comentários por versão, erros explicativos, idempotência, isolamento e cópias defensivas. Os cinco testes HTTP abrem servidores reais em portas aleatórias e validam esses fluxos e os erros de transporte.

As regressões da correção produziram **8 falhas** contra o domínio publicado anteriormente e passaram após a mudança, sem alterar o enunciado: [log anterior à correção](docs/evidence/pecas-opcionais-red.txt), [resumo verificável](docs/evidence/pecas-opcionais.json) e [nota da correção](docs/correcao-pecas-opcionais.md). As revisões anteriores foram preservadas como histórico. As duas revisões independentes do código corrigido, o checkout isolado e a captura nova com 29 etapas HTTP estão vinculados em docs/verificacao-final.md. A demonstração antiga é uma evidência histórica distinta da captura nova.

O armazenamento é em memória e se perde ao reiniciar o processo. Não há autenticação, persistência, descoberta automática da duração nem pagamento: são limites da demonstração local, não atalhos da regra de aprovação. Em produção, os eventos e versões devem ser persistidos atomicamente e as aprovações protegidas pelo papel da marca. Nenhuma integração externa ou mídia real é necessária para reproduzir os testes.

## Uso de IA e revisão

Implementação, testes e documentação: Codex. Dois agentes Codex independentes do implementador revisaram o commit `7cf5c6343987f501f45f760984dbc2e126adb06e` e liberaram a entrega após testes e sondagens próprias. Os pareceres completos estão em `docs/reviews/`. O coordenador conferiu a instalação e os testes em checkout isolado e registrou o fluxo HTTP real. Uma revisão adicional com Claude Opus 5.5 pediu a correção das peças opcionais e aprovou o commit corrigido; ela está registrada em docs/verificacao-final.md. Não foi realizada revisão humana do código. A validação usa dados sintéticos e ambiente local; limites e interpretações do contrato estão documentados.

Atualização após o registro na Conty (10/10/2026): o aviso sobre a nota, no topo deste README, foi escrito por Claude Code (modelo `claude-opus-5-5`) a pedido do autor, depois de uma auditoria independente feita com o mesmo modelo. Essa atualização não altera código nem testes.

[Verificação da correção e histórico das revisões, capturas e recibo](docs/verificacao-final.md).
