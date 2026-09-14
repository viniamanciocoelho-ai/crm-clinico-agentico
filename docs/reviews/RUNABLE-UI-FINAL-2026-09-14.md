# RUNABLE-UI-FINAL-2026-09-14

Integração da interface completa do CAV CRM em `packages/web`, ligada aos
endpoints reais da API, com modo de demonstração controlado por variável de
ambiente.

## Origem e escopo

- Branch base: `main` em `6d516dd` (`docs: atualizar arquitetura e relatorio de correcao`).
- Branch de trabalho: `feat/runable-ui-final-2026-09-14`.
- Nenhum merge em `main`, nenhum deploy, nenhuma migration remota, nenhum force push.
- Backend, contratos de rota, isolamento por `organizacao_id`, autenticação,
  RBAC, schema Drizzle e testes existentes foram preservados. Nenhum endpoint
  novo foi criado: a interface consome apenas o que já estava registrado em
  `packages/api/src/index.ts`.

O único arquivo fora de `packages/web` alterado por decisão de produto é
`.env.example`, que passou a declarar `DEMO_MODE`. `packages/api/tsconfig.json`
recebeu uma correção de typecheck herdada da sessão anterior desta mesma branch.

## Arquivos alterados

### Modificados

| Arquivo | Motivo |
|---|---|
| `.env.example` | Declara `DEMO_MODE=false` com explicação. A variável era usada pela API e pelo bundle mas não estava documentada. |
| `bun.lock` | Dependências de UI instaladas (ver abaixo). |
| `packages/api/tsconfig.json` | Inclui `../db/sqlite-bindings.d.ts` para o typecheck reconhecer o overload de ambiente do `bun:sqlite`. |
| `packages/web/index.html` | `color-scheme`, preconnect e fontes (Fraunces, IBM Plex Sans, IBM Plex Mono). |
| `packages/web/package.json` | Dependências de UI. |
| `packages/web/tsconfig.json` | Alias `@/*` para `./src/*`. |
| `packages/web/vite.config.ts` | `envDir` na raiz do monorepo, `envPrefix` com `DEMO_MODE`, alias `@`, proxy `/api` para a API em `localhost:3001`. |
| `packages/web/src/App.tsx` | Roteamento por `wouter`, guarda de rota por permissão, redirecionamento por cargo, error boundary. |
| `packages/web/src/main.tsx` | Monta o `Provider` e a folha de estilos. |

### Dependências adicionadas (`packages/web`)

`@tanstack/react-query`, `wouter`, `lucide-react`, `@radix-ui/react-slot`,
`class-variance-authority`, `clsx`, `tailwind-merge`; em dev,
`tailwindcss` 4 e `@tailwindcss/vite`.

### Novos (41 arquivos, 12.639 linhas em `packages/web/src`)

```
styles.css                    vite-env.d.ts

components/app-shell.tsx      components/kpi-card.tsx
components/limite-erro.tsx    components/provider.tsx
components/sessao.tsx

components/ui/  avatar.tsx badge.tsx button.tsx card.tsx dialog.tsx
                field.tsx skeleton.tsx states.tsx table.tsx tabs.tsx
                toast.tsx

lib/  api.ts demo.ts formato.ts rbac.ts rotulos.ts utils.ts

pages/  login.tsx painel.tsx agenda.tsx clientes.tsx atendimentos.tsx
        conversas.tsx catalogo.tsx configuracoes.tsx

queries/  agenda.ts agente.ts atendimentos.ts catalogo.ts clientes.ts
          conversas.ts painel.ts tipos.ts
```

Mais `docs/reviews/screenshots/runable-ui-final-2026-09-14/` com 19 imagens.

## Endpoints consumidos

Todos já existentes. `lib/api.ts` segue o contrato de erro de
`packages/api/src/http.ts` (`{ error, tipo }`, com `tipo` em
`tenant | permissao | requisicao | conflito | autenticacao | interno`).

```
/auth/login                        /demo
/painel/resumo  /painel/funil  /painel/ocupacao
/painel/clientes  /painel/procedimentos  /painel/profissionais
/agenda  /agenda/horarios-livres  /agenda/bloqueios
/clientes  /clientes/tags  /clientes/segmentos  /clientes/motivos-perda
/leads
/atendimentos  /atendimentos/indicadores/no-show
/atendimentos/estoque/movimentacoes  /atendimentos/estoque/abaixo-do-minimo
/conversas  /conversas/ia/acoes
/catalogo/procedimentos  /catalogo/profissionais  /catalogo/salas  /catalogo/insumos
/agente/config  /agente/catalogo
```

