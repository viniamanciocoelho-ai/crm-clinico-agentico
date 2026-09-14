/**
 * Configurações da organização.
 *
 * Rotas reais (`packages/api/src/routes/agente.ts`):
 *   GET /agente/config     (agente_ia:config) — nome, timezone, reativacao_dias,
 *                          config_agente_ia, horario_funcionamento
 *   PUT /agente/config     (agente_ia:config) — grava só os campos enviados:
 *                          config_agente_ia, horario_funcionamento, timezone,
 *                          reativacao_dias
 *   GET /agente/catalogo   (agente_ia:config) — o que a IA pode afirmar
 *
 * LIMITES DO CONTRATO (todos à mostra na interface):
 *   - `organizacoes` não guarda CNPJ, endereço, telefone nem e-mail da clínica.
 *     Esses campos não existem no schema e a tela não os oferece.
 *   - `nome` é devolvido pelo GET mas o PUT não o aceita: renomear a clínica não
 *     tem rota. O campo é exibido como leitura.
 *   - `config_agente_ia` é um blob JSON opaco. O servidor valida apenas que é um
 *     objeto (ou null) e NÃO aplica nenhum subcampo: a escalada real acontece por
 *     gatilhos de texto em `detectarEscalada`, e as ferramentas `/agente/*` exigem
 *     só `conversas:write` — não consultam `pode_agendar`/`pode_cancelar`. O que
 *     esta aba grava é declaração de intenção para a integração de canal, não
 *     regra executada hoje. A interface diz isso.
 *   - `timezone`, `reativacao_dias` e `horario_funcionamento` SÃO aplicados:
 *     expediente e fuso entram em `validarAgendamento`/`horariosLivres`, e a
 *     janela de reativação alimenta o painel e a lista de clientes a reativar.
 *   - Não existe rota que liste "reativações disparadas" da organização inteira;
 *     o disparo é por cliente, em Clientes & funil.
 *   - Não existe rota de criação ou edição de usuários. `usuarios:write` está no
 *     mapa de permissões mas nenhuma rota a consome — a aba Permissões registra o
 *     bloqueio em vez de oferecer um formulário que tomaria 404.
 *   - Não existe `catalogo:*` nem `configuracoes:*` no RBAC. Catálogo roda sob
 *     `agenda:read`/`agenda:write` e esta tela sob `agente_ia:config`. Nenhuma
 *     permissão nova é proposta aqui.
 */
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Building2,
  CalendarClock,
  Info,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserCog,
} from "lucide-react";
import { ROLE_PERMISSIONS } from "@cav-crm/shared";
import { AppShell } from "@/components/app-shell";
import { useSessao } from "@/components/sessao";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, SectionLabel } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { SkeletonTabela } from "@/components/ui/skeleton";
import { DeniedState, EmptyState, ErrorState } from "@/components/ui/states";
import { Table, TBody, THead, TRow } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { brl, numero } from "@/lib/formato";
import { MODO_DEMO } from "@/lib/demo";
import { ROLE_DESCRICAO, ROLE_ROTULO, ROLES, type Role } from "@/lib/rbac";
import { cn } from "@/lib/utils";
import {
  useCatalogoDoAgente,
  useConfigAgente,
  useSalvarConfigAgente,
} from "@/queries/agente";
import type { ConfigAgenteIa, HorarioFuncionamento } from "@/queries/tipos";

type Aba = "clinica" | "expediente" | "ia" | "permissoes";

/** 0 = domingo, como o servidor valida em `PUT /agente/config`. */
const DIAS: { chave: string; rotulo: string; curto: string }[] = [
  { chave: "1", rotulo: "Segunda-feira", curto: "Seg" },
  { chave: "2", rotulo: "Terça-feira", curto: "Ter" },
  { chave: "3", rotulo: "Quarta-feira", curto: "Qua" },
  { chave: "4", rotulo: "Quinta-feira", curto: "Qui" },
  { chave: "5", rotulo: "Sexta-feira", curto: "Sex" },
  { chave: "6", rotulo: "Sábado", curto: "Sáb" },
  { chave: "0", rotulo: "Domingo", curto: "Dom" },
];

/** Fusos do Brasil. O servidor aceita qualquer zona válida para `Intl`. */
const FUSOS = [
  "America/Sao_Paulo",
  "America/Bahia",
  "America/Fortaleza",
  "America/Recife",
  "America/Belem",
  "America/Araguaina",
  "America/Campo_Grande",
  "America/Cuiaba",
  "America/Manaus",
  "America/Boa_Vista",
  "America/Porto_Velho",
  "America/Rio_Branco",
  "America/Noronha",
];

const TONS = [
  { id: "cordial_objetivo", rotulo: "Cordial e objetivo" },
  { id: "formal", rotulo: "Formal" },
  { id: "proximo", rotulo: "Próximo e informal" },
];

