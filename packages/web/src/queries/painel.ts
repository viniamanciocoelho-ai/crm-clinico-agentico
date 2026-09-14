/**
 * Painel / relatórios — `packages/api/src/routes/painel.ts`.
 *
 * Rotas reais (todas com permissão `relatorios:read`):
 *   GET /painel/resumo?de&ate
 *   GET /painel/funil?de&ate
 *   GET /painel/clientes?de&ate
 *   GET /painel/procedimentos?de&ate
 *   GET /painel/profissionais?de&ate
 *   GET /painel/ocupacao?de&ate
 *
 * Cada rota devolve APENAS agregados — não existe endpoint único de dashboard.
 * A home compõe o que precisa a partir destes mais `/agenda` e `/conversas`.
 * `de`/`ate` são ISO 8601; omitidos, a API usa o mês corrente no fuso da
 * organização.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  PainelClientes,
  PainelFunil,
  PainelOcupacao,
  PainelProcedimentos,
  PainelProfissionais,
  PainelResumo,
} from "./tipos";

export interface PeriodoConsulta {
  /** ISO 8601. */
  de?: string;
  /** ISO 8601. */
  ate?: string;
}

export const chavesPainel = {
  todas: ["painel"] as const,
  resumo: (p: PeriodoConsulta) => ["painel", "resumo", p] as const,
  funil: (p: PeriodoConsulta) => ["painel", "funil", p] as const,
  clientes: (p: PeriodoConsulta) => ["painel", "clientes", p] as const,
  procedimentos: (p: PeriodoConsulta) => ["painel", "procedimentos", p] as const,
  profissionais: (p: PeriodoConsulta) => ["painel", "profissionais", p] as const,
  ocupacao: (p: PeriodoConsulta) => ["painel", "ocupacao", p] as const,
};

/**
 * Início do dia seguinte, hora local. É o limite superior usado pelos períodos
 * abaixo: arredondar para o dia mantém o valor ESTÁVEL entre renderizações.
 *
 * Isto não é detalhe de estilo. Estes retornos entram na `queryKey` do
 * react-query, que compara por igualdade estrutural; um `ate` com o instante
 * exato (milissegundos) gera uma chave nova a cada render, e cada resposta
 * dispara a próxima busca — laço infinito com a tela presa no skeleton.
 */
function fimDoDia(base: Date): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1);
}

/** Últimos `dias` dias, do início do primeiro dia ao fim de hoje (hora local). */
export function ultimosDias(dias: number): Required<PeriodoConsulta> {
  const agora = new Date();
  const ate = fimDoDia(agora);
  const de = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - dias + 1);
  return { de: de.toISOString(), ate: ate.toISOString() };
}

/** Mês corrente (hora local), do dia 1 ao fim de hoje. */
export function mesCorrente(): Required<PeriodoConsulta> {
  const agora = new Date();
  const de = new Date(agora.getFullYear(), agora.getMonth(), 1);
  return { de: de.toISOString(), ate: fimDoDia(agora).toISOString() };
}

export function usePainelResumo(periodo: PeriodoConsulta = {}, habilitado = true) {
  return useQuery({
    queryKey: chavesPainel.resumo(periodo),
    enabled: habilitado,
    queryFn: () => api<PainelResumo>("/painel/resumo", { params: { ...periodo } }),
  });
}

export function usePainelFunil(periodo: PeriodoConsulta = {}, habilitado = true) {
  return useQuery({
    queryKey: chavesPainel.funil(periodo),
    enabled: habilitado,
    queryFn: () => api<PainelFunil>("/painel/funil", { params: { ...periodo } }),
  });
}

export function usePainelClientes(periodo: PeriodoConsulta = {}, habilitado = true) {
  return useQuery({
    queryKey: chavesPainel.clientes(periodo),
    enabled: habilitado,
    queryFn: () => api<PainelClientes>("/painel/clientes", { params: { ...periodo } }),
  });
}

export function usePainelProcedimentos(periodo: PeriodoConsulta = {}, habilitado = true) {
  return useQuery({
    queryKey: chavesPainel.procedimentos(periodo),
    enabled: habilitado,
    queryFn: () => api<PainelProcedimentos>("/painel/procedimentos", { params: { ...periodo } }),
  });
}

export function usePainelProfissionais(periodo: PeriodoConsulta = {}, habilitado = true) {
  return useQuery({
    queryKey: chavesPainel.profissionais(periodo),
    enabled: habilitado,
    queryFn: () => api<PainelProfissionais>("/painel/profissionais", { params: { ...periodo } }),
  });
}

export function usePainelOcupacao(periodo: PeriodoConsulta = {}, habilitado = true) {
  return useQuery({
    queryKey: chavesPainel.ocupacao(periodo),
    enabled: habilitado,
    queryFn: () => api<PainelOcupacao>("/painel/ocupacao", { params: { ...periodo } }),
  });
}