Duas observações de contrato confirmadas por teste, úteis para quem for revisar:

- **`/leads` e `/clientes` são entidades distintas.** O funil vive em `/leads`;
  a base cadastrada, em `/clientes`. As duas abas da tela de Clientes refletem
  isso, não são uma divisão cosmética.
- **Cancelamento tem autoria no próprio status.** Os valores gravados são
  `cancelado_pelo_cliente` e `cancelado_pela_clinica`, não um `cancelado`
  genérico. Filtrar por `status=cancelado` devolve lista vazia.

## Modo demonstração

`DEMO_MODE` é lida pela API e pelo bundle do front (via `envPrefix` no
`vite.config.ts`), e para o front é decidida **em tempo de build**.

Com `DEMO_MODE=true`: o login lista os acessos e preenche a senha lendo de
`GET /demo` (rota pública real, nada hardcoded no front); o cabeçalho troca de
perfil — o que dispara um `POST /auth/login` real, com JWT real e RBAC real, não
um atalho de cliente; a interface marca os dados como sintéticos; a tela de
Conversas oferece o bloco de simular mensagem recebida.

Sem `DEMO_MODE`: nada disso é carregado. Verificado servindo um bundle com
`DEMO_MODE=false` e inspecionando o DOM renderizado, não apenas por ausência de
string no arquivo:

| Recurso de demo | Presente no DOM com `DEMO_MODE=false` |
|---|---|
| Senha e acessos de demonstração no login | não |
| Troca de perfil no cabeçalho | não |
| Troca de perfil em Configurações | não |
| Selo de dados sintéticos | não |
| Simular mensagem recebida em Conversas | não |

Nenhum dado fictício é usado como fallback fora do modo demo. Falha de rede ou
de permissão renderiza estado de erro ou de bloqueio, nunca um número inventado.

## Correções feitas nesta integração

### Perda silenciosa de edição nos modais do Catálogo

Os quatro formulários de edição do Catálogo (procedimento, profissional, sala,
insumo) sincronizavam os campos com `useEffect` dependendo do objeto vindo do
servidor. Qualquer mutação lateral feita dentro do mesmo modal — habilitar
profissional, vincular sala, salvar ficha técnica, lançar movimento de estoque —
invalidava a query, trocava a referência do objeto e **descartava em silêncio as
edições ainda não salvas dos campos de cadastro**.

Reproduzido: abrir um procedimento, mudar Situação de Inativo para Ativo sem
salvar, remover um profissional habilitado, e observar o campo Situação voltar
para Inativo sozinho. Ao salvar, gravava-se o valor antigo.

Corrigido com `useSincronizarFormulario(id, aplicar)`, que recarrega os campos
apenas quando muda a entidade aberta. Reverificado depois da correção: a edição
local sobrevive ao refetch e é o valor editado que chega à API.

### Overflow horizontal no mobile

- **Painel**: três grids `xl:grid-cols-[...]` sem coluna única declarada abaixo
  do breakpoint `xl`; o grid implícito tentava acomodar duas colunas em 390 px
  e o documento ia a 579 px de largura. Corrigido com `grid-cols-1` explícito.
- **Atendimentos**: a barra de filtros usava larguras fixas em pixels que
  somadas passavam da viewport; o documento ia a 833 px. Os quatro campos
  passaram a ocupar meia largura no mobile e voltam à largura fixa a partir de
  `sm:`.

### Outros

- Error boundary (`components/limite-erro.tsx`) integrado em `App.tsx`: uma tela
  que falhe ao renderizar mostra erro com opção de tentar novamente, em vez de
  página branca. Testado forçando exceção dentro do roteador.
- Rótulo de estoque no Painel: `Zerado` virou `Sem estoque`, porque a API pode
  devolver saldo negativo quando o consumo passa do estoque lançado.

## Divergência de banco resolvida

A API estava sendo iniciada com o diretório de trabalho em `packages/api` e sem
carregar o `.env` da raiz. Como `packages/api/src/config.ts` tem
`process.env.DATABASE_URL || "dev.db"` — caminho **relativo** —, criava-se um
segundo banco em `packages/api/dev.db`, divergente do da raiz apontado pelo
`.env`. Os dois existiram simultaneamente com contagens diferentes.

