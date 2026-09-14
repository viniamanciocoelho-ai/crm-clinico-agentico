import type { Database } from "bun:sqlite";

export type StatusAtendimento = "concluido" | "brinde" | "reembolsado" | "cancelado" | "falta";

/**
 * Efeitos contábeis fixos por status:
 *  concluido   → receita + baixa de estoque pela ficha técnica
 *  brinde      → receita ZERO, mas conta custo e baixa de estoque
 *  reembolsado → estorno da receita + devolução ao estoque
 *  cancelado   → nenhum movimento
 *  falta       → sem receita e sem estoque; incrementa taxa de no-show
 */
export const EFEITOS: Record<StatusAtendimento, { receita: boolean; estoque: 1 | -1 | 0 }> = {
  concluido: { receita: true, estoque: -1 },
  brinde: { receita: false, estoque: -1 },
  reembolsado: { receita: false, estoque: 1 },
  cancelado: { receita: false, estoque: 0 },
  falta: { receita: false, estoque: 0 },
};

const uuid = () => crypto.randomUUID();

function fichaTecnica(sqlite: Database, organizacao_id: string, procedimento_id: string) {
  return sqlite
    .query(
      `SELECT fi.insumo_id, fi.quantidade, i.custo_unitario
       FROM ficha_tecnica_itens fi
       JOIN insumos i ON i.id = fi.insumo_id AND i.organizacao_id = fi.organizacao_id
       WHERE fi.organizacao_id = ? AND fi.procedimento_id = ?`,
    )
    .all(organizacao_id, procedimento_id) as {
    insumo_id: string;
    quantidade: number;
    custo_unitario: number;
  }[];
}

/** Calcula o custo de insumos de um procedimento. Nunca inventa: se não há ficha, custo 0. */
export function custoInsumos(sqlite: Database, organizacao_id: string, procedimento_id: string): number {
  return fichaTecnica(sqlite, organizacao_id, procedimento_id).reduce(
    (acc, i) => acc + i.quantidade * i.custo_unitario,
    0,
  );
}

export interface ConfirmarAtendimentoParams {
  organizacao_id: string;
  agendamento_id?: string | null;
  cliente_id: string;
  profissional_id: string;
  procedimento_id: string;
  status: StatusAtendimento;
  valor?: number;
  forma_pagamento?: string;
  observacoes?: string;
}

/**
 * Executa a transição de status de um atendimento com todos os efeitos
 * contábeis em uma única transação. Devolve o atendimento criado.
 */
export function confirmarAtendimento(sqlite: Database, p: ConfirmarAtendimentoParams) {
  const efeito = EFEITOS[p.status];
  if (!efeito) throw new Error(`Status de atendimento inválido: ${p.status}`);

  const itens = fichaTecnica(sqlite, p.organizacao_id, p.procedimento_id);
  const custo = itens.reduce((acc, i) => acc + i.quantidade * i.custo_unitario, 0);

  // brinde conta custo mas não receita; reembolsado estorna; cancelado/falta zeram
  const valor = efeito.receita ? (p.valor ?? 0) : 0;
  const custoAplicado = efeito.estoque === -1 ? custo : 0;
  const agora = Date.now();
  const id = uuid();

  const tx = sqlite.transaction(() => {
    sqlite.run(
      `INSERT INTO atendimentos
        (id, organizacao_id, agendamento_id, cliente_id, profissional_id, procedimento_id,
         status, valor, custo_insumos, concluido_em, observacoes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      id,
      p.organizacao_id,
      p.agendamento_id ?? null,
      p.cliente_id,
      p.profissional_id,
      p.procedimento_id,
      p.status,
      valor,
      custoAplicado,
      p.status === "concluido" ? agora : null,
      p.observacoes ?? null,
    );

    if (efeito.estoque !== 0) {
      const tipo = efeito.estoque === -1 ? "saida" : "entrada";
      const motivo = efeito.estoque === -1 ? `consumo:${p.status}` : `devolucao:${p.status}`;
      for (const item of itens) {
        sqlite.run(
          `INSERT INTO movimentacoes_estoque
            (id, organizacao_id, insumo_id, atendimento_id, tipo, quantidade, motivo)
           VALUES (?,?,?,?,?,?,?)`,
          uuid(),
          p.organizacao_id,
          item.insumo_id,
          id,
          tipo,
          item.quantidade,
          motivo,
        );
        sqlite.run(
          `UPDATE insumos SET estoque_atual = estoque_atual + ?
           WHERE organizacao_id = ? AND id = ?`,
          efeito.estoque === -1 ? -item.quantidade : item.quantidade,
          p.organizacao_id,
          item.insumo_id,
        );
      }
    }

    if (p.status === "concluido" && valor > 0) {
      sqlite.run(
        `INSERT INTO pagamentos
          (id, organizacao_id, atendimento_id, cliente_id, valor, forma, status, criado_em)
         VALUES (?,?,?,?,?,?,?,?)`,
        uuid(),
        p.organizacao_id,
        id,
        p.cliente_id,
        valor,
        p.forma_pagamento ?? "pix",
        "pago",
        agora,
      );
    }

    if (p.agendamento_id && (p.status === "concluido" || p.status === "falta")) {
      sqlite.run(
        `UPDATE agendamentos SET status = 'confirmado' WHERE organizacao_id = ? AND id = ?`,
        p.organizacao_id,
        p.agendamento_id,
      );
    }
  });

  tx();
  return { id, valor, custo_insumos: custoAplicado };
}
