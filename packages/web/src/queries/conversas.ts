/**
 * Conversas e ações da IA — `packages/api/src/routes/conversas.ts`.
 *
 * Rotas reais:
 *   GET   /conversas?status&fila=1
 *   GET   /conversas/:id
 *   POST  /conversas                    (abre ou reaproveita por telefone)
 *   POST  /conversas/:id/mensagens      (mensagem DO CLIENTE; pode auto-escalar)
 *   POST  /conversas/:id/responder      (humano assume e responde)
 *   POST  /conversas/:id/devolver-ia
 *   POST  /conversas/:id/encerrar
 *   PATCH /conversas/:id/cliente        (vincula a conversa a um cliente)
 *   GET   /conversas/ia/acoes?conversa_id
 *
 * Toda escrita exige `conversas:write`; as leituras, `conversas:read`.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { AcaoIa, ConversaLista, RespostaConversa, StatusConversa } from "./tipos";

export interface FiltroConversas {
  status?: StatusConversa;
  /** `fila=1` traz só o que aguarda humano ou já está com humano. */
  fila?: boolean;
}

export const chavesConversas = {
  todas: ["conversas"] as const,
  lista: (filtro: FiltroConversas) => ["conversas", "lista", filtro] as const,
  item: (id: string) => ["conversas", "item", id] as const,
  acoesIa: (conversaId?: string) => ["conversas", "ia", "acoes", conversaId ?? "todas"] as const,
};

export function useConversas(filtro: FiltroConversas = {}, habilitado = true) {
  return useQuery({
    queryKey: chavesConversas.lista(filtro),
    enabled: habilitado,
    queryFn: () =>
      api<{ conversas: ConversaLista[] }>("/conversas", {
        params: { status: filtro.status, fila: filtro.fila ? "1" : undefined },
      }),
  });
}

/** Fila de atendimento humano — o que a tela de conversas abre por padrão. */
export function useFilaConversas(habilitado = true) {
  return useConversas({ fila: true }, habilitado);
}

export function useConversa(id: string | null) {
  return useQuery({
    queryKey: chavesConversas.item(id ?? ""),
    enabled: id !== null,
    queryFn: () => api<RespostaConversa>(`/conversas/${id}`),
  });
}

export function useAcoesIa(conversaId: string | null, habilitado = true) {
  return useQuery({
    queryKey: chavesConversas.acoesIa(conversaId ?? undefined),
    enabled: habilitado,
    queryFn: () =>
      api<{ acoes: AcaoIa[] }>("/conversas/ia/acoes", {
        params: { conversa_id: conversaId ?? undefined },
      }),
  });
}

export function useAbrirConversa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (corpo: { telefone: string; canal?: string; lead_id?: string }) =>
      api<{ conversa: RespostaConversa["conversa"]; reaproveitada: boolean }>("/conversas", {
        metodo: "POST",
        corpo,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chavesConversas.todas });
    },
  });
}

/**
 * Registra mensagem do CLIENTE. O servidor decide sozinho se escala para
 * humano (`detectarEscalada`) e se a IA responde — o front não simula nada.
 */
export function useRegistrarMensagemCliente() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      conteudo,
      remetente_tipo,
    }: {
      id: string;
      conteudo: string;
      remetente_tipo?: "cliente" | "ia" | "humano";
    }) =>
      api<{
        registrada: true;
        status: StatusConversa;
        motivo_escalada: string | null;
        resposta_ia?: string;
      }>(`/conversas/${id}/mensagens`, { metodo: "POST", corpo: { conteudo, remetente_tipo } }),
    onSuccess: (_dados, { id }) => {
      void qc.invalidateQueries({ queryKey: chavesConversas.item(id) });
      void qc.invalidateQueries({ queryKey: chavesConversas.todas });
    },
  });
}

/** Resposta do humano: assume a conversa e a marca como `com_humano`. */
export function useResponderComoHumano() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, conteudo }: { id: string; conteudo: string }) =>
      api<{ respondida: true; status: "com_humano" }>(`/conversas/${id}/responder`, {
        metodo: "POST",
        corpo: { conteudo },
      }),
    onSuccess: (_dados, { id }) => {
      void qc.invalidateQueries({ queryKey: chavesConversas.item(id) });
      void qc.invalidateQueries({ queryKey: chavesConversas.todas });
    },
  });
}

export function useDevolverParaIa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      api<{ status: "com_ia" }>(`/conversas/${id}/devolver-ia`, { metodo: "POST" }),
    onSuccess: (_dados, { id }) => {
      void qc.invalidateQueries({ queryKey: chavesConversas.item(id) });
      void qc.invalidateQueries({ queryKey: chavesConversas.todas });
    },
  });
}

export function useEncerrarConversa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      api<{ status: "encerrada" }>(`/conversas/${id}/encerrar`, { metodo: "POST" }),
    onSuccess: (_dados, { id }) => {
      void qc.invalidateQueries({ queryKey: chavesConversas.item(id) });
      void qc.invalidateQueries({ queryKey: chavesConversas.todas });
    },
  });
}

export function useVincularClienteAConversa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, clienteId }: { id: string; clienteId: string }) =>
      api<{ conversa_id: string; cliente_id: string }>(`/conversas/${id}/cliente`, {
        metodo: "PATCH",
        corpo: { cliente_id: clienteId },
      }),
    onSuccess: (_dados, { id }) => {
      void qc.invalidateQueries({ queryKey: chavesConversas.item(id) });
      void qc.invalidateQueries({ queryKey: chavesConversas.todas });
    },
  });
}
