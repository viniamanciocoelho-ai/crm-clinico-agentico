/**
 * Conversas — fila da IA e atendimento humano.
 *
 * Contrato real (`packages/api/src/routes/conversas.ts`):
 *   GET   /conversas?status&fila=1          → { conversas: ConversaLista[] }  (LIMIT 300)
 *   GET   /conversas/:id                    → { conversa, cliente, mensagens }
 *   POST  /conversas                        → abre/reaproveita por telefone
 *   POST  /conversas/:id/mensagens          → registra mensagem DO CLIENTE
 *   POST  /conversas/:id/responder          → humano responde E assume
 *   POST  /conversas/:id/devolver-ia
 *   POST  /conversas/:id/encerrar
 *   PATCH /conversas/:id/cliente
 *   GET   /conversas/ia/acoes?conversa_id   → { acoes: AcaoIa[] }
 *
 * Limitações do contrato, expostas na interface (não escondidas):
 *  - não existe rota de "assumir sem responder": o servidor passa a conversa
 *    para `com_humano` quando a primeira resposta humana é enviada;
 *  - a listagem não devolve contadores nem "não lidas": os contadores das abas
 *    são derivados no cliente sobre as até 300 conversas que a rota devolve;
 *  - `POST /conversas/:id/mensagens` grava mensagem do contato. Em produção
 *    isso é trabalho da integração de canal, então o atalho de simular
 *    mensagem recebida só existe com `DEMO_MODE=true`.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  CheckCheck,
  Instagram,
  Link2,
  MessageSquare,
  Phone,
  Plus,
  Send,
  Sparkles,
  SquareArrowLeft,
  TriangleAlert,
  Undo2,
  UserRound,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { useSessao } from "@/components/sessao";
import { Avatar } from "@/components/ui/avatar";
import { Badge, STATUS_CONVERSA } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, SectionLabel } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Label, Select } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { DeniedState, EmptyState, ErrorState } from "@/components/ui/states";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { MODO_DEMO } from "@/lib/demo";
import { dataHoraDe, desde, horaDe, telefone as fmtTelefone } from "@/lib/formato";
import { ROLE_ROTULO } from "@/lib/rbac";
import { cn } from "@/lib/utils";
import { useClientes } from "@/queries/clientes";
import {
  useAbrirConversa,
  useAcoesIa,
  useConversa,
  useConversas,
  useDevolverParaIa,
  useEncerrarConversa,
  useRegistrarMensagemCliente,
  useResponderComoHumano,
  useVincularClienteAConversa,
} from "@/queries/conversas";
import type { ConversaLista, StatusConversa } from "@/queries/tipos";

type Aba = "fila" | "com_ia" | "encerrada" | "todas";

const FILA: StatusConversa[] = ["aguardando_humano", "com_humano"];

const CANAL_ICONE: Record<string, React.ElementType> = {
  whatsapp: MessageSquare,
  instagram: Instagram,
  telefone: Phone,
};

/** `tipo_acao` gravado por `packages/api/src/lib/agente.ts`. */
const ACAO_IA_ROTULO: Record<string, string> = {
  consultar_preco: "Consultou preço",
  consultar_procedimentos: "Consultou catálogo",
  consultar_horarios: "Consultou horários",
  criar_agendamento: "Criou agendamento",
  remarcar_agendamento: "Remarcou agendamento",
  cancelar_agendamento: "Cancelou agendamento",
  escalar_humano: "Escalou para humano",
};

const nomeDoContato = (c: { cliente_nome: string | null; telefone: string }) =>
  c.cliente_nome ?? fmtTelefone(c.telefone);