Nada no código foi alterado: o default relativo é legítimo. O arquivo duplicado
foi removido e a API religada carregando o `.env` da raiz. Para quem rodar
local, o comando do `AGENTS.md` precisa do ambiente carregado:

```bash
set -a; . ./.env; set +a
bun run --cwd packages/api dev
```

## Testes executados

| Verificação | Resultado |
|---|---|
| `bun install --frozen-lockfile` | `Checked 121 installs across 252 packages (no changes)` |
| `bun run typecheck` | limpo em `api`, `db` e `web` |
| `bun test ./packages` | **44 aprovados, 0 falhas**, 103 expectativas, 5 arquivos |
| `bun run build` | API `index.js` 0,32 MB; web CSS 45,90 kB (gzip 8,90 kB), JS 1.001,71 kB (gzip 231,44 kB) |
| Scan de segredos | nenhuma credencial candidata; nenhum `sk-`, `ghp_`, `AKIA`, JWT ou chave privada |
| Arquivos acima de 50 MB | nenhum |
| `.env`, `*.db`, `dist` versionados | nenhum (cobertos por `.gitignore`) |

Bun 1.4.2, conforme `packageManager`.

### Desktop 1440×1000

As sete telas carregam sem erro de console e sem overflow. Screenshots em
`docs/reviews/screenshots/runable-ui-final-2026-09-14/desktop-*.png`.

### Mobile 390×844

Auditoria com `scrollWidth` medido no documento, em todas as telas:

| Tela | Largura do documento | Overflow |
|---|---|---|
| Painel | 390 | não |
| Agenda | 390 | não |
| Clientes e funil | 390 | não |
| Atendimentos | 390 | não |
| Conversas | 390 | não |
| Catálogo | 390 | não |
| Configurações | 390 | não |

Screenshots em `mobile-*.png`. A agenda no mobile deixa de ser grade por
profissional e passa a lista cronológica com filtro de profissional em chips,
com os botões de ação alcançáveis sem rolagem horizontal.

### Quatro perfis

| Perfil | Rota inicial | Menu visível | Bloqueio verificado |
|---|---|---|---|
| Proprietário (Ana Ribeiro) | `/` | completo | — |
| Gerente (Carlos Menezes) | `/` | completo | — |
| Profissional (Marina Duarte) | redireciona para `/agenda` | Agenda, Atendimentos, Catálogo | `/clientes` mostra bloqueio explícito citando `clientes:read` |
| Recepção (Juliana Prado) | redireciona para `/agenda` | Agenda, Clientes e funil, Atendimentos, Conversas, Catálogo | sem Painel nem Configurações |

A guarda da interface espelha o RBAC do servidor, ela não o substitui: o mesmo
teste foi feito por `curl` direto na API e as recusas coincidem. O perfil
profissional vê na Agenda o aviso de que o escopo `agenda:read_own` é imposto
pelo servidor. Screenshots `perfil-*.png`.

### Acessibilidade

- **Foco preso em modal**: `Dialog` testado com teclado real. Foco inicial cai
  dentro do diálogo; 25 `Tab` seguidos e 5 `Shift+Tab` nunca escapam para a
  sidebar ou para trás do overlay; `Escape` fecha e devolve o foco ao botão que
  abriu.
- Campos com `label` associado, estados de erro com `role="alert"`, foco
  visível, contraste conferido no par de cores da identidade, animações
  respeitando `prefers-reduced-motion`.

### Fluxos de CRUD verificados na interface e confirmados na API

Todos executados na interface real com automação de navegador e conferidos
depois por consulta ao servidor ou ao banco.

| Fluxo | Confirmação |
|---|---|
| Criar agendamento (com horários livres do servidor) | registro gravado, `status=agendado` |
| Confirmar agendamento | `status=confirmado` |
| Remarcar agendamento | novo registro com `remarcado_de_id`, original vira `remarcado` |
| Cancelar agendamento com motivo | `status=cancelado_pelo_cliente` |
| Criar lead no funil | aparece em `GET /leads?etapa=novo` |
| Cadastrar cliente | gravado com `lgpd_consentimento` refletindo o checkbox |
| Registrar atendimento | gravado com valor do catálogo, custo de insumo e margem |
| Estornar atendimento | insumos devolvidos ao estoque, pagamento estornado |
| Editar preço de procedimento | preço persistido |
| Alternar Situação (ativo/inativo) de procedimento | `ativo` persistido |
| Habilitar e remover profissional em procedimento | vínculo persistido |
| Responder conversa escalada | conversa passa de "aguardando humano" para "com humano" |

