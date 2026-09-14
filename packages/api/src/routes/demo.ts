import type { Database } from "bun:sqlite";
import { criarAgendamento, type ContextoIa } from "../lib/agente";
import { confirmarAtendimento, type StatusAtendimento } from "../lib/contabil";
import { inicioDoDia } from "../lib/agenda";
import { hashPassword } from "../lib/auth";
import { json, BadRequestError } from "../http";
import type { Rota } from "../router";
import { DEMO_ORG_ID } from "../config";
import { garantirSchema } from "@cav-crm/db";

/**
 * Demo pública. Tudo aqui é cercado por DEMO_ORG_ID e nada mais:
 *  - nenhuma rota autenticada alcança este tenant (o JWT de um cliente real
 *    nunca carrega este id), e
 *  - nenhuma rota daqui alcança outro tenant (o id é constante, não vem do
 *    cliente).
 * A demo NUNCA se mistura com tenant real — o isolamento é por construção,
 * não por checagem.
 */

const TIMEZONE = "America/Sao_Paulo";
const SENHA_DEMO = "demo123456";

/** PRNG determinístico: a demo precisa ser idêntica a cada reset. */
function rng(semente: number) {
  let s = semente >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

const uuid = () => crypto.randomUUID();
const min = 60_000;
const dia = 86_400_000;

interface Cenario {
  organizacao_id: string;
  usuarios: Record<string, string>;
  profissionais: string[];
  salas: Record<string, string>;
  procedimentos: { id: string; nome: string; duracao_min: number; preco: number }[];
  insumos: Record<string, string>;
  clientes: { id: string; nome: string; telefone: string }[];
}

/** Catálogo fictício de clínica de estética — 3 profissionais, 12 procedimentos. */
export function semearDemo(sqlite: Database): void {
  garantirSchema(sqlite);

  const tx = sqlite.transaction(() => {
    limparDemo(sqlite);
    const c = montarCenario(sqlite);
    montarHistorico(sqlite, c);
    montarFuturo(sqlite, c);
    montarConversas(sqlite, c);
  });
  tx();
}

/** Remove APENAS a organização da demo. Um tenant real nunca é tocado. */
export function limparDemo(sqlite: Database): void {
  const tabelas = [
    "mensagens",
    "conversas",
    "ia_acoes_log",
    "reativacoes_log",
    "jobs_execucoes",
    "movimentacoes_estoque",
    "pagamentos",
    "atendimentos",
    "agendamentos",
    "cliente_tags",
    "tags",
    "leads",
    "motivos_perda",
    "ficha_tecnica_itens",
    "procedimento_recursos",
    "procedimento_profissionais",
    "procedimentos",
    "insumos",
    "clientes",
    "salas",
    "profissionais",
    "usuarios",
  ];
  for (const t of tabelas) {
    sqlite.run(`DELETE FROM ${t} WHERE organizacao_id = ?`, DEMO_ORG_ID);
  }
  sqlite.run(`DELETE FROM organizacoes WHERE organizacao_id = ?`, DEMO_ORG_ID);
}

function montarCenario(sqlite: Database): Cenario {
  const agora = Date.now();

  sqlite.run(
    `INSERT INTO organizacoes
      (id, organizacao_id, nome, horario_funcionamento, config_agente_ia, reativacao_dias, timezone, criado_em)
     VALUES (?,?,?,?,?,?,?,?)`,
    uuid(),
    DEMO_ORG_ID,
    "Clínica Aurora Estética",
    JSON.stringify({
      "1": [["09:00", "19:00"]],
      "2": [["09:00", "19:00"]],
      "3": [["09:00", "19:00"]],
      "4": [["09:00", "19:00"]],
      "5": [["09:00", "18:00"]],
      "6": [["09:00", "14:00"]],
    }),
    JSON.stringify({
      nome_agente: "Aurora",
      tom: "acolhedor e objetivo",
      idioma: "pt-BR",
      assinatura: "Equipe Clínica Aurora",
    }),
    90,
    TIMEZONE,
    agora - 180 * dia,
  );

  const usuarios: Record<string, string> = {};
  const contas = [
    { email: "proprietaria@demo.cav", nome: "Ana Ribeiro", role: "proprietario" },
    { email: "gerente@demo.cav", nome: "Carlos Menezes", role: "gerente" },
    { email: "profissional@demo.cav", nome: "Marina Duarte", role: "profissional" },
    { email: "recepcao@demo.cav", nome: "Juliana Prado", role: "recepcao" },
  ];
  const senha_hash = hashPassword(SENHA_DEMO);
  for (const u of contas) {
    const id = uuid();
    usuarios[u.email] = id;
    sqlite.run(
      `INSERT INTO usuarios (id, organizacao_id, email, senha_hash, nome, role, ativo)
       VALUES (?,?,?,?,?,?,1)`,
      id,
      DEMO_ORG_ID,
      u.email,
      senha_hash,
      u.nome,
      u.role,
    );
  }

  const profissionais: string[] = [];
  const equipe = [
    { nome: "Dra. Marina Duarte", especialidade: "Harmonização facial", cor: "#7c8f7a", usuario: usuarios["profissional@demo.cav"] },
    { nome: "Dra. Beatriz Lopes", especialidade: "Estética corporal", cor: "#b08968", usuario: null },
    { nome: "Dra. Renata Alves", especialidade: "Dermatologia estética", cor: "#8d99ae", usuario: null },
  ];
  for (const p of equipe) {
    const id = uuid();
    profissionais.push(id);
    sqlite.run(
      `INSERT INTO profissionais (id, organizacao_id, usuario_id, nome, especialidade, cor, ativo)
       VALUES (?,?,?,?,?,?,1)`,
      id,
      DEMO_ORG_ID,
      p.usuario,
      p.nome,
      p.especialidade,
      p.cor,
    );
  }

  const salas: Record<string, string> = {};
  for (const s of [
    { nome: "Sala 1 — Facial", tipo: "sala" },
    { nome: "Sala 2 — Corporal", tipo: "sala" },
    { nome: "Sala 3 — Procedimentos", tipo: "sala" },
    { nome: "Laser CO2", tipo: "equipamento" },
  ]) {
    const id = uuid();
    salas[s.nome] = id;
    sqlite.run(
      `INSERT INTO salas (id, organizacao_id, nome, tipo, ativo) VALUES (?,?,?,?,1)`,
      id,
      DEMO_ORG_ID,
      s.nome,
      s.tipo,
    );
  }

  const insumos: Record<string, string> = {};
  const estoque = [
    { nome: "Toxina botulínica 100U", unidade: "frasco", custo: 380, atual: 24, minimo: 6 },
    { nome: "Ácido hialurônico 1ml", unidade: "seringa", custo: 420, atual: 18, minimo: 5 },
    { nome: "Sérum vitamina C", unidade: "ml", custo: 1.4, atual: 600, minimo: 150 },
    { nome: "Ácido glicólico 30%", unidade: "ml", custo: 0.9, atual: 500, minimo: 120 },
    { nome: "Máscara de argila", unidade: "g", custo: 0.35, atual: 1200, minimo: 300 },
    { nome: "Anestésico tópico", unidade: "g", custo: 2.2, atual: 400, minimo: 100 },
    { nome: "Criolipólise — aplicador", unidade: "un", custo: 95, atual: 40, minimo: 10 },
    { nome: "Drenagem — óleo essencial", unidade: "ml", custo: 3.1, atual: 300, minimo: 80 },
  ];
  for (const i of estoque) {
    const id = uuid();
    insumos[i.nome] = id;
    sqlite.run(
      `INSERT INTO insumos (id, organizacao_id, nome, unidade, custo_unitario, estoque_atual, estoque_minimo, ativo)
       VALUES (?,?,?,?,?,?,?,1)`,
      id,
      DEMO_ORG_ID,
      i.nome,
      i.unidade,
      i.custo,
      i.atual,
      i.minimo,
    );
    // Estoque inicial registrado como movimento: o saldo nunca é escrito sem
    // lastro, mesma regra do resto do sistema.
    sqlite.run(
      `INSERT INTO movimentacoes_estoque (id, organizacao_id, insumo_id, tipo, quantidade, motivo, criado_em)
       VALUES (?,?,?,'entrada',?,'estoque_inicial',?)`,
      uuid(),
      DEMO_ORG_ID,
      id,
      i.atual,
      agora - 180 * dia,
    );
  }

  // 12 procedimentos, com profissional habilitado e recurso definidos
  const catalogo = [
    { nome: "Aplicação de toxina botulínica", duracao: 30, preco: 1200, profs: [0, 2], sala: "Sala 1 — Facial", prep: 10, limpeza: 10, ficha: [["Toxina botulínica 100U", 1], ["Anestésico tópico", 5]] },
    { nome: "Preenchimento labial", duracao: 45, preco: 1900, profs: [0], sala: "Sala 1 — Facial", prep: 15, limpeza: 15, ficha: [["Ácido hialurônico 1ml", 1], ["Anestésico tópico", 8]] },
    { nome: "Limpeza de pele profunda", duracao: 60, preco: 320, profs: [0, 1, 2], sala: "Sala 1 — Facial", prep: 5, limpeza: 15, ficha: [["Máscara de argila", 30], ["Sérum vitamina C", 5]] },
    { nome: "Peeling de ácido glicólico", duracao: 40, preco: 480, profs: [0, 2], sala: "Sala 1 — Facial", prep: 5, limpeza: 10, ficha: [["Ácido glicólico 30%", 12], ["Anestésico tópico", 4]] },
    { nome: "Microagulhamento facial", duracao: 50, preco: 690, profs: [0], sala: "Sala 1 — Facial", prep: 10, limpeza: 10, ficha: [["Anestésico tópico", 10], ["Sérum vitamina C", 8]] },
    { nome: "Radiofrequência facial", duracao: 45, preco: 550, profs: [1, 2], sala: "Sala 3 — Procedimentos", prep: 5, limpeza: 10, ficha: [["Sérum vitamina C", 6]] },
    { nome: "Criolipólise de flancos", duracao: 90, preco: 1400, profs: [1], sala: "Laser CO2", prep: 15, limpeza: 20, ficha: [["Criolipólise — aplicador", 1]] },
    { nome: "Drenagem linfática corporal", duracao: 60, preco: 260, profs: [1, 2], sala: "Sala 2 — Corporal", prep: 5, limpeza: 10, ficha: [["Drenagem — óleo essencial", 20]] },
    { nome: "Massagem modeladora", duracao: 50, preco: 240, profs: [1], sala: "Sala 2 — Corporal", prep: 5, limpeza: 10, ficha: [["Drenagem — óleo essencial", 15]] },
    { nome: "Depilação a laser — axilas", duracao: 20, preco: 220, profs: [1, 2], sala: "Laser CO2", prep: 5, limpeza: 10, ficha: [["Anestésico tópico", 3]] },
    { nome: "Skinbooster", duracao: 40, preco: 1600, profs: [0], sala: "Sala 1 — Facial", prep: 15, limpeza: 15, ficha: [["Ácido hialurônico 1ml", 1], ["Anestésico tópico", 6]] },
    { nome: "Avaliação facial inicial", duracao: 30, preco: 0, profs: [0, 1, 2], sala: null, prep: 0, limpeza: 0, ficha: [] as [string, number][] },
  ];

  const procedimentos: Cenario["procedimentos"] = [];
  for (const p of catalogo) {
    const id = uuid();
    procedimentos.push({ id, nome: p.nome, duracao_min: p.duracao, preco: p.preco });
    sqlite.run(
      `INSERT INTO procedimentos (id, organizacao_id, nome, duracao_min, preco, ativo, descricao_publica)
       VALUES (?,?,?,?,?,1,?)`,
      id,
      DEMO_ORG_ID,
      p.nome,
      p.duracao,
      p.preco,
      `${p.nome} — ${p.duracao} minutos.`,
    );
    for (const idx of p.profs) {
      sqlite.run(
        `INSERT INTO procedimento_profissionais (id, organizacao_id, procedimento_id, profissional_id)
         VALUES (?,?,?,?)`,
        uuid(),
        DEMO_ORG_ID,
        id,
        profissionais[idx],
      );
    }
    if (p.sala) {
      sqlite.run(
        `INSERT INTO procedimento_recursos
          (id, organizacao_id, procedimento_id, sala_id, tempo_preparo_min, tempo_limpeza_min)
         VALUES (?,?,?,?,?,?)`,
        uuid(),
        DEMO_ORG_ID,
        id,
        salas[p.sala],
        p.prep,
        p.limpeza,
      );
    }
    for (const [nomeInsumo, qtd] of p.ficha as [string, number][]) {
      sqlite.run(
        `INSERT INTO ficha_tecnica_itens (id, organizacao_id, procedimento_id, insumo_id, quantidade)
         VALUES (?,?,?,?,?)`,
        uuid(),
        DEMO_ORG_ID,
        id,
        insumos[nomeInsumo],
        qtd,
      );
    }
  }

  for (const t of [
    { nome: "VIP", cor: "#b08968" },
    { nome: "Retorno", cor: "#7c8f7a" },
    { nome: "Indicação", cor: "#8d99ae" },
  ]) {
    sqlite.run(`INSERT INTO tags (id, organizacao_id, nome, cor) VALUES (?,?,?,?)`, uuid(), DEMO_ORG_ID, t.nome, t.cor);
  }

  for (const m of [
    "Preço acima do esperado",
    "Não respondeu mais",
    "Fechou com outra clínica",
    "Mudou de cidade",
    "Só pesquisando",
  ]) {
    sqlite.run(`INSERT INTO motivos_perda (id, organizacao_id, descricao, ativo) VALUES (?,?,?,1)`, uuid(), DEMO_ORG_ID, m);
  }

  // 40 clientes fictícios com telefones brasileiros sintáticos
  const nomes = [
    "Camila Ferraz", "Rafael Nogueira", "Patrícia Salles", "Bruno Tavares", "Larissa Campos",
    "Eduardo Pires", "Fernanda Bastos", "Gustavo Lima", "Helena Mourão", "Igor Vasconcelos",
    "Júlia Andrade", "Kleber Antunes", "Luana Peixoto", "Marcelo Quintela", "Natália Serra",
    "Otávio Brandão", "Paula Rezende", "Rodrigo Machado", "Sabrina Coelho", "Thiago Amaral",
    "Vanessa Rocha", "Wagner Bittencourt", "Yasmin Correia", "Zélia Nascimento", "Cláudio Furtado",
    "Débora Maciel", "Elaine Barros", "Fábio Teixeira", "Gabriela Rios", "Henrique Sampaio",
    "Isabela Fontes", "Jonas Cardoso", "Karina Beltrão", "Leandro Aguiar", "Michele Prado",
    "Nelson Vilela", "Olívia Siqueira", "Priscila Guedes", "Renan Alcântara", "Sofia Mendonça",
  ];
  const clientes: Cenario["clientes"] = [];
  const r = rng(20240513);
  nomes.forEach((nome, i) => {
    const id = uuid();
    const telefone = `5511${String(90000000 + Math.floor(r() * 9_999_999)).padStart(8, "0")}`;
    clientes.push({ id, nome, telefone });
    const nascimento = `19${70 + Math.floor(r() * 30)}-${String(1 + Math.floor(r() * 12)).padStart(2, "0")}-${String(1 + Math.floor(r() * 28)).padStart(2, "0")}`;
    sqlite.run(
      `INSERT INTO clientes
        (id, organizacao_id, nome, telefone, email, data_nascimento, origem_lead, observacoes,
         lgpd_consentimento, lgpd_data, lgpd_canal, ativo, criado_em)
       VALUES (?,?,?,?,?,?,?,?,1,?,'whatsapp',1,?)`,
      id,
      DEMO_ORG_ID,
      nome,
      telefone,
      `${nome.split(" ")[0].toLowerCase()}.${i}@exemplo.com.br`,
      nascimento,
      ["instagram", "indicacao", "whatsapp", "presencial"][Math.floor(r() * 4)],
      i % 7 === 0 ? "Prefere atendimento no fim da tarde." : null,
      agora - Math.floor(30 + r() * 300) * dia,
      agora - Math.floor(30 + r() * 300) * dia,
    );
  });

  return { organizacao_id: DEMO_ORG_ID, usuarios, profissionais, salas, procedimentos, insumos, clientes };
}

/**
 * Histórico fechado dos últimos 60 dias. Passa pelas MESMAS funções do sistema
 * real (criarAgendamento + confirmarAtendimento), então os efeitos contábeis e
 * a baixa de estoque da demo são idênticos aos de produção — nada é inserido
 * "na mão" no que a contabilidade enxerga.
 */
function montarHistorico(sqlite: Database, c: Cenario): void {
  const ctx: ContextoIa = { organizacao_id: DEMO_ORG_ID, timezone: TIMEZONE };
  const agora = Date.now();
  const r = rng(778899);

  // A janela de expediente é desligada só durante o seed: o histórico é
  // retroativo e precisa caber em dias/horas que o gerador escolhe. O
  // expediente real é restaurado logo depois.
  const original = sqlite.query(`SELECT horario_funcionamento FROM organizacoes WHERE organizacao_id = ?`).get(DEMO_ORG_ID) as { horario_funcionamento: string | null };
  sqlite.run(`UPDATE organizacoes SET horario_funcionamento = NULL WHERE organizacao_id = ?`, DEMO_ORG_ID);
  try {
    // Distribuição de desfecho calibrada para uma clínica saudável
    const sorteio: StatusAtendimento[] = [
      "concluido", "concluido", "concluido", "concluido", "concluido", "concluido",
      "concluido", "concluido", "concluido", "concluido", "concluido", "concluido",
      "concluido", "concluido", "concluido", "concluido",
      "falta", "falta",
      "brinde",
      "reembolsado",
    ];

    // 60 dias, ~5 atendimentos/dia em média
    for (let d = 60; d >= 1; d--) {
      const base = inicioDoDia(agora - d * dia, TIMEZONE);
      const dow = new Date(base).getUTCDay();
      if (dow === 0) continue; // domingo fechado
      const porDia = 3 + Math.floor(r() * 5);

      for (let k = 0; k < porDia; k++) {
        const proc = c.procedimentos[Math.floor(r() * (c.procedimentos.length - 1))];
        const cliente = c.clientes[Math.floor(r() * c.clientes.length)];
        const hora = 9 + Math.floor(r() * 8);
        const minuto = [0, 15, 30, 45][Math.floor(r() * 4)];
        const inicio = base + (hora * 60 + minuto) * min;
        if (inicio > agora - 2 * 60 * min) continue;

        const res = criarAgendamento(sqlite, ctx, null, {
          telefone: cliente.telefone,
          nome_cliente: cliente.nome,
          termo_procedimento: proc.nome,
          inicio,
        });
        const agendamento_id = (res.dados_decisao as { agendamento_id?: string }).agendamento_id;
        if (!agendamento_id) continue; // conflito — o gerador tenta de novo no próximo laço

        const profissional_id = (sqlite
          .query(`SELECT profissional_id FROM agendamentos WHERE organizacao_id = ? AND id = ?`)
          .get(DEMO_ORG_ID, agendamento_id) as { profissional_id: string }).profissional_id;

        const status = sorteio[Math.floor(r() * sorteio.length)];
        try {
          confirmarAtendimento(sqlite, {
            organizacao_id: DEMO_ORG_ID,
            agendamento_id,
            cliente_id: cliente.id,
            profissional_id,
            procedimento_id: proc.id,
            status,
            valor: status === "concluido" ? proc.preco * (r() < 0.25 ? 0.9 : 1) : 0,
            forma_pagamento: ["pix", "credito", "debito", "dinheiro"][Math.floor(r() * 4)],
          });
        } catch {
          // ficha técnica ausente não invalida o histórico
        }

        // O agendamento histórico termina como consumado, não como "aberto"
        sqlite.run(
          `UPDATE agendamentos SET status = 'confirmado', lembrete_enviado_24h = 1, lembrete_enviado_2h = 1
           WHERE organizacao_id = ? AND id = ?`,
          DEMO_ORG_ID,
          agendamento_id,
        );

        // O atendimento é retroativo: `criado_em`/`concluido_em` precisam
        // refletir o dia real, senão o painel mostraria tudo em "hoje".
        sqlite.run(
          `UPDATE atendimentos SET criado_em = ?, concluido_em = ?
           WHERE organizacao_id = ? AND agendamento_id = ?`,
          inicio + 5 * min,
          status === "concluido" ? inicio + 40 * min : null,
          DEMO_ORG_ID,
          agendamento_id,
        );
        sqlite.run(
          `UPDATE agendamentos SET criado_em = ? WHERE organizacao_id = ? AND id = ?`,
          inicio - 3 * dia,
          DEMO_ORG_ID,
          agendamento_id,
        );
        sqlite.run(
          `UPDATE pagamentos SET criado_em = ? WHERE organizacao_id = ? AND atendimento_id =
             (SELECT id FROM atendimentos WHERE organizacao_id = ? AND agendamento_id = ?)`,
          inicio + 5 * min,
          DEMO_ORG_ID,
          DEMO_ORG_ID,
          agendamento_id,
        );
        sqlite.run(
          `UPDATE movimentacoes_estoque SET criado_em = ? WHERE organizacao_id = ? AND atendimento_id =
             (SELECT id FROM atendimentos WHERE organizacao_id = ? AND agendamento_id = ?)`,
          inicio + 5 * min,
          DEMO_ORG_ID,
          DEMO_ORG_ID,
          agendamento_id,
        );
      }
    }

    // Leads que acompanham a origem do cliente + alguns perdidos
    const motivos = sqlite.query(`SELECT id, descricao FROM motivos_perda WHERE organizacao_id = ?`).all(DEMO_ORG_ID) as { id: string; descricao: string }[];
    const etapas = ["novo", "em_conversa", "qualificado", "agendado", "compareceu", "fechado"];
    c.clientes.forEach((cl, i) => {
      const etapa = i < 26 ? "fechado" : etapas[Math.floor(r() * etapas.length)];
      sqlite.run(
        `INSERT INTO leads
          (id, organizacao_id, cliente_id, nome, telefone, etapa, canal_entrada, atendido_por_tipo,
           primeira_resposta_em, ultima_interacao_em, criado_em)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        uuid(),
        DEMO_ORG_ID,
        cl.id,
        cl.nome,
        cl.telefone,
        etapa,
        ["whatsapp", "instagram", "indicacao", "presencial"][Math.floor(r() * 4)],
        r() < 0.65 ? "ia" : "humano",
        agora - Math.floor(20 + r() * 300) * dia + 4 * min,
        agora - Math.floor(1 + r() * 60) * dia,
        agora - Math.floor(20 + r() * 300) * dia,
      );
    });

    for (let i = 0; i < 14; i++) {
      const m = motivos[Math.floor(r() * motivos.length)];
      const tel = `5511${String(90000000 + Math.floor(r() * 9_999_999)).padStart(8, "0")}`;
      const criado = agora - Math.floor(3 + r() * 55) * dia;
      sqlite.run(
        `INSERT INTO leads
          (id, organizacao_id, nome, telefone, etapa, canal_entrada, atendido_por_tipo,
           motivo_perda_id, observacao_perda, primeira_resposta_em, ultima_interacao_em, criado_em)
         VALUES (?,?,?,?,'perdido',?,?,?,?,?,?,?)`,
        uuid(),
        DEMO_ORG_ID,
        ["Amanda Prado", "Vitor Hugo Salles", "Cristina Melo", "Douglas Neves", "Renata Barros",
         "Paulo Cesar Lima", "Tatiane Rocha", "Wesley Antunes", "Marta Figueiredo", "Alexandre Pires",
         "Bianca Moraes", "César Delgado", "Daniele Farias", "Everton Sales"][i],
        tel,
        ["whatsapp", "instagram", "indicacao", "telefone"][Math.floor(r() * 4)],
        r() < 0.7 ? "ia" : "humano",
        m.id,
        r() < 0.5 ? "Disse que ia pensar e não retornou." : null,
        criado + 3 * min,
        criado + 40 * min,
        criado,
      );
    }

    // Reativações disparadas: algumas converteram, outras não
    const antigos = sqlite
      .query(
        `SELECT c.id FROM clientes c
         WHERE c.organizacao_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM atendimentos a
             WHERE a.organizacao_id = c.organizacao_id AND a.cliente_id = c.id
               AND a.criado_em > ?
           )
         LIMIT 12`,
      )
      .all(DEMO_ORG_ID, agora - 60 * dia) as { id: string }[];
    for (const a of antigos) {
      const disparado = agora - Math.floor(10 + r() * 45) * dia;
      const retornou = r() < 0.35 ? 1 : 0;
      sqlite.run(
        `INSERT INTO reativacoes_log
          (id, organizacao_id, cliente_id, disparado_em, retornou, data_retorno, criado_em)
         VALUES (?,?,?,?,?,?,?)`,
        uuid(),
        DEMO_ORG_ID,
        a.id,
        disparado,
        retornou,
        retornou ? disparado + Math.floor(1 + r() * 5) * dia : null,
        disparado,
      );
    }
  } finally {
    sqlite.run(
      `UPDATE organizacoes SET horario_funcionamento = ? WHERE organizacao_id = ?`,
      original.horario_funcionamento,
      DEMO_ORG_ID,
    );
  }
}

/** Próximos 12 dias de agenda — é o que a demo mostra como "agenda de hoje em diante". */
function montarFuturo(sqlite: Database, c: Cenario): void {
  const ctx: ContextoIa = { organizacao_id: DEMO_ORG_ID, timezone: TIMEZONE };
  const agora = Date.now();
  const r = rng(112233);

  for (let d = 0; d <= 12; d++) {
    const base = inicioDoDia(agora + d * dia, TIMEZONE);
    const dow = new Date(base).getUTCDay();
    if (dow === 0) continue;
    const porDia = d === 0 ? 4 : 4 + Math.floor(r() * 4);

    for (let k = 0; k < porDia; k++) {
      const proc = c.procedimentos[Math.floor(r() * c.procedimentos.length)];
      const cliente = c.clientes[Math.floor(r() * c.clientes.length)];
      const hora = 9 + Math.floor(r() * 8);
      const minuto = [0, 15, 30, 45][Math.floor(r() * 4)];
      const inicio = base + (hora * 60 + minuto) * min;
      if (inicio < agora + 30 * min) continue;

      criarAgendamento(sqlite, ctx, null, {
        telefone: cliente.telefone,
        nome_cliente: cliente.nome,
        termo_procedimento: proc.nome,
        inicio,
      });
    }
  }
}

/** Conversas de WhatsApp simuladas, incluindo casos escalados para humano. */
function montarConversas(sqlite: Database, c: Cenario): void {
  const agora = Date.now();
  const r = rng(445566);

  const roteiros: {
    cliente: number;
    status: string;
    motivo?: string;
    acaoIa: string;
    falas: { de: "cliente" | "ia" | "humano"; texto: string; atrasoMin: number }[];
  }[] = [
    {
      cliente: 2,
      status: "com_ia",
      acaoIa: "consultar_horarios",
      falas: [
        { de: "cliente", texto: "Oi, boa tarde! Vocês fazem limpeza de pele?", atrasoMin: 0 },
        { de: "ia", texto: "Boa tarde, Patrícia! Sim, fazemos limpeza de pele profunda, com 60 minutos. O investimento é R$ 320. Quer que eu veja os horários livres?", atrasoMin: 1 },
        { de: "cliente", texto: "Quero sim, de preferência à tarde", atrasoMin: 3 },
        { de: "ia", texto: "Perfeito. Tenho quinta às 14h e sexta às 15h30 com a Dra. Beatriz. Qual prefere?", atrasoMin: 4 },
        { de: "cliente", texto: "Quinta às 14h", atrasoMin: 6 },
      ],
    },
    {
      cliente: 7,
      status: "aguardando_humano",
      motivo: "reclamacao",
      acaoIa: "escalar_humano",
      falas: [
        { de: "cliente", texto: "Fiz radiofrequência semana passada e minha pele ficou manchada", atrasoMin: 0 },
        { de: "ia", texto: "Sinto muito por isso. Vou passar sua mensagem para a equipe responsável agora mesmo.", atrasoMin: 1 },
      ],
    },
    {
      cliente: 12,
      status: "aguardando_humano",
      motivo: "caso_clinico_ou_urgencia",
      acaoIa: "escalar_humano",
      falas: [
        { de: "cliente", texto: "Apliquei ácido ontem e hoje acordei com muita ardência, é normal?", atrasoMin: 0 },
        { de: "ia", texto: "Isso é uma questão clínica e precisa de avaliação humana. Vou chamar a equipe agora — se for urgente, procure atendimento presencial.", atrasoMin: 1 },
      ],
    },
    {
      cliente: 19,
      status: "com_humano",
      acaoIa: "escalar_humano",
      falas: [
        { de: "cliente", texto: "Gostaria de saber sobre pacote de drenagem, são 10 sessões?", atrasoMin: 0 },
        { de: "ia", texto: "A drenagem linfática corporal é uma sessão de 60 minutos, R$ 260 cada. Para pacotes e condições, vou chamar alguém da equipe.", atrasoMin: 1 },
        { de: "humano", texto: "Oi, Thiago! Aqui é a Juliana. O pacote de 10 sessões sai por R$ 2.200, com validade de 4 meses. Quer que eu reserve o primeiro horário?", atrasoMin: 12 },
      ],
    },
    {
      cliente: 25,
      status: "encerrada",
      acaoIa: "consultar_preco",
      falas: [
        { de: "cliente", texto: "Bom dia, quanto custa a toxina botulínica?", atrasoMin: 0 },
        { de: "ia", texto: "Bom dia! A aplicação de toxina botulínica é R$ 1.200, com 30 minutos de atendimento. Quer que eu verifique horários?", atrasoMin: 1 },
        { de: "cliente", texto: "Vou ver e te aviso, obrigada!", atrasoMin: 5 },
        { de: "ia", texto: "Combinado, Débora! Quando quiser, é só me chamar por aqui.", atrasoMin: 5 },
      ],
    },
    {
      cliente: 30,
      status: "aguardando_humano",
      motivo: "pedido_explicito",
      acaoIa: "escalar_humano",
      falas: [
        { de: "cliente", texto: "Quero falar com uma pessoa de verdade, por favor", atrasoMin: 0 },
        { de: "ia", texto: "Claro — vou chamar alguém da equipe para continuar com você por aqui.", atrasoMin: 1 },
      ],
    },
    {
      cliente: 33,
      status: "com_ia",
      acaoIa: "criar_agendamento",
      falas: [
        { de: "cliente", texto: "Tem horário para criolipólise essa semana?", atrasoMin: 0 },
        { de: "ia", texto: "Tenho sim! A criolipólise de flancos dura 90 minutos e custa R$ 1.400. Na quarta às 10h e na sexta às 9h com a Dra. Beatriz. Algum serve?", atrasoMin: 1 },
        { de: "cliente", texto: "Sexta às 9h fica bom", atrasoMin: 9 },
        { de: "ia", texto: "Agendado: criolipólise de flancos com Dra. Beatriz Lopes na sexta às 9h. Vou te enviar um lembrete 24h antes.", atrasoMin: 10 },
      ],
    },
  ];

  roteiros.forEach((rot, idx) => {
    const cl = c.clientes[rot.cliente];
    const conversa_id = uuid();
    const base = agora - Math.floor(1 + idx * 3) * dia;
    const ultima = base + rot.falas[rot.falas.length - 1].atrasoMin * min;

    sqlite.run(
      `INSERT INTO conversas
        (id, organizacao_id, cliente_id, canal, telefone, status, motivo_escalada, ultima_mensagem_em, criado_em)
       VALUES (?,?,?,'whatsapp',?,?,?,?,?)`,
      conversa_id,
      DEMO_ORG_ID,
      cl.id,
      cl.telefone,
      rot.status,
      rot.motivo ?? null,
      ultima,
      base,
    );

    let t = base;
    for (const f of rot.falas) {
      t = base + f.atrasoMin * min;
      sqlite.run(
        `INSERT INTO mensagens
          (id, organizacao_id, conversa_id, remetente_tipo, remetente_id, conteudo, criado_em)
         VALUES (?,?,?,?,?,?,?)`,
        uuid(),
        DEMO_ORG_ID,
        conversa_id,
        f.de,
        f.de === "humano" ? c.usuarios["recepcao@demo.cav"] : null,
        f.texto,
        t,
      );

      if (f.de === "ia") {
        sqlite.run(
          `INSERT INTO ia_acoes_log
            (id, organizacao_id, autor_tipo, tipo_acao, conversa_id, dados_entrada, dados_decisao, sucesso, criado_em)
           VALUES (?,?,'ia',?,?,?,?,1,?)`,
          uuid(),
          DEMO_ORG_ID,
          rot.acaoIa,
          conversa_id,
          JSON.stringify({ telefone: cl.telefone }),
          JSON.stringify({ resposta_enviada: true }),
          t,
        );
      }
    }

    if (rot.status === "encerrada") {
      sqlite.run(
        `UPDATE leads SET etapa = 'em_conversa' WHERE organizacao_id = ? AND cliente_id = ?`,
        DEMO_ORG_ID,
        cl.id,
      );
    }
  });
}

// ─────────────────────────────────────────────────────────────
// ROTAS PÚBLICAS DA DEMO
// ─────────────────────────────────────────────────────────────

const obter: Rota = {
  metodo: "GET",
  caminho: "/demo",
  publica: true,
  handler({ sqlite }) {
    const org = sqlite
      .query(`SELECT nome, timezone, criado_em FROM organizacoes WHERE organizacao_id = ?`)
      .get(DEMO_ORG_ID) as { nome: string; timezone: string; criado_em: number } | null;

    if (!org) {
      return json({ pronta: false, mensagem: "Demo ainda não foi semeada. Use POST /demo/reset." }, 200);
    }

    const contar = (tabela: string) =>
      (sqlite.query(`SELECT COUNT(*) AS n FROM ${tabela} WHERE organizacao_id = ?`).get(DEMO_ORG_ID) as { n: number }).n;

    return json({
      pronta: true,
      organizacao: DEMO_ORG_ID,
      nome: org.nome,
      timezone: org.timezone,
      contagem: {
        profissionais: contar("profissionais"),
        procedimentos: contar("procedimentos"),
        clientes: contar("clientes"),
        agendamentos: contar("agendamentos"),
        atendimentos: contar("atendimentos"),
        conversas: contar("conversas"),
      },
      acessos: [
        { email: "proprietaria@demo.cav", role: "proprietario" },
        { email: "gerente@demo.cav", role: "gerente" },
        { email: "profissional@demo.cav", role: "profissional" },
        { email: "recepcao@demo.cav", role: "recepcao" },
      ],
      senha: SENHA_DEMO,
    });
  },
};

const resetar: Rota = {
  metodo: "POST",
  caminho: "/demo/reset",
  publica: true,
  async handler({ sqlite }) {
    semearDemo(sqlite);
    return json({ ok: true, organizacao: DEMO_ORG_ID, mensagem: "Demo recriada do zero." });
  },
};

/**
 * Responde como o agente responderia, mas SEM tocar no WhatsApp real: a demo
 * pública não tem número homologado e não pode disparar mensagem de verdade.
 * A resposta fica registrada na conversa como `ia`, que é o que a demo exibe.
 */
const simularMensagem: Rota = {
  metodo: "POST",
  caminho: "/demo/conversas/:id/mensagem",
  publica: true,
  async handler({ sqlite, params, req }) {
    const corpo = (await req.json().catch(() => ({}))) as { texto?: string };
    const texto = (corpo.texto ?? "").trim();
    if (!texto) throw new BadRequestError("Informe o texto da mensagem simulada");

    const conversa = sqlite
      .query(`SELECT id, cliente_id, telefone FROM conversas WHERE organizacao_id = ? AND id = ?`)
      .get(DEMO_ORG_ID, params.id) as { id: string; cliente_id: string | null; telefone: string } | null;
    if (!conversa) throw new BadRequestError("Conversa não encontrada na demo");

    const agora = Date.now();
    sqlite.run(
      `INSERT INTO mensagens (id, organizacao_id, conversa_id, remetente_tipo, conteudo, criado_em)
       VALUES (?,?,?,'cliente',?,?)`,
      uuid(),
      DEMO_ORG_ID,
      conversa.id,
      texto,
      agora,
    );
    sqlite.run(
      `UPDATE conversas SET ultima_mensagem_em = ? WHERE organizacao_id = ? AND id = ?`,
      agora,
      DEMO_ORG_ID,
      conversa.id,
    );

    return json({
      ok: true,
      aviso:
        "Modo demonstração: a mensagem foi registrada no histórico, mas nenhum envio real de WhatsApp é feito.",
    });
  },
};

const conversas: Rota = {
  metodo: "GET",
  caminho: "/demo/conversas",
  publica: true,
  handler({ sqlite }) {
    const linhas = sqlite
      .query(
        `SELECT cv.id, cv.status, cv.motivo_escalada, cv.telefone, cv.ultima_mensagem_em,
                cl.nome AS cliente_nome,
                (SELECT m.conteudo FROM mensagens m
                  WHERE m.organizacao_id = cv.organizacao_id AND m.conversa_id = cv.id
                  ORDER BY m.criado_em DESC LIMIT 1) AS ultima_mensagem
         FROM conversas cv
         LEFT JOIN clientes cl ON cl.id = cv.cliente_id AND cl.organizacao_id = cv.organizacao_id
         WHERE cv.organizacao_id = ?
         ORDER BY cv.ultima_mensagem_em DESC`,
      )
      .all(DEMO_ORG_ID);
    return json({ conversas: linhas });
  },
};

const mensagens: Rota = {
  metodo: "GET",
  caminho: "/demo/conversas/:id",
  publica: true,
  handler({ sqlite, params }) {
    const conversa = sqlite
      .query(
        `SELECT cv.id, cv.status, cv.motivo_escalada, cv.telefone, cl.nome AS cliente_nome
         FROM conversas cv
         LEFT JOIN clientes cl ON cl.id = cv.cliente_id AND cl.organizacao_id = cv.organizacao_id
         WHERE cv.organizacao_id = ? AND cv.id = ?`,
      )
      .get(DEMO_ORG_ID, params.id);
    if (!conversa) throw new BadRequestError("Conversa não encontrada na demo");

    const historico = sqlite
      .query(
        `SELECT id, remetente_tipo, conteudo, criado_em FROM mensagens
         WHERE organizacao_id = ? AND conversa_id = ? ORDER BY criado_em`,
      )
      .all(DEMO_ORG_ID, params.id);

    return json({ conversa, mensagens: historico });
  },
};

export const rotasDemo: Rota[] = [obter, resetar, conversas, mensagens, simularMensagem];
