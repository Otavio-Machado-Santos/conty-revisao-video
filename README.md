# Revisão de vídeo por versão

A API impede a aprovação da entrega enquanto alguma peça exigida pela campanha está ausente ou sua versão atual não foi aprovada. Uma substituição suspende a aprovação anterior. Comentários em segundos pertencem à versão do vídeo em que foram feitos.

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

`approvalBlockers` percorre as exigências da campanha e considera apenas a última versão de cada peça. Não há condição especial de campanha de vídeo espalhada nas rotas. Assim, uma campanha só de vídeo aprova sem roteiro, capa ou legenda; peças opcionais existentes e pendentes também não bloqueiam a primeira aprovação.

O primeiro `POST /approve` concede a aprovação da entrega. Depois disso, qualquer versão nova, inclusive de peça opcional ou sua primeira inclusão, suspende essa aprovação até a versão atual ser revisada. Essa é a interpretação explícita da regra do enunciado de que uma peça nova em entrega já aprovada desfaz a aprovação. O conjunto de peças alteradas é mantido durante a suspensão: duas mudanças não podem restaurar a aprovação com apenas uma revisada. Quando todas as exigências e substituições estão aprovadas, a aprovação é restaurada automaticamente.

A versão anterior nunca é apagada, sua aprovação não migra para a seguinte e aprová-la depois da substituição retorna `stale_version`. Cada comentário referencia sua versão e é validado contra a duração daquela versão. A API retorna cópias dos dados para impedir alterações acidentais fora do serviço. Eventos de criação, envio, comentário, aprovação e invalidação são anexados ao histórico; não há operação de edição ou exclusão.

## Validação e limites

`npm test` executou **22 testes** em Node.js **22.23.3**, com **22 aprovados** e nenhuma falha. O log está em [docs/evidence/test.txt](docs/evidence/test.txt). A suíte cobre as 15 combinações de peças obrigatórias, erros explicativos, peças opcionais, substituições antes e após aprovação, múltiplas mudanças durante suspensão, idempotência, isolamento de entregas, cópias defensivas e limites de comentários. Os testes HTTP abrem um servidor real em porta aleatória e validam o fluxo e os erros de transporte. A demonstração executou 16 requisições reais contra a API local; o [log do fluxo](docs/evidence/demo.txt) e seu [registro JSON](docs/evidence/http-flow.json) mostram aprovação bloqueada, aprovação válida, substituição e restauração.

O armazenamento é em memória e se perde ao reiniciar o processo. Não há autenticação, persistência, descoberta automática da duração nem pagamento: são limites da demonstração local, não atalhos da regra de aprovação. Em produção, os eventos e versões devem ser persistidos atomicamente e as aprovações protegidas pelo papel da marca. Nenhuma integração externa ou mídia real é necessária para reproduzir os testes.

## Uso de IA e revisão

Codex implementou a API, os testes, o cliente de demonstração e esta documentação. O agente verificou o contrato, executou os testes em Node.js 22 e validou requisições HTTP reais. Neste commit a revisão independente ainda está pendente e será registrada antes do envio. Nenhuma revisão humana do código foi alegada.
