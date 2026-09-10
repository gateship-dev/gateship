# Base shadcn da Gateship

Este documento é o plano e o inventário visual da rodada de GSHIP-851. Ele
orienta novas composições, mas não impõe um tema ou layout universal e não
autoriza a migração das telas.

## Configuração

`webui/components.json` é o único arquivo de configuração do shadcn. Ele está
no escopo do app Vite, aponta para `src/index.css`, deixa `tailwind.config`
vazio para Tailwind v4, usa o estilo compatível com Base UI (`base-nova`) e
declara Hugeicons como biblioteca de ícones. Os aliases refletem os caminhos
reais do app, incluindo `@/lib/cn` como utilitário de composição.

A configuração é somente descritiva: não há geração de componentes, troca de
tokens ou instalação de fonte. A fonte Saans continua ausente; a interface usa
o fallback sans do sistema. O registry privado fica adiado porque Gateship
ainda não distribui componentes entre múltiplos projetos.

A referência consultada foi a documentação oficial de `components.json`,
fixada no commit `3ba91b1cc83e1bbe4ab35a422ff2a694849c5048`:
<https://raw.githubusercontent.com/shadcn-ui/ui/3ba91b1cc83e1bbe4ab35a422ff2a694849c5048/apps/v4/content/docs/%28root%29/components-json.mdx>.
Ela confirma que o arquivo descreve a configuração usada pelo CLI e que, em
Tailwind v4, `tailwind.config` deve ficar vazio.

## Inventário das quatro telas da Central

| Tela | Shell e navegação | Filtros e controles | Tabelas, gráficos e dados | Estados | Decisão |
| --- | --- | --- | --- | --- | --- |
| `/overview` | `SurfaceColumn`, `ControlCenterNavigation` | links HTML e badges | `CardGrid`, `Stat`, tabela de status, lista de atividade | `EmptyState`, loading, erro, indisponibilidade parcial | reutilizar componentes Gateship; tabela permanece markup semântico |
| `/overview/runs` | `SurfaceColumn`, `ControlCenterNavigation` | `Input` e selects nativos para busca, projeto, estado, provider e período | tabela paginada de runs com badges de estado, PR e CI | loading, erro, parcial e tabela vazia | reutilizar `Input`/`Badge`; adaptar somente a composição dos filtros e paginação |
| `/overview/queues` | `SurfaceColumn`, `ControlCenterNavigation` | select nativo de projeto | disclosures `details/summary`, fatos e sequência ordenada de issues | loading, erro, fila vazia e projeto indisponível | reutilizar `Badge`/`EmptyState`; preservar disclosure nativo e sua sequência |
| `/overview/insights` | `SurfaceColumn`, `ControlCenterNavigation` | selects nativos de projeto e janela | `CardGrid`, `Stat`, gráfico de barras factual, tabelas diárias e de coortes | loading, erro, sem dados, evidência insuficiente e dados indisponíveis | reutilizar `Stat`/`CardGrid`; manter gráfico CSS factual, sem biblioteca de charts |

### Mapa de primitivas

| Origem | Equivalente local | Lacuna | Decisão |
| --- | --- | --- | --- |
| shadcn Card/CardHeader/CardContent/CardFooter | `Card`, `CardHeader`, `CardPanel`, `CardFooter` em `components/ui/card.tsx` | API Gateship tem `CardPanel`, disclosures e composição própria | reutilizar e adaptar |
| shadcn Button | `Button` e `buttonVariants` com Base UI em `components/ui/button.tsx` | variantes Gateship, incluindo `attention` | reutilizar e adaptar |
| shadcn Input | `Input` com Base UI em `components/ui/input.tsx` | chrome e tokens Gateship | reutilizar e adaptar |
| shadcn Select | `Select`/`SelectField` com Base UI em `components/ui/select.tsx` | Hugeicons no trigger e opções | reutilizar e adaptar |
| shadcn Badge | `Badge` em `components/ui/badge.tsx` | estados Gateship e acid restrito | reutilizar e adaptar |
| shadcn Table | `Table*` em `components/ui/table.tsx` e tabelas semânticas da Central | tabelas globais ainda têm necessidades de colunas próprias | reutilizar onde já aplicado; criar markup local nas telas simples |
| shadcn Tabs | `Tabs*` com Base UI em `components/ui/tabs.tsx` | navegação visual da Central é link, não tab de estado | reutilizar apenas em superfícies que são tabs |
| shadcn Progress | `Progress` em `components/ui/progress.tsx` | — | reutilizar |
| shadcn Separator | `Separator` em `components/ui/separator.tsx` | — | reutilizar |
| shadcn Empty state | `EmptyState` em `components/ui/empty-state.tsx` | marca Gateship e ação opcional | reutilizar e adaptar |
| Base UI primitives | Button, Input, Select e Tabs locais | não há lacuna comportamental identificada | reutilizar |
| Hugeicons | `HugeiconsIcon` e ícones em `shell.tsx`/`select.tsx` | não usar Lucide ou Radix | reutilizar |
| Chart library | gráfico CSS factual em `OutcomeTrend` | biblioteca de charts não é necessária | não criar dependência |
| Atenção | `AttentionCard` e tokens `attention-*` | acid deve continuar exclusivo de espera do operador | reutilizar e adaptar |

## Regras para novas composições

### Invariantes

- Tokens neutros, estados semânticos e acid reservado à atenção vêm de
  `webui/src/index.css`; não criar outro sistema de tokens.
- Títulos usam sans proporcional; identificadores, comandos, timestamps,
  durações, custos e contadores usam mono. Não simular ou declarar Saans.
- No colapso da shell, centros dos ícones, alturas e recuos permanecem
  preservados. Destinos icon-only mantêm label acessível, tooltip e estado
  ativo.
- Kbds, quando existirem, ficam em um tooltip único. O viewport não recebe
  gutter externo; gutters pertencem ao conteúdo rolável.
- Estado nunca depende apenas de cor. Cards de atenção são as únicas
  superfícies acid.

### Receitas

- Use `CardStack` para seções verticais, `CardGrid` para métricas ou irmãos e
  `CardSplit` para duas colunas que colapsam. Use `FormStack`/`FormField` em
  formulários.
- Use `Table` para linhas comparáveis, cards para tarefas ou explicações e
  `EmptyState` para ausência de dados. Um card com ação tem uma ação primária;
  ações secundárias e destrutivas ficam distintas.
- Use Base UI quando ele retirar interação customizada e mantenha Tailwind
  como camada de estilo. Use Hugeicons para novos ícones.

### Liberdade

Novas composições podem escolher entre as primitivas locais e markup semântico
da tela conforme a informação exigir. Uma variante nova é permitida quando a
razão estiver registrada, tiver teste do comportamento observável e mantiver
estas invariantes; não requer aprovação humana extra. Não adicionar preset
shadcn, Radix, Lucide, registry ou layout de dashboard inteiro.

## Plano e nomenclatura da rodada

O plano desta rodada é: (1) declarar a configuração no escopo `webui`, (2)
registrar o inventário e as fontes, (3) compor futuras lacunas a partir das
primitivas locais e (4) verificar a configuração sem regenerar arquivos.

| PT-BR | EN | URL preservada |
| --- | --- | --- |
| Central de controle | Control center | `/overview` |
| Visão geral | Overview | `/overview` |
| Execuções | Runs | `/overview/runs` |
| Filas | Queues | `/overview/queues` |
| Análises | Insights | `/overview/insights` |

As URLs existentes permanecem as mesmas. A nomenclatura PT-BR e EN fica
completa nos catálogos; a configuração não cria um sistema paralelo de
componentes, ícones ou tokens.
