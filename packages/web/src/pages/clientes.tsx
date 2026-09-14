/**
 * Clientes & funil de leads.
 *
 * Rotas reais (`packages/api/src/routes/clientes.ts`), todas sob
 * `clientes:read` / `clientes:write`:
 *   GET    /clientes?busca&somente_ativos&tag_id
 *   GET    /clientes/:id                       → cadastro + histórico unificado
 *   POST   /clientes        PATCH /clientes/:id
 *   GET    /clientes/tags   POST /clientes/tags
 *   POST   /clientes/:id/tags   DELETE /clientes/:id/tags/:tagId
 *   GET    /clientes/motivos-perda
 *   GET    /leads?etapa&canal_entrada   POST /leads   PATCH /leads/:id/etapa
 *   POST   /clientes/:id/reativacoes
 *
 * LIMITES DO CONTRATO (visíveis na interface, não escondidos):
 *   - `GET /leads` devolve uma lista crua: não existe valor estimado por lead,
 *     nem total do funil, nem agrupamento por etapa — as colunas e as contagens
 *     são derivadas no cliente.
 *   - Não existe listagem de reativações da organização: dá para registrar um
 *     disparo (`POST /clientes/:id/reativacoes`), mas "marcar retorno" exige o
 *     id da reativação, que nenhuma rota de leitura devolve. O botão fica
 *     desabilitado com o motivo à mostra.
 *   - Consentimento LGPD não tem endpoint próprio: grava-se por
 *     `PATCH /clientes/:id` e a API estampa a data.
 *   - O filtro "sem consentimento" não existe no servidor: é aplicado no
 *     cliente sobre a listagem.
 */
