/**
 * Painel do dia.
 *
 * Não existe endpoint único de dashboard na API: esta tela COMPÕE
 *   GET /painel/resumo   (financeiro, agendamentos, conversas, ações da IA)
 *   GET /painel/funil    (leads por etapa e motivos de perda)
 *   GET /painel/clientes (novos, recorrentes, inativos, reativações)
 *   GET /agenda          (janela do dia corrente)
 *   GET /conversas?fila=1
 *   GET /atendimentos    (mês corrente, últimos lançamentos)
 *   GET /atendimentos/estoque/em-falta
 *
 * Todas as rotas de `/painel/*` e de estoque exigem `relatorios:read`; os blocos
 * que dependem delas não são montados para quem não tem a permissão — a query
 * nem é disparada, em vez de tomar 403.
 */
import { Link } from "wouter";
import {
  AlertTriangle,
  ArrowUpRight,
  Bot,
  CalendarCheck,
  CircleDollarSign,
  Clock,
  PackageX,
  Sparkles,
  TrendingUp,
  UserRoundCheck,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { KpiCard } from "@/components/kpi-card";
import { useSessao } from "@/components/sessao";
import { Avatar } from "@/components/ui/avatar";
import {
  Badge,
  ORIGEM,
  STATUS_AGENDAMENTO,
  STATUS_ATENDIMENTO,
  STATUS_CONVERSA,
} from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Skeleton, SkeletonCards } from "@/components/ui/skeleton";
import { brl, brlCurto, dataCurtaDe, desde, duracaoMin, horaDe, numero, pct } from "@/lib/formato";
import { ROLE_ROTULO } from "@/lib/rbac";
import { useAgendaDia } from "@/queries/agenda";
import { useAtendimentos, useInsumosEmFalta } from "@/queries/atendimentos";
import { useFilaConversas } from "@/queries/conversas";
import { ETAPA_ROTULO } from "@/lib/rotulos";
import { ETAPAS_LEAD } from "@/queries/clientes";
import { mesCorrente, usePainelClientes, usePainelFunil, usePainelResumo } from "@/queries/painel";

const CANCELADOS = new Set(["cancelado_pelo_cliente", "cancelado_pela_clinica"]);