const CANAIS = [
  { id: "whatsapp", rotulo: "WhatsApp" },
  { id: "instagram", rotulo: "Instagram" },
  { id: "telefone", rotulo: "Telefone" },
  { id: "site", rotulo: "Site" },
];

/** Aviso de contrato: o que a tela não pode fazer e por quê. */
function AvisoContrato({
  children,
  tom = "info",
}: {
  children: React.ReactNode;
  tom?: "info" | "warning";
}) {
  const Icone = tom === "warning" ? AlertTriangle : Info;
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-md border px-4 py-3 text-[13px] leading-relaxed",
        tom === "warning"
          ? "border-warning/25 bg-warning-soft text-warning"
          : "border-border bg-muted text-muted-foreground",
      )}
    >
      <Icone className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export default function ConfiguracoesPage() {
  const { usuario, pode } = useSessao();
  const [aba, setAba] = useState<Aba>("clinica");

  // A tela inteira consome `/agente/config`, cuja permissão é `agente_ia:config`.
  if (!pode("agente_ia:config")) {
    return (
      <AppShell titulo="Configurações" descricao="Clínica, expediente, agente de IA e permissões.">
        <Card>
          <DeniedState
            recurso="configurações"
            role={ROLE_ROTULO[usuario?.role ?? "profissional"]}
            permissao="agente_ia:config"
          />
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell
      titulo="Configurações"
      descricao="O que a clínica define uma vez e a operação inteira passa a obedecer."
    >
      <Tabs
        abas={[
          { id: "clinica" as const, rotulo: "Clínica" },
          { id: "expediente" as const, rotulo: "Expediente" },
          { id: "ia" as const, rotulo: "Agente de IA" },
          { id: "permissoes" as const, rotulo: "Permissões" },
        ]}
        atual={aba}
        onMudar={setAba}
        className="mb-6"
      />

      {aba === "clinica" && <Clinica />}
      {aba === "expediente" && <Expediente />}
      {aba === "ia" && <AgenteIa />}
      {aba === "permissoes" && <Permissoes />}
    </AppShell>
  );
}

/* ---------------------------------------------------------------- Clínica -- */

function Clinica() {
  const { mostrar } = useToast();
  const config = useConfigAgente();
  const salvar = useSalvarConfigAgente();

  const [form, setForm] = useState<{ timezone: string; reativacao_dias: string } | null>(null);

  if (config.isPending) {
    return (
      <Card>
        <SkeletonTabela linhas={6} colunas={2} />
      </Card>
    );
  }
  if (config.isError) {
    return (
      <Card>
        <ErrorState descricao={config.error.message} onRetry={() => void config.refetch()} />
      </Card>
    );
  }

  const dados = config.data;
  const estado =
    form ?? {
      timezone: dados.timezone,
      reativacao_dias: String(dados.reativacao_dias),
    };
  const sujo =
    estado.timezone !== dados.timezone ||
    estado.reativacao_dias !== String(dados.reativacao_dias);

  const dias = Number(estado.reativacao_dias);
  const erroDias =
    !Number.isInteger(dias) || dias <= 0
      ? "O servidor exige um inteiro positivo."
      : dias > 1095
        ? "Acima de 3 anos a janela deixa de separar quem sumiu de quem nunca voltou."
        : undefined;

  const fusos = FUSOS.includes(estado.timezone) ? FUSOS : [estado.timezone, ...FUSOS];

  return (
    <div className="space-y-5">
      <AvisoContrato>
        A tabela <code className="font-mono text-[12px]">organizacoes</code> guarda nome, fuso,
        expediente, janela de reativação e a configuração da IA — <strong>nada mais</strong>. CNPJ,
        endereço, telefone e e-mail da clínica não existem no schema, então não há campo a salvar:
        eles não aparecem aqui em vez de aparecerem e falharem. O nome é devolvido pelo GET mas o
        PUT não o aceita — renomear a clínica não tem rota.
      </AvisoContrato>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <span className="bg-secondary text-primary rounded-md p-2">
                <Building2 className="size-4" aria-hidden />
              </span>
              <CardTitle className="font-display">Identificação</CardTitle>
            </div>
            <Badge tom="neutro">Somente leitura</Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <SectionLabel>Nome da clínica</SectionLabel>
              <p className="mt-1 text-[14px]">{dados.nome}</p>
            </div>
            <div>
              <SectionLabel>Identificador da organização</SectionLabel>
              <p className="mt-1 font-mono text-[13px]">{dados.organizacao_id}</p>
              <p className="text-muted-foreground mt-1 text-[12px]">
                Todo registro do sistema é filtrado por este identificador. Ele vem do token da
                sessão, nunca de um campo da tela.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <span className="bg-primary/10 text-primary rounded-md p-2">
                <CalendarClock className="size-4" aria-hidden />
              </span>
              <div>
                <CardTitle className="font-display">Fuso e reativação</CardTitle>
                <p className="text-muted-foreground mt-0.5 text-[13px]">
                  Os dois campos que a operação inteira consulta.
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <Field
              label="Fuso horário"
              hint="Usado para validar expediente e montar os horários livres da agenda."
            >
              {(p) => (
                <Select
                  {...p}
                  value={estado.timezone}
                  onChange={(e) => setForm({ ...estado, timezone: e.target.value })}
                >
                  {fusos.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field
              label="Janela de reativação (dias)"
              erro={erroDias}
              hint="Cliente sem atendimento por mais tempo que isso entra na lista de reativação do painel."
            >
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={1}
                  step={1}
                  value={estado.reativacao_dias}
                  onChange={(e) => setForm({ ...estado, reativacao_dias: e.target.value })}
                />
              )}
            </Field>

            <div className="flex items-center justify-end gap-2">
              {sujo && (
                <Button variant="ghost" size="sm" onClick={() => setForm(null)}>
                  Descartar
                </Button>
              )}
              <Button
                size="sm"
                disabled={!sujo || Boolean(erroDias) || salvar.isPending}
                onClick={() =>
                  salvar.mutate(
                    { timezone: estado.timezone, reativacao_dias: dias },
                    {
                      onSuccess: () => {
                        setForm(null);
                        mostrar({
                          tipo: "sucesso",
                          titulo: "Configuração salva",
                          detalhe: "Agenda e painel já usam os novos valores.",
                        });
                      },
                      onError: (e) =>
                        mostrar({
                          tipo: "erro",
                          titulo: "Não foi possível salvar",
                          detalhe: e.message,
                        }),
                    },
                  )
                }
              >
                {salvar.isPending ? "Salvando…" : "Salvar"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <AvisoContrato tom="warning">
        <strong className="font-semibold">Sem rota:</strong> não existe endpoint que liste as
        reativações disparadas da organização inteira. O disparo e o retorno são registrados por
        cliente — acompanhe em <em>Clientes &amp; funil</em>, no histórico de cada ficha.
      </AvisoContrato>
    </div>
  );
}

/* ------------------------------------------------------------- Expediente -- */

type Faixa = [string, string];

function normalizar(horario: HorarioFuncionamento | null): Record<string, Faixa[]> {
  const saida: Record<string, Faixa[]> = {};
  for (const dia of DIAS) saida[dia.chave] = [];
  if (!horario) return saida;
  for (const [dia, faixas] of Object.entries(horario)) {
    if (!Array.isArray(faixas)) continue;
    saida[dia] = faixas.map((f) => [String(f[0]), String(f[1])] as Faixa);
  }
  return saida;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function Expediente() {
  const { mostrar } = useToast();
  const config = useConfigAgente();
  const salvar = useSalvarConfigAgente();

  /**
   * `null` no rascunho é um valor legítimo ("sem restrição de expediente"), por
   * isso o rascunho é embrulhado: `null` = intocado, `{ valor: null }` = o
   * usuário escolheu remover a restrição.
   */
  const [rascunho, setRascunho] = useState<{ valor: Record<string, Faixa[]> | null } | null>(null);

  if (config.isPending) {
    return (
      <Card>
        <SkeletonTabela linhas={7} colunas={3} />
      </Card>
    );
  }
  if (config.isError) {
    return (
      <Card>
        <ErrorState descricao={config.error.message} onRetry={() => void config.refetch()} />
      </Card>
    );
  }

  const servidor = config.data.horario_funcionamento;
  const atual = rascunho ?? {
    valor: servidor === null ? null : normalizar(servidor),
  };
  const semRestricao = atual.valor === null;
  const grade = atual.valor ?? normalizar(servidor);

  const set = (valor: Record<string, Faixa[]> | null) => setRascunho({ valor });

  const mudarFaixa = (dia: string, indice: number, posicao: 0 | 1, hora: string) => {
    const copia: Record<string, Faixa[]> = { ...grade };
    const faixas = [...(copia[dia] ?? [])];
    const faixa: Faixa = [...(faixas[indice] ?? ["", ""])] as Faixa;
    faixa[posicao] = hora;
    faixas[indice] = faixa;
    copia[dia] = faixas;
    set(copia);
  };

  const adicionarFaixa = (dia: string) => {
    const copia: Record<string, Faixa[]> = { ...grade };
    const faixas = [...(copia[dia] ?? [])];
    const ultima = faixas[faixas.length - 1];
    faixas.push(ultima ? ["13:00", "18:00"] : ["08:00", "12:00"]);
    copia[dia] = faixas;
    set(copia);
  };

  const removerFaixa = (dia: string, indice: number) => {
    const copia: Record<string, Faixa[]> = { ...grade };
    copia[dia] = (copia[dia] ?? []).filter((_, i) => i !== indice);
    set(copia);
  };

  const copiarParaSemana = (dia: string) => {
    const modelo = (grade[dia] ?? []).map((f) => [...f] as Faixa);
    const copia: Record<string, Faixa[]> = { ...grade };
    for (const d of DIAS) {
      if (d.chave === "0" || d.chave === "6") continue;
      copia[d.chave] = modelo.map((f) => [...f] as Faixa);
    }
    set(copia);
  };

  // Mesmas checagens do servidor, antes de gastar a requisição.
  const erros: string[] = [];
  if (!semRestricao) {
    for (const dia of DIAS) {
      for (const [ini, fim] of grade[dia.chave] ?? []) {
        if (!HHMM.test(ini) || !HHMM.test(fim)) {
          erros.push(`${dia.rotulo}: faixa incompleta — informe início e fim no formato HH:MM.`);
        } else if (ini >= fim) {
          erros.push(`${dia.rotulo}: ${ini} não é antes de ${fim}.`);
        }
      }
    }
  }
  const abertos = DIAS.filter((d) => (grade[d.chave] ?? []).length > 0).length;
  const sujo = JSON.stringify(atual.valor) !== JSON.stringify(servidor === null ? null : normalizar(servidor));

  const enviar = () => {
    const corpo: HorarioFuncionamento | null = semRestricao
      ? null
      : Object.fromEntries(
          DIAS.filter((d) => (grade[d.chave] ?? []).length > 0).map((d) => [d.chave, grade[d.chave]!]),
        );
    salvar.mutate(
      { horario_funcionamento: corpo },
      {
        onSuccess: () => {
          setRascunho(null);
          mostrar({
            tipo: "sucesso",
            titulo: "Expediente salvo",
            detalhe: corpo
              ? "A agenda passa a recusar agendamento fora dessas faixas."
              : "Sem restrição: a agenda deixa de checar expediente.",
          });
        },
        onError: (e) =>
          mostrar({ tipo: "erro", titulo: "Não foi possível salvar", detalhe: e.message }),
      },
    );
  };

  return (
    <div className="space-y-5">
      <AvisoContrato>
        O expediente é regra executada, não decoração: <code className="font-mono text-[12px]">
          POST /agenda/agendamentos
        </code>{" "}
        recusa horário fora dele. A checagem usa o <strong>bloco reservado</strong>, que inclui o
        tempo de preparo antes e de limpeza depois do procedimento — um atendimento que termina às
        18:00 com 15 min de limpeza precisa de expediente até 18:15. Dia sem faixa é dia fechado.
      </AvisoContrato>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <span className="bg-secondary text-primary rounded-md p-2">
              <CalendarClock className="size-4" aria-hidden />
            </span>
            <div>
              <CardTitle className="font-display">Horário de funcionamento</CardTitle>
              <p className="text-muted-foreground mt-0.5 text-[13px]">
                {semRestricao
                  ? "Sem restrição de expediente."
                  : `${abertos} ${abertos === 1 ? "dia aberto" : "dias abertos"} · fuso ${config.data.timezone}`}
              </p>
            </div>
          </div>
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              className="accent-primary size-4"
              checked={semRestricao}
              onChange={(e) => set(e.target.checked ? null : normalizar(servidor))}
            />
            Sem restrição de expediente
          </label>
        </CardHeader>

        {semRestricao ? (
          <CardContent>
            <AvisoContrato tom="warning">
              Com <code className="font-mono text-[12px]">horario_funcionamento = null</code> o
              servidor <strong>não valida expediente</strong>: qualquer horário passa, inclusive
              madrugada e domingo. Só os bloqueios do profissional e da sala continuam valendo.
            </AvisoContrato>
          </CardContent>
        ) : (
          <CardContent className="space-y-3">
            {DIAS.map((dia) => {
              const faixas = grade[dia.chave] ?? [];
              return (
                <div
                  key={dia.chave}
                  className="border-border rounded-md border px-3.5 py-3 sm:flex sm:items-start sm:gap-4"
                >
                  <div className="flex items-center justify-between gap-3 sm:w-40 sm:shrink-0">
                    <span className="text-[13px] font-semibold">{dia.rotulo}</span>
                    {faixas.length === 0 && <Badge tom="neutro">Fechado</Badge>}
                  </div>

                  <div className="mt-3 min-w-0 flex-1 space-y-2 sm:mt-0">
                    {faixas.map((faixa, i) => (
                      <div key={i} className="flex flex-wrap items-center gap-2">
                        <label className="sr-only" htmlFor={`abre-${dia.chave}-${i}`}>
                          {dia.rotulo}: início da faixa {i + 1}
                        </label>
                        <Input
                          id={`abre-${dia.chave}-${i}`}
                          type="time"
                          className="w-[7.5rem]"
                          value={faixa[0]}
                          onChange={(e) => mudarFaixa(dia.chave, i, 0, e.target.value)}
                        />
                        <span className="text-muted-foreground text-[13px]" aria-hidden>
                          até
                        </span>
                        <label className="sr-only" htmlFor={`fecha-${dia.chave}-${i}`}>
                          {dia.rotulo}: fim da faixa {i + 1}
                        </label>
                        <Input
                          id={`fecha-${dia.chave}-${i}`}
                          type="time"
                          className="w-[7.5rem]"
                          value={faixa[1]}
                          onChange={(e) => mudarFaixa(dia.chave, i, 1, e.target.value)}
                        />
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Remover a faixa ${faixa[0]}–${faixa[1]} de ${dia.rotulo}`}
                          onClick={() => removerFaixa(dia.chave, i)}
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </Button>
                      </div>
                    ))}

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => adicionarFaixa(dia.chave)}
                      >
                        <Plus className="size-3.5" aria-hidden />
                        {faixas.length === 0 ? "Abrir este dia" : "Outra faixa"}
                      </Button>
                      {faixas.length > 0 && dia.chave !== "0" && dia.chave !== "6" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copiarParaSemana(dia.chave)}
                        >
                          Copiar para segunda a sexta
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        )}

        <div className="border-border flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3">
          <div className="min-w-0">
            {erros.length > 0 ? (
              <ul className="text-destructive space-y-0.5 text-[12px]" role="alert">
                {erros.slice(0, 3).map((e) => (
                  <li key={e}>{e}</li>
                ))}
                {erros.length > 3 && <li>e mais {erros.length - 3}…</li>}
              </ul>
            ) : (
              <p className="text-muted-foreground text-[12px]">
                Duas faixas no mesmo dia cobrem o intervalo de almoço. O servidor não recusa faixas
                sobrepostas — ele só exige início antes do fim.
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {sujo && (
              <Button variant="ghost" size="sm" onClick={() => setRascunho(null)}>
                Descartar
              </Button>
            )}
            <Button size="sm" disabled={!sujo || erros.length > 0 || salvar.isPending} onClick={enviar}>
              {salvar.isPending ? "Salvando…" : "Salvar expediente"}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ----------------------------------------------------------- Agente de IA -- */

interface FormIa {
  ativo: boolean;
  nome_exibicao: string;
  canal: string;
  tom: string;
  pode_agendar: boolean;
  pode_remarcar: boolean;
  pode_cancelar: boolean;
  escalar_apos_mensagens: string;
  horario_atendimento_ia: string;
}

function doServidor(cfg: ConfigAgenteIa | null): FormIa {
  return {
    ativo: cfg?.ativo ?? false,
    nome_exibicao: cfg?.nome_exibicao ?? "",
    canal: cfg?.canal ?? "whatsapp",
    tom: cfg?.tom ?? "cordial_objetivo",
    pode_agendar: cfg?.pode_agendar ?? false,
    pode_remarcar: cfg?.pode_remarcar ?? false,
    pode_cancelar: cfg?.pode_cancelar ?? false,
    escalar_apos_mensagens: String(cfg?.escalar_apos_mensagens ?? 5),
    horario_atendimento_ia: cfg?.horario_atendimento_ia ?? "",
  };
}

function AgenteIa() {
  const { mostrar } = useToast();
  const config = useConfigAgente();
  const catalogo = useCatalogoDoAgente();
  const salvar = useSalvarConfigAgente();

  const [form, setForm] = useState<FormIa | null>(null);

  if (config.isPending) {
    return (
      <Card>
        <SkeletonTabela linhas={6} colunas={2} />
      </Card>
    );
  }
  if (config.isError) {
    return (
      <Card>
        <ErrorState descricao={config.error.message} onRetry={() => void config.refetch()} />
      </Card>
    );
  }

  const base = doServidor(config.data.config_agente_ia);
  const estado = form ?? base;
  const sujo = JSON.stringify(estado) !== JSON.stringify(base);

  const escalar = Number(estado.escalar_apos_mensagens);
  const erroEscalar =
    !Number.isInteger(escalar) || escalar < 1 || escalar > 30
      ? "Informe um inteiro entre 1 e 30."
      : undefined;
  const erroNome =
    estado.ativo && estado.nome_exibicao.trim() === ""
      ? "Com o agente ativo, o nome exibido ao cliente é obrigatório."
      : undefined;

  const enviar = () => {
    const corpo: ConfigAgenteIa = {
      ativo: estado.ativo,
      nome_exibicao: estado.nome_exibicao.trim(),
      canal: estado.canal,
      tom: estado.tom,
      pode_agendar: estado.pode_agendar,
      pode_remarcar: estado.pode_remarcar,
      pode_cancelar: estado.pode_cancelar,
      escalar_apos_mensagens: escalar,
      horario_atendimento_ia: estado.horario_atendimento_ia.trim(),
    };
    salvar.mutate(
      { config_agente_ia: corpo },
      {
        onSuccess: () => {
          setForm(null);
          mostrar({
            tipo: "sucesso",
            titulo: "Configuração do agente salva",
            detalhe: "Gravada em config_agente_ia. A aplicação depende da integração de canal.",
          });
        },
        onError: (e) =>
          mostrar({ tipo: "erro", titulo: "Não foi possível salvar", detalhe: e.message }),
      },
    );
  };

  return (
    <div className="space-y-5">
      <AvisoContrato tom="warning">
        <strong className="font-semibold">Leia antes de mexer:</strong> o servidor guarda este bloco
        como JSON opaco e valida apenas que é um objeto. <strong>Nenhum subcampo é aplicado hoje</strong>
        : as ferramentas <code className="font-mono text-[12px]">/agente/*</code> exigem apenas{" "}
        <code className="font-mono text-[12px]">conversas:write</code> e não consultam a alçada, e a
        escalada para a fila humana acontece por gatilhos de texto no conteúdo da mensagem, não por
        contagem. O que se grava aqui é a decisão da clínica, para a integração de canal obedecer —
        não uma trava já executada pela API.
      </AvisoContrato>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <span className="bg-primary/10 text-primary rounded-md p-2">
                <Bot className="size-4" aria-hidden />
              </span>
              <div>
                <CardTitle className="font-display">Agente de IA</CardTitle>
                <p className="text-muted-foreground mt-0.5 text-[13px]">
                  Como ele se apresenta e o que a clínica autoriza.
                </p>
              </div>
            </div>
            <Badge tom={estado.ativo ? "success" : "neutro"} ponto>
              {estado.ativo ? "Ativo" : "Desligado"}
            </Badge>
          </CardHeader>

          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Situação do agente">
                {(p) => (
                  <Select
                    {...p}
                    value={estado.ativo ? "1" : "0"}
                    onChange={(e) => setForm({ ...estado, ativo: e.target.value === "1" })}
                  >
                    <option value="1">Ativo</option>
                    <option value="0">Desligado</option>
                  </Select>
                )}
              </Field>
              <Field label="Nome exibido ao cliente" erro={erroNome}>
                {(p) => (
                  <Input
                    {...p}
                    value={estado.nome_exibicao}
                    placeholder="Ex.: Ana, assistente da clínica"
                    onChange={(e) => setForm({ ...estado, nome_exibicao: e.target.value })}
                  />
                )}
              </Field>
              <Field label="Canal principal">
                {(p) => (
                  <Select
                    {...p}
                    value={estado.canal}
                    onChange={(e) => setForm({ ...estado, canal: e.target.value })}
                  >
                    {CANAIS.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.rotulo}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Tom de voz">
                {(p) => (
                  <Select
                    {...p}
                    value={estado.tom}
                    onChange={(e) => setForm({ ...estado, tom: e.target.value })}
                  >
                    {TONS.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.rotulo}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field
                label="Escalar depois de quantas mensagens"
                erro={erroEscalar}
                hint="Intenção declarada. A escalada real hoje é por gatilho de texto."
              >
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    min={1}
                    max={30}
                    value={estado.escalar_apos_mensagens}
                    onChange={(e) =>
                      setForm({ ...estado, escalar_apos_mensagens: e.target.value })
                    }
                  />
                )}
              </Field>
              <Field
                label="Janela de atendimento da IA"
                hint="Texto livre, ex.: 24h ou 08:00–20:00. Não é validado pelo servidor."
              >
                {(p) => (
                  <Input
                    {...p}
                    value={estado.horario_atendimento_ia}
                    placeholder="24h"
                    onChange={(e) =>
                      setForm({ ...estado, horario_atendimento_ia: e.target.value })
                    }
                  />
                )}
              </Field>
            </div>

            <div>
              <SectionLabel className="mb-2">Alçada — o que a IA pode executar sozinha</SectionLabel>
              <div className="space-y-2">
                <Alcada
                  rotulo="Criar agendamento"
                  descricao="Reserva horário na agenda respeitando expediente, sala e preparo."
                  valor={estado.pode_agendar}
                  onMudar={(v) => setForm({ ...estado, pode_agendar: v })}
                />
                <Alcada
                  rotulo="Remarcar agendamento"
                  descricao="Move um horário existente do próprio cliente."
                  valor={estado.pode_remarcar}
                  onMudar={(v) => setForm({ ...estado, pode_remarcar: v })}
                />
                <Alcada
                  rotulo="Cancelar agendamento"
                  descricao="Desligue se o cancelamento deve sempre passar por uma pessoa."
                  valor={estado.pode_cancelar}
                  onMudar={(v) => setForm({ ...estado, pode_cancelar: v })}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              {sujo && (
                <Button variant="ghost" size="sm" onClick={() => setForm(null)}>
                  Descartar
                </Button>
              )}
              <Button
                size="sm"
                disabled={!sujo || Boolean(erroEscalar || erroNome) || salvar.isPending}
                onClick={enviar}
              >
                {salvar.isPending ? "Salvando…" : "Salvar configuração"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card className="h-fit">
            <CardHeader className="py-3">
              <SectionLabel>Prévia da apresentação</SectionLabel>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="border-primary/20 bg-primary/8 rounded-lg border px-3.5 py-2.5 text-[13px] leading-relaxed">
                Olá! Aqui é {estado.nome_exibicao.trim() || "—"}, da {config.data.nome}.{" "}
                {estado.pode_agendar
                  ? "Posso verificar horários e já agendar para você."
                  : "Posso tirar dúvidas e passar para a equipe agendar."}
              </div>
              <p className="text-muted-foreground text-[12px]">
                Texto montado no cliente a partir dos campos acima, só para conferência. Nenhuma
                rota devolve a mensagem de saudação real.
              </p>
            </CardContent>
          </Card>

          <Card className="h-fit">
            <CardHeader className="py-3">
              <div className="flex items-center gap-2">
                <Sparkles className="text-primary size-4" aria-hidden />
                <SectionLabel>O que a IA pode afirmar</SectionLabel>
              </div>
            </CardHeader>
            {catalogo.isPending ? (
              <div className="p-5">
                <SkeletonTabela linhas={4} colunas={2} />
              </div>
            ) : catalogo.isError ? (
              <ErrorState
                descricao={catalogo.error.message}
                onRetry={() => void catalogo.refetch()}
              />
            ) : catalogo.data.procedimentos.length === 0 ? (
              <EmptyState
                titulo="Catálogo vazio"
                descricao="Sem procedimento ativo a IA não tem o que oferecer. Cadastre em Catálogo."
              />
            ) : (
              <>
                <Table>
                  <THead>
                    <tr>
                      <th>Procedimento</th>
                      <th className="text-right">Preço</th>
                      <th className="text-right">Prof.</th>
                    </tr>
                  </THead>
                  <TBody>
                    {catalogo.data.procedimentos.map((p) => (
                      <TRow key={p.id}>
                        <td>
                          <span className="font-medium">{p.nome}</span>
                          <span className="text-muted-foreground block text-[12px]">
                            {numero(p.duracao_min)} min
                          </span>
                        </td>
                        <td className="tabular text-right whitespace-nowrap">{brl(p.preco)}</td>
                        <td
                          className={cn(
                            "tabular text-right",
                            p.profissionais_habilitados === 0 && "text-warning font-semibold",
                          )}
                        >
                          {p.profissionais_habilitados}
                        </td>
                      </TRow>
                    ))}
                  </TBody>
                </Table>
                <div className="border-border border-t px-5 py-3">
                  <p className="text-muted-foreground text-[12px]">
                    Esta é a fronteira contra invenção: preço e duração fora desta lista a IA recusa
                    responder. Procedimento com zero profissional habilitado não pode ser agendado.
                  </p>
                </div>
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Alcada({
  rotulo,
  descricao,
  valor,
  onMudar,
}: {
  rotulo: string;
  descricao: string;
  valor: boolean;
  onMudar: (v: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "border-border hover:bg-muted/50 flex cursor-pointer items-start gap-3 rounded-md border px-3.5 py-3 transition-colors",
        valor && "border-primary/25 bg-primary/5",
      )}
    >
      <input
        type="checkbox"
        checked={valor}
        onChange={(e) => onMudar(e.target.checked)}
        className="accent-primary mt-0.5 size-4"
      />
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold">{rotulo}</span>
        <span className="text-muted-foreground block text-[12px]">{descricao}</span>
      </span>
    </label>
  );
}

/* ------------------------------------------------------------ Permissões -- */

function Permissoes() {
  const { usuario, trocarPerfil } = useSessao();
  const { mostrar } = useToast();

  const mapa = useMemo(() => ROLE_PERMISSIONS as Record<string, string[]>, []);

  return (
    <div className="space-y-5">
      <AvisoContrato>
        Este é o mapa real, o mesmo que{" "}
        <code className="font-mono text-[12px]">packages/api/src/middleware/permissoes.ts</code>{" "}
        aplica em cada rota — lido de{" "}
        <code className="font-mono text-[12px]">@cav-crm/shared</code>, não reescrito aqui. Ele é
        fixo no código: <strong>não existe rota para editar permissões</strong>, então esta aba é de
        leitura. Catálogo roda sob <code className="font-mono text-[12px]">agenda:read</code> e esta
        tela sob <code className="font-mono text-[12px]">agente_ia:config</code>; não há{" "}
        <code className="font-mono text-[12px]">catalogo:*</code> nem{" "}
        <code className="font-mono text-[12px]">configuracoes:*</code>.
      </AvisoContrato>

      <div className="grid gap-4 md:grid-cols-2">
        {ROLES.map((role) => {
          const permissoes = mapa[role] ?? [];
          const total = permissoes.includes("*");
          return (
            <Card key={role} className={cn(usuario?.role === role && "border-primary/40")}>
              <CardHeader>
                <div className="min-w-0">
                  <CardTitle className="font-display">{ROLE_ROTULO[role as Role]}</CardTitle>
                  <p className="text-muted-foreground mt-1 text-[13px]">
                    {ROLE_DESCRICAO[role as Role]}
                  </p>
                </div>
                {usuario?.role === role && <Badge tom="primary">Perfil atual</Badge>}
              </CardHeader>
              <CardContent className="space-y-3">
                <SectionLabel>Concedido pelo servidor</SectionLabel>
                {total ? (
                  <p className="text-[13px]">
                    <code className="border-border bg-muted rounded-sm border px-1.5 py-0.5 font-mono text-[11px]">
                      *
                    </code>{" "}
                    — acesso a toda rota, incluindo financeiro e configuração da IA.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {permissoes.map((p) => (
                      <code
                        key={p}
                        className="border-border bg-muted text-muted-foreground rounded-sm border px-1.5 py-0.5 font-mono text-[11px]"
                      >
                        {p}
                      </code>
                    ))}
                  </div>
                )}
                {permissoes.some((p) => p.endsWith(":read_own")) && (
                  <p className="text-muted-foreground text-[12px]">
                    <code className="font-mono text-[11px]">:read_own</code> é recorte do servidor:
                    a consulta já volta filtrada pelos próprios registros, não é a interface que
                    esconde.
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <span className="bg-warning-soft text-warning rounded-md p-2">
              <UserCog className="size-4" aria-hidden />
            </span>
            <div>
              <CardTitle className="font-display">Equipe e usuários</CardTitle>
              <p className="text-muted-foreground mt-0.5 text-[13px]">
                O que esta versão não faz — e por quê.
              </p>
            </div>
          </div>
          <Badge tom="warning">Bloqueado pelo backend</Badge>
        </CardHeader>
        <CardContent className="space-y-3 text-[13px] leading-relaxed">
          <p>
            <strong className="font-semibold">Criar, editar ou desativar usuário não tem rota.</strong>{" "}
            A permissão <code className="font-mono text-[12px]">usuarios:write</code> existe no mapa
            acima, mas nenhuma rota da API a consome — não há{" "}
            <code className="font-mono text-[12px]">POST /usuarios</code>. Incluir o formulário aqui
            só produziria 404, então ele não existe: quem cria acesso hoje é o seed/administração do
            banco.
          </p>
          <p>
            <strong className="font-semibold">Profissionais são outra coisa.</strong> Quem executa
            procedimento e ocupa agenda vive na tabela{" "}
            <code className="font-mono text-[12px]">profissionais</code> e é gerido em{" "}
            <em>Catálogo → Profissionais</em>, com rotas reais de criação e edição. Vincular um
            profissional a um login só é possível informando um{" "}
            <code className="font-mono text-[12px]">usuario_id</code> que já exista.
          </p>
          <p className="text-muted-foreground">
            Conselho profissional (CRO) e demais dados de registro não existem na tabela — nenhum
            campo do tipo é oferecido.
          </p>
        </CardContent>
      </Card>

      {MODO_DEMO && trocarPerfil && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <span className="bg-accent/15 text-accent rounded-md p-2">
                <ShieldCheck className="size-4" aria-hidden />
              </span>
              <div>
                <CardTitle className="font-display">Conferir o RBAC na prática</CardTitle>
                <p className="text-muted-foreground mt-0.5 text-[13px]">
                  Só em modo demonstração. Faz um login real com o usuário daquele perfil — JWT e
                  RBAC do servidor, sem atalho de cliente.
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {ROLES.map((role) => (
              <Button
                key={role}
                variant={usuario?.role === role ? "secondary" : "outline"}
                size="sm"
                disabled={usuario?.role === role}
                onClick={() =>
                  void trocarPerfil(role).catch((e: Error) =>
                    mostrar({
                      tipo: "erro",
                      titulo: "Não foi possível trocar de perfil",
                      detalhe: e.message,
                    }),
                  )
                }
              >
                Entrar como {ROLE_ROTULO[role as Role]}
              </Button>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
