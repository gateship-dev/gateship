# Entrega do control plane multiprojeto

> Plano canônico da v0.435.0. Esta documentação não autoriza, por si só, as
> entregas posteriores.

## Objetivo

Gateship é o control plane persistente e determinístico que permite a um
operador acompanhar vários projetos sem perder o contexto de cada repositório.
O agente conversacional externo continua sendo a interface primária para
investigar, refinar e invocar comandos tipados. O runtime continua dono do
estado da execução, verificação, review, shipping e cleanup.

## Arquitetura da Central de controle

A Central de controle organiza o estado agregado por função:

- `/overview`: Agora, a visão imediata do que requer atenção e do estado dos
  projetos.
- `/overview/runs`: Execuções, histórico e estado operacional das runs entre
  projetos.
- `/overview/queues`: Filas, admissões e bloqueios de execução por projeto.
- `/overview/insights`: Insights derivados de evidências e observações, sempre
  como sinais separados e advisory.

`/projects` fica reservado ao gerenciamento de projetos. O contexto de um
projeto usa `/projects/:projectId/runs`, `/projects/:projectId/work` e
`/projects/:projectId/settings`. `/settings` é a configuração global.

A seleção de projeto é um contexto de navegação, não um escopo oculto de API.
Ela persiste quando o operador visita a Central e é atualizada ao abrir uma
rota válida do projeto. Uma seleção removida ou inválida é descartada sem
inventar um projeto padrão.

### Contrato de ordenação e paginação

`GET /api/overview/runs` ordena execuções por `updatedAt`, `createdAt`,
`projectName`, `issueId`, `state`, `providerId`, `duration` ou `cost`. A direção
é `asc` ou `desc`; o padrão é `updatedAt desc`. Valores nulos ficam sempre no
fim. O desempate estável usa `projectId` e depois `runId`. Para coortes em
`GET /api/overview`, os campos são `latestTerminalRunAt`, `sampleSize`,
`workflowRevision` e `specVersion`, com padrão `latestTerminalRunAt desc`,
nulos no fim e desempate por `cohortId`. Parâmetros inválidos são rejeitados
explicitamente pelo endpoint, enquanto o cliente descarta valores inválidos
ao restaurar a URL.

Filtros e ordenação são aplicados no servidor antes da paginação; os totais
pertencem ao conjunto filtrado. A paginação é controlada pelos parâmetros
canônicos de limite e offset, preservando URLs antigas e reiniciando o offset
quando filtros, ordenação ou tamanho de página mudam.

Cada polling refaz a consulta sobre o estado atual. Requests independentes não
formam um snapshot: com dados mutáveis, uma linha pode mudar de página entre
leituras. A ausência de duplicação entre páginas é garantida somente quando o
conjunto permanece estático.

## Métricas e evidências

As métricas devem responder perguntas operacionais concretas, como atenção
pendente, projetos ativos, backlog, execuções concluídas, atividade e custo
conhecido. Cada sinal mantém sua origem, cobertura e limitações. Não existe
score composto, nível de maturidade ou número que substitua a leitura dos
fatos.

