/**
 * Catálogo: procedimentos, profissionais, salas e insumos —
 * `packages/api/src/routes/catalogo.ts`.
 *
 * Rotas reais:
 *   GET    /catalogo/procedimentos?ativos=1
 *   GET    /catalogo/procedimentos/:id
 *   POST   /catalogo/procedimentos          PATCH /catalogo/procedimentos/:id
 *   POST   /catalogo/procedimentos/:id/profissionais
 *   DELETE /catalogo/procedimentos/:id/profissionais/:profissionalId
 *   POST   /catalogo/procedimentos/:id/recursos
 *   DELETE /catalogo/procedimentos/:id/recursos/:recursoId
 *   PUT    /catalogo/procedimentos/:id/ficha-tecnica
 *   GET/POST/PATCH /catalogo/profissionais[/:id]
 *   GET/POST/PATCH /catalogo/salas[/:id]
 *   GET/POST/PATCH /catalogo/insumos[/:id]
 *   POST   /catalogo/insumos/:id/movimentacoes
 *
 * PERMISSÕES: o catálogo NÃO tem permissão própria no RBAC. Ler exige
 * `agenda:read` e escrever exige `agenda:write` — não existe `catalogo:*`.
 *
 * LIMITE DO CONTRATO: a tabela `profissionais` não guarda registro em conselho
 * (CRO e afins). Só `nome`, `especialidade`, `cor`, `usuario_id`, `ativo`.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Insumo, Procedimento, ProcedimentoCompleto, Profissional, Sala } from "./tipos";

export const chavesCatalogo = {
  todas: ["catalogo"] as const,
  procedimentos: (ativos: boolean) => ["catalogo", "procedimentos", { ativos }] as const,
  procedimento: (id: string) => ["catalogo", "procedimentos", "item", id] as const,
  profissionais: (ativos: boolean) => ["catalogo", "profissionais", { ativos }] as const,
  salas: (ativos: boolean) => ["catalogo", "salas", { ativos }] as const,
  insumos: (ativos: boolean) => ["catalogo", "insumos", { ativos }] as const,
};

/* ───────────────────────────── Procedimentos ───────────────────────────── */

export function useProcedimentos(apenasAtivos = false, habilitado = true) {
  return useQuery({
    queryKey: chavesCatalogo.procedimentos(apenasAtivos),
    enabled: habilitado,
    queryFn: () =>
      api<{ procedimentos: Procedimento[] }>("/catalogo/procedimentos", {
        params: { ativos: apenasAtivos ? "1" : undefined },
      }),
  });
}

export function useProcedimento(id: string | null) {
  return useQuery({
    queryKey: chavesCatalogo.procedimento(id ?? ""),
    enabled: id !== null,
    queryFn: () =>
      api<{ procedimento: ProcedimentoCompleto }>(`/catalogo/procedimentos/${id}`),
  });
}

export interface NovoProcedimento {
  nome: string;
  duracao_min?: number;
  preco?: number;
  descricao_publica?: string;
}

export function useCriarProcedimento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (corpo: NovoProcedimento) =>
      api<{ procedimento: ProcedimentoCompleto }>("/catalogo/procedimentos", {
        metodo: "POST",
        corpo,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chavesCatalogo.todas });
    },
  });
}

export function useAtualizarProcedimento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...corpo
    }: {
      id: string;
      nome?: string;
      duracao_min?: number;
      preco?: number;
      ativo?: boolean;
      descricao_publica?: string | null;
    }) =>
      api<{ procedimento: ProcedimentoCompleto }>(`/catalogo/procedimentos/${id}`, {
        metodo: "PATCH",
        corpo,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chavesCatalogo.todas });
    },
  });
}

export function useHabilitarProfissionalNoProcedimento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, profissionalId }: { id: string; profissionalId: string }) =>
      api<{ procedimento: ProcedimentoCompleto }>(
        `/catalogo/procedimentos/${id}/profissionais`,
        { metodo: "POST", corpo: { profissional_id: profissionalId } },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chavesCatalogo.todas });
    },
  });
}

export function useDesabilitarProfissionalNoProcedimento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, profissionalId }: { id: string; profissionalId: string }) =>
      api<{ removido: true }>(
        `/catalogo/procedimentos/${id}/profissionais/${profissionalId}`,
        { metodo: "DELETE" },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chavesCatalogo.todas });
    },
  });
}

export function useVincularRecurso() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...corpo
    }: {
      id: string;
      sala_id: string;
      tempo_preparo_min?: number;
      tempo_limpeza_min?: number;
    }) =>
      api<{ procedimento: ProcedimentoCompleto }>(`/catalogo/procedimentos/${id}/recursos`, {
        metodo: "POST",
        corpo,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chavesCatalogo.todas });
    },
  });
}

export function useDesvincularRecurso() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, recursoId }: { id: string; recursoId: string }) =>
      api<{ removido: true }>(`/catalogo/procedimentos/${id}/recursos/${recursoId}`, {
        metodo: "DELETE",
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chavesCatalogo.todas });
    },
  });
}