export default function PainelPage() {
  const { usuario, pode, soProprios } = useSessao();
  const verRelatorios = pode("relatorios:read");
  const verConversas = pode("conversas:read");
  const verAtendimentos = pode("atendimentos:read");
  const escopoProprio = soProprios("agenda");

  const periodo = mesCorrente();
  const hoje = new Date();

  const resumo = usePainelResumo(periodo, verRelatorios);
  const funil = usePainelFunil(periodo, verRelatorios);
  const painelClientes = usePainelClientes(periodo, verRelatorios);
  const agenda = useAgendaDia(hoje, undefined, pode("agenda:read"));
  const fila = useFilaConversas(verConversas);
  const estoque = useInsumosEmFalta(verRelatorios);
  const atendimentos = useAtendimentos(
    { de: periodo.de, ate: periodo.ate },
    verAtendimentos,
  );

  const primeiroNome = usuario?.nome.replace(/^Dra?\.\s*/i, "").split(" ")[0] ?? "";
  const blocos = agenda.data?.agendamentos ?? [];
  const ativos = blocos.filter((a) => !CANCELADOS.has(a.status));
  const aConfirmar = blocos.filter((a) => a.status === "agendado").length;
  const confirmados = blocos.filter((a) => a.status === "confirmado").length;

  const carregandoTopo = resumo.isLoading || agenda.isLoading;

  const acoes = (
    <>
      {pode("agenda:read") && (
        <Button variant="outline" size="sm" asChild>
          <Link to="/agenda">
            <CalendarCheck className="size-3.5" aria-hidden />
            Abrir agenda
          </Link>
        </Button>
      )}
      {verConversas && (
        <Button size="sm" asChild>
          <Link to="/conversas">
            <Bot className="size-3.5" aria-hidden />
            Fila de conversas
          </Link>
        </Button>
      )}
    </>
  );

  return (
    <AppShell
      titulo={primeiroNome ? `Olá, ${primeiroNome}` : "Painel"}
      descricao={
        escopoProprio
          ? "Como profissional, você vê apenas a sua própria agenda e os seus atendimentos."
          : "Visão do dia: agenda, funil, conversas escaladas e estoque abaixo do mínimo."
      }
      acoes={acoes}
    >
      <div className="space-y-6">
        {carregandoTopo ? (
          <>
            <SkeletonCards quantidade={4} />
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.55fr_1fr]">
              <Card>
                <CardHeader>
                  <Skeleton className="h-4 w-40" />
                </CardHeader>
                <CardContent className="space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </CardContent>
              </Card>
              <Skeleton className="h-72 w-full" />
            </div>
          </>
        ) : (
          <>
            {/* KPIs — só entram os números que o perfil pode ler */}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard
                rotulo="Agendamentos hoje"
                valor={numero(ativos.length)}
                apoio={`${confirmados} confirmados · ${aConfirmar} a confirmar`}
                icone={CalendarCheck}
                tom="primary"
              />

              {verRelatorios && resumo.data && (
                <>
                  <KpiCard
                    rotulo="Receita do mês"
                    valor={brlCurto(resumo.data.financeiro.receita)}
                    apoio={`Ticket médio ${brlCurto(resumo.data.financeiro.ticket_medio)}`}
                    icone={CircleDollarSign}
                    tom="success"
                  />
                  <KpiCard
                    rotulo="Margem do mês"
                    valor={brlCurto(resumo.data.financeiro.margem)}
                    apoio={`${brlCurto(resumo.data.financeiro.custo_insumos)} em insumos consumidos`}
                    icone={TrendingUp}
                    tom="accent"
                  />
                  <KpiCard
                    rotulo="Faltas e cancelamentos"
                    valor={pct(resumo.data.agendamentos.taxa_no_show)}
                    apoio={`${pct(resumo.data.agendamentos.taxa_cancelamento)} de cancelamento · ${resumo.data.agendamentos.total} blocos no mês`}
                    icone={AlertTriangle}
                    tom="warning"
                  />
                </>
              )}

              {!verRelatorios && verConversas && (
                <KpiCard
                  rotulo="Aguardando humano"
                  valor={numero(fila.data?.conversas.length ?? 0)}
                  apoio="Conversas que a IA escalou"
                  icone={Bot}
                  tom="warning"
                />
              )}

              {!verRelatorios && verAtendimentos && (
                <KpiCard
                  rotulo={escopoProprio ? "Seus atendimentos no mês" : "Atendimentos no mês"}
                  valor={numero(atendimentos.data?.atendimentos.length ?? 0)}
                  apoio={
                    escopoProprio
                      ? "Somente registros ligados ao seu cadastro"
                      : "Lançamentos do mês corrente"
                  }
                  icone={Clock}
                  tom="neutro"
                />
              )}

              {!verRelatorios && (
                <KpiCard
                  rotulo="A confirmar hoje"
                  valor={numero(aConfirmar)}
                  apoio="Blocos que ainda não foram confirmados"
                  icone={CalendarCheck}
                  tom="neutro"
                />
              )}
            </div>

            {resumo.isError && verRelatorios && (
              <Card>
                <ErrorState
                  descricao="Não foi possível carregar os indicadores do mês."
                  onRetry={() => void resumo.refetch()}
                />
              </Card>
            )}

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.55fr_1fr]">
              {/* Agenda do dia */}
              {pode("agenda:read") && (
                <Card>
                  <CardHeader>
                    <div>
                      <CardTitle>Agenda de hoje</CardTitle>
                      <p className="text-muted-foreground mt-0.5 text-[12px]">
                        {blocos.length} bloco(s) · horários já incluem preparo e limpeza
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" asChild>
                      <Link to="/agenda">
                        Ver timeline
                        <ArrowUpRight className="size-3.5" aria-hidden />
                      </Link>
                    </Button>
                  </CardHeader>

                  {agenda.data?.aviso && (
                    <p className="border-border bg-warning-soft text-warning border-t px-5 py-2 text-[12px]">
                      {agenda.data.aviso}
                    </p>
                  )}

                  {agenda.isError ? (
                    <ErrorState
                      descricao="Não foi possível carregar a agenda do dia."
                      onRetry={() => void agenda.refetch()}
                    />
                  ) : blocos.length === 0 ? (
                    <EmptyState
                      titulo="Nenhum agendamento hoje"
                      descricao="Quando a IA ou a recepção marcarem algo, aparece aqui em ordem de horário."
                      icone={CalendarCheck}
                    />
                  ) : (
                    <ul className="divide-border divide-y">
                      {blocos.map((a) => {
                        const status = STATUS_AGENDAMENTO[a.status] ?? {
                          rotulo: a.status,
                          tom: "neutro" as const,
                        };
                        return (
                          <li key={a.id} className="flex items-center gap-4 px-5 py-3">
                            <div className="w-[64px] shrink-0">
                              <p className="tabular text-[15px] leading-none font-semibold">
                                {horaDe(a.inicio)}
                              </p>
                              <p className="text-muted-foreground tabular mt-1 text-[11px]">
                                {duracaoMin(a.inicio, a.fim)} min
                              </p>
                            </div>
                            <span
                              className="h-9 w-[3px] shrink-0 rounded-full"
                              style={{ backgroundColor: a.profissional?.cor ?? "#C7D3CC" }}
                              aria-hidden
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[13px] font-medium">
                                {a.cliente?.nome ?? "Cliente removido"}
                              </p>
                              <p className="text-muted-foreground truncate text-[12px]">
                                {[a.procedimento?.nome, a.profissional?.nome, a.sala?.nome]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </p>
                            </div>
                            <div className="hidden shrink-0 text-right sm:block">
                              {verRelatorios && a.procedimento && (
                                <p className="tabular text-[13px]">{brl(a.procedimento.preco)}</p>
                              )}
                              <p className="text-muted-foreground mt-0.5 text-[11px]">
                                via {ORIGEM[a.origem] ?? a.origem}
                              </p>
                            </div>
                            <Badge tom={status.tom} className="shrink-0">
                              {status.rotulo}
                            </Badge>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Card>
              )}

              <div className="space-y-5">
                {/* Fila escalada pela IA */}
                {verConversas && (
                  <Card>
                    <CardHeader>
                      <div>
                        <CardTitle>Escaladas pela IA</CardTitle>
                        <p className="text-muted-foreground mt-0.5 text-[12px]">
                          {fila.data?.conversas.length ?? 0} aguardando atendimento humano
                        </p>
                      </div>
                    </CardHeader>
                    {fila.isError ? (
                      <ErrorState
                        descricao="Não foi possível carregar a fila."
                        onRetry={() => void fila.refetch()}
                      />
                    ) : (fila.data?.conversas.length ?? 0) === 0 ? (
                      <EmptyState
                        titulo="Nada na fila"
                        descricao="A IA está conduzindo todas as conversas."
                        icone={Bot}
                      />
                    ) : (
                      <ul className="divide-border divide-y">
                        {fila.data!.conversas.slice(0, 4).map((c) => {
                          const status = STATUS_CONVERSA[c.status] ?? {
                            rotulo: c.status,
                            tom: "neutro" as const,
                          };
                          const nome = c.cliente_nome ?? c.telefone;
                          return (
                            <li key={c.id} className="px-5 py-3">
                              <div className="flex items-center gap-2.5">
                                <Avatar nome={nome} tamanho="sm" />
                                <p className="min-w-0 flex-1 truncate text-[13px] font-medium">
                                  {nome}
                                </p>
                                {c.ultima_mensagem_em && (
                                  <span className="text-muted-foreground tabular shrink-0 text-[11px]">
                                    {desde(c.ultima_mensagem_em)}
                                  </span>
                                )}
                              </div>
                              {c.ultima_mensagem && (
                                <p className="text-muted-foreground mt-1.5 line-clamp-2 text-[12px]">
                                  {c.ultima_mensagem}
                                </p>
                              )}
                              <div className="mt-2 flex items-center gap-2">
                                <Badge tom={status.tom}>{status.rotulo}</Badge>
                                {c.motivo_escalada && (
                                  <span className="text-muted-foreground truncate text-[11px]">
                                    {c.motivo_escalada}
                                  </span>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    <div className="border-border bg-muted/40 border-t px-5 py-2.5">
                      <Button variant="ghost" size="sm" asChild>
                        <Link to="/conversas">
                          Abrir fila completa
                          <ArrowUpRight className="size-3.5" aria-hidden />
                        </Link>
                      </Button>
                    </div>
                  </Card>
                )}

                {/* Ações da IA no período — vem de /painel/resumo */}
                {verRelatorios && resumo.data && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Sparkles className="text-accent size-4" aria-hidden />
                        IA no mês
                      </CardTitle>
                    </CardHeader>
                    {resumo.data.agente_ia.length === 0 ? (
                      <EmptyState
                        titulo="Nenhuma ação registrada"
                        descricao="O log de ações da IA está vazio neste período."
                        icone={Bot}
                      />
                    ) : (
                      <CardContent className="grid grid-cols-2 gap-4">
                        {resumo.data.agente_ia.slice(0, 6).map((acao) => (
                          <div key={acao.tipo_acao}>
                            <p className="text-muted-foreground text-[11px] font-semibold tracking-[0.12em] uppercase">
                              {acao.tipo_acao.replace(/_/g, " ")}
                            </p>
                            <p className="font-display mt-1 text-xl leading-none">
                              {numero(acao.quantidade)}
                            </p>
                          </div>
                        ))}
                        {painelClientes.data && (
                          <div>
                            <p className="text-muted-foreground text-[11px] font-semibold tracking-[0.12em] uppercase">
                              Reativações
                            </p>
                            <p className="font-display mt-1 text-xl leading-none">
                              {painelClientes.data.reativacoes.retornaram}/
                              {painelClientes.data.reativacoes.disparadas}
                            </p>
                          </div>
                        )}
                      </CardContent>
                    )}
                  </Card>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_1.2fr]">
              {/* Funil — agregado por etapa; a API não devolve valor monetário por etapa */}
              {verRelatorios && (
                <Card>
                  <CardHeader>
                    <div>
                      <CardTitle>Funil de leads</CardTitle>
                      <p className="text-muted-foreground mt-0.5 text-[12px]">
                        Contagem por etapa no mês corrente
                      </p>
                    </div>
                    {pode("clientes:read") && (
                      <Button variant="ghost" size="sm" asChild>
                        <Link to="/clientes">
                          Abrir kanban
                          <ArrowUpRight className="size-3.5" aria-hidden />
                        </Link>
                      </Button>
                    )}
                  </CardHeader>
                  {funil.isError ? (
                    <ErrorState
                      descricao="Não foi possível carregar o funil."
                      onRetry={() => void funil.refetch()}
                    />
                  ) : (
                    <CardContent className="space-y-2.5">
                      {(() => {
                        const porEtapa = funil.data?.por_etapa ?? {};
                        const maior = Math.max(1, ...Object.values(porEtapa).map((n) => n ?? 0));
                        return ETAPAS_LEAD.map((etapa) => {
                          const quantidade = porEtapa[etapa] ?? 0;
                          return (
                            <div key={etapa} className="flex items-center gap-3">
                              <span className="w-[104px] shrink-0 text-[12px]">
                                {ETAPA_ROTULO[etapa]}
                              </span>
                              <span className="bg-muted relative h-5 flex-1 overflow-hidden rounded-sm">
                                <span
                                  className={
                                    etapa === "perdido"
                                      ? "bg-destructive/70 absolute inset-y-0 left-0"
                                      : etapa === "fechado"
                                        ? "bg-success absolute inset-y-0 left-0"
                                        : "bg-primary/70 absolute inset-y-0 left-0"
                                  }
                                  style={{ width: `${(quantidade / maior) * 100}%` }}
                                  aria-hidden
                                />
                              </span>
                              <span className="tabular w-7 shrink-0 text-right text-[12px]">
                                {quantidade}
                              </span>
                            </div>
                          );
                        });
                      })()}
                    </CardContent>
                  )}
                </Card>
              )}

              {/* Estoque crítico — GET /atendimentos/estoque/em-falta (relatorios:read) */}
              {verRelatorios && (
                <Card>
                  <CardHeader>
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <AlertTriangle className="text-warning size-4" aria-hidden />
                        Insumos no limite
                      </CardTitle>
                      <p className="text-muted-foreground mt-0.5 text-[12px]">
                        {estoque.data?.insumos.length ?? 0} item(ns) abaixo ou no mínimo
                      </p>
                    </div>
                  </CardHeader>
                  {estoque.isError ? (
                    <ErrorState
                      descricao="Não foi possível carregar o estoque."
                      onRetry={() => void estoque.refetch()}
                    />
                  ) : (estoque.data?.insumos.length ?? 0) === 0 ? (
                    <EmptyState titulo="Estoque saudável" icone={PackageX} />
                  ) : (
                    <ul className="divide-border divide-y">
                      {estoque.data!.insumos.map((i) => {
                        const falta = i.estoque_minimo - i.estoque_atual;
                        return (
                          <li key={i.id} className="flex items-center gap-3 px-5 py-3">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[13px] font-medium">{i.nome}</p>
                              <p className="text-muted-foreground text-[12px]">
                                {numero(i.estoque_atual, i.estoque_atual % 1 === 0 ? 0 : 2)} {i.unidade} em
                                estoque · mínimo {numero(i.estoque_minimo, 0)} {i.unidade}
                              </p>
                            </div>
                            <Badge tom={i.estoque_atual <= 0 ? "destructive" : "warning"}>
                              {/* A API devolve saldo negativo quando o consumo registrado
                                  passou do estoque lançado, então o rótulo cobre 0 e negativo. */}
                              {i.estoque_atual <= 0
                                ? "Sem estoque"
                                : falta > 0
                                  ? `Faltam ${numero(falta, falta % 1 === 0 ? 0 : 2)} ${i.unidade}`
                                  : "No limite"}
                            </Badge>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Card>
              )}
            </div>

            {/* Atendimentos recentes */}
            {verAtendimentos && (
              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Atendimentos recentes</CardTitle>
                    <p className="text-muted-foreground mt-0.5 text-[12px]">
                      {escopoProprio ? "Somente os seus registros" : "Últimos lançamentos do mês"}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" asChild>
                    <Link to="/atendimentos">
                      Ver todos
                      <ArrowUpRight className="size-3.5" aria-hidden />
                    </Link>
                  </Button>
                </CardHeader>
                {atendimentos.isError ? (
                  <ErrorState
                    descricao="Não foi possível carregar os atendimentos."
                    onRetry={() => void atendimentos.refetch()}
                  />
                ) : (atendimentos.data?.atendimentos.length ?? 0) === 0 ? (
                  <EmptyState titulo="Nenhum atendimento no período" icone={Clock} />
                ) : (
                  <ul className="divide-border divide-y">
                    {atendimentos
                      .data!.atendimentos.slice()
                      .sort((a, b) => b.criado_em - a.criado_em)
                      .slice(0, 8)
                      .map((a) => {
                      const status = STATUS_ATENDIMENTO[a.status] ?? {
                        rotulo: a.status,
                        tom: "neutro" as const,
                      };
                      return (
                        <li key={a.id} className="flex items-center gap-4 px-5 py-3">
                          <span className="text-muted-foreground tabular w-[52px] shrink-0 text-[12px]">
                            {dataCurtaDe(a.concluido_em ?? a.criado_em)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-medium">
                              {a.cliente?.nome ?? "Cliente removido"}
                            </p>
                            <p className="text-muted-foreground truncate text-[12px]">
                              {[a.procedimento?.nome, a.profissional?.nome]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          </div>
                          {verRelatorios && (
                            <div className="hidden shrink-0 text-right sm:block">
                              <p className="tabular text-[13px]">{brl(a.valor)}</p>
                              <p className="text-muted-foreground tabular text-[11px]">
                                margem {brl(a.valor - a.custo_insumos)}
                              </p>
                            </div>
                          )}
                          <Badge tom={status.tom} className="shrink-0">
                            {status.rotulo}
                          </Badge>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            )}

            {usuario && (
              <p className="text-muted-foreground text-[12px]">
                Perfil ativo:{" "}
                <strong className="text-foreground">{ROLE_ROTULO[usuario.role]}</strong> — blocos
                sem permissão não são montados nesta tela, e não apenas escondidos por CSS.
              </p>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
