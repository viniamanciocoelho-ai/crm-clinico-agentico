/**
 * Atendimentos, financeiro e estoque — `packages/api/src/routes/atendimentos.ts`.
 *
 * Rotas reais:
 *   GET  /atendimentos?profissional_id&cliente_id&status&de&ate
 *   GET  /atendimentos/:id
 *   POST /atendimentos
 *   POST /atendimentos/:id/reembolsar        (permissão `financeiro:read`)
 *   GET  /atendimentos/indicadores/no-show   (permissão `relatorios:read`)
 *   GET  /atendimentos/estoque/movimentacoes (permissão `relatorios:read`)
 *   GET  /atendimentos/estoque/abaixo-do-minimo
 *
 * LIMITES DO CONTRATO — não existe rota para:
 *   - editar status de um atendimento já registrado (só registrar e reembolsar);
 *   - listar pagamentos isoladamente: o valor vive no atendimento e no
 *     histórico do cliente. Toda tela de "pagamentos" deve ser derivada daqui.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  Atendimento,
  IndicadorNoShow,
  InsumoEmFalta,
  MovimentacaoEstoque,
  RespostaAtendimentos,
  StatusAtendimento,
} from "./tipos";

/** `STATUS_VALIDOS` em `packages/api/src/routes/atendimentos.ts`. */
export const STATUS_ATENDIMENTO = [
  "concluido",
  "brinde",
  "reembolsado",
  "cancelado",
  "falta",
] as const;

/** Status que `POST /atendimentos` aceita ao registrar (reembolso tem rota própria). */
export const STATUS_ATENDIMENTO_REGISTRAVEIS = [
  "concluido",
  "brinde",
  "cancelado",
  "falta",
] as const;

export interface FiltroAtendimentos {
  profissional_id?: string;
  cliente_id?: string;
  status?: StatusAtendimento;
  /** ISO 8601. */
  de?: string;
  /** ISO 8601. */
  ate?: string;
}

export const chavesAtendimentos = {
  todas: ["atendimentos"] as const,
  lista: (filtro: FiltroAtendimentos) => ["atendimentos", "lista", filtro] as const,
  item: (id: string) => ["atendimentos", "item", id] as const,
  noShow: ["atendimentos", "no-show"] as const,
  movimentacoes: (insumoId?: string) => ["atendimentos", "estoque", insumoId ?? "todos"] as const,
  emFalta: ["atendimentos", "estoque", "abaixo-do-minimo"] as const,
};

export function useAtendimentos(filtro: FiltroAtendimentos = {}, habilitado = true) {
  return useQuery({
    queryKey: chavesAtendimentos.lista(filtro),
    enabled: habilitado,
    queryFn: () => api<RespostaAtendimentos>("/atendimentos", { params: { ...filtro } }),
  });
}

export function useAtendimento(id: string | null) {
  return useQuery({
    queryKey: chavesAtendimentos.item(id ?? ""),
    enabled: id !== null,
    queryFn: () => api<{ atendimento: Atendimento }>(`/atendimentos/${id}`),
  });
}

export interface NovoAtendimento {
  cliente_id: string;
  procedimento_id: string;
  status: (typeof STATUS_ATENDIMENTO_REGISTRAVEIS)[number];
  /** Quando informado, cliente/profissional/procedimento vêm do agendamento. */
  agendamento_id?: string;
  profissional_id?: string;
  /** Ausente, a API usa o preço do catálogo. */
  valor?: number;
  forma_pagamento?: string;
  observacoes?: string;
}

export function useRegistrarAtendimento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (corpo: NovoAtendimento) =>
      api<{ atendimento: Atendimento; efeito: Atendimento["efeito"] }>("/atendimentos", {
        metodo: "POST",
        corpo,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chavesAtendimentos.todas });
      void qc.invalidateQueries({ queryKey: ["agenda"] });
      void qc.invalidateQueries({ queryKey: ["clientes"] });
      void qc.invalidateQueries({ queryKey: ["painel"] });
    },
  });
}

/** Estorno: só de `concluido`/`brinde`, devolvendo insumos ao estoque. */
export function useReembolsarAtendimento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, observacoes }: { id: string; observacoes?: string }) =>
      api<{ atendimento: Atendimento; reembolsado_de: string }>(
        `/atendimentos/${id}/reembolsar`,
        { metodo: "POST", corpo: { observacoes } },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chavesAtendimentos.todas });
      void qc.invalidateQueries({ queryKey: ["clientes"] });
      void qc.invalidateQueries({ queryKey: ["painel"] });
    },
  });
}

export function useIndicadorNoShow(habilitado = true) {
  return useQuery({
    queryKey: chavesAtendimentos.noShow,
    enabled: habilitado,
    queryFn: () => api<IndicadorNoShow>("/atendimentos/indicadores/no-show"),
  });
}

export function useMovimentacoesEstoque(insumoId?: string, habilitado = true) {
  return useQuery({
    queryKey: chavesAtendimentos.movimentacoes(insumoId),
    enabled: habilitado,
    queryFn: () =>
      api<{ movimentacoes: MovimentacaoEstoque[] }>("/atendimentos/estoque/movimentacoes", {
        params: { insumo_id: insumoId },
      }),
  });
}

export function useInsumosEmFalta(habilitado = true) {
  return useQuery({
    queryKey: chavesAtendimentos.emFalta,
    enabled: habilitado,
    queryFn: () =>
      api<{ insumos: InsumoEmFalta[] }>("/atendimentos/estoque/abaixo-do-minimo"),
  });
}
