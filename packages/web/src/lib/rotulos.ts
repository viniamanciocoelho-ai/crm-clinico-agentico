/**
 * Rótulos em português para enums do servidor que `components/ui/badge.tsx`
 * ainda não cobre (lá vivem os mapas de status, com rótulo + tom).
 *
 * As chaves são exatamente os enums de `packages/api` (ver `queries/tipos.ts`):
 * nada aqui inventa estado novo, só traduz para exibição.
 */
import type { CanalEntrada, EtapaLead, StatusAgendamento } from "@/queries/tipos";

/** `ETAPAS` em `packages/api/src/routes/clientes.ts`, na ordem do funil. */
export const ETAPA_ROTULO: Record<EtapaLead, string> = {
  novo: "Novo",
  em_conversa: "Em conversa",
  qualificado: "Qualificado",
  agendado: "Agendado",
  compareceu: "Compareceu",
  fechado: "Fechado",
  perdido: "Perdido",
};

/** `CANAIS` em `packages/api/src/routes/clientes.ts`. */
export const CANAL_ROTULO: Record<CanalEntrada, string> = {
  whatsapp: "WhatsApp",
  indicacao: "Indicação",
  instagram: "Instagram",
  presencial: "Presencial",
  telefone: "Telefone",
};

/** Versão curta dos status, para caber nos chips da grade da agenda no mobile. */
export const STATUS_AGENDAMENTO_CURTO: Record<StatusAgendamento, string> = {
  agendado: "A confirmar",
  confirmado: "Confirmado",
  cancelado_pelo_cliente: "Cancel. cliente",
  cancelado_pela_clinica: "Cancel. clínica",
  remarcado: "Remarcado",
};

/** Status que representam cancelamento — não ocupam sala nem contam na grade. */
export const AGENDAMENTOS_CANCELADOS = new Set<StatusAgendamento>([
  "cancelado_pelo_cliente",
  "cancelado_pela_clinica",
  "remarcado",
]);