export default function ConversasPage() {
  const { usuario, pode } = useSessao();
  const [aba, setAba] = useState<Aba>("fila");
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [abrindo, setAbrindo] = useState(false);

  const podeLer = pode("conversas:read");
  // Uma única leitura sem filtro: a rota não devolve contadores, então as abas
  // e as contagens saem da mesma lista, agrupada no cliente.
  const lista = useConversas({}, podeLer);

  const conversas = lista.data?.conversas ?? [];
  const porAba = useMemo(() => {
    const fila = conversas.filter((c) => FILA.includes(c.status));
    return {
      fila,
      com_ia: conversas.filter((c) => c.status === "com_ia"),
      encerrada: conversas.filter((c) => c.status === "encerrada"),
      todas: conversas,
    } satisfies Record<Aba, ConversaLista[]>;
  }, [conversas]);

  if (!podeLer) {
    return (
      <AppShell titulo="Conversas" descricao="Fila da IA e atendimento humano.">
        <Card>
          <DeniedState
            recurso="conversas"
            role={ROLE_ROTULO[usuario?.role ?? "profissional"]}
            permissao="conversas:read"
          />
        </Card>
      </AppShell>
    );
  }

  const itens = porAba[aba];
  const atual = selecionada !== null && itens.some((c) => c.id === selecionada) ? selecionada : null;
  const aguardando = conversas.filter((c) => c.status === "aguardando_humano").length;

  return (
    <AppShell
      titulo="Conversas"
      descricao="A IA conduz até onde pode; o que escala fica aqui esperando gente."
      acoes={
        <div className="flex items-center gap-2">
          {lista.data && (
            <Badge tom={aguardando > 0 ? "warning" : "success"} ponto>
              {aguardando} aguardando humano
            </Badge>
          )}
          {pode("conversas:write") && (
            <Button size="sm" variant="outline" onClick={() => setAbrindo(true)}>
              <Plus className="size-3.5" aria-hidden />
              Nova conversa
            </Button>
          )}
        </div>
      }
    >
      <Tabs
        abas={[
          { id: "fila" as const, rotulo: "Fila humana", contagem: porAba.fila.length },
          { id: "com_ia" as const, rotulo: "Com a IA", contagem: porAba.com_ia.length },
          { id: "encerrada" as const, rotulo: "Encerradas", contagem: porAba.encerrada.length },
          { id: "todas" as const, rotulo: "Todas", contagem: porAba.todas.length },
        ]}
        atual={aba}
        onMudar={(id) => {
          setAba(id);
          setSelecionada(null);
        }}
        className="mb-6"
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        {/* Mobile: a fila sai de cena quando uma conversa está aberta. */}
        <Card className={cn("h-fit overflow-hidden", atual !== null && "hidden xl:block")}>
          <CardHeader className="py-3">
            <SectionLabel>Fila</SectionLabel>
            <span className="text-muted-foreground text-[12px]">{itens.length} conversa(s)</span>
          </CardHeader>
          {lista.isPending ? (
            <output className="block space-y-3 p-4" aria-label="Carregando fila">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex gap-3">
                  <Skeleton className="size-9 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-2/3" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                </div>
              ))}
            </output>
          ) : lista.isError ? (
            <ErrorState descricao={lista.error.message} onRetry={() => void lista.refetch()} />
          ) : itens.length === 0 ? (
            <EmptyState
              icone={CheckCheck}
              titulo="Nada nesta aba"
              descricao="Nenhuma conversa neste filtro. A IA está dando conta."
            />
          ) : (
            <ul className="divide-border divide-y">
              {itens.map((c) => {
                const st = STATUS_CONVERSA[c.status];
                const Icone = CANAL_ICONE[c.canal] ?? MessageSquare;
                const ativo = c.id === atual;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setSelecionada(c.id)}
                      aria-current={ativo}
                      className={cn(
                        "hover:bg-muted/60 focus-visible:ring-ring/50 flex w-full items-start gap-3 px-4 py-3 text-left transition-colors focus-visible:ring-[3px] focus-visible:outline-none",
                        ativo && "bg-secondary/70 hover:bg-secondary/70",
                      )}
                    >
                      <Avatar nome={nomeDoContato(c)} tamanho="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-[13px] font-semibold">
                            {nomeDoContato(c)}
                          </span>
                          {c.ultima_mensagem_em !== null && (
                            <span className="text-muted-foreground shrink-0 text-[11px]">
                              {desde(c.ultima_mensagem_em)}
                            </span>
                          )}
                        </span>
                        <span className="text-muted-foreground mt-0.5 line-clamp-2 block text-[12px]">
                          {c.ultima_mensagem ?? "Sem mensagens ainda."}
                        </span>
                        <span className="mt-1.5 flex flex-wrap items-center gap-2">
                          <Icone className="text-muted-foreground/70 size-3" aria-hidden />
                          <Badge tom={st?.tom ?? "neutro"} className="px-1.5 py-0">
                            {st?.rotulo ?? c.status}
                          </Badge>
                          <span className="text-muted-foreground text-[11px]">
                            {c.total_mensagens} msg
                          </span>
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {atual !== null ? (
          <Conversa id={atual} onVoltar={() => setSelecionada(null)} />
        ) : (
          <Card className="hidden xl:block">
            <EmptyState
              icone={MessageSquare}
              titulo="Selecione uma conversa"
              descricao="Escolha um contato na fila para ver o histórico e as ações da IA."
            />
          </Card>
        )}
      </div>

      <DialogAbrirConversa aberto={abrindo} onFechar={() => setAbrindo(false)} onAberta={setSelecionada} />
    </AppShell>
  );
}

/* ─────────────────────────────── Conversa ─────────────────────────────── */

function Conversa({ id, onVoltar }: { id: string; onVoltar: () => void }) {
  const { pode } = useSessao();
  const { mostrar } = useToast();
  const detalhe = useConversa(id);
  const acoes = useAcoesIa(id, pode("conversas:read"));
  const devolver = useDevolverParaIa();
  const encerrar = useEncerrarConversa();
  const responder = useResponderComoHumano();

  const [rascunho, setRascunho] = useState("");
  const [vinculando, setVinculando] = useState(false);
  const fim = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setRascunho("");
  }, [id]);

  const totalMensagens = detalhe.data?.mensagens.length ?? 0;
  useEffect(() => {
    fim.current?.scrollIntoView({ block: "end" });
  }, [totalMensagens]);

  if (detalhe.isPending) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Skeleton className="size-9 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className={cn("h-12", i % 2 === 0 ? "w-3/5" : "ml-auto w-2/5")} />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (detalhe.isError) {
    return (
      <Card>
        <ErrorState descricao={detalhe.error.message} onRetry={() => void detalhe.refetch()} />
      </Card>
    );
  }

  const { conversa, cliente, mensagens } = detalhe.data;
  const st = STATUS_CONVERSA[conversa.status];
  const comHumano = conversa.status === "com_humano";
  const encerrada = conversa.status === "encerrada";
  const podeEscrever = pode("conversas:write");
  const nome = cliente?.nome ?? fmtTelefone(conversa.telefone);

  const falhou = (titulo: string) => (e: Error) =>
    mostrar({ tipo: "erro", titulo, detalhe: e.message });

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" className="xl:hidden" onClick={onVoltar}>
        <SquareArrowLeft className="size-4" aria-hidden />
        Voltar à fila
      </Button>

      <Card className="flex flex-col">
        <CardHeader className="flex-wrap items-center gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar nome={nome} />
            <div className="min-w-0">
              <CardTitle className="font-display truncate">{nome}</CardTitle>
              <p className="text-muted-foreground mt-0.5 truncate text-[12px]">
                {fmtTelefone(conversa.telefone)} · {conversa.canal} · início{" "}
                {dataHoraDe(conversa.criado_em)}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Badge tom={st?.tom ?? "neutro"} ponto>
              {st?.rotulo ?? conversa.status}
            </Badge>
            {podeEscrever && conversa.cliente_id === null && (
              <Button variant="outline" size="sm" onClick={() => setVinculando(true)}>
                <Link2 className="size-3.5" aria-hidden />
                Vincular cliente
              </Button>
            )}
            {podeEscrever && comHumano && (
              <Button
                variant="outline"
                size="sm"
                disabled={devolver.isPending}
                onClick={() =>
                  devolver.mutate(
                    { id: conversa.id },
                    {
                      onSuccess: () =>
                        mostrar({
                          tipo: "info",
                          titulo: "Devolvido para a IA",
                          detalhe: "O agente volta a responder este contato.",
                        }),
                      onError: falhou("Não foi possível devolver"),
                    },
                  )
                }
              >
                <Undo2 className="size-3.5" aria-hidden />
                {devolver.isPending ? "Devolvendo…" : "Devolver para a IA"}
              </Button>
            )}
            {podeEscrever && !encerrada && (
              <Button
                variant="ghost"
                size="sm"
                disabled={encerrar.isPending}
                onClick={() =>
                  encerrar.mutate(
                    { id: conversa.id },
                    {
                      onSuccess: () =>
                        mostrar({ tipo: "sucesso", titulo: "Conversa encerrada" }),
                      onError: falhou("Não foi possível encerrar"),
                    },
                  )
                }
              >
                <CheckCheck className="size-3.5" aria-hidden />
                {encerrar.isPending ? "Encerrando…" : "Encerrar"}
              </Button>
            )}
          </div>
        </CardHeader>

        {conversa.motivo_escalada && (
          <div className="border-warning/25 bg-warning-soft text-warning flex items-start gap-2.5 border-b px-5 py-3">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p className="text-[13px]">
              <strong className="font-semibold">Escalada:</strong> {conversa.motivo_escalada}
            </p>
          </div>
        )}

        <div className="paper max-h-[440px] min-h-[240px] space-y-3 overflow-y-auto px-4 py-5 sm:px-5">
          {mensagens.length === 0 ? (
            <p className="text-muted-foreground text-[13px]">
              Nenhuma mensagem registrada nesta conversa.
            </p>
          ) : (
            mensagens.map((m) => (
              <Mensagem
                key={m.id}
                remetente={m.remetente_tipo}
                conteudo={m.conteudo}
                quando={horaDe(m.criado_em)}
              />
            ))
          )}
          <div ref={fim} />
        </div>

        <div className="border-border border-t px-4 py-4 sm:px-5">
          {!podeEscrever ? (
            <p className="text-muted-foreground text-[13px]">
              Seu perfil lê conversas, mas não pode responder — falta{" "}
              <code className="font-mono">conversas:write</code>.
            </p>
          ) : encerrada ? (
            <p className="text-muted-foreground text-[13px]">
              Conversa encerrada: o servidor recusa novas mensagens neste estado.
            </p>
          ) : (
            <form
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                const conteudo = rascunho.trim();
                if (conteudo === "") return;
                responder.mutate(
                  { id: conversa.id, conteudo },
                  {
                    onSuccess: () => setRascunho(""),
                    onError: falhou("Mensagem não enviada"),
                  },
                );
              }}
            >
              <div className="min-w-0 flex-1">
                <label htmlFor="redacao" className="sr-only">
                  Resposta ao contato
                </label>
                <textarea
                  id="redacao"
                  value={rascunho}
                  onChange={(e) => setRascunho(e.target.value)}
                  rows={2}
                  placeholder="Escreva a resposta…"
                  className="bg-card border-input placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:ring-ring/50 min-h-[44px] w-full resize-none rounded-md border px-3 py-2 text-sm focus-visible:ring-[3px] focus-visible:outline-none"
                />
              </div>
              <Button
                type="submit"
                className="sm:w-auto"
                disabled={responder.isPending || rascunho.trim() === ""}
              >
                <Send className="size-4" aria-hidden />
                {responder.isPending ? "Enviando…" : "Enviar"}
              </Button>
            </form>
          )}
          {podeEscrever && !encerrada && !comHumano && (
            <p className="text-muted-foreground mt-2 text-[12px]">
              Não existe rota para "assumir sem responder": o servidor passa a conversa para{" "}
              <strong>com humano</strong> quando a primeira resposta humana é enviada
              (<code className="font-mono">POST /conversas/:id/responder</code>). Até lá a IA
              continua respondendo.
            </p>
          )}
        </div>
      </Card>

      {MODO_DEMO && podeEscrever && !encerrada && <SimularContato id={conversa.id} />}

      <Card>
        <CardHeader className="py-3">
          <div className="flex items-center gap-2">
            <Sparkles className="text-primary size-4" aria-hidden />
            <SectionLabel>Ações da IA nesta conversa</SectionLabel>
          </div>
          {acoes.data && (
            <span className="text-muted-foreground text-[12px]">
              {acoes.data.acoes.length} registro(s)
            </span>
          )}
        </CardHeader>
        <CardContent className="py-4">
          {acoes.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : acoes.isError ? (
            <ErrorState descricao={acoes.error.message} onRetry={() => void acoes.refetch()} />
          ) : acoes.data.acoes.length === 0 ? (
            <p className="text-muted-foreground text-[13px]">
              Nenhuma ação executada pela IA — só troca de mensagens.
            </p>
          ) : (
            <ol className="space-y-3">
              {acoes.data.acoes.map((a) => (
                <li key={a.id} className="flex items-start gap-3">
                  <span
                    className={cn(
                      "mt-1 size-2 shrink-0 rounded-full",
                      a.sucesso ? "bg-success" : "bg-destructive",
                    )}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium">
                      {ACAO_IA_ROTULO[a.tipo_acao] ?? a.tipo_acao}
                      <span className="text-muted-foreground ml-2 text-[12px] font-normal">
                        {dataHoraDe(a.criado_em)}
                      </span>
                    </p>
                    {a.erro && (
                      <p className="text-destructive mt-0.5 font-mono text-[12px] break-words">
                        {a.erro}
                      </p>
                    )}
                  </div>
                  <Badge tom={a.sucesso ? "success" : "destructive"} className="shrink-0">
                    {a.sucesso ? "Sucesso" : "Falhou"}
                  </Badge>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <DialogVincularCliente
        aberto={vinculando}
        onFechar={() => setVinculando(false)}
        conversaId={conversa.id}
        telefone={conversa.telefone}
      />
    </div>
  );
}

function Mensagem({
  remetente,
  conteudo,
  quando,
}: {
  remetente: "cliente" | "ia" | "humano";
  conteudo: string;
  quando: string;
}) {
  const doContato = remetente === "cliente";
  const Icone = remetente === "ia" ? Bot : UserRound;

  return (
    <div className={cn("flex", doContato ? "justify-start" : "justify-end")}>
      <div className="max-w-[85%] min-w-0 sm:max-w-[78%]">
        <div
          className={cn(
            "rounded-lg border px-3.5 py-2.5 text-[13px] leading-relaxed break-words whitespace-pre-line",
            doContato && "bg-card border-border",
            remetente === "ia" && "border-primary/20 bg-primary/8 text-foreground",
            remetente === "humano" && "border-accent/25 bg-accent-soft text-foreground",
          )}
        >
          {conteudo}
        </div>
        <p
          className={cn(
            "text-muted-foreground mt-1 flex items-center gap-1.5 text-[11px]",
            doContato ? "justify-start" : "justify-end",
          )}
        >
          {!doContato && <Icone className="size-3" aria-hidden />}
          {remetente === "ia" ? "Agente (IA)" : remetente === "humano" ? "Equipe" : "Contato"}
          <span aria-hidden>·</span>
          <span className="tabular">{quando}</span>
        </p>
      </div>
    </div>
  );
}

/* ──────────────────────────── Atalho de demo ──────────────────────────── */

/**
 * Só com `DEMO_MODE=true`. A rota é real, mas em produção quem registra
 * mensagem do contato é a integração do canal, não a equipe pelo painel.
 */
function SimularContato({ id }: { id: string }) {
  const { mostrar } = useToast();
  const registrar = useRegistrarMensagemCliente();
  const [texto, setTexto] = useState("");

  return (
    <Card className="border-dashed">
      <CardHeader className="py-3">
        <SectionLabel>Simular mensagem recebida (demo)</SectionLabel>
        <Badge tom="warning">dados sintéticos</Badge>
      </CardHeader>
      <CardContent className="space-y-3 py-4">
        <p className="text-muted-foreground text-[12px]">
          Envia como se fosse o contato (<code className="font-mono">POST /conversas/:id/mensagens</code>
          ). O servidor decide sozinho se escala para humano e se a IA responde. Este bloco não
          existe no bundle de produção.
        </p>
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            const conteudo = texto.trim();
            if (conteudo === "") return;
            registrar.mutate(
              { id, conteudo },
              {
                onSuccess: (r) => {
                  setTexto("");
                  mostrar({
                    tipo: "info",
                    titulo: `Registrada · status ${r.status}`,
                    detalhe: r.motivo_escalada ? `Escalada: ${r.motivo_escalada}` : undefined,
                  });
                },
                onError: (e2) =>
                  mostrar({ tipo: "erro", titulo: "Não registrada", detalhe: e2.message }),
              },
            );
          }}
        >
          <div className="min-w-0 flex-1">
            <Label htmlFor="simula">Mensagem do contato</Label>
            <Input
              id="simula"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Quanto custa uma limpeza?"
            />
          </div>
          <Button
            type="submit"
            variant="outline"
            disabled={registrar.isPending || texto.trim() === ""}
          >
            {registrar.isPending ? "Registrando…" : "Registrar"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/* ───────────────────────────────  Dialogs ─────────────────────────────── */

const CANAIS_CONVERSA = ["whatsapp", "instagram", "telefone", "presencial"] as const;

function DialogAbrirConversa({
  aberto,
  onFechar,
  onAberta,
}: {
  aberto: boolean;
  onFechar: () => void;
  onAberta: (id: string) => void;
}) {
  const { mostrar } = useToast();
  const abrir = useAbrirConversa();
  const [telefone, setTelefone] = useState("");
  const [canal, setCanal] = useState<string>("whatsapp");
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (aberto) {
      setTelefone("");
      setCanal("whatsapp");
      setErro(null);
    }
  }, [aberto]);

  const enviar = () => {
    const digitos = telefone.replace(/\D/g, "");
    if (digitos.length < 10) {
      setErro("Informe um telefone com DDD.");
      return;
    }
    setErro(null);
    abrir.mutate(
      { telefone, canal },
      {
        onSuccess: (r) => {
          onAberta(r.conversa.id);
          onFechar();
          mostrar({
            tipo: "sucesso",
            titulo: r.reaproveitada ? "Conversa existente reaberta" : "Conversa criada",
            detalhe: r.reaproveitada
              ? "Este número já tinha conversa em aberto neste canal."
              : undefined,
          });
        },
        onError: (e) => setErro(e.message),
      },
    );
  };

  return (
    <Dialog
      aberto={aberto}
      onFechar={onFechar}
      titulo="Nova conversa"
      descricao="O servidor reaproveita a conversa se este número já tiver uma em aberto no canal."
      rodape={
        <>
          <Button variant="ghost" onClick={onFechar}>
            Cancelar
          </Button>
          <Button onClick={enviar} disabled={abrir.isPending}>
            {abrir.isPending ? "Abrindo…" : "Abrir conversa"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Telefone" hint="Com DDD. É a chave da conversa no canal.">
          {(props) => (
            <Input
              {...props}
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              placeholder="+55 11 90000-0000"
              inputMode="tel"
            />
          )}
        </Field>
        <Field label="Canal">
          {(props) => (
            <Select {...props} value={canal} onChange={(e) => setCanal(e.target.value)}>
              {CANAIS_CONVERSA.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
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

function DialogVincularCliente({
  aberto,
  onFechar,
  conversaId,
  telefone,
}: {
  aberto: boolean;
  onFechar: () => void;
  conversaId: string;
  telefone: string;
}) {
  const { mostrar } = useToast();
  const vincular = useVincularClienteAConversa();
  const [busca, setBusca] = useState("");
  const clientes = useClientes({ busca: busca.trim() || undefined }, aberto);

  useEffect(() => {
    if (aberto) setBusca(fmtTelefone(telefone));
  }, [aberto, telefone]);

  return (
    <Dialog
      aberto={aberto}
      onFechar={onFechar}
      titulo="Vincular a um cliente"
      descricao="Liga a conversa a um cadastro existente (PATCH /conversas/:id/cliente)."
      rodape={
        <Button variant="ghost" onClick={onFechar}>
          Fechar
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label="Buscar cliente" hint="Por nome ou telefone.">
          {(props) => (
            <Input {...props} value={busca} onChange={(e) => setBusca(e.target.value)} />
          )}
        </Field>
        {clientes.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : clientes.isError ? (
          <ErrorState descricao={clientes.error.message} onRetry={() => void clientes.refetch()} />
        ) : clientes.data.clientes.length === 0 ? (
          <p className="text-muted-foreground text-[13px]">
            Nenhum cliente encontrado. Cadastre em Clientes antes de vincular — não existe rota que
            crie cliente a partir da conversa.
          </p>
        ) : (
          <ul className="divide-border max-h-64 divide-y overflow-y-auto">
            {clientes.data.clientes.slice(0, 40).map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium">{c.nome}</span>
                  <span className="text-muted-foreground block text-[12px]">
                    {fmtTelefone(c.telefone)}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={vincular.isPending}
                  onClick={() =>
                    vincular.mutate(
                      { id: conversaId, clienteId: c.id },
                      {
                        onSuccess: () => {
                          onFechar();
                          mostrar({ tipo: "sucesso", titulo: "Conversa vinculada", detalhe: c.nome });
                        },
                        onError: (e) =>
                          mostrar({ tipo: "erro", titulo: "Não vinculou", detalhe: e.message }),
                      },
                    )
                  }
                >
                  Vincular
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
