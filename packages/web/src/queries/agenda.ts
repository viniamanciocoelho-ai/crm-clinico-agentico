/**
 * Agenda — `packages/api/src/routes/agenda.ts`.
 *
 * Rotas reais usadas aqui, nada além delas:
 *   GET   /agenda?de&ate&profissional_id&status
 *   GET   /agenda/horarios-livres?procedimento_id&de&ate&profissional_id&sala_id&passo_min
 *   GET   /agenda/:id
 *   POST  /agenda
 *   POST  /agenda/:id/remarcar
 *   PATCH /agenda/:id/status
 *   POST  /agenda/bloqueios
 *
 * `de`/`ate` são ISO 8601 (a API faz `Date.parse`), enquanto TODO instante que
 * volta é epoch em ms. O filtro por profissional é ignorado pelo servidor para
 * quem só tem `agenda:read_own` — a coluna própria é imposta pelo banco.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  Agendamento,
  Bloqueio,
  RespostaAgenda,
  RespostaHorariosLivres,
  StatusAgendamento,
} from "./tipos";

/** Status que `PATCH /agenda/:id/status` aceita — `remarcado` é só do /remarcar. */
export const STATUS_AGENDAMENTO_EDITAVEIS = [
  "agendado",
  "confirmado",
  "cancelado_pelo_cliente",
  "cancelado_pela_clinica",
] as const;

export type StatusAgendamentoEditavel = (typeof STATUS_AGENDAMENTO_EDITAVEIS)[number];

export interface FiltroAgenda {
  de: string;
  ate: string;
  profissional_id?: string;
  status?: StatusAgendamento;
}

export const chavesAgenda = {
  todas: ["agenda"] as const,
  lista: (filtro: FiltroAgenda) => ["agenda", "lista", filtro] as const,
  item: (id: string) => ["agenda", "item", id] as const,
  horarios: (filtro: FiltroHorariosLivres) => ["agenda", "horarios-livres", filtro] as const,
};

/** Janela [00:00, 24:00) do dia local informado, no formato que a API aceita. */
export function janelaDoDia(dia: Date): { de: string; ate: string } {
  const inicio = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate());
  const fim = new Date(inicio.getTime() + 86_400_000);
  return { de: inicio.toISOString(), ate: fim.toISOString() };
}

/** Janela da semana que contém o dia (domingo a domingo, hora local). */
export function janelaDaSemana(dia: Date): { de: string; ate: string } {
  const inicio = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate() - dia.getDay());
  const fim = new Date(inicio.getTime() + 7 * 86_400_000);
  return { de: inicio.toISOString(), ate: fim.toISOString() };
}

export function useAgenda(filtro: FiltroAgenda, habilitado = true) {
  return useQuery({
    queryKey: chavesAgenda.lista(filtro),
    enabled: habilitado,
    queryFn: () => api<RespostaAgenda>("/agenda", { params: { ...filtro } }),
  });
}

/** Atalho para a agenda de um dia só — o caso da tela de agenda. */
export function useAgendaDia(dia: Date, profissionalId?: string, habilitado = true) {
  return useAgenda({ ...janelaDoDia(dia), profissional_id: profissionalId }, habilitado);
}

export function useAgendamento(id: string | null) {
  return useQuery({
    queryKey: chavesAgenda.item(id ?? ""),
    enabled: id !== null,
    queryFn: () => api<{ agendamento: Agendamento }>(`/agenda/${id}`),
  });
}

export interface FiltroHorariosLivres {
  procedimento_id: string;
  de: string;
  ate: string;
  profissional_id?: string;
  sala_id?: string;
  passo_min?: number;
}

export function useHorariosLivres(filtro: FiltroHorariosLivres | null) {
  return useQuery({
    queryKey: chavesAgenda.horarios(filtro ?? ({} as FiltroHorariosLivres)),
    enabled: filtro !== null && filtro.procedimento_id !== "",
    queryFn: () =>
      api<RespostaHorariosLivres>("/agenda/horarios-livres", { params: { ...filtro } }),
  });
}

export interface NovoAgendamento {
  cliente_id: string;
  procedimento_id: string;
  /** ISO 8601. */
  inicio: string;
  profissional_id?: string;
  sala_id?: string;
  origem?: string;
  observacoes?: string;
}

export function useCriarAgendamento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (corpo: NovoAgendamento) =>
      api<{ agendamento: Agendamento }>("/agenda", { metodo: "POST", corpo }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chavesAgenda.todas });
    },
  });
}

export function useRemarcarAgendamento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      inicio,
      observacoes,
    }: {
      id: string;
      /** ISO 8601. */
      inicio: string;
      observacoes?: string;
    }) =>
      api<{ agendamento: Agendamento; remarcado_de: string }>(`/agenda/${id}/remarcar`, {
        metodo: "POST",
        corpo: { inicio, observacoes },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chavesAgenda.todas });
    },
  });
}

export function useAlterarStatusAgendamento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: StatusAgendamentoEditavel }) =>
      api<{ id: string; status: string }>(`/agenda/${id}/status`, {
        metodo: "PATCH",
        corpo: { status },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chavesAgenda.todas });
    },
  });
}

/**
 * Bloqueio de agenda de um profissional ou de uma sala. A API grava a lista
 * completa em `bloqueios_agenda` (JSON) e devolve a lista resultante.
 */
export function useCriarBloqueio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (corpo: {
      alvo: "profissional" | "sala";
      alvo_id: string;
      /** ISO 8601. */
      inicio: string;
      /** ISO 8601. */
      fim: string;
      motivo?: string;
    }) =>
      api<{ alvo: string; alvo_id: string; bloqueios: Bloqueio[] }>("/agenda/bloqueios", {
        metodo: "POST",
        corpo,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chavesAgenda.todas });
      void qc.invalidateQueries({ queryKey: ["catalogo"] });
    },
  });
}