O endpoint global `GET /api/overview` aceita `window=7d|30d|all` e os filtros
opcionais `projectId`, `providerId`, `model`, `role` e `effort`. A projeção
reproduz o histórico existente, sem novo armazenamento. `runsByOutcome` conta
as runs selecionadas; `activeRuns` conta `incomplete` e `terminalRuns` conta os
demais outcomes. `terminalWallTimeMs` soma durações terminais válidas e
`terminalWallTimeRuns` é seu denominador conhecido; sem duração conhecida o
valor permanece `null`.
`shippedWithoutIntervention` conta entregas sem intervenção registrada.
`dispatchToMergeMs` soma o intervalo entre `run.started` e `ship.merged`, e
`dispatchToMergeRuns` é seu denominador conhecido. `firstReviewPasses` conta
quando a primeira decisão de review é `run.review-clean`, enquanto
`firstReviewPassKnownRuns` conta runs com primeira decisão demonstrável.
`medianDispatchToMergeMs` calcula a mediana determinística desses mesmos
intervalos válidos: o valor central para uma amostra ímpar e a média dos dois
valores centrais para uma amostra par. Seu denominador é
`dispatchToMergeRuns`; sem amostra válida, permanece `null`. A cobertura
exclui runs sem os dois eventos, intervalos negativos e timestamps inválidos,
e preserva as janelas e os filtros de proveniência descritos acima. A fórmula
é coberta por testes de amostra vazia, timestamps inválidos, cardinalidade par
e ímpar e filtros.
`ciCorrections` conta rounds `run.ci-fix-requested`. Timestamps inválidos e
custo não reportado ficam fora das derivações e permanecem `null` quando a
soma não é conhecida. Custo é equivalente ao uso da API, não cobrança da
assinatura. `providerId` usa a proveniência das configurações reconstruídas;
sem configuração reconstruível, o provider da run é fallback apenas no filtro
isolado. Com `role`, `model` ou `effort`, todos os campos devem coincidir na
mesma configuração, sem fallback. A origem inicial da run não define a
semântica desse filtro.

Evidências são tipadas por origem: check determinístico, julgamento humano ou
avaliação de modelo. Diagnósticos, coortes e ideias derivadas continuam
advisory: podem gerar uma proposta revisável, mas não aprovam, iniciam,
corrigem ou bloqueiam uma execução.

`resolvedCycleQuestions` conta só as respostas `run.cycle-response` que o
próprio resolvedor do orquestrador respondeu `continue`; uma escalada
(`outcome: 'operator'`) e uma resposta de operador ou agent-cli a uma pergunta
pendente nunca contam como resolução interna, já que nenhuma delas chamou o
resolvedor. Um `continue` não prova que a correção seguinte foi de fato
aplicada nem que teve efeito -- essa medição é distinta de `corrections` e de
`dispatches.executor`. `dispatches` segue a mesma proveniência: só conta uma
invocação confirmada do processo CLI (executor, reviewer ou o resolvedor do
orquestrador); nunca conta chamadas LLM internas ou subagentes que um
processo CLI faça por conta própria, porque este histórico de eventos não os
observa. `dispatches.orchestrator` soma cada `run.cycle-response` com
`responder: 'orchestrator'` e cada `run.cycle-response-invalid` -- este
último é gravado só depois que a chamada ao resolvedor retorna, então a
invocação está confirmada mesmo que a resposta tenha falhado a validação e
nunca conte em `resolvedCycleQuestions`; uma resposta de operador ou de
agent-cli nunca soma aqui, porque nenhuma delas chamou o resolvedor. Um
`run.cycle-response` legado sem `responder` registrado fica em
`dispatches.unknown`, nunca chutado para autônomo nem para zero.
`evaluation.roles` segue a mesma regra: só lista a configuração do
orquestrador quando o resolvedor de fato rodou (`responder: 'orchestrator'`);
uma resposta de operador ou de agent-cli, ou um `run.cycle-response` legado
ambíguo, nunca aparece como configuração de orquestrador nas coortes do
workflow. A regra de contagem tem versão própria (`dispatchMethodologyVersion`,
hoje `'cli-process-v1'`), exposta junto de `dispatches` e do relatório
agregado de autonomia, para que uma futura mudança de metodologia não seja
lida como se sempre tivesse sido a mesma. `operatorInterventions` exclui só a
resposta de
canal `agent-cli` com evidência de autorização `observed`: essa combinação é
uma resposta técnica que o operador explicitamente autorizou, não texto
produzido diretamente pelo humano, ainda que tenha exigido a autorização do
operador para retomar a run. Uma resposta `agent-cli` com autorização
`absent` ou `unknown` -- inclusive evento legado sem esse campo -- continua
contando como intervenção: legado sem evidência fica desconhecido, nunca
reclassificado como autônomo por supor que todo `agent-cli` foi autorizado.
`guidance.channels` e `guidance.authorization` continuam expondo essa
distribuição completa, por canal e por autorização.
A timeline da run (`webui/src/screens/runs.tsx`) segue a mesma proveniência:
atribui o ator de cada `run.cycle-response` pelo seu `responder` --
orquestrador, operador ou agent-cli -- e mostra um evento legado sem
`responder` registrado como origem desconhecida, nunca como orquestrador.
Nenhuma dessas correções declara melhora causal de modelo ou de provider --
apenas separa quem originou cada resposta.

