# Correção de peças opcionais

Base publicada: `b8f0fdc123556fe4c94d0c6791e8394d0ff96154`. Código avaliado por Claude Opus 5.5: `7ab6ea31c6e5bd69565345dffdf7e35bd263ad21`. Branch da correção: `fix/pecas-opcionais`.

A revisão real apontou um P2: roteiro opcional enviado depois de uma aprovação bloqueava uma campanha só de vídeo; o mesmo roteiro enviado antes não bloqueava. Isso tornava a política dependente da ordem das operações.

A nota originalmente enviada à Conty também declarava que qualquer versão nova depois da primeira aprovação exigia revisão, incluindo opcionais. **Essa interpretação da nota original foi corrigida nesta revisão.** A nota e o recibo históricos permanecem inalterados como registro do envio anterior; eles não descrevem a política deste candidato. Uma eventual atualização do envio cabe à coordenação após as revisões.

“Peça que a campanha não pediu não bloqueia” se aplica antes e depois da aprovação. A regra de invalidação por versão nova se aplica às peças exigidas, pois são elas que compõem a aprovação da campanha. Assim, `approvalBlockers` considera somente a versão atual de cada item de `requiredPieces`. Uma obrigatória nova permanece pendente; uma opcional nova não cria bloqueio. A regra continua única para qualquer combinação das quatro peças.

O conjunto `reviewRequiredAfterApproval` foi removido. O histórico continua anexando envios, comentários e aprovações, mas registra invalidação somente quando uma entrega realmente muda de aprovada para produção. Aprovar todas as versões atuais obrigatórias restaura a aprovação previamente concedida. Antes da primeira concessão, a entrega pronta continua em produção até o `POST /deliveries/:id/approve`, conforme o fluxo existente.

As regressões verificam:

- Opcionais pendentes incluídas e substituídas antes da primeira aprovação.
- Primeira inclusão e substituição opcional depois da aprovação, sem mudança de status, timestamp ou evento de invalidação.
- As 15 combinações de exigências e suas peças opcionais, inclusive vídeo opcional.
- Estados de peças equivalentes alcançados em ordens diferentes com a mesma decisão de aprovação.
- Versão nova obrigatória, várias mudanças obrigatórias enquanto suspensa e rejeição da versão intermediária obsoleta.
- Comentários presos à versão de origem e à duração daquela versão, sem migração.
- Reprodução dos fluxos por HTTP real, mantendo as rotas e os formatos existentes.

Com Node.js 22.23.3, `npm test` antes de modificar o domínio produziu 27 testes, 19 aprovados e oito falhas esperadas: [log vermelho](evidence/pecas-opcionais-red.txt). Depois da correção, os mesmos 27 testes passaram: [log verde](evidence/test.txt). A [evidência estruturada](evidence/pecas-opcionais.json) registra comandos, contagens e integridade dos arquivos preservados.

Código, testes e documentação da correção feitos com IA Codex. Os pareceres anteriores foram preservados; esta mudança ainda aguarda revisão independente e nova rodada real de Claude Opus 5.5. Não é alegada revisão humana, aprovação final, republicação ou novo envio à Conty. O enunciado, o recibo, as mídias históricas e o servidor HTTP não foram alterados. Os limites de memória local, ausência de autenticação e uso de assets fictícios permanecem os do README.