/** Substitui a ficha técnica inteira — a API apaga e reinsere numa transação. */
export function useSalvarFichaTecnica() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      itens,
    }: {
      id: string;
      itens: { insumo_id: string; quantidade: number }[];
    }) =>
      api<{ procedimento: ProcedimentoCompleto }>(
        `/catalogo/procedimentos/${id}/ficha-tecnica`,
        { metodo: "PUT", corpo: { itens } },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chavesCatalogo.todas });
    },
  });
}

/* ───────────────────────────── Profissionais ───────────────────────────── */

export function useProfissionais(apenasAtivos = false, habilitado = true) {
  return useQuery({
    queryKey: chavesCatalogo.profissionais(apenasAtivos),
    enabled: habilitado,
    queryFn: () =>
      api<{ profissionais: Profissional[] }>("/catalogo/profissionais", {
        params: { ativos: apenasAtivos ? "1" : undefined },
      }),
  });
}

export function useCriarProfissional() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (corpo: {
      nome: string;
      especialidade?: string;
      cor?: string;
      usuario_id?: string;
    }) =>
      api<{ profissional: { id: string; nome: string } }>("/catalogo/profissionais", {
        metodo: "POST",
        corpo,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chavesCatalogo.todas });
    },
  });
}

export function useAtualizarProfissional() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...corpo
    }: {
      id: string;
      nome?: string;
      especialidade?: string | null;
      cor?: string;
      ativo?: boolean;
      /** Lista completa — a API serializa como JSON no lugar da anterior. */
      bloqueios_agenda?: { inicio: number; fim: number; motivo: string }[];
    }) => api<{ atualizado: true }>(`/catalogo/profissionais/${id}`, { metodo: "PATCH", corpo }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chavesCatalogo.todas });
      void qc.invalidateQueries({ queryKey: ["agenda"] });
    },
  });
}

/* ──────────────────────────────── Salas ──────────────────────────────── */

export function useSalas(apenasAtivos = false, habilitado = true) {
  return useQuery({
    queryKey: chavesCatalogo.salas(apenasAtivos),
    enabled: habilitado,
    queryFn: () =>
      api<{ salas: Sala[] }>("/catalogo/salas", {
        params: { ativos: apenasAtivos ? "1" : undefined },
      }),
  });
}

export function useCriarSala() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (corpo: { nome: string; tipo?: "sala" | "equipamento" }) =>
      api<{ sala: { id: string; nome: string; tipo: string } }>("/catalogo/salas", {
        metodo: "POST",
        corpo,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chavesCatalogo.todas });
    },
  });
}

export function useAtualizarSala() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...corpo
    }: {
      id: string;
      nome?: string;
      ativo?: boolean;
      bloqueios_agenda?: { inicio: number; fim: number; motivo: string }[];
    }) => api<{ atualizado: true }>(`/catalogo/salas/${id}`, { metodo: "PATCH", corpo }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chavesCatalogo.todas });
      void qc.invalidateQueries({ queryKey: ["agenda"] });
    },
  });
}

/* ──────────────────────────────── Insumos ──────────────────────────────── */

export function useInsumos(apenasAtivos = false, habilitado = true) {
  return useQuery({
    queryKey: chavesCatalogo.insumos(apenasAtivos),
    enabled: habilitado,
    queryFn: () =>
      api<{ insumos: Insumo[] }>("/catalogo/insumos", {
        params: { ativos: apenasAtivos ? "1" : undefined },
      }),
  });
}

export function useCriarInsumo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (corpo: {
      nome: string;
      unidade?: string;
      custo_unitario?: number;
      estoque_atual?: number;
      estoque_minimo?: number;
    }) =>
      api<{ insumo: { id: string; nome: string } }>("/catalogo/insumos", {
        metodo: "POST",
        corpo,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chavesCatalogo.todas });
    },
  });
}

export function useAtualizarInsumo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...corpo
    }: {
      id: string;
      nome?: string;
      unidade?: string;
      custo_unitario?: number;
      estoque_minimo?: number;
      ativo?: boolean;
    }) => api<{ atualizado: true }>(`/catalogo/insumos/${id}`, { metodo: "PATCH", corpo }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chavesCatalogo.todas });
    },
  });
}

/**
 * Entrada/saída manual de estoque. `estoque_atual` não é editável por PATCH:
 * o saldo só muda por movimentação, para o rastro nunca ficar inconsistente.
 */
export function useMovimentarInsumo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...corpo
    }: {
      id: string;
      tipo: "entrada" | "saida";
      quantidade: number;
      motivo?: string;
    }) =>
      api<{ insumo_id: string; estoque_atual: number }>(
        `/catalogo/insumos/${id}/movimentacoes`,
        { metodo: "POST", corpo },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chavesCatalogo.todas });
      void qc.invalidateQueries({ queryKey: ["atendimentos", "estoque"] });
    },
  });
}
