# O kit shadcn da Gateship

As regras de design e os checks que as garantem vivem em `design-system.md`.
Este documento registra de onde vem o kit de componentes e como um componente
novo entra nele.

## Base

O kit é o shadcn sobre Base UI, no estilo `base-nova`, com Hugeicons como
biblioteca de ícones e Tailwind v4 como camada de estilo. `webui/components.json`
declara essa escolha no escopo do app Vite: aponta para `src/index.css`, deixa
`tailwind.config` vazio, como o Tailwind v4 pede, e mapeia os aliases para os
caminhos reais, com `@/lib/cn` como utilitário de composição.

Os componentes ficam em `webui/src/components/ui` e pertencem à Gateship. Depois
de entrar no repositório, um componente é código nosso, e evolui com o produto
em vez de acompanhar o upstream.

## Como um componente entra

O CLI `shadcn add` não roda neste repositório, porque ele exige um
`package.json` dentro de `webui/` e o nosso fica na raiz. O componente vem
direto do registry, no endereço
`https://ui.shadcn.com/r/styles/base-nova/<nome>.json`, e é adaptado à mão em
quatro pontos.

- Os imports passam a ser relativos, com extensão, como no resto do app.
- Os ícones passam a ser Hugeicons. Lucide e Radix não entram.
- O chrome de popup segue o do kit, com a mesma borda, o mesmo relevo e a mesma
  sombra. O menu exporta esses valores em `POPUP_CHROME`, que o seletor de
  projeto reaproveita. `select` ainda repete os mesmos valores por extenso.
- Dimensões entram na grade de 4px e nos tokens de `index.css`. O que o registry
  traz fora da grade é ajustado, ou registrado como exceção com motivo.

Vieram do registry `alert`, `dropdown-menu`, `empty`, `toggle`, `toggle-group` e
`tooltip`. `data-table` segue a receita Data Table do shadcn com TanStack Table
v9, sem pinning nem resizing, e ganhou o que as listas do produto pediram: linha
que espera o operador, coluna responsiva, linha que abre e paginação local.

Os demais componentes nasceram no repositório e seguem o mesmo idioma: `badge`,
`button`, `callout`, `card`, `card-layout`, `chart`, `collapsible`,
`count`, `empty-state`, `input`, `item`, `progress`, `reference`, `select`,
`separator`, `skeleton`, `stat`, `status-dot`, `switch`, `table`, `tabs`, `tag` e
`textarea`.

## Quando criar uma variante

Uma tela compõe o kit e não o reestiliza. Quando o design pede um tratamento que
o componente não oferece, a mudança entra no kit como variante ou opção (por
exemplo `tone` em `Stat`, `mono` em `Input`, `sticky` em `CardFooter`), com
teste do comportamento observável. O lint de design trata as telas como erro e o
kit como relatório, porque sombras e raios em valor arbitrário são o idioma do
próprio registry, e zerá-los significaria reescrever o que veio vendorizado.

O scratchpad de design (`webui/design.html`) lê as variantes de cada componente
direto do código e mostra quais estão em uso. Uma variante sem uso é removida.

## O que fica de fora

- A fonte Saans não está no repositório. A interface usa o sans do sistema até
  que um arquivo de fonte e a licença dele sejam adicionados.
- Biblioteca de charts além do Recharts já usado em Insights.
- Registry privado. A Gateship ainda não distribui componentes entre projetos.
- Layout de dashboard pronto ou preset de tema. Tokens neutros e estados
  semânticos vêm de `webui/src/index.css`. O acid é da marca e não entra em
  componente nenhum.
