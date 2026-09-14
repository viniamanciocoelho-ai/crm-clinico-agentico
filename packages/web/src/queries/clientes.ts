/**
 * Clientes, tags, segmentos, leads e reativações —
 * `packages/api/src/routes/clientes.ts`.
 *
 * Rotas reais:
 *   GET    /clientes?busca&somente_ativos&tag_id
 *   GET    /clientes/:id                      (cadastro + histórico unificado)
 *   POST   /clientes
 *   PATCH  /clientes/:id
 *   GET    /clientes/segmentos?segmento=inativos|aniversariantes|com_pacote
 *   GET    /clientes/tags        POST /clientes/tags
 *   POST   /clientes/:id/tags   DELETE /clientes/:id/tags/:tagId
 *   GET    /clientes/motivos-perda  POST /clientes/motivos-perda
 *   GET    /leads?etapa&canal_entrada   POST /leads   PATCH /leads/:id/etapa
 *   POST   /clientes/:id/reativacoes
 *   PATCH  /clientes/reativacoes/:id/retorno
 *
 * LGPD: não existe endpoint dedicado de consentimento — grava-se por
 * `PATCH /clientes/:id` com `{ lgpd_consentimento, lgpd_canal? }`, e a própria
 * API estampa `lgpd_data`.
 *
 * O filtro "sem consentimento" não existe no servidor: é aplicado no cliente
 * sobre `lgpd_consentimento` da listagem.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  CanalEntrada,
  Cliente,
  EtapaLead,
  Lead,
  MotivoPerda,
  RespostaCliente,
  RespostaSegmento,
  SegmentoCliente,
  Tag,
} from "./tipos";

/** `ETAPAS` no servidor, na ordem do funil. */
export const ETAPAS_LEAD = [
  "novo",
  "em_conversa",
  "qualificado",
  "agendado",
  "compareceu",
  "fechado",
  "perdido",
] as const;

/** `CANAIS` no servidor. */
export const CANAIS_LEAD = [
  "whatsapp",
  "indicacao",
  "instagram",
  "presencial",
  "telefone",
] as const;

export interface FiltroClientes {
  busca?: string;
  somente_ativos?: boolean;
  tag_id?: string;
}

export const chavesClientes = {
  todas: ["clientes"] as const,
  lista: (filtro: FiltroClientes) => ["clientes", "lista", filtro] as const,
  item: (id: string) => ["clientes", "item", id] as const,
  segmento: (segmento: SegmentoCliente) => ["clientes", "segmento", segmento] as const,
  tags: ["clientes", "tags"] as const,
  motivosPerda: ["clientes", "motivos-perda"] as const,
  leads: (filtro: FiltroLeads) => ["clientes", "leads", filtro] as const,
};

export function useClientes(filtro: FiltroClientes = {}, habilitado = true) {
  return useQuery({
    queryKey: chavesClientes.lista(filtro),
    enabled: habilitado,
    queryFn: () =>
      api<{ clientes: Cliente[] }>("/clientes", {
        params: {
          busca: filtro.busca,
          somente_ativos: filtro.somente_ativos ? "1" : undefined,
          tag_id: filtro.tag_id,
        },
      }),
  });
}

export function useCliente(id: string | null) {
  return useQuery({
    queryKey: chavesClientes.item(id ?? ""),
    enabled: id !== null,
    queryFn: () => api<RespostaCliente>(`/clientes/${id}`),
  });
}

export interface NovoCliente {
  nome: string;
  telefone: string;
  email?: string;
  /** `YYYY-MM-DD`. */
  data_nascimento?: string;
  origem_lead?: string;
  observacoes?: string;
  lgpd_consentimento?: boolean;
  lgpd_canal?: string;
}

export function useCriarCliente() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (corpo: NovoCliente) =>
      api<{ cliente: { id: string; nome: string; telefone: string } }>("/clientes", {
        metodo: "POST",
        corpo,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chavesClientes.todas });
    },
  });
}

export interface AlteracaoCliente {
  nome?: string;
  telefone?: string;
  email?: string | null;
  data_nascimento?: string | null;
  origem_lead?: string | null;
  observacoes?: string | null;
  ativo?: boolean;
  lgpd_consentimento?: boolean;
  lgpd_canal?: string;
}

export function useAtualizarCliente() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...corpo }: AlteracaoCliente & { id: string }) =>
      api<{ atualizado: true }>(`/clientes/${id}`, { metodo: "PATCH", corpo }),
    onSuccess: (_dados, variaveis) => {
      void qc.invalidateQueries({ queryKey: chavesClientes.item(variaveis.id) });
      void qc.invalidateQueries({ queryKey: chavesClientes.todas });
    },
  });
}

/** Consentimento LGPD: mesmo `PATCH /clientes/:id`, com intenção explícita. */
export function useRegistrarConsentimento() {
  const atualizar = useAtualizarCliente();
  return {
    ...atualizar,
    registrar: (id: string, consentimento: boolean, canal = "presencial") =>
      atualizar.mutateAsync({ id, lgpd_consentimento: consentimento, lgpd_canal: canal }),
  };
}

