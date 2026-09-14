/**
 * Agenda do dia.
 *
 * Tudo aqui vem de rotas reais (`packages/api/src/routes/agenda.ts`):
 *   GET   /agenda                      → lista do dia
 *   GET   /agenda/horarios-livres      → sugestões ao criar
 *   POST  /agenda                      → novo agendamento
 *   POST  /agenda/:id/remarcar         → remarcar
 *   PATCH /agenda/:id/status           → confirmar / cancelar
 *
 * LIMITES DO CONTRATO (não escondidos na interface):
 *   - A API devolve uma LISTA de agendamentos, sem colunas, jornada, totais nem
 *     conflitos pré-calculados: a grade, os totais e a faixa de horas são
 *     derivados no cliente a partir dos próprios agendamentos.
 *   - O horário de funcionamento só é legível em `GET /agente/config`
 *     (permissão `agente_ia:config`), que recepção e profissional não têm.
 *     Por isso a régua usa a faixa dos agendamentos do dia, não a jornada.
 *   - Bloqueios de profissional/sala existem como JSON em `bloqueios_agenda`,
 *     mas não há rota de leitura por dia — a grade não os desenha.
 */
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarPlus,
  CalendarX2,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  DoorOpen,
  Phone,
  RotateCw,
  X,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { useSessao } from "@/components/sessao";
