/**
 * Catálogo — procedimentos, profissionais, salas/equipamentos e insumos.
 *
 * Contrato real (`packages/api/src/routes/catalogo.ts`):
 *   GET    /catalogo/procedimentos?ativos=1   GET /catalogo/procedimentos/:id
 *   POST   /catalogo/procedimentos            PATCH /catalogo/procedimentos/:id
 *   POST   /catalogo/procedimentos/:id/profissionais
 *   DELETE /catalogo/procedimentos/:id/profissionais/:profissionalId
 *   POST   /catalogo/procedimentos/:id/recursos
 *   DELETE /catalogo/procedimentos/:id/recursos/:recursoId
 *   PUT    /catalogo/procedimentos/:id/ficha-tecnica
 *   GET/POST/PATCH /catalogo/{profissionais,salas,insumos}[/:id]
 *   POST   /catalogo/insumos/:id/movimentacoes
 *
 * PERMISSÕES: o catálogo não tem permissão própria no RBAC. Ler exige
 * `agenda:read`, escrever exige `agenda:write`. Não existe `catalogo:*` —
 * a interface não inventa essa permissão.
 *
 * Limitações do contrato expostas na interface:
 *  - `profissionais` não tem coluna de registro em conselho (CRO);
 *  - `estoque_atual` não é editável por PATCH: só muda por movimentação;
 *  - `bloqueios_agenda` volta como JSON cru e o PATCH substitui a lista
 *    inteira; não existe rota de leitura de bloqueios por dia;
 *  - não existe rota para excluir procedimento, insumo, sala ou profissional —
 *    o desligamento é feito pelo campo `ativo`.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Boxes,
  DoorOpen,
  Package,
  PackageX,
  Pencil,
  Plus,
  Sparkles,
  TriangleAlert,
  UserRound,
  Wrench,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { KpiCard } from "@/components/kpi-card";
import { useSessao } from "@/components/sessao";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, SectionLabel } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { SkeletonTabela } from "@/components/ui/skeleton";
import { DeniedState, EmptyState, ErrorState } from "@/components/ui/states";
import { Table, TBody, THead, TRow } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { brl, dataHoraDe, numero } from "@/lib/formato";
import { ROLE_ROTULO } from "@/lib/rbac";
import { cn } from "@/lib/utils";
import {
  useAtualizarInsumo,
  useAtualizarProcedimento,
  useAtualizarProfissional,
  useAtualizarSala,
  useCriarInsumo,
  useCriarProcedimento,
  useCriarProfissional,
  useCriarSala,
  useDesabilitarProfissionalNoProcedimento,
  useDesvincularRecurso,
  useHabilitarProfissionalNoProcedimento,
  useInsumos,
  useMovimentarInsumo,
  useProcedimento,
  useProcedimentos,
  useProfissionais,
  useSalas,
  useSalvarFichaTecnica,
  useVincularRecurso,
} from "@/queries/catalogo";
import type { Bloqueio, Insumo, Procedimento, Profissional, Sala } from "@/queries/tipos";

type Aba = "procedimentos" | "profissionais" | "recursos" | "insumos";

export default function CatalogoPage() {
  const { usuario, pode } = useSessao();
  const [aba, setAba] = useState<Aba>("procedimentos");

  if (!pode("agenda:read")) {
    return (
      <AppShell titulo="Catálogo" descricao="Procedimentos, insumos e recursos da clínica.">
        <Card>
          <DeniedState
            recurso="catálogo"
            role={ROLE_ROTULO[usuario?.role ?? "profissional"]}
            permissao="agenda:read"
          />
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell
      titulo="Catálogo"
      descricao="A fonte de verdade que a IA consulta para preço, duração e disponibilidade."
      acoes={
        <Badge tom="neutro">
          Controlado por <code className="font-mono">agenda:read</code> /{" "}
          <code className="font-mono">agenda:write</code>
        </Badge>
      }
    >
      <Tabs
        abas={[
          { id: "procedimentos" as const, rotulo: "Procedimentos" },
          { id: "profissionais" as const, rotulo: "Profissionais" },
          { id: "recursos" as const, rotulo: "Salas e equipamentos" },
          { id: "insumos" as const, rotulo: "Insumos" },
        ]}
        atual={aba}
        onMudar={setAba}
        className="mb-6"
      />

      {aba === "procedimentos" && <Procedimentos />}
      {aba === "profissionais" && <Profissionais />}
      {aba === "recursos" && <Recursos />}
      {aba === "insumos" && <Insumos />}
    </AppShell>
  );
}

/* ───────────────────────────── Procedimentos ───────────────────────────── */