export function useSegmento(segmento: SegmentoCliente | null) {
  return useQuery({
    queryKey: chavesClientes.segmento(segmento ?? "inativos"),
    enabled: segmento !== null,
    queryFn: () => api<RespostaSegmento>("/clientes/segmentos", { params: { segmento } }),
  });
}

export function useTags(habilitado = true) {
  return useQuery({
    queryKey: chavesClientes.tags,
    enabled: habilitado,
    queryFn: () => api<{ tags: Tag[] }>("/clientes/tags"),
  });
}

export function useCriarTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (corpo: { nome: string; cor?: string }) =>
      api<{ tag: { id: string; nome: string } }>("/clientes/tags", { metodo: "POST", corpo }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chavesClientes.tags });
    },
  });
}

export function useVincularTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ clienteId, tagId }: { clienteId: string; tagId: string }) =>
      api<{ tags: Tag[] }>(`/clientes/${clienteId}/tags`, {
        metodo: "POST",
        corpo: { tag_id: tagId },
      }),
    onSuccess: (_dados, { clienteId }) => {
      void qc.invalidateQueries({ queryKey: chavesClientes.item(clienteId) });
      void qc.invalidateQueries({ queryKey: chavesClientes.todas });
    },
  });
}

export function useDesvincularTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ clienteId, tagId }: { clienteId: string; tagId: string }) =>
      api<{ removido: true }>(`/clientes/${clienteId}/tags/${tagId}`, { metodo: "DELETE" }),
    onSuccess: (_dados, { clienteId }) => {
      void qc.invalidateQueries({ queryKey: chavesClientes.item(clienteId) });
      void qc.invalidateQueries({ queryKey: chavesClientes.todas });
    },
  });
}

export function useMotivosPerda(habilitado = true) {
  return useQuery({
    queryKey: chavesClientes.motivosPerda,
    enabled: habilitado,
    queryFn: () => api<{ motivos: MotivoPerda[] }>("/clientes/motivos-perda"),
  });
}

export function useCriarMotivoPerda() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (corpo: { descricao: string }) =>
      api<{ motivo: { id: string; descricao: string } }>("/clientes/motivos-perda", {
        metodo: "POST",
        corpo,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chavesClientes.motivosPerda });
    },
  });
}

export interface FiltroLeads {
  etapa?: EtapaLead;
  canal_entrada?: CanalEntrada;
}

export function useLeads(filtro: FiltroLeads = {}, habilitado = true) {
  return useQuery({
    queryKey: chavesClientes.leads(filtro),
    enabled: habilitado,
    queryFn: () => api<{ leads: Lead[] }>("/leads", { params: { ...filtro } }),
  });
}

export function useCriarLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (corpo: {
      telefone: string;
      nome?: string;
      canal_entrada?: CanalEntrada;
      atendido_por_tipo?: "ia" | "humano";
    }) =>
      api<{ lead: { id: string; telefone: string; etapa: EtapaLead; cliente_id: string | null } }>(
        "/leads",
        { metodo: "POST", corpo },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chavesClientes.todas });
      void qc.invalidateQueries({ queryKey: ["painel"] });
    },
  });
}

/**
 * Move o lead de etapa. `perdido` exige `motivo_perda_id`; `fechado` converte o
 * lead em cliente no servidor — e é o único ponto em que `lgpd_consentimento`
 * entra junto.
 */
export function useMoverLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...corpo
    }: {
      id: string;
      etapa: EtapaLead;
      motivo_perda_id?: string;
      observacao_perda?: string;
      nome?: string;
      origem_lead?: string;
      lgpd_consentimento?: boolean;
      lgpd_canal?: string;
    }) =>
      api<{ id: string; etapa: EtapaLead; cliente_id: string | null }>(`/leads/${id}/etapa`, {
        metodo: "PATCH",
        corpo,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chavesClientes.todas });
      void qc.invalidateQueries({ queryKey: ["painel"] });
    },
  });
}

/**
 * Registra o disparo de uma reativação para o cliente. Não existe listagem
 * crua de reativações da organização: só o agregado em `GET /painel/clientes`
 * e os eventos no histórico de cada cliente.
 */
export function useRegistrarReativacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ clienteId, canal }: { clienteId: string; canal?: string }) =>
      api<{ reativacao: { id: string; cliente_id: string }; canal: string }>(
        `/clientes/${clienteId}/reativacoes`,
        { metodo: "POST", corpo: { canal } },
      ),
    onSuccess: (_dados, { clienteId }) => {
      void qc.invalidateQueries({ queryKey: chavesClientes.item(clienteId) });
      void qc.invalidateQueries({ queryKey: ["painel"] });
    },
  });
}

export function useMarcarRetornoReativacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ reativacaoId }: { reativacaoId: string }) =>
      api<{ id: string; retornou: true }>(`/clientes/reativacoes/${reativacaoId}/retorno`, {
        metodo: "PATCH",
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chavesClientes.todas });
      void qc.invalidateQueries({ queryKey: ["painel"] });
    },
  });
}
