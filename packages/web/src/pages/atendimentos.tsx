/**
 * Atendimentos, financeiro derivado e estoque.
 *
 * Rotas reais (`packages/api/src/routes/atendimentos.ts`):
 *   GET  /atendimentos?profissional_id&cliente_id&status&de&ate   (atendimentos:read)
 *   POST /atendimentos                                            (atendimentos:write)
 *   POST /atendimentos/:id/reembolsar                             (financeiro:read)
 *   GET  /atendimentos/indicadores/no-show                        (relatorios:read)
 *   GET  /atendimentos/estoque/movimentacoes                      (relatorios:read)
 *   GET  /atendimentos/estoque/abaixo-do-minimo                   (relatorios:read)
 *
 * LIMITES DO CONTRATO (à mostra na interface):
 *   - Não existe rota para editar um atendimento já registrado: o fluxo é
 *     registrar e, se preciso, estornar. Nada de "mudar status".
 *   - A tabela `pagamentos` é escrita pelo servidor ao registrar, mas nenhuma
 *     rota a devolve: forma e status de pagamento não são legíveis. O painel
 *     financeiro é derivado de `valor`, `custo_insumos` e `efeito` do próprio
 *     atendimento.
 *   - A listagem não traz resumo agregado — os KPIs são somados no cliente
 *     sobre as linhas carregadas (limite de 500 no servidor).
 *   - Quem só tem `atendimentos:read_own` recebe apenas os próprios registros:
 *     o recorte é do servidor, e a interface diz isso.
 */
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownUp,
  ClipboardList,
  Filter,
  Gift,
  PackageX,
  Plus,
  RotateCcw,
  TrendingDown,
  TrendingUp,
  Undo2,
  UserX,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { KpiCard } from "@/components/kpi-card";