import { useMemo, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  Instagram,
  MessageCircle,
  Phone,
  Plus,
  Search,
  Send,
  ShieldAlert,
  Tag as TagIcone,
  UserRound,
  X,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { useSessao } from "@/components/sessao";
import { Avatar } from "@/components/ui/avatar";
import { Badge, STATUS_AGENDAMENTO, type Tom } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionLabel } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Skeleton, SkeletonTabela } from "@/components/ui/skeleton";
import { Table, TBody, THead, TRow } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { DeniedState, EmptyState, ErrorState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import {
  brl,
  dataCurtaDe,
  dataHoraDe,
  desde,
  telefone as fmtTelefone,
} from "@/lib/formato";
import { ROLE_ROTULO } from "@/lib/rbac";
import { CANAL_ROTULO, ETAPA_ROTULO } from "@/lib/rotulos";
import { cn } from "@/lib/utils";
import {
  CANAIS_LEAD,
  ETAPAS_LEAD,
  useAtualizarCliente,
  useCliente,
  useClientes,
  useCriarCliente,
  useCriarLead,
  useDesvincularTag,
  useLeads,
  useMotivosPerda,
  useMoverLead,
  useRegistrarConsentimento,
  useRegistrarReativacao,
  useTags,
  useVincularTag,
} from "@/queries/clientes";
import type { CanalEntrada, Cliente, EtapaLead, Lead } from "@/queries/tipos";

const CANAL_ICONE: Record<string, React.ElementType> = {
  whatsapp: MessageCircle,
  instagram: Instagram,
  telefone: Phone,
  indicacao: UserRound,
  presencial: UserRound,
};

/** Cor do marcador de cada etapa — decorativa, derivada da posição no funil. */
const ETAPA_COR: Record<EtapaLead, string> = {
  novo: "bg-info",
  em_conversa: "bg-info",
  qualificado: "bg-primary",
  agendado: "bg-accent",
  compareceu: "bg-accent",
  fechado: "bg-success",
  perdido: "bg-destructive",
};

export default function ClientesPage() {
  const { usuario, pode } = useSessao();
  const [aba, setAba] = useState<"funil" | "base">("funil");

  if (!pode("clientes:read")) {
    return (
      <AppShell titulo="Clientes & funil" descricao="Leads, base de clientes e consentimento.">
        <Card>
          <DeniedState
            recurso="clientes"
            role={ROLE_ROTULO[usuario?.role ?? "profissional"]}
            permissao="clientes:read"
          />
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell
      titulo="Clientes & funil"
      descricao="Do primeiro contato ao atendimento: etapas do funil, base cadastrada e consentimento LGPD."
    >
      <Tabs
        className="mb-5"
        abas={[
          { id: "funil" as const, rotulo: "Funil de leads" },
          { id: "base" as const, rotulo: "Base de clientes" },
        ]}
        atual={aba}
        onMudar={setAba}
      />
      {aba === "funil" ? <PainelFunil /> : <BaseClientes />}
    </AppShell>
  );
}

/* ────────────────────────────────── Funil ────────────────────────────────── */

function PainelFunil() {
  const { pode } = useSessao();
  const leads = useLeads();
  const motivos = useMotivosPerda();
  const [lead, setLead] = useState<Lead | null>(null);
  const [novo, setNovo] = useState(false);
  const [etapaMobile, setEtapaMobile] = useState<EtapaLead>("novo");
  const podeEscrever = pode("clientes:write");

  /** `GET /leads` não agrupa: as colunas do funil são montadas aqui. */
  const porEtapa = useMemo(() => {
    const mapa = new Map<EtapaLead, Lead[]>(ETAPAS_LEAD.map((e) => [e, [] as Lead[]]));
    for (const l of leads.data?.leads ?? []) {
      mapa.get(l.etapa)?.push(l);
    }
    for (const lista of mapa.values()) {
      lista.sort((a, b) => (b.ultima_interacao_em ?? b.criado_em) - (a.ultima_interacao_em ?? a.criado_em));
    }
    return mapa;
  }, [leads.data]);

  if (leads.isLoading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-[320px] w-[248px] shrink-0" />
        ))}
      </div>
    );
  }

  if (leads.isError) {
    return (
      <Card>
        <ErrorState
          descricao={leads.error.message}
          onRetry={() => {
            void leads.refetch();
          }}
        />
      </Card>
    );
  }

  const total = leads.data?.leads.length ?? 0;
  const perdidos = porEtapa.get("perdido")?.length ?? 0;
  const fechados = porEtapa.get("fechado")?.length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-6 gap-y-1 text-[12.5px]">
          <span>
            <strong className="text-foreground font-semibold">{total}</strong> leads na base
          </span>
          <span>
            Fechados: <strong className="text-foreground font-semibold">{fechados}</strong>
          </span>
          <span>
            Perdidos: <strong className="text-foreground font-semibold">{perdidos}</strong>
          </span>
        </div>
        {podeEscrever && (
          <Button size="sm" onClick={() => setNovo(true)}>
            <Plus className="size-3.5" aria-hidden />
            Novo lead
          </Button>
        )}
      </div>

      {/* Mobile: uma etapa por vez, sem grade horizontal apertada. */}
      <div className="lg:hidden">
        <div className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-2">
          {ETAPAS_LEAD.map((etapa) => {
            const qtd = porEtapa.get(etapa)?.length ?? 0;
            const ativo = etapa === etapaMobile;
            return (
              <button
                key={etapa}
                type="button"
                aria-pressed={ativo}
                onClick={() => setEtapaMobile(etapa)}
                className={cn(
                  "flex h-9 shrink-0 snap-start items-center gap-2 rounded-full border px-3 text-[13px] font-medium transition-colors",
                  ativo
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground",
                )}
              >
                <span className={cn("size-2 rounded-full", ativo ? "bg-primary-foreground/80" : ETAPA_COR[etapa])} aria-hidden />
                {ETAPA_ROTULO[etapa]}
                <span className="tabular text-[11.5px] opacity-80">{qtd}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-2 space-y-2">
          {(porEtapa.get(etapaMobile) ?? []).length === 0 ? (
            <Card>
              <EmptyState
                titulo={`Nada em "${ETAPA_ROTULO[etapaMobile]}"`}
                descricao="Escolha outra etapa do funil acima."
              />
            </Card>
          ) : (
            (porEtapa.get(etapaMobile) ?? []).map((l) => (
              <CartaoLead key={l.id} lead={l} onAbrir={() => setLead(l)} />
            ))
          )}
        </div>
      </div>

      {/* Desktop: kanban por etapa. */}
      <div className="hidden gap-3 overflow-x-auto pb-3 lg:flex">
        {ETAPAS_LEAD.map((etapa) => {
          const lista = porEtapa.get(etapa) ?? [];
          return (
            <section
              key={etapa}
              className="bg-card border-border flex w-[252px] shrink-0 flex-col rounded-lg border"
              aria-label={ETAPA_ROTULO[etapa]}
            >
              <header className="border-border border-b px-3 py-2.5">
                <p className="flex items-center gap-1.5 text-[13px] font-semibold">
                  <span className={cn("size-2 rounded-full", ETAPA_COR[etapa])} aria-hidden />
                  {ETAPA_ROTULO[etapa]}
                </p>
                <p className="text-muted-foreground tabular mt-0.5 text-[11.5px]">
                  {lista.length} {lista.length === 1 ? "lead" : "leads"}
                </p>
              </header>
              <div className="flex-1 space-y-2 p-2">
                {lista.length === 0 && (
                  <p className="text-muted-foreground/80 px-1 py-6 text-center text-[12px]">Vazio</p>
                )}
                {lista.map((l) => (
                  <CartaoLead key={l.id} lead={l} compacto onAbrir={() => setLead(l)} />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <p className="text-muted-foreground text-[12px]">
        Sem arrastar-e-soltar: a etapa muda por <code className="tabular">PATCH /leads/:id/etapa</code>, abrindo
        o lead. O contrato não devolve valor estimado por lead — o funil mostra contagem, não receita projetada.
      </p>

      {lead && (
        <DialogLead
          lead={lead}
          motivos={motivos.data?.motivos ?? []}
          onFechar={() => setLead(null)}
        />
      )}
      {novo && <DialogNovoLead onFechar={() => setNovo(false)} />}
    </div>
  );
}

function CartaoLead({
  lead,
  compacto,
  onAbrir,
}: {
  lead: Lead;
  compacto?: boolean;
  onAbrir: () => void;
}) {
  const Icone = CANAL_ICONE[lead.canal_entrada] ?? MessageCircle;
  const quando = lead.ultima_interacao_em ?? lead.criado_em;
  return (
    <button
      type="button"
      onClick={onAbrir}
      className={cn(
        "border-border bg-card hover:border-border-strong w-full rounded-md border px-3 text-left transition-colors",
        compacto ? "py-2" : "py-3",
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="truncate text-[13px] font-medium">
          {lead.nome ?? lead.cliente_nome ?? fmtTelefone(lead.telefone)}
        </span>
        {lead.atendido_por_tipo === "ia" && (
          <span className="bg-primary/10 text-primary rounded-sm px-1 text-[10px] font-semibold">IA</span>
        )}
      </span>
      <span className="text-muted-foreground tabular mt-0.5 block truncate text-[11.5px]">
        {fmtTelefone(lead.telefone)}
      </span>
      <span className="mt-1.5 flex items-center justify-between gap-2">
        <span className="text-muted-foreground flex items-center gap-1 text-[11px]">
          <Icone className="size-3" aria-hidden />
          {CANAL_ROTULO[lead.canal_entrada]}
        </span>
        <span className="text-muted-foreground text-[11px]">{desde(quando)}</span>
      </span>
      {lead.motivo_perda && (
        <span className="text-destructive mt-1 block truncate text-[11px]">{lead.motivo_perda}</span>
      )}
    </button>
  );
}

function DialogLead({
  lead,
  motivos,
  onFechar,
}: {
  lead: Lead;
  motivos: { id: string; descricao: string }[];
  onFechar: () => void;
}) {
  const { pode } = useSessao();
  const { mostrar } = useToast();
  const mover = useMoverLead();
  const [etapa, setEtapa] = useState<EtapaLead>(lead.etapa);
  const [motivo, setMotivo] = useState("");
  const [observacao, setObservacao] = useState("");
  const [nome, setNome] = useState(lead.nome ?? "");
  const [consentimento, setConsentimento] = useState(false);
  const podeEscrever = pode("clientes:write");
  const exigeMotivo = etapa === "perdido";
  const converte = etapa === "fechado" && lead.cliente_id === null;
  const faltaMotivo = exigeMotivo && !motivo;

  const enviar = () => {
    if (faltaMotivo) return;
    mover.mutate(
      {
        id: lead.id,
        etapa,
        motivo_perda_id: exigeMotivo ? motivo : undefined,
        observacao_perda: exigeMotivo && observacao ? observacao : undefined,
        nome: converte && nome ? nome : undefined,
        lgpd_consentimento: converte ? consentimento : undefined,
        lgpd_canal: converte && consentimento ? "whatsapp" : undefined,
      },
      {
        onSuccess: () => {
          mostrar({
            tipo: "sucesso",
            titulo: "Lead movido",
            detalhe: `${lead.nome ?? fmtTelefone(lead.telefone)} → ${ETAPA_ROTULO[etapa]}.`,
          });
          onFechar();
        },
        onError: (erro) =>
          mostrar({ tipo: "erro", titulo: "Não foi possível mover", detalhe: erro.message }),
      },
    );
  };

  return (
    <Dialog
      aberto
      onFechar={onFechar}
      titulo={lead.nome ?? lead.cliente_nome ?? fmtTelefone(lead.telefone)}
      descricao={`${CANAL_ROTULO[lead.canal_entrada]} · entrou em ${dataCurtaDe(lead.criado_em)}`}
      rodape={
        podeEscrever ? (
          <>
            <Button variant="ghost" size="sm" onClick={onFechar}>
              Cancelar
            </Button>
            <Button
              size="sm"
              disabled={mover.isPending || etapa === lead.etapa || faltaMotivo}
              onClick={enviar}
            >
              <ArrowRight className="size-3.5" aria-hidden />
              {mover.isPending ? "Movendo…" : "Mover etapa"}
            </Button>
          </>
        ) : (
          <p className="text-muted-foreground text-[12px]">
            Seu perfil não tem <code className="tabular">clientes:write</code> — a etapa só pode ser lida.
          </p>
        )
      }
    >
      <div className="space-y-4">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <ItemDl rotulo="Telefone" valor={fmtTelefone(lead.telefone)} />
          <ItemDl rotulo="Etapa atual" valor={ETAPA_ROTULO[lead.etapa]} />
          <ItemDl
            rotulo="Atendido por"
            valor={lead.atendido_por_tipo === "ia" ? "Agente de IA" : "Equipe"}
          />
          <ItemDl
            rotulo="Última interação"
            valor={lead.ultima_interacao_em ? dataHoraDe(lead.ultima_interacao_em) : "—"}
          />
          <ItemDl
            rotulo="Primeira resposta"
            valor={lead.primeira_resposta_em ? dataHoraDe(lead.primeira_resposta_em) : "—"}
          />
          <ItemDl
            rotulo="Cliente vinculado"
            valor={lead.cliente_id ? (lead.cliente_nome ?? "Sim") : "Ainda não convertido"}
          />
        </dl>

        {lead.motivo_perda && (
          <div className="border-destructive/30 bg-destructive-soft rounded-md border px-3 py-2.5 text-[12.5px]">
            Perdido por <strong>{lead.motivo_perda}</strong>
            {lead.observacao_perda ? ` — ${lead.observacao_perda}` : ""}
          </div>
        )}

        {podeEscrever && (
          <div className="space-y-3 border-t border-border pt-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Mover para">
                {(p) => (
                  <Select {...p} value={etapa} onChange={(e) => setEtapa(e.target.value as EtapaLead)}>
                    {ETAPAS_LEAD.map((e) => (
                      <option key={e} value={e}>
                        {ETAPA_ROTULO[e]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field
                label="Motivo da perda"
                hint={exigeMotivo ? "Obrigatório na etapa perdido." : "Só se for marcar como perdido."}
                erro={faltaMotivo && mover.isError ? "Selecione um motivo." : undefined}
              >
                {(p) => (
                  <Select
                    {...p}
                    value={motivo}
                    disabled={!exigeMotivo}
                    onChange={(e) => setMotivo(e.target.value)}
                  >
                    <option value="">—</option>
                    {motivos.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.descricao}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>

            {exigeMotivo && (
              <Field label="Observação da perda" hint="Opcional, fica no registro do lead.">
                {(p) => (
                  <Textarea
                    {...p}
                    value={observacao}
                    onChange={(e) => setObservacao(e.target.value)}
                    placeholder="O que o cliente disse?"
                  />
                )}
              </Field>
            )}

            {converte && (
              <div className="border-border bg-muted/60 space-y-3 rounded-md border px-3 py-3">
                <p className="text-[12.5px]">
                  Fechar este lead cria o cliente na base — é o único ponto em que o consentimento
                  entra junto da conversão.
                </p>
                <Field label="Nome do cliente" hint="Usado no cadastro criado pelo servidor.">
                  {(p) => (
                    <Input
                      {...p}
                      value={nome}
                      onChange={(e) => setNome(e.target.value)}
                      placeholder="Nome completo"
                    />
                  )}
                </Field>
                <label className="flex cursor-pointer items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    className="accent-primary size-3.5"
                    checked={consentimento}
                    onChange={(e) => setConsentimento(e.target.checked)}
                  />
                  Cliente autorizou contato por WhatsApp (LGPD)
                </label>
              </div>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}

function DialogNovoLead({ onFechar }: { onFechar: () => void }) {
  const { mostrar } = useToast();
  const criar = useCriarLead();
  const [nome, setNome] = useState("");
  const [tel, setTel] = useState("");
  const [canal, setCanal] = useState<CanalEntrada>("whatsapp");
  const telLimpo = tel.replace(/\D/g, "");
  const valido = telLimpo.length >= 10;

  return (
    <Dialog
      aberto
      onFechar={onFechar}
      titulo="Novo lead"
      descricao="Entra no funil na etapa novo. O servidor deduplica por telefone."
      rodape={
        <>
          <Button variant="ghost" size="sm" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            size="sm"
            disabled={!valido || criar.isPending}
            onClick={() =>
              criar.mutate(
                { telefone: telLimpo, nome: nome || undefined, canal_entrada: canal },
                {
                  onSuccess: () => {
                    mostrar({ tipo: "sucesso", titulo: "Lead criado", detalhe: "Etapa: novo." });
                    onFechar();
                  },
                  onError: (erro) =>
                    mostrar({ tipo: "erro", titulo: "Não foi possível criar", detalhe: erro.message }),
                },
              )
            }
          >
            {criar.isPending ? "Criando…" : "Criar lead"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Telefone" hint="Só dígitos, com DDD." erro={tel && !valido ? "Telefone incompleto." : undefined}>
          {(p) => (
            <Input
              {...p}
              inputMode="tel"
              value={tel}
              onChange={(e) => setTel(e.target.value)}
              placeholder="11988887777"
            />
          )}
        </Field>
        <Field label="Nome" hint="Opcional — pode chegar depois na conversa.">
          {(p) => <Input {...p} value={nome} onChange={(e) => setNome(e.target.value)} />}
        </Field>
        <Field label="Canal de entrada" className="sm:col-span-2">
          {(p) => (
            <Select {...p} value={canal} onChange={(e) => setCanal(e.target.value as CanalEntrada)}>
              {CANAIS_LEAD.map((c) => (
                <option key={c} value={c}>
                  {CANAL_ROTULO[c]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
    </Dialog>
  );
}

/* ─────────────────────────── Base de clientes ─────────────────────────── */

function BaseClientes() {
  const { pode } = useSessao();
  const [busca, setBusca] = useState("");
  const [somenteAtivos, setSomenteAtivos] = useState(true);
  const [tagId, setTagId] = useState("");
  const [semConsentimento, setSemConsentimento] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);

  const tags = useTags();
  const lista = useClientes({
    busca: busca.trim() || undefined,
    somente_ativos: somenteAtivos,
    tag_id: tagId || undefined,
  });

  /** Filtro aplicado no cliente: o servidor não expõe esse recorte. */
  const itens = useMemo(() => {
    const base = lista.data?.clientes ?? [];
    return semConsentimento ? base.filter((c) => !c.lgpd_consentimento) : base;
  }, [lista.data, semConsentimento]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Buscar" className="w-full sm:w-72">
          {(p) => (
            <div className="relative">
              <Search
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2"
                aria-hidden
              />
              <Input
                {...p}
                className="pl-9"
                placeholder="Nome, telefone ou e-mail"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>
          )}
        </Field>
        <Field label="Etiqueta" className="w-full sm:w-52">
          {(p) => (
            <Select {...p} value={tagId} onChange={(e) => setTagId(e.target.value)}>
              <option value="">Todas</option>
              {(tags.data?.tags ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="flex flex-wrap gap-2">
          <label className="border-border bg-card flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-[13px]">
            <input
              type="checkbox"
              className="accent-primary size-3.5"
              checked={somenteAtivos}
              onChange={(e) => setSomenteAtivos(e.target.checked)}
            />
            Só ativos
          </label>
          <label className="border-border bg-card flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-[13px]">
            <input
              type="checkbox"
              className="accent-primary size-3.5"
              checked={semConsentimento}
              onChange={(e) => setSemConsentimento(e.target.checked)}
            />
            Sem consentimento LGPD
          </label>
        </div>
        {pode("clientes:write") && (
          <Button size="sm" className="ml-auto" onClick={() => setNovo(true)}>
            <Plus className="size-3.5" aria-hidden />
            Novo cliente
          </Button>
        )}
      </div>

      <Card>
        {lista.isLoading && <SkeletonTabela linhas={6} colunas={5} />}
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
            titulo="Nenhum cliente encontrado"
            descricao="Ajuste a busca ou limpe os filtros."
            acao={
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setBusca("");
                  setTagId("");
                  setSemConsentimento(false);
                  setSomenteAtivos(true);
                }}
              >
                Limpar filtros
              </Button>
            }
          />
        )}
        {lista.data && itens.length > 0 && (
          <Table>
            <THead>
              <tr>
                <th>Cliente</th>
                <th>Contato</th>
                <th>Cadastro</th>
                <th>Origem</th>
                <th>LGPD</th>
                <th aria-label="Ações" />
              </tr>
            </THead>
            <TBody>
              {itens.map((c) => (
                <TRow key={c.id}>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <Avatar nome={c.nome} tamanho="sm" />
                      <div className="min-w-0">
                        <p className="truncate font-medium">{c.nome}</p>
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {c.tags.map((t) => (
                            <span
                              key={t.id}
                              className="rounded-sm px-1.5 text-[10.5px] font-semibold text-white"
                              style={{ backgroundColor: t.cor }}
                            >
                              {t.nome}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="text-muted-foreground">
                    <p className="tabular">{fmtTelefone(c.telefone)}</p>
                    <p className="max-w-[200px] truncate text-[12px]">{c.email ?? "—"}</p>
                  </td>
                  <td className="tabular">{dataCurtaDe(c.criado_em)}</td>
                  <td className="text-muted-foreground">{c.origem_lead ?? "—"}</td>
                  <td>
                    <div className="flex flex-wrap gap-1.5">
                      {c.lgpd_consentimento ? (
                        <Badge tom="success">Consentido</Badge>
                      ) : (
                        <Badge tom="warning">Sem consentimento</Badge>
                      )}
                      {c.ativo === 0 && <Badge tom="neutro">Inativo</Badge>}
                    </div>
                  </td>
                  <td className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setAberto(c.id)}>
                      Abrir
                    </Button>
                  </td>
                </TRow>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {aberto && <DialogCliente id={aberto} onFechar={() => setAberto(null)} />}
      {novo && <DialogNovoCliente onFechar={() => setNovo(false)} />}
    </div>
  );
}

function DialogNovoCliente({ onFechar }: { onFechar: () => void }) {
  const { mostrar } = useToast();
  const criar = useCriarCliente();
  const [nome, setNome] = useState("");
  const [tel, setTel] = useState("");
  const [email, setEmail] = useState("");
  const [nascimento, setNascimento] = useState("");
  const [origem, setOrigem] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [consentimento, setConsentimento] = useState(false);
  const telLimpo = tel.replace(/\D/g, "");
  const valido = nome.trim().length >= 2 && telLimpo.length >= 10;

  return (
    <Dialog
      aberto
      onFechar={onFechar}
      largura="max-w-xl"
      titulo="Novo cliente"
      descricao="Cadastro direto na base, sem passar pelo funil."
      rodape={
        <>
          <Button variant="ghost" size="sm" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            size="sm"
            disabled={!valido || criar.isPending}
            onClick={() =>
              criar.mutate(
                {
                  nome: nome.trim(),
                  telefone: telLimpo,
                  email: email.trim() || undefined,
                  data_nascimento: nascimento || undefined,
                  origem_lead: origem.trim() || undefined,
                  observacoes: observacoes.trim() || undefined,
                  lgpd_consentimento: consentimento,
                  lgpd_canal: consentimento ? "presencial" : undefined,
                },
                {
                  onSuccess: () => {
                    mostrar({ tipo: "sucesso", titulo: "Cliente cadastrado", detalhe: nome.trim() });
                    onFechar();
                  },
                  onError: (erro) =>
                    mostrar({ tipo: "erro", titulo: "Não foi possível cadastrar", detalhe: erro.message }),
                },
              )
            }
          >
            {criar.isPending ? "Salvando…" : "Cadastrar"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nome" erro={nome && nome.trim().length < 2 ? "Nome muito curto." : undefined}>
          {(p) => <Input {...p} value={nome} onChange={(e) => setNome(e.target.value)} />}
        </Field>
        <Field label="Telefone" hint="Com DDD." erro={tel && telLimpo.length < 10 ? "Telefone incompleto." : undefined}>
          {(p) => (
            <Input {...p} inputMode="tel" value={tel} onChange={(e) => setTel(e.target.value)} />
          )}
        </Field>
        <Field label="E-mail" hint="Opcional.">
          {(p) => (
            <Input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          )}
        </Field>
        <Field label="Nascimento" hint="Usado no segmento de aniversariantes.">
          {(p) => (
            <Input
              {...p}
              type="date"
              value={nascimento}
              onChange={(e) => setNascimento(e.target.value)}
            />
          )}
        </Field>
        <Field label="Origem" hint="Texto livre, como o servidor guarda." className="sm:col-span-2">
          {(p) => (
            <Input
              {...p}
              value={origem}
              onChange={(e) => setOrigem(e.target.value)}
              placeholder="indicação, instagram, fachada…"
            />
          )}
        </Field>
        <Field label="Observações" className="sm:col-span-2">
          {(p) => (
            <Textarea {...p} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
          )}
        </Field>
        <label className="flex cursor-pointer items-center gap-2 text-[13px] sm:col-span-2">
          <input
            type="checkbox"
            className="accent-primary size-3.5"
            checked={consentimento}
            onChange={(e) => setConsentimento(e.target.checked)}
          />
          Consentimento LGPD coletado presencialmente
        </label>
      </div>
    </Dialog>
  );
}

function DialogCliente({ id, onFechar }: { id: string; onFechar: () => void }) {
  const { pode } = useSessao();
  const { mostrar } = useToast();
  const cliente = useCliente(id);
  const consentimento = useRegistrarConsentimento();
  const reativacao = useRegistrarReativacao();
  const [editando, setEditando] = useState(false);
  const podeEscrever = pode("clientes:write");
  const dados = cliente.data;

  return (
    <Dialog
      aberto
      onFechar={onFechar}
      largura="max-w-2xl"
      titulo={dados?.cliente.nome ?? "Carregando…"}
      descricao={
        dados
          ? `${fmtTelefone(dados.cliente.telefone)} · na base desde ${dataCurtaDe(dados.cliente.criado_em)}`
          : undefined
      }
      rodape={
        dados && podeEscrever ? (
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditando((v) => !v)}>
              {editando ? "Fechar edição" : "Editar cadastro"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={reativacao.isPending || !dados.cliente.lgpd_consentimento}
              onClick={() =>
                reativacao.mutate(
                  { clienteId: id, canal: "whatsapp" },
                  {
                    onSuccess: () =>
                      mostrar({
                        tipo: "sucesso",
                        titulo: "Reativação registrada",
                        detalhe: "Canal: WhatsApp.",
                      }),
                    onError: (erro) =>
                      mostrar({ tipo: "erro", titulo: "Falhou", detalhe: erro.message }),
                  },
                )
              }
            >
              <Send className="size-3.5" aria-hidden />
              {reativacao.isPending ? "Registrando…" : "Registrar reativação"}
            </Button>
            {!dados.cliente.lgpd_consentimento && (
              <Button
                size="sm"
                disabled={consentimento.isPending}
                onClick={() =>
                  consentimento
                    .registrar(id, true, "whatsapp")
                    .then(() =>
                      mostrar({
                        tipo: "sucesso",
                        titulo: "Consentimento registrado",
                        detalhe: "Canal: WhatsApp.",
                      }),
                    )
                    .catch((erro: Error) =>
                      mostrar({ tipo: "erro", titulo: "Falhou", detalhe: erro.message }),
                    )
                }
              >
                <BadgeCheck className="size-3.5" aria-hidden />
                {consentimento.isPending ? "Registrando…" : "Registrar consentimento"}
              </Button>
            )}
          </div>
        ) : undefined
      }
    >
      {cliente.isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      )}
      {cliente.isError && (
        <ErrorState
          descricao={cliente.error.message}
          onRetry={() => {
            void cliente.refetch();
          }}
        />
      )}
      {dados && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <Metrica rotulo="Receita" valor={brl(dados.historico.totais.receita)} />
            <Metrica rotulo="Atendimentos" valor={`${dados.historico.totais.atendimentos}`} />
            <Metrica
              rotulo="Faltas"
              valor={`${dados.historico.totais.faltas}`}
              tom={dados.historico.totais.faltas > 0 ? "warning" : "neutro"}
            />
            <Metrica rotulo="Custo de insumos" valor={brl(dados.historico.totais.custo_insumos)} />
            <Metrica rotulo="Margem" valor={brl(dados.historico.totais.margem)} />
            <Metrica
              rotulo="Sem atividade"
              valor={
                dados.historico.dias_sem_atividade === null
                  ? "—"
                  : `${dados.historico.dias_sem_atividade} dias`
              }
            />
          </div>

          {!dados.cliente.lgpd_consentimento && (
            <div className="border-warning/30 bg-warning-soft flex items-start gap-2.5 rounded-md border px-3 py-2.5">
              <ShieldAlert className="text-warning mt-0.5 size-4 shrink-0" aria-hidden />
              <p className="text-[12.5px]">
                Sem consentimento LGPD registrado — a reativação automática fica bloqueada para este
                cliente até o consentimento ser gravado.
              </p>
            </div>
          )}

          {dados.cliente.lgpd_consentimento && dados.cliente.lgpd_data && (
            <p className="text-muted-foreground text-[12px]">
              Consentimento em {dataCurtaDe(dados.cliente.lgpd_data)}
              {dados.cliente.lgpd_canal ? ` · canal ${dados.cliente.lgpd_canal}` : ""}
            </p>
          )}

          <TagsDoCliente clienteId={id} atuais={dados.cliente.tags} podeEscrever={podeEscrever} />

          {dados.cliente.observacoes && !editando && (
            <div className="bg-muted/60 border-border rounded-md border px-3 py-2.5">
              <SectionLabel>Observações</SectionLabel>
              <p className="mt-1 text-[13px] whitespace-pre-line">{dados.cliente.observacoes}</p>
            </div>
          )}

          {editando && podeEscrever && (
            <FormularioEdicao cliente={dados.cliente} onPronto={() => setEditando(false)} />
          )}

          <div>
            <SectionLabel className="mb-2">Histórico unificado</SectionLabel>
            {dados.historico.eventos.length === 0 ? (
              <p className="text-muted-foreground text-[13px]">Nenhum evento registrado.</p>
            ) : (
              <ul className="divide-border divide-y">
                {dados.historico.eventos.map((h, i) => {
                  const status = STATUS_AGENDAMENTO[h.status];
                  return (
                    <li key={`${h.tipo}-${h.quando}-${i}`} className="flex items-center gap-3 py-2">
                      <CalendarClock className="text-muted-foreground size-4 shrink-0" aria-hidden />
                      <span className="tabular text-muted-foreground w-16 shrink-0 text-[12.5px]">
                        {dataCurtaDe(h.quando)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px]">{h.descricao}</span>
                      {typeof h.receita === "number" && h.receita > 0 && (
                        <span className="tabular text-[12.5px]">{brl(h.receita)}</span>
                      )}
                      {status ? (
                        <Badge tom={status.tom}>{status.rotulo}</Badge>
                      ) : (
                        <Badge tom="neutro">{h.status}</Badge>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <p className="text-muted-foreground text-[12px]">
            "Marcar retorno de reativação" não aparece aqui: a rota existe
            (<code className="tabular">PATCH /clientes/reativacoes/:id/retorno</code>), mas nenhuma rota
            de leitura devolve o id da reativação — sem id, a ação não pode ser oferecida.
          </p>
        </div>
      )}
    </Dialog>
  );
}

function TagsDoCliente({
  clienteId,
  atuais,
  podeEscrever,
}: {
  clienteId: string;
  atuais: { id: string; nome: string; cor: string }[];
  podeEscrever: boolean;
}) {
  const { mostrar } = useToast();
  const tags = useTags();
  const vincular = useVincularTag();
  const desvincular = useDesvincularTag();
  const disponiveis = (tags.data?.tags ?? []).filter((t) => !atuais.some((a) => a.id === t.id));

  return (
    <div>
      <SectionLabel className="mb-2">Etiquetas</SectionLabel>
      <div className="flex flex-wrap items-center gap-2">
        {atuais.length === 0 && <span className="text-muted-foreground text-[13px]">Nenhuma.</span>}
        {atuais.map((t) => (
          <span
            key={t.id}
            className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11.5px] font-semibold text-white"
            style={{ backgroundColor: t.cor }}
          >
            {t.nome}
            {podeEscrever && (
              <button
                type="button"
                aria-label={`Remover etiqueta ${t.nome}`}
                disabled={desvincular.isPending}
                onClick={() =>
                  desvincular.mutate(
                    { clienteId, tagId: t.id },
                    {
                      onError: (erro) =>
                        mostrar({ tipo: "erro", titulo: "Falhou", detalhe: erro.message }),
                    },
                  )
                }
                className="rounded-sm hover:bg-black/20"
              >
                <X className="size-3" aria-hidden />
              </button>
            )}
          </span>
        ))}
        {podeEscrever && disponiveis.length > 0 && (
          <label className="flex items-center gap-1.5">
            <span className="sr-only">Adicionar etiqueta</span>
            <TagIcone className="text-muted-foreground size-3.5" aria-hidden />
            <Select
              className="h-8 w-40 text-[12.5px]"
              value=""
              disabled={vincular.isPending}
              onChange={(e) =>
                e.target.value &&
                vincular.mutate(
                  { clienteId, tagId: e.target.value },
                  {
                    onError: (erro) =>
                      mostrar({ tipo: "erro", titulo: "Falhou", detalhe: erro.message }),
                  },
                )
              }
            >
              <option value="">Adicionar…</option>
              {disponiveis.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome}
                </option>
              ))}
            </Select>
          </label>
        )}
      </div>
    </div>
  );
}

function FormularioEdicao({
  cliente,
  onPronto,
}: {
  cliente: Cliente & { observacoes: string | null };
  onPronto: () => void;
}) {
  const { mostrar } = useToast();
  const atualizar = useAtualizarCliente();
  const [nome, setNome] = useState(cliente.nome);
  const [tel, setTel] = useState(cliente.telefone);
  const [email, setEmail] = useState(cliente.email ?? "");
  const [nascimento, setNascimento] = useState(cliente.data_nascimento ?? "");
  const [observacoes, setObservacoes] = useState(cliente.observacoes ?? "");
  const [ativo, setAtivo] = useState(cliente.ativo === 1);
  const telLimpo = tel.replace(/\D/g, "");
  const valido = nome.trim().length >= 2 && telLimpo.length >= 10;

  return (
    <div className="border-border space-y-3 rounded-md border px-3 py-3">
      <SectionLabel>Editar cadastro</SectionLabel>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nome">
          {(p) => <Input {...p} value={nome} onChange={(e) => setNome(e.target.value)} />}
        </Field>
        <Field label="Telefone">
          {(p) => <Input {...p} inputMode="tel" value={tel} onChange={(e) => setTel(e.target.value)} />}
        </Field>
        <Field label="E-mail">
          {(p) => <Input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Field label="Nascimento">
          {(p) => (
            <Input {...p} type="date" value={nascimento} onChange={(e) => setNascimento(e.target.value)} />
          )}
        </Field>
        <Field label="Observações" className="sm:col-span-2">
          {(p) => (
            <Textarea {...p} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
          )}
        </Field>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          className="accent-primary size-3.5"
          checked={ativo}
          onChange={(e) => setAtivo(e.target.checked)}
        />
        Cliente ativo
      </label>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onPronto}>
          Cancelar
        </Button>
        <Button
          size="sm"
          disabled={!valido || atualizar.isPending}
          onClick={() =>
            atualizar.mutate(
              {
                id: cliente.id,
                nome: nome.trim(),
                telefone: telLimpo,
                email: email.trim() || null,
                data_nascimento: nascimento || null,
                observacoes: observacoes.trim() || null,
                ativo,
              },
              {
                onSuccess: () => {
                  mostrar({ tipo: "sucesso", titulo: "Cadastro atualizado", detalhe: nome.trim() });
                  onPronto();
                },
                onError: (erro) =>
                  mostrar({ tipo: "erro", titulo: "Não foi possível salvar", detalhe: erro.message }),
              },
            )
          }
        >
          {atualizar.isPending ? "Salvando…" : "Salvar"}
        </Button>
      </div>
    </div>
  );
}

function Metrica({ rotulo, valor, tom = "neutro" }: { rotulo: string; valor: string; tom?: Tom }) {
  return (
    <div className="border-border bg-card rounded-md border px-3 py-2.5">
      <SectionLabel>{rotulo}</SectionLabel>
      <p className={cn("font-display mt-1 text-[20px] leading-none", tom === "warning" && "text-warning")}>
        {valor}
      </p>
    </div>
  );
}

function ItemDl({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-[11px] font-semibold tracking-[0.12em] uppercase">
        {rotulo}
      </dt>
      <dd className="mt-0.5 truncate text-[13px]">{valor || "—"}</dd>
    </div>
  );
}