## Limitações

Não estão escondidas: onde a rota não existe, a ação está desabilitada ou
ausente e a própria tela diz por quê. Nada foi simulado no cliente para
disfarçar ausência de backend.

### Não há rota, e a interface declara isso

1. **Criar ou editar usuários.** `usuarios:write` existe no RBAC mas nenhuma
   rota o consome. Vincular profissional exige um login já existente.
2. **Editar permissões.** O mapa de permissões é fixo no código; a aba é de
   leitura.
3. **Editar atendimento registrado.** O contrato permite registrar e estornar,
   nada mais.
4. **Excluir procedimento, insumo, sala ou profissional.** Desliga-se pelo campo
   `ativo`.
5. **Ler bloqueios de agenda por dia.** Só há escrita (`POST /agenda/bloqueios`)
   e a leitura agregada da organização, então a grade não desenha bloqueios
   avulsos.
6. **Assumir conversa sem responder.** O servidor passa para humano quando a
   primeira resposta humana é enviada; até lá a IA continua respondendo.
7. **Listar reativações disparadas** da organização inteira.
8. **Pagamentos como lista.** Não há endpoint de leitura; a forma de pagamento é
   gravada no servidor e nenhuma rota a devolve, por isso não aparece no detalhe
   do atendimento.
9. **Dados de contato, CNPJ e endereço da clínica** não existem em
   `organizacoes`. O `nome` da organização é somente leitura — `PUT /agente/config`
   não aceita esse campo.
10. **Registro em conselho profissional** não existe em `profissionais`.
11. **Tipo de sala e equipamento** só podem ser definidos na criação.
12. **`GET /conversas`** não devolve contadores nem marcação de não lidas.
13. **`config_agente_ia`** é JSON opaco: nenhum subcampo é interpretado pelo
    servidor, e a tela avisa que editar ali não muda comportamento da IA.

### Observações técnicas

- **Permissão de catálogo**: `catalogo:*` não existe no RBAC. As telas de
  catálogo usam `agenda:read` e `agenda:write`, que é o que o servidor avalia.
  Nenhuma permissão foi inventada.
- **Bundle único de 1 MB** (231 kB comprimido), acima do aviso de 500 kB do
  Vite. Não houve code-splitting porque não estava no escopo; para o piloto de
  uma clínica é aceitável, mas é o primeiro candidato a otimização se o tempo de
  primeiro carregamento incomodar.
- **Fontes vindas do Google Fonts** por CDN. Em rede restrita, o navegador cai
  na fonte de sistema.

## Como rodar local

```bash
bun install --frozen-lockfile
cp .env.example .env            # ajuste JWT_SECRET e PASSWORD_SALT

# caminho absoluto evita o segundo banco relativo descrito acima
# DATABASE_URL=file:/caminho/do/repo/dev.db

set -a; . ./.env; set +a

bun packages/db/migrate.ts
bun packages/db/seed.ts --recriar        # só com DEMO_MODE=true

bun run --cwd packages/api dev           # API  em :3001
bun run --cwd packages/web dev           # web  em :3000
```

Com `DEMO_MODE=true`, a tela de login lista os quatro acessos de demonstração e
preenche a senha. Organização `demo-org-001`, "Clínica Aurora Estética".

Validação completa:

```bash
bun run typecheck && bun test ./packages && bun run build
```

## Screenshots

`docs/reviews/screenshots/runable-ui-final-2026-09-14/`

- `desktop-painel.png`, `desktop-agenda.png`, `desktop-clientes.png`,
  `desktop-atendimentos.png`, `desktop-conversas.png`, `desktop-catalogo.png`,
  `desktop-configuracoes.png` — 1440×1000
- `mobile-painel.png`, `mobile-agenda.png`, `mobile-clientes.png`,
  `mobile-atendimentos.png`, `mobile-conversas.png`, `mobile-catalogo.png`,
  `mobile-configuracoes.png` — 390×844
- `perfil-gerente.png`, `perfil-profissional.png`,
  `perfil-profissional-bloqueio.png`, `perfil-recepcao.png`
- `producao-login-sem-demo.png` — login com `DEMO_MODE=false`