import { useSessao } from "@/components/sessao";
import { Badge, STATUS_ATENDIMENTO } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, SectionLabel } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { SkeletonCards, SkeletonTabela } from "@/components/ui/skeleton";
import { Table, TBody, THead, TRow } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { DeniedState, EmptyState, ErrorState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import {
  brl,
  dataCurtaDe,
  dataHoraDe,
  hojeNaClinica,
  inicioDoDia,
  numero,
  somarDias,
} from "@/lib/formato";
import { ROLE_ROTULO } from "@/lib/rbac";
import { cn } from "@/lib/utils";
import {
  STATUS_ATENDIMENTO as STATUS_LISTA,
  STATUS_ATENDIMENTO_REGISTRAVEIS,
  useAtendimentos,
  useIndicadorNoShow,
  useInsumosEmFalta,
  useMovimentacoesEstoque,
  useRegistrarAtendimento,
  useReembolsarAtendimento,
} from "@/queries/atendimentos";
import { useProcedimentos, useProfissionais } from "@/queries/catalogo";
import { useClientes } from "@/queries/clientes";
import type { Atendimento, StatusAtendimento } from "@/queries/tipos";

/** Formas aceitas pelo servidor em `pagamentos.forma` (campo de texto livre no POST). */
const FORMAS = ["dinheiro", "pix", "cartao_credito", "cartao_debito", "pacote"] as const;
const FORMA_ROTULO: Record<string, string> = {
  dinheiro: "Dinheiro",
  pix: "Pix",
  cartao_credito: "Cartão de crédito",
  cartao_debito: "Cartão de débito",
  pacote: "Pacote",
};

export default function AtendimentosPage() {
  const { usuario, pode } = useSessao();
  const [aba, setAba] = useState<"registros" | "financeiro" | "estoque">("registros");

  if (!pode("atendimentos:read")) {
    return (
      <AppShell titulo="Atendimentos" descricao="Execução, receita e baixa de insumos.">
        <Card>
          <DeniedState
            recurso="atendimentos"
            role={ROLE_ROTULO[usuario?.role ?? "profissional"]}
            permissao="atendimentos:read"
          />
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell
      titulo="Atendimentos"
      descricao="O que foi executado, quanto entrou e o que saiu do estoque."
    >
      <Tabs
        className="mb-5"
        abas={[
          { id: "registros" as const, rotulo: "Registros" },
          { id: "financeiro" as const, rotulo: "Financeiro" },
          { id: "estoque" as const, rotulo: "Estoque & no-show" },
        ]}
        atual={aba}
        onMudar={setAba}
      />
      {aba === "registros" && <Registros />}
      {aba === "financeiro" && <Financeiro />}
      {aba === "estoque" && <EstoqueENoShow />}
    </AppShell>
  );
}

/** Intervalo padrão: últimos 30 dias no fuso da clínica. */
function useIntervaloPadrao() {
  return useMemo(() => {
    const hoje = hojeNaClinica();
    return { de: somarDias(hoje, -30), ate: hoje };
  }, []);
}

const isoDe = (dia: string) => new Date(inicioDoDia(dia)).toISOString();
const isoAte = (dia: string) => new Date(inicioDoDia(dia) + 86_399_999).toISOString();

interface Resumo {
  total: number;
  receita: number;
  custo: number;
  margem: number;
  faltas: number;
  brindes: number;
  reembolsos: number;
}

/** O servidor não devolve resumo: somado aqui sobre as linhas carregadas. */
function resumir(itens: Atendimento[]): Resumo {
  let receita = 0;
  let custo = 0;
  let faltas = 0;
  let brindes = 0;
  let reembolsos = 0;
  for (const a of itens) {
    if (a.efeito.receita) receita += a.valor;
    custo += a.custo_insumos;
    if (a.status === "falta") faltas += 1;
    if (a.status === "brinde") brindes += 1;
    if (a.status === "reembolsado") reembolsos += 1;
  }
  return { total: itens.length, receita, custo, margem: receita - custo, faltas, brindes, reembolsos };
}

/* ──────────────────────────────── Registros ──────────────────────────────── */

function Registros() {
  const { pode, soProprios } = useSessao();
  const padrao = useIntervaloPadrao();
  const escopoProprio = soProprios("atendimentos");
  const [status, setStatus] = useState<StatusAtendimento | "">("");
  const [profissionalId, setProfissionalId] = useState("");
  const [de, setDe] = useState(padrao.de);
  const [ate, setAte] = useState(padrao.ate);
  const [aberto, setAberto] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);

  const profissionais = useProfissionais(true, !escopoProprio);
  const lista = useAtendimentos({
    status: status || undefined,
    profissional_id: escopoProprio ? undefined : profissionalId || undefined,
    de: isoDe(de),
    ate: isoAte(ate),
  });

  const itens = lista.data?.atendimentos ?? [];
  const resumo = useMemo(() => resumir(itens), [itens]);
  const atendimento = itens.find((a) => a.id === aberto) ?? null;
  const podeEscrever = pode("atendimentos:write");

  return (
    <div className="space-y-5">
      {escopoProprio && (
        <p className="border-info/25 bg-info-soft text-info rounded-md border px-4 py-2.5 text-[13px]">
          Seu perfil tem <code className="tabular">atendimentos:read_own</code>: o servidor devolve
          apenas os atendimentos vinculados ao seu cadastro de profissional.
        </p>
      )}
      {lista.data?.aviso && (
        <p className="border-warning/30 bg-warning-soft rounded-md border px-4 py-2.5 text-[13px]">
          {lista.data.aviso}
        </p>
      )}

      {lista.isLoading ? (
        <SkeletonCards quantidade={4} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            rotulo="Atendimentos"
            valor={numero(resumo.total)}
            apoio={`${resumo.faltas} falta(s) no período`}
            icone={ClipboardList}
            tom="primary"
          />
          <KpiCard
            rotulo="Receita"
            valor={brl(resumo.receita)}
            apoio="Soma dos registros com efeito de receita"
            icone={TrendingUp}
            tom="success"
          />
          <KpiCard
            rotulo="Custo de insumos"
            valor={brl(resumo.custo)}
            apoio="Baixa pela ficha técnica"
            icone={TrendingDown}
            tom="warning"
          />
          <KpiCard
            rotulo="Margem"
            valor={brl(resumo.margem)}
            apoio={`${resumo.brindes} brinde(s) · ${resumo.reembolsos} estorno(s)`}
            icone={Gift}
            tom="accent"
          />
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="min-w-0">
            <CardTitle className="font-display">Registros</CardTitle>
            <p className="text-muted-foreground mt-1 text-[13px]">
              Cada linha é um atendimento executado. Registrar dá baixa no estoque pela ficha técnica.
            </p>
          </div>
          <div className="flex w-full flex-wrap items-end gap-3 sm:w-auto sm:shrink-0">
            <Field label="De" className="w-[calc(50%-0.375rem)] sm:w-[150px]">
              {(p) => <Input {...p} type="date" value={de} max={ate} onChange={(e) => setDe(e.target.value)} />}
            </Field>
            <Field label="Até" className="w-[calc(50%-0.375rem)] sm:w-[150px]">
              {(p) => <Input {...p} type="date" value={ate} min={de} onChange={(e) => setAte(e.target.value)} />}
            </Field>
            <Field label="Status" className="w-[calc(50%-0.375rem)] sm:w-[160px]">
              {(p) => (
                <Select
                  {...p}
                  value={status}
                  onChange={(e) => setStatus(e.target.value as StatusAtendimento | "")}
                >
                  <option value="">Todos</option>
                  {STATUS_LISTA.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_ATENDIMENTO[s]?.rotulo ?? s}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {!escopoProprio && (
              <Field label="Profissional" className="w-[calc(50%-0.375rem)] sm:w-[190px]">
                {(p) => (
                  <Select
                    {...p}
                    value={profissionalId}
                    onChange={(e) => setProfissionalId(e.target.value)}
                  >
                    <option value="">Todos</option>
                    {(profissionais.data?.profissionais ?? []).map((prof) => (
                      <option key={prof.id} value={prof.id}>
                        {prof.nome}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            {podeEscrever && (
              <Button size="sm" onClick={() => setNovo(true)}>
                <Plus className="size-3.5" aria-hidden />
                Registrar
              </Button>
            )}
          </div>
        </CardHeader>

        {lista.isLoading && <SkeletonTabela linhas={7} colunas={6} />}
        {lista.isError && (
          <ErrorState
            descricao={lista.error.message}
            onRetry={() => {
              void lista.refetch();
            }}
          />
        )}
        {lista.data && itens.length === 0 && (
          <EmptyState
            icone={Filter}
            titulo="Nenhum atendimento no período"
            descricao="Amplie o intervalo de datas ou limpe o status."
            acao={
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setStatus("");
                  setProfissionalId("");
                  setDe(padrao.de);
                  setAte(padrao.ate);
                }}
              >
                <RotateCcw className="size-3.5" aria-hidden />
                Limpar filtros
              </Button>
            }
          />
        )}
        {itens.length > 0 && (
          <>
            {/* Desktop: tabela. */}
            <div className="hidden lg:block">
              <Table>
                <THead>
                  <tr>
                    <th>Quando</th>
                    <th>Cliente</th>
                    <th>Procedimento</th>
                    <th>Profissional</th>
                    <th>Status</th>
                    <th className="text-right">Valor</th>
                    <th className="text-right">Margem</th>
                    <th aria-label="Ações" />
                  </tr>
                </THead>
                <TBody>
                  {itens.map((a) => {
                    const st = STATUS_ATENDIMENTO[a.status];
                    const margem = (a.efeito.receita ? a.valor : 0) - a.custo_insumos;
                    return (
                      <TRow key={a.id}>
                        <td className="tabular whitespace-nowrap">
                          {dataCurtaDe(a.concluido_em ?? a.criado_em)}
                        </td>
                        <td className="font-medium">{a.cliente?.nome ?? "—"}</td>
                        <td className="text-muted-foreground">{a.procedimento?.nome ?? "—"}</td>
                        <td className="text-muted-foreground whitespace-nowrap">
                          {a.profissional?.nome ?? "—"}
                        </td>
                        <td>
                          <Badge tom={st?.tom ?? "neutro"}>{st?.rotulo ?? a.status}</Badge>
                        </td>
                        <td className="tabular text-right whitespace-nowrap">{brl(a.valor)}</td>
                        <td
                          className={cn(
                            "tabular text-right whitespace-nowrap",
                            margem < 0 && "text-destructive font-semibold",
                          )}
                        >
                          {brl(margem)}
                        </td>
                        <td className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setAberto(a.id)}
                            aria-label={`Abrir atendimento de ${a.cliente?.nome ?? "cliente"}`}
                          >
                            Detalhes
                          </Button>
                        </td>
                      </TRow>
                    );
                  })}
                </TBody>
              </Table>
            </div>

            {/* Mobile: cartões, sem rolagem horizontal. */}
            <ul className="divide-border divide-y lg:hidden">
              {itens.map((a) => {
                const st = STATUS_ATENDIMENTO[a.status];
                return (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => setAberto(a.id)}
                      className="hover:bg-muted/60 w-full px-4 py-3 text-left"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13.5px] font-medium">
                          {a.cliente?.nome ?? "—"}
                        </span>
                        <Badge tom={st?.tom ?? "neutro"}>{st?.rotulo ?? a.status}</Badge>
                      </span>
                      <span className="text-muted-foreground mt-0.5 block truncate text-[12.5px]">
                        {a.procedimento?.nome ?? "—"} · {a.profissional?.nome ?? "—"}
                      </span>
                      <span className="mt-1 flex items-center justify-between gap-2 text-[12.5px]">
                        <span className="text-muted-foreground tabular">
                          {dataCurtaDe(a.concluido_em ?? a.criado_em)}
                        </span>
                        <span className="tabular font-semibold">{brl(a.valor)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>

      <p className="text-muted-foreground text-[12px]">
        Os totais somam as linhas carregadas (o servidor devolve no máximo 500 por consulta) — não há
        endpoint de resumo agregado por período.
      </p>

      {atendimento && (
        <DialogAtendimento atendimento={atendimento} onFechar={() => setAberto(null)} />
      )}
      {novo && <DialogRegistrar onFechar={() => setNovo(false)} />}
    </div>
  );
}

function DialogAtendimento({
  atendimento,
  onFechar,
}: {
  atendimento: Atendimento;
  onFechar: () => void;
}) {
  const { pode } = useSessao();
  const { mostrar } = useToast();
  const estornar = useReembolsarAtendimento();
  const [observacoes, setObservacoes] = useState("");
  const st = STATUS_ATENDIMENTO[atendimento.status];
  const podeEstornar = pode("financeiro:read");
  const estornavel = atendimento.status === "concluido" || atendimento.status === "brinde";
  const margem = (atendimento.efeito.receita ? atendimento.valor : 0) - atendimento.custo_insumos;

  return (
    <Dialog
      aberto
      onFechar={onFechar}
      largura="max-w-xl"
      titulo={atendimento.cliente?.nome ?? "Atendimento"}
      descricao={`${atendimento.procedimento?.nome ?? "—"} · ${dataHoraDe(
        atendimento.concluido_em ?? atendimento.criado_em,
      )}`}
      rodape={
        estornavel && podeEstornar ? (
          <>
            <Button variant="ghost" size="sm" onClick={onFechar}>
              Fechar
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={estornar.isPending}
              onClick={() =>
                estornar.mutate(
                  { id: atendimento.id, observacoes: observacoes || undefined },
                  {
                    onSuccess: () => {
                      mostrar({
                        tipo: "sucesso",
                        titulo: "Atendimento estornado",
                        detalhe: "Insumos devolvidos ao estoque e pagamento marcado como estornado.",
                      });
                      onFechar();
                    },
                    onError: (erro) =>
                      mostrar({ tipo: "erro", titulo: "Não foi possível estornar", detalhe: erro.message }),
                  },
                )
              }
            >
              <Undo2 className="size-3.5" aria-hidden />
              {estornar.isPending ? "Estornando…" : "Estornar"}
            </Button>
          </>
        ) : (
          <p className="text-muted-foreground text-[12px]">
            {!estornavel
              ? `Status ${st?.rotulo ?? atendimento.status} não é estornável — só concluído e brinde são.`
              : "Estorno exige a permissão financeiro:read, que seu perfil não tem."}
          </p>
        )
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="border-border bg-card rounded-md border px-3 py-2.5">
            <SectionLabel>Valor</SectionLabel>
            <p className="font-display mt-1 text-[20px] leading-none">{brl(atendimento.valor)}</p>
          </div>
          <div className="border-border bg-card rounded-md border px-3 py-2.5">
            <SectionLabel>Insumos</SectionLabel>
            <p className="font-display mt-1 text-[20px] leading-none">
              {brl(atendimento.custo_insumos)}
            </p>
          </div>
          <div className="border-border bg-card rounded-md border px-3 py-2.5">
            <SectionLabel>Margem</SectionLabel>
            <p
              className={cn(
                "font-display mt-1 text-[20px] leading-none",
                margem < 0 && "text-destructive",
              )}
            >
              {brl(margem)}
            </p>
          </div>
        </div>

        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground text-[11px] font-semibold tracking-[0.12em] uppercase">
              Status
            </dt>
            <dd className="mt-1">
              <Badge tom={st?.tom ?? "neutro"}>{st?.rotulo ?? atendimento.status}</Badge>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-[11px] font-semibold tracking-[0.12em] uppercase">
              Efeito contábil
            </dt>
            <dd className="mt-1 text-[13px]">
              {atendimento.efeito.receita ? "Entra na receita" : "Sem receita"} ·{" "}
              {atendimento.efeito.estoque === -1
                ? "baixa de estoque"
                : atendimento.efeito.estoque === 1
                  ? "devolve estoque"
                  : "estoque intacto"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-[11px] font-semibold tracking-[0.12em] uppercase">
              Profissional
            </dt>
            <dd className="mt-1 text-[13px]">{atendimento.profissional?.nome ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-[11px] font-semibold tracking-[0.12em] uppercase">
              Agendamento de origem
            </dt>
            <dd className="mt-1 text-[13px]">
              {atendimento.agendamento_id ? "Vinculado" : "Registro direto, sem agendamento"}
            </dd>
          </div>
        </dl>

        {atendimento.observacoes && (
          <div className="bg-muted/60 border-border rounded-md border px-3 py-2.5">
            <SectionLabel>Observações</SectionLabel>
            <p className="mt-1 text-[13px] whitespace-pre-line">{atendimento.observacoes}</p>
          </div>
        )}

        {estornavel && podeEstornar && (
          <Field label="Observação do estorno" hint="Opcional, fica no registro.">
            {(p) => (
              <Textarea
                {...p}
                value={observacoes}
                onChange={(e) => setObservacoes(e.target.value)}
                placeholder="Motivo do estorno"
              />
            )}
          </Field>
        )}

        <p className="text-muted-foreground text-[12px]">
          Não existe rota para editar um atendimento registrado: o contrato só permite registrar e
          estornar. A forma de pagamento é gravada no servidor, mas nenhuma rota a devolve — por isso
          ela não aparece aqui.
        </p>
      </div>
    </Dialog>
  );
}

function DialogRegistrar({ onFechar }: { onFechar: () => void }) {
  const { mostrar } = useToast();
  const { soProprios } = useSessao();
  const registrar = useRegistrarAtendimento();
  const [busca, setBusca] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [procedimentoId, setProcedimentoId] = useState("");
  const [profissionalId, setProfissionalId] = useState("");
  const [status, setStatus] = useState<(typeof STATUS_ATENDIMENTO_REGISTRAVEIS)[number]>("concluido");
  const [valor, setValor] = useState("");
  const [forma, setForma] = useState<string>("pix");
  const [observacoes, setObservacoes] = useState("");

  const escopoProprio = soProprios("atendimentos");
  const clientes = useClientes({ busca: busca.trim() || undefined, somente_ativos: true });
  const procedimentos = useProcedimentos(true);
  const profissionais = useProfissionais(true, !escopoProprio);
  const procedimento = (procedimentos.data?.procedimentos ?? []).find((p) => p.id === procedimentoId);
  const valido = clienteId !== "" && procedimentoId !== "" && (escopoProprio || profissionalId !== "");

  return (
    <Dialog
      aberto
      onFechar={onFechar}
      largura="max-w-2xl"
      titulo="Registrar atendimento"
      descricao="Dá baixa nos insumos da ficha técnica e grava o pagamento, tudo no servidor."
      rodape={
        <>
          <Button variant="ghost" size="sm" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            size="sm"
            disabled={!valido || registrar.isPending}
            onClick={() =>
              registrar.mutate(
                {
                  cliente_id: clienteId,
                  procedimento_id: procedimentoId,
                  profissional_id: escopoProprio ? undefined : profissionalId,
                  status,
                  valor: valor === "" ? undefined : Number(valor),
                  forma_pagamento: status === "concluido" ? forma : undefined,
                  observacoes: observacoes.trim() || undefined,
                },
                {
                  onSuccess: (resposta) => {
                    mostrar({
                      tipo: "sucesso",
                      titulo: "Atendimento registrado",
                      detalhe: resposta.efeito.receita
                        ? `Receita de ${brl(resposta.atendimento.valor)} lançada.`
                        : "Sem lançamento de receita para este status.",
                    });
                    onFechar();
                  },
                  onError: (erro) =>
                    mostrar({ tipo: "erro", titulo: "Não foi possível registrar", detalhe: erro.message }),
                },
              )
            }
          >
            {registrar.isPending ? "Registrando…" : "Registrar"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Buscar cliente" hint="Busca no servidor por nome, telefone ou e-mail.">
          {(p) => (
            <Input
              {...p}
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Nome ou telefone"
            />
          )}
        </Field>
        <Field label="Cliente">
          {(p) => (
            <Select {...p} value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
              <option value="">Selecione…</option>
              {(clientes.data?.clientes ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Procedimento">
            {(p) => (
              <Select
                {...p}
                value={procedimentoId}
                onChange={(e) => setProcedimentoId(e.target.value)}
              >
                <option value="">Selecione…</option>
                {(procedimentos.data?.procedimentos ?? []).map((proc) => (
                  <option key={proc.id} value={proc.id}>
                    {proc.nome} — {brl(proc.preco)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label="Profissional"
            hint={escopoProprio ? "Seu perfil só registra em nome próprio." : undefined}
          >
            {(p) => (
              <Select
                {...p}
                value={escopoProprio ? "" : profissionalId}
                disabled={escopoProprio}
                onChange={(e) => setProfissionalId(e.target.value)}
              >
                <option value="">{escopoProprio ? "Você" : "Selecione…"}</option>
                {(profissionais.data?.profissionais ?? []).map((prof) => (
                  <option key={prof.id} value={prof.id}>
                    {prof.nome}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Status">
            {(p) => (
              <Select
                {...p}
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as (typeof STATUS_ATENDIMENTO_REGISTRAVEIS)[number])
                }
              >
                {STATUS_ATENDIMENTO_REGISTRAVEIS.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_ATENDIMENTO[s]?.rotulo ?? s}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label="Valor"
            hint={
              procedimento
                ? `Vazio usa o preço do catálogo: ${brl(procedimento.preco)}.`
                : "Vazio usa o preço do catálogo."
            }
          >
            {(p) => (
              <Input
                {...p}
                type="number"
                min={0}
                step="0.01"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder="—"
              />
            )}
          </Field>
          {status === "concluido" && (
            <Field label="Forma de pagamento" hint="Gravada no servidor; não é legível depois.">
              {(p) => (
                <Select {...p} value={forma} onChange={(e) => setForma(e.target.value)}>
                  {FORMAS.map((f) => (
                    <option key={f} value={f}>
                      {FORMA_ROTULO[f]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
        </div>
        <Field label="Observações">
          {(p) => (
            <Textarea {...p} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
          )}
        </Field>
        <p className="text-muted-foreground text-[12px]">
          Para registrar a partir de um agendamento confirmado, use a agenda: lá o
          <code className="tabular"> agendamento_id</code> vai junto e o servidor herda cliente,
          profissional e procedimento.
        </p>
      </div>
    </Dialog>
  );
}

/* ──────────────────────────────── Financeiro ─────────────────────────────── */

function Financeiro() {
  const { usuario, pode } = useSessao();
  const padrao = useIntervaloPadrao();
  const [de, setDe] = useState(padrao.de);
  const [ate, setAte] = useState(padrao.ate);
  const lista = useAtendimentos({ de: isoDe(de), ate: isoAte(ate) });

  if (!pode("financeiro:read")) {
    return (
      <Card>
        <DeniedState
          recurso="financeiro"
          role={ROLE_ROTULO[usuario?.role ?? "profissional"]}
          permissao="financeiro:read"
        />
      </Card>
    );
  }

  const itens = lista.data?.atendimentos ?? [];
  const resumo = resumir(itens);
  const comReceita = itens.filter((a) => a.efeito.receita);

  /** Agregação por procedimento — derivada, porque não existe endpoint disso. */
  const porProcedimento = new Map<string, { nome: string; qtd: number; receita: number; custo: number }>();
  for (const a of itens) {
    const nome = a.procedimento?.nome ?? "—";
    const atual = porProcedimento.get(nome) ?? { nome, qtd: 0, receita: 0, custo: 0 };
    atual.qtd += 1;
    if (a.efeito.receita) atual.receita += a.valor;
    atual.custo += a.custo_insumos;
    porProcedimento.set(nome, atual);
  }
  const linhas = [...porProcedimento.values()].sort((a, b) => b.receita - a.receita);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="De" className="w-[150px]">
          {(p) => <Input {...p} type="date" value={de} max={ate} onChange={(e) => setDe(e.target.value)} />}
        </Field>
        <Field label="Até" className="w-[150px]">
          {(p) => <Input {...p} type="date" value={ate} min={de} onChange={(e) => setAte(e.target.value)} />}
        </Field>
      </div>

      {lista.isLoading ? (
        <SkeletonCards quantidade={3} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          <KpiCard rotulo="Receita" valor={brl(resumo.receita)} icone={TrendingUp} tom="success" />
          <KpiCard rotulo="Custo de insumos" valor={brl(resumo.custo)} icone={TrendingDown} tom="warning" />
          <KpiCard
            rotulo="Margem"
            valor={brl(resumo.margem)}
            apoio={`${comReceita.length} registro(s) com receita`}
            icone={Gift}
            tom="accent"
          />
        </div>
      )}

      <Card>
        <CardHeader>
          <div>
            <CardTitle className="font-display">Receita por procedimento</CardTitle>
            <p className="text-muted-foreground mt-1 text-[13px]">
              Derivado dos atendimentos do período — o servidor não expõe relatório financeiro pronto.
            </p>
          </div>
        </CardHeader>
        {lista.isLoading && <SkeletonTabela linhas={5} colunas={4} />}
        {lista.isError && (
          <ErrorState
            descricao={lista.error.message}
            onRetry={() => {
              void lista.refetch();
            }}
          />
        )}
        {lista.data && linhas.length === 0 && (
          <EmptyState titulo="Nada no período" descricao="Amplie o intervalo de datas." />
        )}
        {linhas.length > 0 && (
          <Table>
            <THead>
              <tr>
                <th>Procedimento</th>
                <th className="text-right">Qtd.</th>
                <th className="text-right">Receita</th>
                <th className="text-right">Insumos</th>
                <th className="text-right">Margem</th>
              </tr>
            </THead>
            <TBody>
              {linhas.map((l) => (
                <TRow key={l.nome}>
                  <td className="font-medium">{l.nome}</td>
                  <td className="tabular text-right">{numero(l.qtd)}</td>
                  <td className="tabular text-right">{brl(l.receita)}</td>
                  <td className="tabular text-right">{brl(l.custo)}</td>
                  <td
                    className={cn(
                      "tabular text-right",
                      l.receita - l.custo < 0 && "text-destructive font-semibold",
                    )}
                  >
                    {brl(l.receita - l.custo)}
                  </td>
                </TRow>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <div className="border-warning/30 bg-warning-soft flex items-start gap-2.5 rounded-md border px-4 py-3">
        <AlertTriangle className="text-warning mt-0.5 size-4 shrink-0" aria-hidden />
        <p className="text-[12.5px]">
          Não existe listagem de pagamentos: a tabela <code className="tabular">pagamentos</code> é
          escrita ao registrar o atendimento, mas nenhuma rota a devolve. Forma de pagamento, status
          pago/estornado e recibos ficam fora desta tela até existir endpoint de leitura.
        </p>
      </div>
    </div>
  );
}

/* ────────────────────────── Estoque & no-show ────────────────────────── */

function EstoqueENoShow() {
  const { usuario, pode } = useSessao();
  const habilitado = pode("relatorios:read");
  const emFalta = useInsumosEmFalta(habilitado);
  const movimentacoes = useMovimentacoesEstoque(undefined, habilitado);
  const noShow = useIndicadorNoShow(habilitado);

  if (!habilitado) {
    return (
      <Card>
        <DeniedState
          recurso="estoque e indicadores"
          role={ROLE_ROTULO[usuario?.role ?? "profissional"]}
          permissao="relatorios:read"
        />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <div>
            <CardTitle className="font-display">Insumos abaixo do mínimo</CardTitle>
            <p className="text-muted-foreground mt-1 text-[13px]">
              Comparação direta entre estoque atual e mínimo definido na ficha do insumo.
            </p>
          </div>
        </CardHeader>
        {emFalta.isLoading && <SkeletonTabela linhas={3} colunas={4} />}
        {emFalta.isError && (
          <ErrorState
            descricao={emFalta.error.message}
            onRetry={() => {
              void emFalta.refetch();
            }}
          />
        )}
        {emFalta.data && emFalta.data.insumos.length === 0 && (
          <EmptyState
            icone={PackageX}
            titulo="Estoque em ordem"
            descricao="Nenhum insumo abaixo do mínimo agora."
          />
        )}
        {emFalta.data && emFalta.data.insumos.length > 0 && (
          <Table>
            <THead>
              <tr>
                <th>Insumo</th>
                <th className="text-right">Atual</th>
                <th className="text-right">Mínimo</th>
                <th className="text-right">Faltam</th>
              </tr>
            </THead>
            <TBody>
              {emFalta.data.insumos.map((i) => (
                <TRow key={i.id}>
                  <td className="font-medium">{i.nome}</td>
                  <td className="tabular text-right">
                    {numero(i.estoque_atual, 2)} {i.unidade}
                  </td>
                  <td className="tabular text-right">
                    {numero(i.estoque_minimo, 2)} {i.unidade}
                  </td>
                  <td className="tabular text-destructive text-right font-semibold">
                    {numero(Math.max(0, i.estoque_minimo - i.estoque_atual), 2)} {i.unidade}
                  </td>
                </TRow>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle className="font-display">Movimentações de estoque</CardTitle>
            <p className="text-muted-foreground mt-1 text-[13px]">
              Entradas e saídas geradas pelos atendimentos e pelos ajustes manuais.
            </p>
          </div>
        </CardHeader>
        {movimentacoes.isLoading && <SkeletonTabela linhas={5} colunas={4} />}
        {movimentacoes.isError && (
          <ErrorState
            descricao={movimentacoes.error.message}
            onRetry={() => {
              void movimentacoes.refetch();
            }}
          />
        )}
        {movimentacoes.data && movimentacoes.data.movimentacoes.length === 0 && (
          <EmptyState icone={ArrowDownUp} titulo="Sem movimentações registradas" />
        )}
        {movimentacoes.data && movimentacoes.data.movimentacoes.length > 0 && (
          <Table>
            <THead>
              <tr>
                <th>Quando</th>
                <th>Insumo</th>
                <th>Tipo</th>
                <th className="text-right">Quantidade</th>
                <th>Motivo</th>
              </tr>
            </THead>
            <TBody>
              {movimentacoes.data.movimentacoes.map((m) => (
                <TRow key={m.id}>
                  <td className="tabular whitespace-nowrap">{dataHoraDe(m.criado_em)}</td>
                  <td className="font-medium">{m.insumo_nome}</td>
                  <td>
                    <Badge tom={m.tipo === "entrada" ? "success" : "neutro"}>
                      {m.tipo === "entrada" ? "Entrada" : "Saída"}
                    </Badge>
                  </td>
                  <td className="tabular text-right">
                    {numero(m.quantidade, 2)} {m.unidade}
                  </td>
                  <td className="text-muted-foreground">{m.motivo ?? "—"}</td>
                </TRow>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle className="font-display">Faltas (no-show)</CardTitle>
            <p className="text-muted-foreground mt-1 text-[13px]">
              Taxa calculada pelo servidor por consulta agregada, sem tabela dedicada.
            </p>
          </div>
        </CardHeader>
        {noShow.isLoading && <SkeletonTabela linhas={4} colunas={4} />}
        {noShow.isError && (
          <ErrorState
            descricao={noShow.error.message}
            onRetry={() => {
              void noShow.refetch();
            }}
          />
        )}
        {noShow.data && (
          <div className="grid gap-5 p-5 lg:grid-cols-2">
            <div>
              <SectionLabel className="mb-2">Por profissional</SectionLabel>
              {noShow.data.por_profissional.length === 0 ? (
                <p className="text-muted-foreground text-[13px]">Sem dados.</p>
              ) : (
                <ul className="divide-border divide-y">
                  {noShow.data.por_profissional.map((p, i) => (
                    <li key={`${p.profissional?.nome ?? "?"}-${i}`} className="flex items-center gap-3 py-2">
                      <span className="min-w-0 flex-1 truncate text-[13px]">
                        {p.profissional?.nome ?? "—"}
                      </span>
                      <span className="text-muted-foreground tabular text-[12.5px]">
                        {p.faltas}/{p.total}
                      </span>
                      <Badge tom={p.taxa >= 0.2 ? "warning" : "neutro"}>
                        {numero(p.taxa * 100, 1)}%
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <SectionLabel className="mb-2">Por cliente</SectionLabel>
              {noShow.data.por_cliente.length === 0 ? (
                <p className="text-muted-foreground text-[13px]">Sem dados.</p>
              ) : (
                <ul className="divide-border divide-y">
                  {noShow.data.por_cliente.map((c, i) => (
                    <li key={`${c.cliente?.telefone ?? "?"}-${i}`} className="flex items-center gap-3 py-2">
                      <UserX className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-[13px]">
                        {c.cliente?.nome ?? "—"}
                      </span>
                      <span className="text-muted-foreground tabular text-[12.5px]">
                        {c.faltas}/{c.total}
                      </span>
                      <Badge tom={c.taxa >= 0.3 ? "warning" : "neutro"}>
                        {numero(c.taxa * 100, 1)}%
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