import { Badge, ORIGEM, STATUS_AGENDAMENTO } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, SectionLabel } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { DeniedState, EmptyState, ErrorState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import {
  brl,
  dataLonga,
  duracaoMin,
  hojeNaClinica,
  horaDe,
  inicioDoDia,
  minutosNoDia,
  somarDias,
  telefone as fmtTelefone,
} from "@/lib/formato";
import { ROLE_ROTULO } from "@/lib/rbac";
import { AGENDAMENTOS_CANCELADOS, STATUS_AGENDAMENTO_CURTO } from "@/lib/rotulos";
import { cn } from "@/lib/utils";
import {
  STATUS_AGENDAMENTO_EDITAVEIS,
  useAgenda,
  useAlterarStatusAgendamento,
  useCriarAgendamento,
  useHorariosLivres,
  useRemarcarAgendamento,
} from "@/queries/agenda";
import { useProcedimentos, useProfissionais } from "@/queries/catalogo";
import { useClientes } from "@/queries/clientes";
import type { Agendamento } from "@/queries/tipos";

/** Pixels por minuto na régua do desktop. */
const PX_MIN = 1.3;
/** Faixa mínima desenhada quando o dia tem pouca coisa (08:00–19:00). */
const FAIXA_PADRAO = { inicio: 8 * 60, fim: 19 * 60 };

const hhmmParaMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** "YYYY-MM-DD" + "HH:MM" no fuso da clínica → ISO 8601 que a API aceita. */
const instanteIso = (dia: string, hhmm: string) =>
  new Date(inicioDoDia(dia) + hhmmParaMin(hhmm) * 60_000).toISOString();

const janelaDoDiaCivil = (dia: string) => ({
  de: new Date(inicioDoDia(dia)).toISOString(),
  ate: new Date(inicioDoDia(somarDias(dia, 1))).toISOString(),
});

const nomeCliente = (a: Agendamento) => a.cliente?.nome ?? "Cliente removido";

export default function AgendaPage() {
  const { usuario, pode, soProprios } = useSessao();
  const podeLer = pode("agenda:read");
  const podeEscrever = pode("agenda:write");
  const escopoProprio = soProprios("agenda");
  const verPreco = pode("relatorios:read") || pode("financeiro:read");

  const [dia, setDia] = useState(hojeNaClinica);
  const [profFiltro, setProfFiltro] = useState("");
  const [selecionado, setSelecionado] = useState<Agendamento | null>(null);
  const [criando, setCriando] = useState(false);

  const janela = useMemo(() => janelaDoDiaCivil(dia), [dia]);
  const agenda = useAgenda(
    { ...janela, profissional_id: profFiltro || undefined },
    podeLer,
  );
  // `GET /catalogo/profissionais` exige `agenda:read`: mesma permissão da tela.
  const profissionais = useProfissionais(true, podeLer);

  const hoje = hojeNaClinica();
  const agendamentos = useMemo(
    () => (agenda.data?.agendamentos ?? []).slice().sort((a, b) => a.inicio - b.inicio),
    [agenda.data],
  );

  // Mantém o detalhe aberto em sincronia com os dados recarregados.
  useEffect(() => {
    if (selecionado === null) return;
    const atual = agendamentos.find((a) => a.id === selecionado.id);
    if (atual && atual !== selecionado) setSelecionado(atual);
  }, [agendamentos, selecionado]);

  const ativos = agendamentos.filter((a) => !AGENDAMENTOS_CANCELADOS.has(a.status));
  const totais = {
    confirmados: agendamentos.filter((a) => a.status === "confirmado").length,
    aConfirmar: agendamentos.filter((a) => a.status === "agendado").length,
    cancelados: agendamentos.filter((a) => a.status.startsWith("cancelado")).length,
    remarcados: agendamentos.filter((a) => a.status === "remarcado").length,
    receita: ativos.reduce((s, a) => s + (a.procedimento?.preco ?? 0), 0),
  };

  /** Colunas da grade: profissionais com agenda no dia, na ordem do catálogo. */
  const colunas = useMemo(() => {
    const comAgenda = new Map<string, { id: string; nome: string; cor: string | null }>();
    for (const a of agendamentos) {
      comAgenda.set(a.profissional_id, {
        id: a.profissional_id,
        nome: a.profissional?.nome ?? "Profissional",
        cor: a.profissional?.cor ?? null,
      });
    }
    const catalogo = profissionais.data?.profissionais ?? [];
    const ordenadas = catalogo
      .filter((p) => comAgenda.has(p.id))
      .map((p) => ({ id: p.id, nome: p.nome, cor: p.cor }));
    const faltantes = [...comAgenda.values()].filter(
      (c) => !ordenadas.some((o) => o.id === c.id),
    );
    return [...ordenadas, ...faltantes];
  }, [agendamentos, profissionais.data]);

  /** Faixa de horas desenhada: derivada do dia, nunca da jornada (sem permissão). */
  const faixa = useMemo(() => {
    if (agendamentos.length === 0) return FAIXA_PADRAO;
    const inicios = agendamentos.map((a) => minutosNoDia(a.inicio_bloqueio));
    const fins = agendamentos.map((a) => minutosNoDia(a.fim_bloqueio));
    return {
      inicio: Math.min(FAIXA_PADRAO.inicio, Math.floor(Math.min(...inicios) / 60) * 60),
      fim: Math.max(FAIXA_PADRAO.fim, Math.ceil(Math.max(...fins) / 60) * 60),
    };
  }, [agendamentos]);

  if (!podeLer) {
    return (
      <AppShell titulo="Agenda" descricao="Ocupação do dia por profissional.">
        <Card>
          <DeniedState
            recurso="agenda"
            role={ROLE_ROTULO[usuario?.role ?? "recepcao"]}
            permissao="agenda:read"
          />
        </Card>
      </AppShell>
    );
  }

  const acoes = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="border-border bg-card flex items-center rounded-md border">
        <button
          type="button"
          aria-label="Dia anterior"
          onClick={() => setDia((d) => somarDias(d, -1))}
          className="hover:bg-muted focus-visible:ring-ring/50 grid size-9 place-items-center rounded-l-md focus-visible:ring-[3px]"
        >
          <ChevronLeft className="size-4" aria-hidden />
        </button>
        <input
          type="date"
          aria-label="Dia da agenda"
          value={dia}
          onChange={(e) => e.target.value && setDia(e.target.value)}
          className="tabular border-border h-9 border-x bg-transparent px-2 text-[12px] outline-none"
        />
        <button
          type="button"
          aria-label="Próximo dia"
          onClick={() => setDia((d) => somarDias(d, 1))}
          className="hover:bg-muted focus-visible:ring-ring/50 grid size-9 place-items-center rounded-r-md focus-visible:ring-[3px]"
        >
          <ChevronRight className="size-4" aria-hidden />
        </button>
      </div>
      <Button variant="outline" size="sm" onClick={() => setDia(hoje)} disabled={dia === hoje}>
        Hoje
      </Button>
      {podeEscrever && (
        <Button size="sm" onClick={() => setCriando(true)}>
          <CalendarPlus className="size-3.5" aria-hidden />
          <span className="hidden sm:inline">Novo agendamento</span>
          <span className="sm:hidden">Novo</span>
        </Button>
      )}
    </div>
  );

  return (
    <AppShell
      titulo="Agenda"
      descricao={
        escopoProprio
          ? "Você vê apenas os seus atendimentos — escopo agenda:read_own imposto pelo servidor."
          : "Ocupação do dia por profissional, incluindo o bloqueio de preparo e limpeza."
      }
      acoes={acoes}
    >
      {agenda.isLoading && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[74px]" />
            ))}
          </div>
          <Skeleton className="h-[420px]" />
        </div>
      )}

      {agenda.isError && (
        <Card>
          <ErrorState
            descricao={agenda.error.message}
            onRetry={() => void agenda.refetch()}
          />
        </Card>
      )}

      {agenda.data && (
        <div className="space-y-5">
          {agenda.data.aviso && (
            <div
              role="alert"
              className="border-warning/30 bg-warning-soft flex items-start gap-3 rounded-lg border px-4 py-3"
            >
              <AlertTriangle className="text-warning mt-0.5 size-4 shrink-0" aria-hidden />
              <p className="text-[13px]">{agenda.data.aviso}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
            <ResumoDia
              rotulo="Na agenda"
              valor={`${ativos.length}`}
              apoio={`${totais.confirmados} confirmados · ${totais.aConfirmar} a confirmar`}
            />
            <ResumoDia
              rotulo="Cancelados"
              valor={`${totais.cancelados}`}
              apoio="Não ocupam sala nem profissional"
            />
            <ResumoDia
              rotulo="Remarcados"
              valor={`${totais.remarcados}`}
              apoio="Movidos para outro horário"
            />
            <ResumoDia
              rotulo="Receita prevista"
              valor={verPreco ? brl(totais.receita) : "—"}
              apoio={
                verPreco
                  ? "Soma dos preços de catálogo dos ativos"
                  : "Exige relatorios:read ou financeiro:read"
              }
            />
          </div>

          {!escopoProprio && (
            <>
              {/* Mobile: navegação entre profissionais por chips, sem grade lateral. */}
              <div className="-mx-4 px-4 lg:hidden">
                <SectionLabel>Profissional</SectionLabel>
                <div className="mt-2 flex snap-x gap-2 overflow-x-auto pb-1">
                  <ChipProf
                    ativo={profFiltro === ""}
                    onClick={() => setProfFiltro("")}
                    rotulo="Todos"
                  />
                  {(profissionais.data?.profissionais ?? []).map((p) => (
                    <ChipProf
                      key={p.id}
                      ativo={profFiltro === p.id}
                      onClick={() => setProfFiltro(p.id)}
                      rotulo={p.nome}
                      cor={p.cor}
                    />
                  ))}
                </div>
              </div>

              <div className="hidden lg:block">
                <Field label="Profissional" className="w-72">
                  {(p) => (
                    <Select
                      {...p}
                      value={profFiltro}
                      onChange={(e) => setProfFiltro(e.target.value)}
                    >
                      <option value="">Todos os profissionais</option>
                      {(profissionais.data?.profissionais ?? []).map((prof) => (
                        <option key={prof.id} value={prof.id}>
                          {prof.nome}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
            </>
          )}

          {agendamentos.length === 0 ? (
            <Card>
              <EmptyState
                icone={CalendarX2}
                titulo="Nenhum agendamento neste dia"
                descricao={`Nada marcado para ${dataLonga(dia)}${profFiltro ? " para o profissional selecionado" : ""}.`}
                acao={
                  <div className="flex flex-wrap justify-center gap-2">
                    {dia !== hoje && (
                      <Button variant="outline" size="sm" onClick={() => setDia(hoje)}>
                        Voltar para hoje
                      </Button>
                    )}
                    {podeEscrever && (
                      <Button size="sm" onClick={() => setCriando(true)}>
                        <CalendarPlus className="size-3.5" aria-hidden />
                        Novo agendamento
                      </Button>
                    )}
                  </div>
                }
              />
            </Card>
          ) : (
            <>
              <ListaDia
                agendamentos={agendamentos}
                mostrarProfissional={!escopoProprio && profFiltro === ""}
                onSelecionar={setSelecionado}
              />
              <Grade
                agendamentos={agendamentos}
                colunas={colunas}
                faixa={faixa}
                onSelecionar={setSelecionado}
              />
            </>
          )}
        </div>
      )}

      <DetalheAgendamento
        agendamento={selecionado}
        podeEscrever={podeEscrever}
        verPreco={verPreco}
        onFechar={() => setSelecionado(null)}
      />

      {criando && (
        <NovoAgendamentoDialog
          dia={dia}
          profissionalSugerido={profFiltro || undefined}
          onFechar={() => setCriando(false)}
        />
      )}
    </AppShell>
  );
}

function ChipProf({
  ativo,
  onClick,
  rotulo,
  cor,
}: {
  ativo: boolean;
  onClick: () => void;
  rotulo: string;
  cor?: string | null;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        "focus-visible:ring-ring/50 flex shrink-0 snap-start items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] whitespace-nowrap focus-visible:ring-[3px]",
        ativo
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-foreground",
      )}
    >
      {cor && (
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: cor }}
          aria-hidden
        />
      )}
      {rotulo}
    </button>
  );
}

/**
 * Cartão de resumo do dia. O texto de apoio só aparece de `sm` para cima: no
 * mobile os quatro cartões vêm em duas colunas e a agenda precisa caber na
 * primeira tela, então o número e o rótulo bastam.
 */
function ResumoDia({
  rotulo,
  valor,
  apoio,
}: {
  rotulo: string;
  valor: string;
  apoio: string;
}) {
  return (
    <div className="border-border bg-card rounded-lg border px-3 py-2.5 sm:px-4 sm:py-3">
      <SectionLabel>{rotulo}</SectionLabel>
      <p className="font-display mt-1.5 text-[20px] leading-none sm:text-[22px]">{valor}</p>
      <p className="text-muted-foreground mt-1.5 hidden text-[12px] sm:block">{apoio}</p>
    </div>
  );
}

/**
 * Lista vertical — é o que o mobile mostra. Sem rolagem horizontal, sem grade
 * de colunas: cada agendamento é um botão de altura confortável para o toque.
 */
function ListaDia({
  agendamentos,
  mostrarProfissional,
  onSelecionar,
}: {
  agendamentos: Agendamento[];
  mostrarProfissional: boolean;
  onSelecionar: (a: Agendamento) => void;
}) {
  return (
    <Card className="lg:hidden">
      <ul className="divide-border divide-y">
        {agendamentos.map((a) => {
          const status = STATUS_AGENDAMENTO[a.status];
          const cancelado = AGENDAMENTOS_CANCELADOS.has(a.status);
          return (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => onSelecionar(a)}
                className="hover:bg-muted/60 focus-visible:ring-ring/50 flex w-full items-start gap-3 px-4 py-3 text-left focus-visible:ring-[3px] focus-visible:ring-inset"
                style={{ borderLeft: `3px solid ${a.profissional?.cor ?? "transparent"}` }}
              >
                <span className="tabular w-11 shrink-0 pt-0.5 text-[13px] font-semibold">
                  {horaDe(a.inicio)}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block truncate text-[14px] font-medium",
                      cancelado && "text-muted-foreground line-through",
                    )}
                  >
                    {nomeCliente(a)}
                  </span>
                  <span className="text-muted-foreground block truncate text-[12px]">
                    {a.procedimento?.nome ?? "Procedimento"}
                    {a.sala?.nome ? ` · ${a.sala.nome}` : ""}
                  </span>
                  {mostrarProfissional && (
                    <span className="text-muted-foreground block truncate text-[12px]">
                      {a.profissional?.nome ?? "—"}
                    </span>
                  )}
                </span>
                <span className="shrink-0 pt-0.5">
                  <Badge tom={status?.tom ?? "neutro"}>
                    {STATUS_AGENDAMENTO_CURTO[a.status] ?? a.status}
                  </Badge>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** Grade por profissional — só do breakpoint `lg` para cima. */
function Grade({
  agendamentos,
  colunas,
  faixa,
  onSelecionar,
}: {
  agendamentos: Agendamento[];
  colunas: { id: string; nome: string; cor: string | null }[];
  faixa: { inicio: number; fim: number };
  onSelecionar: (a: Agendamento) => void;
}) {
  const altura = (faixa.fim - faixa.inicio) * PX_MIN;
  const horas = useMemo(() => {
    const lista: number[] = [];
    for (let m = faixa.inicio; m <= faixa.fim; m += 60) lista.push(m);
    return lista;
  }, [faixa]);

  return (
    <Card className="hidden overflow-hidden lg:block">
      <div className="flex">
        <div className="border-border w-14 shrink-0 border-r pt-[52px]">
          <div className="relative" style={{ height: altura }}>
            {horas.map((m) => (
              <span
                key={m}
                className="tabular text-muted-foreground absolute right-2 -translate-y-1/2 text-[11px]"
                style={{ top: (m - faixa.inicio) * PX_MIN }}
              >
                {String(Math.floor(m / 60)).padStart(2, "0")}:00
              </span>
            ))}
          </div>
        </div>

        <div className="min-w-0 flex-1 overflow-x-auto">
          <div
            className="grid"
            style={{ gridTemplateColumns: `repeat(${colunas.length}, minmax(210px, 1fr))` }}
          >
            {colunas.map((coluna) => (
              <div key={coluna.id} className="border-border min-w-0 border-r last:border-r-0">
                <div className="border-border flex h-[52px] items-center gap-2 border-b px-3">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: coluna.cor ?? "var(--color-border-strong)" }}
                    aria-hidden
                  />
                  <span className="block min-w-0 truncate text-[13px] font-medium">
                    {coluna.nome}
                  </span>
                </div>

                <div className="relative" style={{ height: altura }}>
                  {horas.map((m) => (
                    <span
                      key={m}
                      className="bg-border/70 absolute inset-x-0 h-px"
                      style={{ top: (m - faixa.inicio) * PX_MIN }}
                      aria-hidden
                    />
                  ))}

                  {agendamentos
                    .filter((a) => a.profissional_id === coluna.id)
                    .map((a) => {
                      const cancelado = AGENDAMENTOS_CANCELADOS.has(a.status);
                      const status = STATUS_AGENDAMENTO[a.status];
                      const topo = (minutosNoDia(a.inicio) - faixa.inicio) * PX_MIN;
                      const bloqueioTopo =
                        (minutosNoDia(a.inicio_bloqueio) - faixa.inicio) * PX_MIN;
                      return (
                        <div key={a.id}>
                          <span
                            className="bg-muted/70 absolute inset-x-1.5 rounded-md"
                            style={{
                              top: bloqueioTopo,
                              height:
                                duracaoMin(a.inicio_bloqueio, a.fim_bloqueio) * PX_MIN,
                            }}
                            aria-hidden
                          />
                          <button
                            type="button"
                            onClick={() => onSelecionar(a)}
                            className={cn(
                              "focus-visible:ring-ring/50 absolute inset-x-1.5 overflow-hidden rounded-md border px-2.5 py-1.5 text-left transition-shadow hover:shadow-[0_8px_20px_-10px_rgba(18,48,42,0.5)] focus-visible:ring-[3px]",
                              cancelado
                                ? "border-border-strong bg-card opacity-60"
                                : "border-primary/25 bg-card",
                            )}
                            style={{
                              top: topo,
                              height: Math.max(34, duracaoMin(a.inicio, a.fim) * PX_MIN),
                              borderLeft: `3px solid ${a.profissional?.cor ?? "var(--color-border-strong)"}`,
                            }}
                          >
                            <span className="tabular block text-[11px] font-semibold">
                              {horaDe(a.inicio)}
                            </span>
                            <span
                              className={cn(
                                "block truncate text-[12.5px] font-medium",
                                cancelado && "line-through",
                              )}
                            >
                              {nomeCliente(a)}
                            </span>
                            <span className="text-muted-foreground block truncate text-[11px]">
                              {a.procedimento?.nome ?? "Procedimento"}
                              {a.sala?.nome ? ` · ${a.sala.nome}` : ""}
                            </span>
                            {status && (
                              <span className="text-muted-foreground mt-0.5 block truncate text-[10.5px] font-semibold tracking-wide uppercase">
                                {status.rotulo}
                              </span>
                            )}
                          </button>
                        </div>
                      );
                    })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <CardContent className="border-border text-muted-foreground flex flex-wrap items-center gap-4 border-t py-3 text-[11.5px]">
        <span className="flex items-center gap-1.5">
          <span className="bg-muted border-border inline-block size-3 rounded border" aria-hidden />
          Preparo e limpeza (bloqueio do agendamento)
        </span>
        <span>
          A régua cobre a faixa dos agendamentos do dia: o horário de funcionamento exige
          <code className="tabular"> agente_ia:config</code>.
        </span>
      </CardContent>
    </Card>
  );
}

function DetalheAgendamento({
  agendamento,
  podeEscrever,
  verPreco,
  onFechar,
}: {
  agendamento: Agendamento | null;
  podeEscrever: boolean;
  verPreco: boolean;
  onFechar: () => void;
}) {
  const { mostrar } = useToast();
  const alterarStatus = useAlterarStatusAgendamento();
  const remarcar = useRemarcarAgendamento();
  const [modo, setModo] = useState<"detalhe" | "remarcar" | "cancelar">("detalhe");
  const [novoDia, setNovoDia] = useState("");
  const [novaHora, setNovaHora] = useState("");
  const [motivoCancelamento, setMotivoCancelamento] =
    useState<"cancelado_pelo_cliente" | "cancelado_pela_clinica">("cancelado_pelo_cliente");

  // Reabre sempre no detalhe, com os campos preenchidos pelo horário atual.
  useEffect(() => {
    if (!agendamento) return;
    setModo("detalhe");
    setNovoDia(new Date(agendamento.inicio).toLocaleDateString("en-CA"));
    setNovaHora(horaDe(agendamento.inicio));
  }, [agendamento]);

  if (!agendamento) return null;

  const status = STATUS_AGENDAMENTO[agendamento.status];
  const cancelado = agendamento.status.startsWith("cancelado");
  const editavel = (STATUS_AGENDAMENTO_EDITAVEIS as readonly string[]).includes(
    agendamento.status,
  );
  const ocupado = alterarStatus.isPending || remarcar.isPending;

  const confirmar = () => {
    alterarStatus.mutate(
      { id: agendamento.id, status: "confirmado" },
      {
        onSuccess: () => {
          mostrar({
            tipo: "sucesso",
            titulo: "Presença confirmada",
            detalhe: `${nomeCliente(agendamento)} às ${horaDe(agendamento.inicio)}.`,
          });
          onFechar();
        },
        onError: (erro) =>
          mostrar({ tipo: "erro", titulo: "Não foi possível confirmar", detalhe: erro.message }),
      },
    );
  };

  const cancelar = () => {
    alterarStatus.mutate(
      { id: agendamento.id, status: motivoCancelamento },
      {
        onSuccess: () => {
          mostrar({
            tipo: "sucesso",
            titulo: "Agendamento cancelado",
            detalhe: `${nomeCliente(agendamento)} — ${STATUS_AGENDAMENTO[motivoCancelamento]?.rotulo}.`,
          });
          onFechar();
        },
        onError: (erro) =>
          mostrar({ tipo: "erro", titulo: "Não foi possível cancelar", detalhe: erro.message }),
      },
    );
  };

  const enviarRemarcacao = () => {
    if (!novoDia || !novaHora) return;
    remarcar.mutate(
      { id: agendamento.id, inicio: instanteIso(novoDia, novaHora) },
      {
        onSuccess: () => {
          mostrar({
            tipo: "sucesso",
            titulo: "Agendamento remarcado",
            detalhe: `${nomeCliente(agendamento)} para ${novaHora}.`,
          });
          onFechar();
        },
        onError: (erro) =>
          mostrar({ tipo: "erro", titulo: "Horário recusado", detalhe: erro.message }),
      },
    );
  };

  const rodape = !podeEscrever ? (
    <p className="text-muted-foreground text-[12px]">
      Seu perfil não tem <code className="tabular">agenda:write</code> — as ações ficam
      desabilitadas e o servidor recusaria a requisição.
    </p>
  ) : modo === "remarcar" ? (
    <>
      <Button variant="outline" size="sm" onClick={() => setModo("detalhe")} disabled={ocupado}>
        Voltar
      </Button>
      <Button size="sm" onClick={enviarRemarcacao} disabled={ocupado || !novoDia || !novaHora}>
        <RotateCw className="size-3.5" aria-hidden />
        {remarcar.isPending ? "Remarcando…" : "Confirmar remarcação"}
      </Button>
    </>
  ) : modo === "cancelar" ? (
    <>
      <Button variant="outline" size="sm" onClick={() => setModo("detalhe")} disabled={ocupado}>
        Voltar
      </Button>
      <Button variant="destructive" size="sm" onClick={cancelar} disabled={ocupado}>
        <X className="size-3.5" aria-hidden />
        {alterarStatus.isPending ? "Cancelando…" : "Cancelar agendamento"}
      </Button>
    </>
  ) : (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setModo("cancelar")}
        disabled={ocupado || !editavel}
      >
        <X className="size-3.5" aria-hidden />
        Cancelar
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setModo("remarcar")}
        disabled={ocupado || cancelado}
      >
        <RotateCw className="size-3.5" aria-hidden />
        Remarcar
      </Button>
      <Button
        size="sm"
        onClick={confirmar}
        disabled={ocupado || agendamento.status === "confirmado" || !editavel}
      >
        <Check className="size-3.5" aria-hidden />
        {agendamento.status === "confirmado" ? "Já confirmado" : "Confirmar"}
      </Button>
    </>
  );

  return (
    <Dialog
      aberto
      onFechar={onFechar}
      titulo={nomeCliente(agendamento)}
      descricao={`${agendamento.procedimento?.nome ?? "Procedimento"} · ${horaDe(agendamento.inicio)}–${horaDe(agendamento.fim)}`}
      rodape={rodape}
    >
      {modo === "remarcar" ? (
        <div className="space-y-4">
          <p className="text-muted-foreground text-[13px]">
            A validação de conflito é do servidor (<code className="tabular">
              POST /agenda/:id/remarcar
            </code>): horário fora da jornada, sala ocupada ou profissional indisponível são
            recusados e o erro aparece aqui.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Novo dia">
              {(p) => (
                <Input
                  {...p}
                  type="date"
                  value={novoDia}
                  onChange={(e) => setNovoDia(e.target.value)}
                />
              )}
            </Field>
            <Field label="Novo horário" hint="Fuso da clínica (America/Sao_Paulo).">
              {(p) => (
                <Input
                  {...p}
                  type="time"
                  step={300}
                  value={novaHora}
                  onChange={(e) => setNovaHora(e.target.value)}
                />
              )}
            </Field>
          </div>
        </div>
      ) : modo === "cancelar" ? (
        <div className="space-y-4">
          <p className="text-[13px]">
            O cancelamento é registrado com autoria: o indicador de no-show e o funil dependem
            disso.
          </p>
          <Field label="Motivo">
            {(p) => (
              <Select
                {...p}
                value={motivoCancelamento}
                onChange={(e) =>
                  setMotivoCancelamento(
                    e.target.value as "cancelado_pelo_cliente" | "cancelado_pela_clinica",
                  )
                }
              >
                <option value="cancelado_pelo_cliente">Cancelado pelo cliente</option>
                <option value="cancelado_pela_clinica">Cancelado pela clínica</option>
              </Select>
            )}
          </Field>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {status && <Badge tom={status.tom}>{status.rotulo}</Badge>}
            <Badge tom={agendamento.origem === "ia" ? "primary" : "neutro"}>
              Origem: {ORIGEM[agendamento.origem] ?? agendamento.origem}
            </Badge>
            {agendamento.remarcado_de_id && <Badge tom="warning">Veio de remarcação</Badge>}
          </div>

          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Linha rotulo="Profissional" valor={agendamento.profissional?.nome ?? "—"} />
            <Linha
              rotulo="Sala / recurso"
              valor={agendamento.sala?.nome ?? "Sem recurso vinculado"}
              icone={DoorOpen}
            />
            <Linha
              rotulo="Bloqueio total"
              valor={`${horaDe(agendamento.inicio_bloqueio)}–${horaDe(agendamento.fim_bloqueio)} (${duracaoMin(agendamento.inicio_bloqueio, agendamento.fim_bloqueio)} min)`}
              icone={Clock}
            />
            <Linha
              rotulo="Telefone"
              valor={agendamento.cliente ? fmtTelefone(agendamento.cliente.telefone) : "—"}
              icone={Phone}
            />
            <Linha
              rotulo="Preço de catálogo"
              valor={
                verPreco
                  ? agendamento.procedimento
                    ? brl(agendamento.procedimento.preco)
                    : "—"
                  : "Sem permissão"
              }
            />
            <Linha
              rotulo="Duração"
              valor={`${duracaoMin(agendamento.inicio, agendamento.fim)} min`}
            />
          </dl>

          {agendamento.observacoes && (
            <div className="bg-muted/60 border-border rounded-md border px-3 py-2.5">
              <SectionLabel>Observações</SectionLabel>
              <p className="mt-1 text-[13px]">{agendamento.observacoes}</p>
            </div>
          )}

          <p className="text-muted-foreground text-[12px]">
            Lembretes: 24 h {agendamento.lembrete_enviado_24h ? "enviado" : "pendente"} · 2 h{" "}
            {agendamento.lembrete_enviado_2h ? "enviado" : "pendente"}. O disparo é do worker do
            servidor, não desta tela.
          </p>
        </div>
      )}
    </Dialog>
  );
}

function NovoAgendamentoDialog({
  dia,
  profissionalSugerido,
  onFechar,
}: {
  dia: string;
  profissionalSugerido?: string;
  onFechar: () => void;
}) {
  const { mostrar } = useToast();
  const criar = useCriarAgendamento();
  const [busca, setBusca] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [procedimentoId, setProcedimentoId] = useState("");
  const [profissionalId, setProfissionalId] = useState(profissionalSugerido ?? "");
  const [diaEscolhido, setDiaEscolhido] = useState(dia);
  const [hora, setHora] = useState("09:00");
  const [observacoes, setObservacoes] = useState("");

  const clientes = useClientes({ busca: busca || undefined, somente_ativos: true });
  const procedimentos = useProcedimentos(true);
  const profissionais = useProfissionais(true);

  const janela = useMemo(() => janelaDoDiaCivil(diaEscolhido), [diaEscolhido]);
  const livres = useHorariosLivres(
    procedimentoId
      ? {
          procedimento_id: procedimentoId,
          de: janela.de,
          ate: janela.ate,
          profissional_id: profissionalId || undefined,
          passo_min: 30,
        }
      : null,
  );

  const enviar = () => {
    if (!clienteId || !procedimentoId) return;
    criar.mutate(
      {
        cliente_id: clienteId,
        procedimento_id: procedimentoId,
        inicio: instanteIso(diaEscolhido, hora),
        profissional_id: profissionalId || undefined,
        observacoes: observacoes || undefined,
        origem: "recepcao",
      },
      {
        onSuccess: () => {
          mostrar({
            tipo: "sucesso",
            titulo: "Agendamento criado",
            detalhe: `${diaEscolhido.split("-").reverse().join("/")} às ${hora}.`,
          });
          onFechar();
        },
        onError: (erro) =>
          mostrar({ tipo: "erro", titulo: "Agendamento recusado", detalhe: erro.message }),
      },
    );
  };

  return (
    <Dialog
      aberto
      onFechar={onFechar}
      titulo="Novo agendamento"
      descricao="O servidor valida jornada, sala, insumos e conflito de horário."
      largura="max-w-2xl"
      rodape={
        <>
          <Button variant="outline" size="sm" onClick={onFechar} disabled={criar.isPending}>
            Fechar
          </Button>
          <Button
            size="sm"
            onClick={enviar}
            disabled={criar.isPending || !clienteId || !procedimentoId}
          >
            <CalendarPlus className="size-3.5" aria-hidden />
            {criar.isPending ? "Agendando…" : "Agendar"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Buscar cliente" hint="Busca por nome, telefone ou e-mail em GET /clientes.">
          {(p) => (
            <Input
              {...p}
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Ana, 11999…"
            />
          )}
        </Field>

        <Field label="Cliente">
          {(p) => (
            <Select
              {...p}
              value={clienteId}
              onChange={(e) => setClienteId(e.target.value)}
              disabled={clientes.isLoading}
            >
              <option value="">Selecione…</option>
              {(clientes.data?.clientes ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome} · {fmtTelefone(c.telefone)}
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
                    {proc.nome} · {proc.duracao_min} min
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label="Profissional"
            hint="Em branco, a API escolhe quem está habilitado e livre."
          >
            {(p) => (
              <Select
                {...p}
                value={profissionalId}
                onChange={(e) => setProfissionalId(e.target.value)}
              >
                <option value="">Qualquer disponível</option>
                {(profissionais.data?.profissionais ?? []).map((prof) => (
                  <option key={prof.id} value={prof.id}>
                    {prof.nome}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Dia">
            {(p) => (
              <Input
                {...p}
                type="date"
                value={diaEscolhido}
                onChange={(e) => setDiaEscolhido(e.target.value)}
              />
            )}
          </Field>
          <Field label="Horário" hint="Fuso da clínica (America/Sao_Paulo).">
            {(p) => (
              <Input
                {...p}
                type="time"
                step={300}
                value={hora}
                onChange={(e) => setHora(e.target.value)}
              />
            )}
          </Field>
        </div>

        {procedimentoId !== "" && (
          <div>
            <SectionLabel>Horários livres em GET /agenda/horarios-livres</SectionLabel>
            {livres.isLoading ? (
              <Skeleton className="mt-2 h-9" />
            ) : livres.isError ? (
              <p role="alert" className="text-destructive mt-2 text-[12px]">
                {livres.error.message}
              </p>
            ) : (livres.data?.horarios.length ?? 0) === 0 ? (
              <p className="text-muted-foreground mt-2 text-[12px]">
                {livres.data?.aviso ?? "Nenhum horário livre neste dia para este procedimento."}
              </p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {livres.data!.horarios.slice(0, 18).map((inicio) => (
                  <Button
                    key={inicio}
                    type="button"
                    variant={horaDe(inicio) === hora ? "default" : "outline"}
                    size="sm"
                    onClick={() => setHora(horaDe(inicio))}
                  >
                    {horaDe(inicio)}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}

        <Field label="Observações" hint="Opcional. Vai para o campo observacoes do agendamento.">
          {(p) => (
            <Textarea
              {...p}
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              rows={2}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}

function Linha({
  rotulo,
  valor,
  icone: Icone,
}: {
  rotulo: string;
  valor: string;
  icone?: React.ElementType;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-[11px] font-semibold tracking-[0.12em] uppercase">
        {rotulo}
      </dt>
      <dd className="mt-0.5 flex items-center gap-1.5 text-[13px]">
        {Icone && <Icone className="text-muted-foreground size-3.5 shrink-0" aria-hidden />}
        <span className="truncate">{valor || "—"}</span>
      </dd>
    </div>
  );
}
