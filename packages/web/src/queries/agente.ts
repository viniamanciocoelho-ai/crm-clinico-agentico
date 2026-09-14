/**
 * Configuração da organização e do agente de IA —
 * `packages/api/src/routes/agente.ts`.
 *
 * Rotas reais usadas pela interface de configuração:
 *   GET /agente/config      (nome, timezone, reativacao_dias, config e horário)
 *   PUT /agente/config      (atualiza só os campos enviados)
 *   GET /agente/catalogo    (o que o agente pode afirmar sem inventar)
 *
 * As demais rotas `/agente/*` (agendar, remarcar, cancelar, escalar…) são as
 * ferramentas do agente e exigem `conversas:write`. Elas não são chamadas pela
 * interface: quem as usa é o próprio agente. Deixá-las de fora é deliberado.
 *
 * LIMITES DO CONTRATO:
 *   - `config_agente_ia` é um blob JSON opaco: o servidor só valida que é um
 *     objeto (ou null), nunca os subcampos. O shape em `tipos.ts` é convenção
 *     deste front.
 *   - a tabela `organizacoes` não guarda CNPJ, endereço nem contato da clínica.
 *     Nenhum campo desses pode ser salvo — a tela não deve oferecê-los.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ConfigAgenteIa, HorarioFuncionamento, RespostaConfigAgente } from "./tipos";

export const chavesAgente = {
  todas: ["agente"] as const,
  config: ["agente", "config"] as const,
  catalogo: ["agente", "catalogo"] as const,
};

export function useConfigAgente(habilitado = true) {
  return useQuery({
    queryKey: chavesAgente.config,
    enabled: habilitado,
    queryFn: () => api<RespostaConfigAgente>("/agente/config"),
  });
}

export interface CatalogoDoAgente {
  procedimentos: {
    id: string;
    nome: string;
    duracao_min: number;
    preco: number;
    profissionais_habilitados: number;
  }[];
}

export function useCatalogoDoAgente(habilitado = true) {
  return useQuery({
    queryKey: chavesAgente.catalogo,
    enabled: habilitado,
    queryFn: () => api<CatalogoDoAgente>("/agente/catalogo"),
  });
}

export interface AlteracaoConfigAgente {
  config_agente_ia?: ConfigAgenteIa | null;
  horario_funcionamento?: HorarioFuncionamento | null;
  timezone?: string;
  reativacao_dias?: number;
}

export function useSalvarConfigAgente() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (corpo: AlteracaoConfigAgente) =>
      api<{
        config_agente_ia: ConfigAgenteIa | null;
        horario_funcionamento: HorarioFuncionamento | null;
        timezone: string;
        reativacao_dias: number;
      }>("/agente/config", { metodo: "PUT", corpo }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chavesAgente.todas });
      void qc.invalidateQueries({ queryKey: ["agenda"] });
    },
  });
}