## Verificação da recuperação integrada e comparação com baseline

`RunEvaluation.recovery` expõe, para uma run cortada pelo próprio teto de
recuperação (`run.recovery-limit`), o mesmo diagnóstico de convergência que o
evento já registrou: até três rodadas corretivas anteriores ao corte e se
a última encontrou um achado novo ou repetiu o anterior. Uma run ainda aberta,
ou que entregou com o orçamento exatamente esgotado mas sem nova causa de
despacho, nunca é lida como "cortada pelo teto" só por ter o orçamento zerado.
O relatório e a UI seguem consultivos: sem score composto, gate ou troca
automática de modelo, efeito ou provider.

A comparação com a evidência agregada de autonomia (`autonomyEvidence`,
`dispatchCeilings`) preserva workflow, modelo, esforço, exposição a falhas
(`outcomes`) e origem da atenção (`guidance.channels`, `guidance.authorization`)
do período selecionado. Um baseline anterior medido sob outra metodologia de
contagem de despachos (`dispatchMethodologyVersion` distinta) não é diretamente
comparável ao período atual; comparar através dessa fronteira exige registrar
as duas versões, nunca somar como se fossem a mesma medida. Ausência de amostra
nova no período é "indisponível" (`missing`), nunca lida como zero nem como
autorização para criar runs só para preencher a comparação.

Uma verificação com mocks e fixtures determinísticas prova que o runtime --
máquina de estados, orçamento de recuperação, notificações -- se comporta como
o contrato descreve. Ela não é evidência de que o modelo por trás do Luna
raciocina melhor ou pior: nenhuma correção medida aqui declara melhora causal
de modelo, esforço ou provider. Um experimento pareado que meça isso exigiria
o mesmo modelo e esforço, o mesmo commit, a mesma tarefa, as mesmas
ferramentas, o mesmo orçamento e um número de repetições suficiente para
separar sinal de ruído -- e depende de autorização própria para rodar contra
provedores reais, nunca implícita nesta entrega. Um replay sobre o histórico
persistido não chama provedor algum; ele só reconstitui o que uma amostra
natural já existente registrou, e essa amostra já é evidência válida para
formar a próxima coleta, mesmo sem o experimento pareado.

## Envelope de adaptação autônoma

Uma adaptação técnica durante a execução é válida somente quando permanece
contida no contrato aprovado e preserva, de forma observável:

- o objetivo da issue;
- o comportamento aceito;
- o risco e seus limites;
- a verificação aprovada.

Mudança que altera objetivo, comportamento, risco, exclusões, evidência exigida
ou comando de verificação retorna ao operador como proposta. O agente não
reescreve silenciosamente a especificação.

## Concorrência e ciclo de entrega

Execuções são seriais dentro do mesmo repositório. Paralelismo é permitido
somente entre projetos independentes. O serviço inicia cada run em worktree
fresca de `origin/main`, executa a verificação explícita, recebe review
independente e mecanicamente somente leitura e só então pode fazer shipping
conforme o contrato.

## Limites

Esta entrega rejeita terminal web, Kanban genérico, página global de agentes,
event explorer como superfície principal, merge decidido por IA e memória
genérica. Também não adiciona paralelismo no mesmo repositório, daemon novo,
banco novo, broker ou serviço separado.

A densidade operacional de ferramentas externas e seu onboarding ou
distribuição são referências competitivas registradas apenas no radar. Nomes
de terceiros não entram na interface, nos catálogos ou no fluxo operacional de
Gateship.

Esta issue altera somente documentação. Ela formaliza a entrega da v0.435.0,
mas não aprova as entregas posteriores por conta própria.