function Procedimentos() {
  const { pode } = useSessao();
  const procedimentos = useProcedimentos();
  const [emEdicao, setEmEdicao] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const podeEscrever = pode("agenda:write");

  if (procedimentos.isPending) {
    return (
      <Card>
        <SkeletonTabela linhas={6} colunas={5} />
      </Card>
    );
  }
  if (procedimentos.isError) {
    return (
      <Card>
        <ErrorState
          descricao={procedimentos.error.message}
          onRetry={() => void procedimentos.refetch()}
        />
      </Card>
    );
  }

  const itens = procedimentos.data.procedimentos;
  const ativos = itens.filter((p) => p.ativo === 1);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          rotulo="Procedimentos ativos"
          valor={String(ativos.length)}
          apoio={`${itens.length} no catálogo`}
          icone={Sparkles}
          tom="primary"
        />
        <KpiCard
          rotulo="Ticket médio de tabela"
          valor={brl(
            ativos.reduce((t, p) => t + p.preco, 0) / Math.max(1, ativos.length),
          )}
          apoio="Média simples dos preços ativos"
          icone={Boxes}
        />
        <KpiCard
          rotulo="Duração média"
          valor={`${numero(
            ativos.reduce((t, p) => t + p.duracao_min, 0) / Math.max(1, ativos.length),
          )} min`}
          apoio="Base do encaixe na agenda"
          icone={Wrench}
        />
      </div>

      <Card>
        <CardHeader>
          <div className="min-w-0">
            <CardTitle className="font-display">Procedimentos</CardTitle>
            <p className="text-muted-foreground mt-0.5 text-[12px]">
              Preço e duração daqui alimentam a agenda e as respostas da IA.
            </p>
          </div>
          {podeEscrever && (
            <Button size="sm" onClick={() => setCriando(true)}>
              <Plus className="size-3.5" aria-hidden />
              Novo procedimento
            </Button>
          )}
        </CardHeader>

        {itens.length === 0 ? (
          <EmptyState
            icone={Sparkles}
            titulo="Catálogo vazio"
            descricao="Cadastre os procedimentos para a agenda e a IA terem preço e duração."
          />
        ) : (
          <>
            {/* Desktop: tabela. Mobile: cartões, para não haver rolagem lateral. */}
            <div className="hidden lg:block">
              <Table>
                <THead>
                  <tr>
                    <th>Procedimento</th>
                    <th>Duração</th>
                    <th>Preço</th>
                    <th>Situação</th>
                    <th className="text-right">Ações</th>
                  </tr>
                </THead>
                <TBody>
                  {itens.map((p) => (
                    <TRow key={p.id}>
                      <td>
                        <span className="font-medium">{p.nome}</span>
                        {p.descricao_publica && (
                          <span className="text-muted-foreground mt-0.5 line-clamp-1 block text-[12px]">
                            {p.descricao_publica}
                          </span>
                        )}
                      </td>
                      <td className="tabular">{p.duracao_min} min</td>
                      <td className="tabular">{brl(p.preco)}</td>
                      <td>
                        <Badge tom={p.ativo === 1 ? "success" : "neutro"}>
                          {p.ativo === 1 ? "Ativo" : "Inativo"}
                        </Badge>
                      </td>
                      <td className="text-right">
                        <Button variant="outline" size="sm" onClick={() => setEmEdicao(p.id)}>
                          <Pencil className="size-3.5" aria-hidden />
                          {podeEscrever ? "Editar" : "Ver"}
                        </Button>
                      </td>
                    </TRow>
                  ))}
                </TBody>
              </Table>
            </div>
            <ul className="divide-border divide-y lg:hidden">
              {itens.map((p) => (
                <li key={p.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold">{p.nome}</p>
                    <p className="text-muted-foreground mt-0.5 text-[12px]">
                      {p.duracao_min} min · {brl(p.preco)}
                    </p>
                    <Badge tom={p.ativo === 1 ? "success" : "neutro"} className="mt-1.5">
                      {p.ativo === 1 ? "Ativo" : "Inativo"}
                    </Badge>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => setEmEdicao(p.id)}
                  >
                    {podeEscrever ? "Editar" : "Ver"}
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <DialogProcedimento id={emEdicao} onFechar={() => setEmEdicao(null)} />
      <DialogNovoProcedimento aberto={criando} onFechar={() => setCriando(false)} />
    </div>
  );
}

function DialogNovoProcedimento({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const { mostrar } = useToast();
  const criar = useCriarProcedimento();
  const [nome, setNome] = useState("");
  const [duracao, setDuracao] = useState("30");
  const [preco, setPreco] = useState("");
  const [descricao, setDescricao] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (aberto) {
      setNome("");
      setDuracao("30");
      setPreco("");
      setDescricao("");
      setErro(null);
    }
  }, [aberto]);

  const salvar = () => {
    if (nome.trim().length < 2) {
      setErro("Informe o nome do procedimento.");
      return;
    }
    setErro(null);
    criar.mutate(
      {
        nome: nome.trim(),
        duracao_min: Number(duracao) || undefined,
        preco: preco === "" ? undefined : Number(preco),
        descricao_publica: descricao.trim() || undefined,
      },
      {
        onSuccess: (r) => {
          onFechar();
          mostrar({ tipo: "sucesso", titulo: "Procedimento criado", detalhe: r.procedimento.nome });
        },
        onError: (e) => setErro(e.message),
      },
    );
  };

  return (
    <Dialog
      aberto={aberto}
      onFechar={onFechar}
      titulo="Novo procedimento"
      descricao="Profissionais, salas e ficha técnica são vinculados depois, na edição."
      rodape={
        <>
          <Button variant="ghost" onClick={onFechar}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={criar.isPending}>
            {criar.isPending ? "Criando…" : "Criar"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Nome">
          {(props) => (
            <Input {...props} value={nome} onChange={(e) => setNome(e.target.value)} />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Duração (min)">
            {(props) => (
              <Input
                {...props}
                type="number"
                min={5}
                step={5}
                value={duracao}
                onChange={(e) => setDuracao(e.target.value)}
              />
            )}
          </Field>
          <Field label="Preço (R$)" hint="Opcional no contrato; sem preço, a IA não cota.">
            {(props) => (
              <Input
                {...props}
                type="number"
                min={0}
                step="0.01"
                value={preco}
                onChange={(e) => setPreco(e.target.value)}
              />
            )}
          </Field>
        </div>
        <Field label="Descrição pública" hint="Texto que a IA pode usar ao explicar o procedimento.">
          {(props) => (
            <Textarea
              {...props}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
            />
          )}
        </Field>
        {erro && (
          <p className="text-destructive text-[13px]" role="alert">
            {erro}
          </p>
        )}
      </div>
    </Dialog>
  );
}

function DialogProcedimento({ id, onFechar }: { id: string | null; onFechar: () => void }) {
  const { pode } = useSessao();
  const detalhe = useProcedimento(id);
  const podeEscrever = pode("agenda:write");

  return (
    <Dialog
      aberto={id !== null}
      onFechar={onFechar}
      titulo={detalhe.data?.procedimento.nome ?? "Procedimento"}
      descricao="Cadastro, equipe habilitada, ocupação de sala e ficha técnica."
      largura="max-w-3xl"
      rodape={
        <Button variant="ghost" onClick={onFechar}>
          Fechar
        </Button>
      }
    >
      {id === null ? null : detalhe.isPending ? (
        <SkeletonTabela linhas={5} colunas={2} />
      ) : detalhe.isError ? (
        <ErrorState descricao={detalhe.error.message} onRetry={() => void detalhe.refetch()} />
      ) : (
        <CorpoProcedimento
          procedimento={detalhe.data.procedimento}
          podeEscrever={podeEscrever}
        />
      )}
    </Dialog>
  );
}

/**
 * Recarrega os campos de um formulário de edição a partir do servidor apenas
 * quando muda a entidade aberta (id), não a cada refetch.
 *
 * Sem isso qualquer mutação lateral do mesmo cadastro — habilitar profissional,
 * vincular sala, salvar ficha técnica, lançar movimento de estoque — invalidava
 * a query, trocava o objeto vindo do servidor e descartava em silêncio as
 * edições ainda não salvas dos campos de cadastro.
 */
function useSincronizarFormulario(id: string | null, aplicar: () => void): void {
  const aplicarRef = useRef(aplicar);
  aplicarRef.current = aplicar;
  useEffect(() => {
    if (id === null) return;
    aplicarRef.current();
  }, [id]);
}

function CorpoProcedimento({
  procedimento,
  podeEscrever,
}: {
  procedimento: import("@/queries/tipos").ProcedimentoCompleto;
  podeEscrever: boolean;
}) {
  const { mostrar } = useToast();
  const atualizar = useAtualizarProcedimento();
  const habilitar = useHabilitarProfissionalNoProcedimento();
  const desabilitar = useDesabilitarProfissionalNoProcedimento();
  const vincularRecurso = useVincularRecurso();
  const desvincularRecurso = useDesvincularRecurso();
  const salvarFicha = useSalvarFichaTecnica();

  const profissionais = useProfissionais(true);
  const salas = useSalas(true);
  const insumos = useInsumos(true);

  const [nome, setNome] = useState(procedimento.nome);
  const [duracao, setDuracao] = useState(String(procedimento.duracao_min));
  const [preco, setPreco] = useState(String(procedimento.preco));
  const [descricao, setDescricao] = useState(procedimento.descricao_publica ?? "");
  const [ativo, setAtivo] = useState(procedimento.ativo === 1);

  const [ficha, setFicha] = useState(
    procedimento.ficha_tecnica.map((i) => ({
      insumo_id: i.insumo_id,
      quantidade: i.quantidade,
    })),
  );
  const [novoInsumo, setNovoInsumo] = useState("");
  const [novaSala, setNovaSala] = useState("");
  const [preparo, setPreparo] = useState("0");
  const [limpeza, setLimpeza] = useState("0");

  useSincronizarFormulario(procedimento.id, () => {
    setNome(procedimento.nome);
    setDuracao(String(procedimento.duracao_min));
    setPreco(String(procedimento.preco));
    setDescricao(procedimento.descricao_publica ?? "");
    setAtivo(procedimento.ativo === 1);
    setFicha(
      procedimento.ficha_tecnica.map((i) => ({ insumo_id: i.insumo_id, quantidade: i.quantidade })),
    );
  });

  const catalogoInsumos = insumos.data?.insumos ?? [];
  const custoFicha = useMemo(
    () =>
      ficha.reduce((total, item) => {
        const insumo = catalogoInsumos.find((i) => i.id === item.insumo_id);
        return total + (insumo ? insumo.custo_unitario * item.quantidade : 0);
      }, 0),
    [ficha, catalogoInsumos],
  );

  const falhou = (titulo: string) => (e: Error) =>
    mostrar({ tipo: "erro", titulo, detalhe: e.message });

  const habilitados = new Set(procedimento.profissionais.map((p) => p.id));
  const salasVinculadas = new Set(procedimento.recursos.map((r) => r.sala_id));

  return (
    <div className="space-y-6">
      {/* Cadastro */}
      <section className="space-y-4">
        <SectionLabel>Cadastro</SectionLabel>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome">
            {(props) => (
              <Input
                {...props}
                value={nome}
                disabled={!podeEscrever}
                onChange={(e) => setNome(e.target.value)}
              />
            )}
          </Field>
          <Field label="Duração (min)">
            {(props) => (
              <Input
                {...props}
                type="number"
                min={5}
                step={5}
                value={duracao}
                disabled={!podeEscrever}
                onChange={(e) => setDuracao(e.target.value)}
              />
            )}
          </Field>
          <Field label="Preço (R$)">
            {(props) => (
              <Input
                {...props}
                type="number"
                min={0}
                step="0.01"
                value={preco}
                disabled={!podeEscrever}
                onChange={(e) => setPreco(e.target.value)}
              />
            )}
          </Field>
          <Field label="Situação" hint="Não existe exclusão no contrato: desliga-se pelo ativo.">
            {(props) => (
              <Select
                {...props}
                value={ativo ? "1" : "0"}
                disabled={!podeEscrever}
                onChange={(e) => setAtivo(e.target.value === "1")}
              >
                <option value="1">Ativo</option>
                <option value="0">Inativo</option>
              </Select>
            )}
          </Field>
        </div>
        <Field label="Descrição pública">
          {(props) => (
            <Textarea
              {...props}
              value={descricao}
              disabled={!podeEscrever}
              onChange={(e) => setDescricao(e.target.value)}
            />
          )}
        </Field>
        {podeEscrever ? (
          <Button
            size="sm"
            disabled={atualizar.isPending}
            onClick={() =>
              atualizar.mutate(
                {
                  id: procedimento.id,
                  nome: nome.trim(),
                  duracao_min: Number(duracao),
                  preco: Number(preco),
                  ativo,
                  descricao_publica: descricao.trim() === "" ? null : descricao.trim(),
                },
                {
                  onSuccess: () => mostrar({ tipo: "sucesso", titulo: "Cadastro salvo" }),
                  onError: falhou("Não salvou"),
                },
              )
            }
          >
            {atualizar.isPending ? "Salvando…" : "Salvar cadastro"}
          </Button>
        ) : (
          <p className="text-muted-foreground text-[12px]">
            Somente leitura: escrever no catálogo exige{" "}
            <code className="font-mono">agenda:write</code>.
          </p>
        )}
      </section>

      {/* Profissionais habilitados */}
      <section className="space-y-3">
        <SectionLabel>Profissionais habilitados</SectionLabel>
        <p className="text-muted-foreground text-[12px]">
          A agenda só oferece o procedimento a quem está habilitado aqui.
        </p>
        {profissionais.isPending ? (
          <SkeletonTabela linhas={3} colunas={2} />
        ) : profissionais.isError ? (
          <ErrorState descricao={profissionais.error.message} />
        ) : (
          <ul className="divide-border divide-y">
            {profissionais.data.profissionais.map((p) => {
              const on = habilitados.has(p.id);
              return (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium">{p.nome}</span>
                    {p.especialidade && (
                      <span className="text-muted-foreground block text-[12px]">
                        {p.especialidade}
                      </span>
                    )}
                  </span>
                  <Button
                    size="sm"
                    variant={on ? "outline" : "default"}
                    disabled={!podeEscrever || habilitar.isPending || desabilitar.isPending}
                    onClick={() =>
                      on
                        ? desabilitar.mutate(
                            { id: procedimento.id, profissionalId: p.id },
                            { onError: falhou("Não removeu") },
                          )
                        : habilitar.mutate(
                            { id: procedimento.id, profissionalId: p.id },
                            { onError: falhou("Não habilitou") },
                          )
                    }
                  >
                    {on ? "Remover" : "Habilitar"}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Recursos */}
      <section className="space-y-3">
        <SectionLabel>Ocupação de sala / equipamento</SectionLabel>
        {procedimento.recursos.length === 0 ? (
          <p className="text-muted-foreground text-[13px]">
            Nenhum recurso vinculado — a agenda não reserva sala para este procedimento.
          </p>
        ) : (
          <ul className="divide-border divide-y">
            {procedimento.recursos.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium">{r.sala_nome}</span>
                  <span className="text-muted-foreground block text-[12px]">
                    preparo {r.tempo_preparo_min} min · limpeza {r.tempo_limpeza_min} min · {r.tipo}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!podeEscrever || desvincularRecurso.isPending}
                  onClick={() =>
                    desvincularRecurso.mutate(
                      { id: procedimento.id, recursoId: r.id },
                      { onError: falhou("Não desvinculou") },
                    )
                  }
                >
                  Desvincular
                </Button>
              </li>
            ))}
          </ul>
        )}
        {podeEscrever && (
          <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_90px_90px_auto]">
            <Field label="Sala / equipamento">
              {(props) => (
                <Select
                  {...props}
                  value={novaSala}
                  onChange={(e) => setNovaSala(e.target.value)}
                >
                  <option value="">Selecione…</option>
                  {(salas.data?.salas ?? [])
                    .filter((s) => !salasVinculadas.has(s.id))
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nome}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
            <Field label="Preparo">
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  min={0}
                  value={preparo}
                  onChange={(e) => setPreparo(e.target.value)}
                />
              )}
            </Field>
            <Field label="Limpeza">
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  min={0}
                  value={limpeza}
                  onChange={(e) => setLimpeza(e.target.value)}
                />
              )}
            </Field>
            <Button
              variant="outline"
              disabled={novaSala === "" || vincularRecurso.isPending}
              onClick={() =>
                vincularRecurso.mutate(
                  {
                    id: procedimento.id,
                    sala_id: novaSala,
                    tempo_preparo_min: Number(preparo) || 0,
                    tempo_limpeza_min: Number(limpeza) || 0,
                  },
                  {
                    onSuccess: () => setNovaSala(""),
                    onError: falhou("Não vinculou"),
                  },
                )
              }
            >
              Vincular
            </Button>
          </div>
        )}
      </section>

      {/* Ficha técnica */}
      <section className="space-y-3">
        <SectionLabel>Ficha técnica</SectionLabel>
        <p className="text-muted-foreground text-[12px]">
          É o que o atendimento consome de estoque. Salvar substitui a ficha inteira
          (<code className="font-mono">PUT …/ficha-tecnica</code>).
        </p>
        {ficha.length === 0 ? (
          <p className="text-muted-foreground text-[13px]">
            Sem insumos: o atendimento deste procedimento não baixa estoque.
          </p>
        ) : (
          <ul className="divide-border divide-y">
            {ficha.map((item, indice) => {
              const insumo = catalogoInsumos.find((i) => i.id === item.insumo_id);
              const original = procedimento.ficha_tecnica.find((f) => f.insumo_id === item.insumo_id);
              const rotulo = insumo?.nome ?? original?.insumo_nome ?? item.insumo_id;
              const unidade = insumo?.unidade ?? original?.unidade ?? "";
              return (
                <li key={item.insumo_id} className="flex items-center gap-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-[13px]">{rotulo}</span>
                  <label className="sr-only" htmlFor={`qtd-${item.insumo_id}`}>
                    Quantidade de {rotulo}
                  </label>
                  <Input
                    id={`qtd-${item.insumo_id}`}
                    type="number"
                    min={0}
                    step="0.01"
                    className="w-24"
                    value={String(item.quantidade)}
                    disabled={!podeEscrever}
                    onChange={(e) =>
                      setFicha((atual) =>
                        atual.map((f, i) =>
                          i === indice ? { ...f, quantidade: Number(e.target.value) } : f,
                        ),
                      )
                    }
                  />
                  <span className="text-muted-foreground w-12 shrink-0 text-[12px]">{unidade}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!podeEscrever}
                    onClick={() => setFicha((atual) => atual.filter((_, i) => i !== indice))}
                  >
                    Remover
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-[13px]">
          Custo de insumos por atendimento: <strong className="tabular">{brl(custoFicha)}</strong>
          {insumos.isPending && (
            <span className="text-muted-foreground"> (carregando custos…)</span>
          )}
        </p>
        {podeEscrever && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Field label="Adicionar insumo" className="flex-1">
              {(props) => (
                <Select
                  {...props}
                  value={novoInsumo}
                  onChange={(e) => setNovoInsumo(e.target.value)}
                >
                  <option value="">Selecione…</option>
                  {catalogoInsumos
                    .filter((i) => !ficha.some((f) => f.insumo_id === i.id))
                    .map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.nome} ({i.unidade})
                      </option>
                    ))}
                </Select>
              )}
            </Field>
            <Button
              variant="outline"
              disabled={novoInsumo === ""}
              onClick={() => {
                setFicha((atual) => [...atual, { insumo_id: novoInsumo, quantidade: 1 }]);
                setNovoInsumo("");
              }}
            >
              Adicionar
            </Button>
            <Button
              disabled={salvarFicha.isPending}
              onClick={() =>
                salvarFicha.mutate(
                  { id: procedimento.id, itens: ficha },
                  {
                    onSuccess: () => mostrar({ tipo: "sucesso", titulo: "Ficha técnica salva" }),
                    onError: falhou("Não salvou a ficha"),
                  },
                )
              }
            >
              {salvarFicha.isPending ? "Salvando…" : "Salvar ficha"}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

/* ───────────────────────────── Profissionais ───────────────────────────── */

function Profissionais() {
  const { pode } = useSessao();
  const profissionais = useProfissionais();
  const [emEdicao, setEmEdicao] = useState<Profissional | null>(null);
  const [criando, setCriando] = useState(false);
  const podeEscrever = pode("agenda:write");

  if (profissionais.isPending) {
    return (
      <Card>
        <SkeletonTabela linhas={4} colunas={4} />
      </Card>
    );
  }
  if (profissionais.isError) {
    return (
      <Card>
        <ErrorState
          descricao={profissionais.error.message}
          onRetry={() => void profissionais.refetch()}
        />
      </Card>
    );
  }

  const itens = profissionais.data.profissionais;

  return (
    <div className="space-y-5">
      <Card className="border-dashed">
        <CardContent className="py-4">
          <p className="text-muted-foreground text-[13px]">
            Este cadastro é a agenda do profissional, não o acesso ao sistema: a tabela{" "}
            <code className="font-mono">profissionais</code> não guarda registro em conselho (CRO) e
            não existe rota de criação/edição de usuários — a permissão{" "}
            <code className="font-mono">usuarios:write</code> existe no RBAC, mas nenhuma rota a
            usa. Vincular um profissional a um login só é possível informando um{" "}
            <code className="font-mono">usuario_id</code> já existente.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="min-w-0">
            <CardTitle className="font-display">Profissionais</CardTitle>
            <p className="text-muted-foreground mt-0.5 text-[12px]">
              Cor e disponibilidade usadas pela agenda.
            </p>
          </div>
          {podeEscrever && (
            <Button size="sm" onClick={() => setCriando(true)}>
              <Plus className="size-3.5" aria-hidden />
              Novo profissional
            </Button>
          )}
        </CardHeader>
        {itens.length === 0 ? (
          <EmptyState
            icone={UserRound}
            titulo="Nenhum profissional"
            descricao="Sem profissional cadastrado não há agenda para preencher."
          />
        ) : (
          <ul className="divide-border divide-y">
            {itens.map((p) => (
              <li key={p.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    className="mt-1 size-3 shrink-0 rounded-full border"
                    style={{ backgroundColor: p.cor ?? "transparent" }}
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold">{p.nome}</p>
                    <p className="text-muted-foreground mt-0.5 text-[12px]">
                      {p.especialidade ?? "Sem especialidade"} ·{" "}
                      {p.usuario_id ? "com login vinculado" : "sem login vinculado"}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <Badge tom={p.ativo === 1 ? "success" : "neutro"}>
                        {p.ativo === 1 ? "Ativo" : "Inativo"}
                      </Badge>
                      <BadgeBloqueios json={p.bloqueios_agenda} />
                    </div>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => setEmEdicao(p)}
                >
                  <Pencil className="size-3.5" aria-hidden />
                  {podeEscrever ? "Editar" : "Ver"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <DialogProfissional
        profissional={emEdicao}
        onFechar={() => setEmEdicao(null)}
        podeEscrever={podeEscrever}
      />
      <DialogNovoProfissional aberto={criando} onFechar={() => setCriando(false)} />
    </div>
  );
}

function bloqueiosDe(json: string | null): Bloqueio[] {
  if (!json) return [];
  try {
    const dados: unknown = JSON.parse(json);
    return Array.isArray(dados) ? (dados as Bloqueio[]) : [];
  } catch {
    return [];
  }
}

function BadgeBloqueios({ json }: { json: string | null }) {
  const total = bloqueiosDe(json).length;
  if (total === 0) return null;
  return <Badge tom="warning">{total} bloqueio(s) na agenda</Badge>;
}

function DialogProfissional({
  profissional,
  onFechar,
  podeEscrever,
}: {
  profissional: Profissional | null;
  onFechar: () => void;
  podeEscrever: boolean;
}) {
  const { mostrar } = useToast();
  const atualizar = useAtualizarProfissional();
  const [nome, setNome] = useState("");
  const [especialidade, setEspecialidade] = useState("");
  const [cor, setCor] = useState("#3F6B5B");
  const [ativo, setAtivo] = useState(true);

  useSincronizarFormulario(profissional?.id ?? null, () => {
    if (profissional) {
      setNome(profissional.nome);
      setEspecialidade(profissional.especialidade ?? "");
      setCor(profissional.cor ?? "#3F6B5B");
      setAtivo(profissional.ativo === 1);
    }
  });

  const bloqueios = bloqueiosDe(profissional?.bloqueios_agenda ?? null);

  return (
    <Dialog
      aberto={profissional !== null}
      onFechar={onFechar}
      titulo={profissional?.nome ?? "Profissional"}
      descricao="Dados usados pela agenda e pelo agente ao oferecer horários."
      rodape={
        <>
          <Button variant="ghost" onClick={onFechar}>
            Fechar
          </Button>
          {podeEscrever && profissional && (
            <Button
              disabled={atualizar.isPending}
              onClick={() =>
                atualizar.mutate(
                  {
                    id: profissional.id,
                    nome: nome.trim(),
                    especialidade: especialidade.trim() === "" ? null : especialidade.trim(),
                    cor,
                    ativo,
                  },
                  {
                    onSuccess: () => {
                      onFechar();
                      mostrar({ tipo: "sucesso", titulo: "Profissional atualizado" });
                    },
                    onError: (e) =>
                      mostrar({ tipo: "erro", titulo: "Não salvou", detalhe: e.message }),
                  },
                )
              }
            >
              {atualizar.isPending ? "Salvando…" : "Salvar"}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Nome">
          {(props) => (
            <Input
              {...props}
              value={nome}
              disabled={!podeEscrever}
              onChange={(e) => setNome(e.target.value)}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Especialidade" hint="Campo livre — não é registro em conselho.">
            {(props) => (
              <Input
                {...props}
                value={especialidade}
                disabled={!podeEscrever}
                onChange={(e) => setEspecialidade(e.target.value)}
              />
            )}
          </Field>
          <Field label="Cor na agenda">
            {(props) => (
              <Input
                {...props}
                type="color"
                className="h-9 p-1"
                value={cor}
                disabled={!podeEscrever}
                onChange={(e) => setCor(e.target.value)}
              />
            )}
          </Field>
        </div>
        <Field label="Situação">
          {(props) => (
            <Select
              {...props}
              value={ativo ? "1" : "0"}
              disabled={!podeEscrever}
              onChange={(e) => setAtivo(e.target.value === "1")}
            >
              <option value="1">Ativo</option>
              <option value="0">Inativo</option>
            </Select>
          )}
        </Field>

        <section className="space-y-2">
          <SectionLabel>Bloqueios de agenda</SectionLabel>
          {bloqueios.length === 0 ? (
            <p className="text-muted-foreground text-[13px]">Nenhum bloqueio registrado.</p>
          ) : (
            <ul className="space-y-1.5">
              {bloqueios.map((b, i) => (
                <li key={`${b.inicio}-${i}`} className="text-[13px]">
                  <span className="tabular">
                    {dataHoraDe(b.inicio)} → {dataHoraDe(b.fim)}
                  </span>
                  <span className="text-muted-foreground"> · {b.motivo}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-muted-foreground text-[12px]">
            Somente leitura aqui: os bloqueios vêm como JSON no cadastro e o PATCH substituiria a
            lista inteira. Criar bloqueio é ação da agenda
            (<code className="font-mono">POST /agenda/bloqueios</code>); não existe rota que leia
            bloqueios por dia.
          </p>
        </section>
      </div>
    </Dialog>
  );
}

function DialogNovoProfissional({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const { mostrar } = useToast();
  const criar = useCriarProfissional();
  const [nome, setNome] = useState("");
  const [especialidade, setEspecialidade] = useState("");
  const [cor, setCor] = useState("#3F6B5B");
  const [usuarioId, setUsuarioId] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (aberto) {
      setNome("");
      setEspecialidade("");
      setCor("#3F6B5B");
      setUsuarioId("");
      setErro(null);
    }
  }, [aberto]);

  return (
    <Dialog
      aberto={aberto}
      onFechar={onFechar}
      titulo="Novo profissional"
      rodape={
        <>
          <Button variant="ghost" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            disabled={criar.isPending}
            onClick={() => {
              if (nome.trim().length < 2) {
                setErro("Informe o nome.");
                return;
              }
              setErro(null);
              criar.mutate(
                {
                  nome: nome.trim(),
                  especialidade: especialidade.trim() || undefined,
                  cor,
                  usuario_id: usuarioId.trim() || undefined,
                },
                {
                  onSuccess: (r) => {
                    onFechar();
                    mostrar({ tipo: "sucesso", titulo: "Profissional criado", detalhe: r.profissional.nome });
                  },
                  onError: (e) => setErro(e.message),
                },
              );
            }}
          >
            {criar.isPending ? "Criando…" : "Criar"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Nome">
          {(props) => <Input {...props} value={nome} onChange={(e) => setNome(e.target.value)} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Especialidade">
            {(props) => (
              <Input
                {...props}
                value={especialidade}
                onChange={(e) => setEspecialidade(e.target.value)}
              />
            )}
          </Field>
          <Field label="Cor na agenda">
            {(props) => (
              <Input
                {...props}
                type="color"
                className="h-9 p-1"
                value={cor}
                onChange={(e) => setCor(e.target.value)}
              />
            )}
          </Field>
        </div>
        <Field
          label="ID do usuário (opcional)"
          hint="Vincula a um login já existente. Não existe rota para criar usuários."
        >
          {(props) => (
            <Input {...props} value={usuarioId} onChange={(e) => setUsuarioId(e.target.value)} />
          )}
        </Field>
        {erro && (
          <p className="text-destructive text-[13px]" role="alert">
            {erro}
          </p>
        )}
      </div>
    </Dialog>
  );
}

/* ──────────────────────── Salas e equipamentos ──────────────────────── */

function Recursos() {
  const { pode } = useSessao();
  const salas = useSalas();
  const [emEdicao, setEmEdicao] = useState<Sala | null>(null);
  const [criando, setCriando] = useState(false);
  const podeEscrever = pode("agenda:write");

  if (salas.isPending) {
    return (
      <Card>
        <SkeletonTabela linhas={3} colunas={3} />
      </Card>
    );
  }
  if (salas.isError) {
    return (
      <Card>
        <ErrorState descricao={salas.error.message} onRetry={() => void salas.refetch()} />
      </Card>
    );
  }

  const itens = salas.data.salas;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <div className="min-w-0">
            <CardTitle className="font-display">Salas e equipamentos</CardTitle>
            <p className="text-muted-foreground mt-0.5 text-[12px]">
              Recursos disputados pela agenda: dois atendimentos não ocupam o mesmo.
            </p>
          </div>
          {podeEscrever && (
            <Button size="sm" onClick={() => setCriando(true)}>
              <Plus className="size-3.5" aria-hidden />
              Novo recurso
            </Button>
          )}
        </CardHeader>
        {itens.length === 0 ? (
          <EmptyState
            icone={DoorOpen}
            titulo="Nenhum recurso"
            descricao="Sem sala cadastrada a agenda não controla ocupação física."
          />
        ) : (
          <ul className="divide-border divide-y">
            {itens.map((s) => (
              <li key={s.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold">{s.nome}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <Badge tom={s.tipo === "sala" ? "info" : "neutro"}>
                      {s.tipo === "sala" ? "Sala" : "Equipamento"}
                    </Badge>
                    <Badge tom={s.ativo === 1 ? "success" : "neutro"}>
                      {s.ativo === 1 ? "Ativo" : "Inativo"}
                    </Badge>
                    <BadgeBloqueios json={s.bloqueios_agenda} />
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => setEmEdicao(s)}
                >
                  <Pencil className="size-3.5" aria-hidden />
                  {podeEscrever ? "Editar" : "Ver"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <DialogSala sala={emEdicao} onFechar={() => setEmEdicao(null)} podeEscrever={podeEscrever} />
      <DialogNovaSala aberto={criando} onFechar={() => setCriando(false)} />
    </div>
  );
}

function DialogSala({
  sala,
  onFechar,
  podeEscrever,
}: {
  sala: Sala | null;
  onFechar: () => void;
  podeEscrever: boolean;
}) {
  const { mostrar } = useToast();
  const atualizar = useAtualizarSala();
  const [nome, setNome] = useState("");
  const [ativo, setAtivo] = useState(true);

  useSincronizarFormulario(sala?.id ?? null, () => {
    if (sala) {
      setNome(sala.nome);
      setAtivo(sala.ativo === 1);
    }
  });

  const bloqueios = bloqueiosDe(sala?.bloqueios_agenda ?? null);

  return (
    <Dialog
      aberto={sala !== null}
      onFechar={onFechar}
      titulo={sala?.nome ?? "Recurso"}
      descricao="O tipo é definido na criação: o PATCH do contrato não o altera."
      rodape={
        <>
          <Button variant="ghost" onClick={onFechar}>
            Fechar
          </Button>
          {podeEscrever && sala && (
            <Button
              disabled={atualizar.isPending}
              onClick={() =>
                atualizar.mutate(
                  { id: sala.id, nome: nome.trim(), ativo },
                  {
                    onSuccess: () => {
                      onFechar();
                      mostrar({ tipo: "sucesso", titulo: "Recurso atualizado" });
                    },
                    onError: (e) =>
                      mostrar({ tipo: "erro", titulo: "Não salvou", detalhe: e.message }),
                  },
                )
              }
            >
              {atualizar.isPending ? "Salvando…" : "Salvar"}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Nome">
          {(props) => (
            <Input
              {...props}
              value={nome}
              disabled={!podeEscrever}
              onChange={(e) => setNome(e.target.value)}
            />
          )}
        </Field>
        <Field label="Situação">
          {(props) => (
            <Select
              {...props}
              value={ativo ? "1" : "0"}
              disabled={!podeEscrever}
              onChange={(e) => setAtivo(e.target.value === "1")}
            >
              <option value="1">Ativo</option>
              <option value="0">Inativo</option>
            </Select>
          )}
        </Field>
        <section className="space-y-2">
          <SectionLabel>Bloqueios de agenda</SectionLabel>
          {bloqueios.length === 0 ? (
            <p className="text-muted-foreground text-[13px]">Nenhum bloqueio registrado.</p>
          ) : (
            <ul className="space-y-1.5">
              {bloqueios.map((b, i) => (
                <li key={`${b.inicio}-${i}`} className="text-[13px]">
                  <span className="tabular">
                    {dataHoraDe(b.inicio)} → {dataHoraDe(b.fim)}
                  </span>
                  <span className="text-muted-foreground"> · {b.motivo}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Dialog>
  );
}

function DialogNovaSala({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const { mostrar } = useToast();
  const criar = useCriarSala();
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState<"sala" | "equipamento">("sala");
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (aberto) {
      setNome("");
      setTipo("sala");
      setErro(null);
    }
  }, [aberto]);

  return (
    <Dialog
      aberto={aberto}
      onFechar={onFechar}
      titulo="Novo recurso"
      rodape={
        <>
          <Button variant="ghost" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            disabled={criar.isPending}
            onClick={() => {
              if (nome.trim().length < 2) {
                setErro("Informe o nome.");
                return;
              }
              setErro(null);
              criar.mutate(
                { nome: nome.trim(), tipo },
                {
                  onSuccess: (r) => {
                    onFechar();
                    mostrar({ tipo: "sucesso", titulo: "Recurso criado", detalhe: r.sala.nome });
                  },
                  onError: (e) => setErro(e.message),
                },
              );
            }}
          >
            {criar.isPending ? "Criando…" : "Criar"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Nome">
          {(props) => <Input {...props} value={nome} onChange={(e) => setNome(e.target.value)} />}
        </Field>
        <Field label="Tipo" hint="Só definível na criação.">
          {(props) => (
            <Select
              {...props}
              value={tipo}
              onChange={(e) => setTipo(e.target.value as "sala" | "equipamento")}
            >
              <option value="sala">Sala</option>
              <option value="equipamento">Equipamento</option>
            </Select>
          )}
        </Field>
        {erro && (
          <p className="text-destructive text-[13px]" role="alert">
            {erro}
          </p>
        )}
      </div>
    </Dialog>
  );
}

/* ──────────────────────────────── Insumos ──────────────────────────────── */

function Insumos() {
  const { pode } = useSessao();
  const insumos = useInsumos();
  const [emEdicao, setEmEdicao] = useState<Insumo | null>(null);
  const [criando, setCriando] = useState(false);
  const podeEscrever = pode("agenda:write");

  if (insumos.isPending) {
    return (
      <Card>
        <SkeletonTabela linhas={5} colunas={5} />
      </Card>
    );
  }
  if (insumos.isError) {
    return (
      <Card>
        <ErrorState descricao={insumos.error.message} onRetry={() => void insumos.refetch()} />
      </Card>
    );
  }

  const itens = insumos.data.insumos;
  const emFalta = itens.filter((i) => i.ativo === 1 && i.estoque_atual < i.estoque_minimo);
  const valorEstoque = itens.reduce((t, i) => t + i.custo_unitario * i.estoque_atual, 0);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          rotulo="Insumos ativos"
          valor={String(itens.filter((i) => i.ativo === 1).length)}
          apoio={`${itens.length} cadastrados`}
          icone={Package}
          tom="primary"
        />
        <KpiCard
          rotulo="Abaixo do mínimo"
          valor={String(emFalta.length)}
          apoio={emFalta.length > 0 ? "Repor antes de agendar" : "Estoque saudável"}
          icone={PackageX}
          tom={emFalta.length > 0 ? "warning" : "success"}
        />
        <KpiCard
          rotulo="Valor em estoque"
          valor={brl(valorEstoque)}
          apoio="Custo unitário × saldo"
          icone={Boxes}
        />
      </div>

      {emFalta.length > 0 && (
        <Card className="border-warning/30">
          <CardContent className="flex items-start gap-2.5 py-4">
            <TriangleAlert className="text-warning mt-0.5 size-4 shrink-0" aria-hidden />
            <p className="text-[13px]">
              <strong className="font-semibold">Abaixo do mínimo:</strong>{" "}
              {emFalta.map((i) => `${i.nome} (${numero(i.estoque_atual)} ${i.unidade})`).join(", ")}
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="min-w-0">
            <CardTitle className="font-display">Insumos</CardTitle>
            <p className="text-muted-foreground mt-0.5 text-[12px]">
              O saldo muda por movimentação — não é campo editável.
            </p>
          </div>
          {podeEscrever && (
            <Button size="sm" onClick={() => setCriando(true)}>
              <Plus className="size-3.5" aria-hidden />
              Novo insumo
            </Button>
          )}
        </CardHeader>

        {itens.length === 0 ? (
          <EmptyState
            icone={Package}
            titulo="Nenhum insumo"
            descricao="Sem insumo cadastrado, a ficha técnica dos procedimentos fica vazia."
          />
        ) : (
          <>
            <div className="hidden lg:block">
              <Table>
                <THead>
                  <tr>
                    <th>Insumo</th>
                    <th>Custo unit.</th>
                    <th>Saldo</th>
                    <th>Mínimo</th>
                    <th>Situação</th>
                    <th className="text-right">Ações</th>
                  </tr>
                </THead>
                <TBody>
                  {itens.map((i) => (
                    <TRow key={i.id}>
                      <td className="font-medium">{i.nome}</td>
                      <td className="tabular">{brl(i.custo_unitario)}</td>
                      <td
                        className={cn(
                          "tabular",
                          i.estoque_atual < i.estoque_minimo && "text-warning font-semibold",
                        )}
                      >
                        {numero(i.estoque_atual)} {i.unidade}
                      </td>
                      <td className="tabular">{numero(i.estoque_minimo)}</td>
                      <td>
                        <Badge tom={i.ativo === 1 ? "success" : "neutro"}>
                          {i.ativo === 1 ? "Ativo" : "Inativo"}
                        </Badge>
                      </td>
                      <td className="text-right">
                        <Button variant="outline" size="sm" onClick={() => setEmEdicao(i)}>
                          <Pencil className="size-3.5" aria-hidden />
                          {podeEscrever ? "Editar" : "Ver"}
                        </Button>
                      </td>
                    </TRow>
                  ))}
                </TBody>
              </Table>
            </div>
            <ul className="divide-border divide-y lg:hidden">
              {itens.map((i) => (
                <li key={i.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold">{i.nome}</p>
                    <p className="text-muted-foreground mt-0.5 text-[12px]">
                      {brl(i.custo_unitario)} / {i.unidade} · saldo {numero(i.estoque_atual)} (mín.{" "}
                      {numero(i.estoque_minimo)})
                    </p>
                    {i.estoque_atual < i.estoque_minimo && (
                      <Badge tom="warning" className="mt-1.5">
                        Abaixo do mínimo
                      </Badge>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => setEmEdicao(i)}
                  >
                    {podeEscrever ? "Editar" : "Ver"}
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <DialogInsumo
        insumo={emEdicao}
        onFechar={() => setEmEdicao(null)}
        podeEscrever={podeEscrever}
      />
      <DialogNovoInsumo aberto={criando} onFechar={() => setCriando(false)} />
    </div>
  );
}

function DialogInsumo({
  insumo,
  onFechar,
  podeEscrever,
}: {
  insumo: Insumo | null;
  onFechar: () => void;
  podeEscrever: boolean;
}) {
  const { mostrar } = useToast();
  const atualizar = useAtualizarInsumo();
  const movimentar = useMovimentarInsumo();

  const [nome, setNome] = useState("");
  const [unidade, setUnidade] = useState("");
  const [custo, setCusto] = useState("0");
  const [minimo, setMinimo] = useState("0");
  const [ativo, setAtivo] = useState(true);
  const [tipoMov, setTipoMov] = useState<"entrada" | "saida">("entrada");
  const [quantidade, setQuantidade] = useState("");
  const [motivo, setMotivo] = useState("");

  useSincronizarFormulario(insumo?.id ?? null, () => {
    if (insumo) {
      setNome(insumo.nome);
      setUnidade(insumo.unidade);
      setCusto(String(insumo.custo_unitario));
      setMinimo(String(insumo.estoque_minimo));
      setAtivo(insumo.ativo === 1);
      setQuantidade("");
      setMotivo("");
      setTipoMov("entrada");
    }
  });

  return (
    <Dialog
      aberto={insumo !== null}
      onFechar={onFechar}
      titulo={insumo?.nome ?? "Insumo"}
      descricao="Cadastro e movimentação de estoque."
      rodape={
        <Button variant="ghost" onClick={onFechar}>
          Fechar
        </Button>
      }
    >
      {insumo && (
        <div className="space-y-6">
          <section className="space-y-4">
            <SectionLabel>Cadastro</SectionLabel>
            <Field label="Nome">
              {(props) => (
                <Input
                  {...props}
                  value={nome}
                  disabled={!podeEscrever}
                  onChange={(e) => setNome(e.target.value)}
                />
              )}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Unidade">
                {(props) => (
                  <Input
                    {...props}
                    value={unidade}
                    disabled={!podeEscrever}
                    onChange={(e) => setUnidade(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Custo unitário (R$)">
                {(props) => (
                  <Input
                    {...props}
                    type="number"
                    min={0}
                    step="0.01"
                    value={custo}
                    disabled={!podeEscrever}
                    onChange={(e) => setCusto(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Estoque mínimo">
                {(props) => (
                  <Input
                    {...props}
                    type="number"
                    min={0}
                    step="0.01"
                    value={minimo}
                    disabled={!podeEscrever}
                    onChange={(e) => setMinimo(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Situação">
                {(props) => (
                  <Select
                    {...props}
                    value={ativo ? "1" : "0"}
                    disabled={!podeEscrever}
                    onChange={(e) => setAtivo(e.target.value === "1")}
                  >
                    <option value="1">Ativo</option>
                    <option value="0">Inativo</option>
                  </Select>
                )}
              </Field>
            </div>
            <p className="text-muted-foreground text-[12px]">
              Saldo atual: <strong className="tabular">{numero(insumo.estoque_atual)}</strong>{" "}
              {insumo.unidade}. O saldo não é editável por cadastro — só muda por movimentação,
              para o rastro não ficar inconsistente.
            </p>
            {podeEscrever && (
              <Button
                size="sm"
                disabled={atualizar.isPending}
                onClick={() =>
                  atualizar.mutate(
                    {
                      id: insumo.id,
                      nome: nome.trim(),
                      unidade: unidade.trim(),
                      custo_unitario: Number(custo),
                      estoque_minimo: Number(minimo),
                      ativo,
                    },
                    {
                      onSuccess: () => mostrar({ tipo: "sucesso", titulo: "Insumo atualizado" }),
                      onError: (e) =>
                        mostrar({ tipo: "erro", titulo: "Não salvou", detalhe: e.message }),
                    },
                  )
                }
              >
                {atualizar.isPending ? "Salvando…" : "Salvar cadastro"}
              </Button>
            )}
          </section>

          {podeEscrever && (
            <section className="space-y-4">
              <SectionLabel>Movimentar estoque</SectionLabel>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Tipo">
                  {(props) => (
                    <Select
                      {...props}
                      value={tipoMov}
                      onChange={(e) => setTipoMov(e.target.value as "entrada" | "saida")}
                    >
                      <option value="entrada">Entrada (compra, devolução)</option>
                      <option value="saida">Saída (perda, ajuste)</option>
                    </Select>
                  )}
                </Field>
                <Field label="Quantidade">
                  {(props) => (
                    <Input
                      {...props}
                      type="number"
                      min={0}
                      step="0.01"
                      value={quantidade}
                      onChange={(e) => setQuantidade(e.target.value)}
                    />
                  )}
                </Field>
              </div>
              <Field label="Motivo" hint="Fica no rastro da movimentação.">
                {(props) => (
                  <Input {...props} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                )}
              </Field>
              <Button
                variant="outline"
                size="sm"
                disabled={movimentar.isPending || quantidade === "" || Number(quantidade) <= 0}
                onClick={() =>
                  movimentar.mutate(
                    {
                      id: insumo.id,
                      tipo: tipoMov,
                      quantidade: Number(quantidade),
                      motivo: motivo.trim() || undefined,
                    },
                    {
                      onSuccess: (r) => {
                        setQuantidade("");
                        setMotivo("");
                        mostrar({
                          tipo: "sucesso",
                          titulo: "Estoque movimentado",
                          detalhe: `Novo saldo: ${numero(r.estoque_atual)} ${insumo.unidade}`,
                        });
                      },
                      onError: (e) =>
                        mostrar({ tipo: "erro", titulo: "Não movimentou", detalhe: e.message }),
                    },
                  )
                }
              >
                {movimentar.isPending ? "Registrando…" : "Registrar movimentação"}
              </Button>
            </section>
          )}
        </div>
      )}
    </Dialog>
  );
}

function DialogNovoInsumo({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const { mostrar } = useToast();
  const criar = useCriarInsumo();
  const [nome, setNome] = useState("");
  const [unidade, setUnidade] = useState("un");
  const [custo, setCusto] = useState("");
  const [inicial, setInicial] = useState("");
  const [minimo, setMinimo] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (aberto) {
      setNome("");
      setUnidade("un");
      setCusto("");
      setInicial("");
      setMinimo("");
      setErro(null);
    }
  }, [aberto]);

  return (
    <Dialog
      aberto={aberto}
      onFechar={onFechar}
      titulo="Novo insumo"
      descricao="O estoque inicial só pode ser informado na criação."
      rodape={
        <>
          <Button variant="ghost" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            disabled={criar.isPending}
            onClick={() => {
              if (nome.trim().length < 2) {
                setErro("Informe o nome.");
                return;
              }
              setErro(null);
              criar.mutate(
                {
                  nome: nome.trim(),
                  unidade: unidade.trim() || undefined,
                  custo_unitario: custo === "" ? undefined : Number(custo),
                  estoque_atual: inicial === "" ? undefined : Number(inicial),
                  estoque_minimo: minimo === "" ? undefined : Number(minimo),
                },
                {
                  onSuccess: (r) => {
                    onFechar();
                    mostrar({ tipo: "sucesso", titulo: "Insumo criado", detalhe: r.insumo.nome });
                  },
                  onError: (e) => setErro(e.message),
                },
              );
            }}
          >
            {criar.isPending ? "Criando…" : "Criar"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Nome">
          {(props) => <Input {...props} value={nome} onChange={(e) => setNome(e.target.value)} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Unidade">
            {(props) => (
              <Input {...props} value={unidade} onChange={(e) => setUnidade(e.target.value)} />
            )}
          </Field>
          <Field label="Custo unitário (R$)">
            {(props) => (
              <Input
                {...props}
                type="number"
                min={0}
                step="0.01"
                value={custo}
                onChange={(e) => setCusto(e.target.value)}
              />
            )}
          </Field>
          <Field label="Estoque inicial">
            {(props) => (
              <Input
                {...props}
                type="number"
                min={0}
                step="0.01"
                value={inicial}
                onChange={(e) => setInicial(e.target.value)}
              />
            )}
          </Field>
          <Field label="Estoque mínimo">
            {(props) => (
              <Input
                {...props}
                type="number"
                min={0}
                step="0.01"
                value={minimo}
                onChange={(e) => setMinimo(e.target.value)}
              />
            )}
          </Field>
        </div>
        {erro && (
          <p className="text-destructive text-[13px]" role="alert">
            {erro}
          </p>
        )}
      </div>
    </Dialog>
  );
}
