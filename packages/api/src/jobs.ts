import type { Database } from "bun:sqlite";
import { carregarOrg } from "./lib/org";
import { confirmarAtendimento } from "./lib/contabil";

/**
 * Jobs internos. Cron dentro do próprio servidor Bun — sem serviço externo de
 * fila, como a spec exige. Nada aqui é agendado por processo separado: o
 * `iniciarJobs` registra os timers no mesmo runtime da API.
 *
 * Todo job é por organização. Um que falhe em um tenant não pode impedir os
 * outros: o laço isola o erro, registra em `jobs_execucoes` e segue.
 */

const min = 60_000;

export interface ResultadoJob {
  job: string;
  organizacao_id: string;
  resultado: Record<string, unknown>;
  erro?: string;
  duracao_ms: number;
}

type Job = (sqlite: Database, organizacao_id: string) => Record<string, unknown>;

function registrarExecucao(
  sqlite: Database,
  organizacao_id: string,
  job: string,
  resultado: Record<string, unknown>,
  duracao_ms: number,
  erro?: string,
) {
  sqlite.run(
    `INSERT INTO jobs_execucoes (id, organizacao_id, job, resultado, duracao_ms, erro)
     VALUES (?,?,?,?,?,?)`,
    crypto.randomUUID(),
    organizacao_id,
    job,
    JSON.stringify(resultado),
    Math.round(duracao_ms),
    erro ?? null,
  );
}

/**
 * Roda um job em todas as organizações. O erro de um tenant vira uma linha de
 * log com `erro` preenchido e o laço continua — nunca aborta a rodada inteira.
 */
export function rodarEmTodas(
  sqlite: Database,
  nome: string,
  job: Job,
): ResultadoJob[] {
  const orgs = sqlite
    .query(`SELECT organizacao_id FROM organizacoes`)
    .all() as { organizacao_id: string }[];

  const saida: ResultadoJob[] = [];
  for (const { organizacao_id } of orgs) {
    const inicio = performance.now();
    try {
      const resultado = job(sqlite, organizacao_id);
      const duracao_ms = performance.now() - inicio;
      registrarExecucao(sqlite, organizacao_id, nome, resultado, duracao_ms);
      saida.push({ job: nome, organizacao_id, resultado, duracao_ms });
    } catch (e) {
      const duracao_ms = performance.now() - inicio;
      const erro = e instanceof Error ? e.message : String(e);
      registrarExecucao(sqlite, organizacao_id, nome, {}, duracao_ms, erro);
      saida.push({ job: nome, organizacao_id, resultado: {}, erro, duracao_ms });
    }
  }
  return saida;
}

/**
 * Fila de saída do WhatsApp. Enquanto a Meta Cloud API não estiver plugada
 * (template aprovado), o que a clínica pode enviar fica registrado como
 * mensagem da IA na conversa e marcado como pendente de disparo — assim o
 * lembrete existe no histórico e a flag do agendamento não mente dizendo que
 * avisou quem nunca recebeu.
 */
function enfileirarEnvio(
  sqlite: Database,
  organizacao_id: string,
  telefone: string,
  texto: string,
  referencia: string,
) {
  // Reaproveita a conversa aberta daquele telefone; se não houver, cria uma
  // para que a mensagem tenha onde existir.
  let conversa = sqlite
    .query(
      `SELECT id FROM conversas
       WHERE organizacao_id = ? AND telefone = ? AND status != 'encerrada'
       ORDER BY criado_em DESC LIMIT 1`,
    )
    .get(organizacao_id, telefone) as { id: string } | null;

  if (!conversa) {
    const cliente = sqlite
      .query(`SELECT id FROM clientes WHERE organizacao_id = ? AND telefone = ?`)
      .get(organizacao_id, telefone) as { id: string } | null;
    const id = crypto.randomUUID();
    sqlite.run(
      `INSERT INTO conversas (id, organizacao_id, cliente_id, lead_id, canal, telefone, status, ultima_mensagem_em)
       VALUES (?, ?, ?, NULL, 'whatsapp', ?, 'com_ia', ?)`,
      id,
      organizacao_id,
      cliente?.id ?? null,
      telefone,
      Date.now(),
    );
    conversa = { id };
  }

  sqlite.run(
    `INSERT INTO mensagens (id, organizacao_id, conversa_id, remetente_tipo, remetente_id, conteudo)
     VALUES (?, ?, ?, 'ia', NULL, ?)`,
    crypto.randomUUID(),
    organizacao_id,
    conversa.id,
    texto,
  );
  sqlite.run(`UPDATE conversas SET ultima_mensagem_em = ? WHERE organizacao_id = ? AND id = ?`, Date.now(), organizacao_id, conversa.id);

  // A ação consta no log da IA: o lembrete automático é ação do agente, mesmo
  // sem humano por trás. `autor_tipo = 'ia'` mantém a auditoria coerente.
  sqlite.run(
    `INSERT INTO ia_acoes_log
       (id, organizacao_id, autor_tipo, tipo_acao, conversa_id, dados_entrada, dados_decisao, sucesso, erro)
     VALUES (?, ?, 'ia', 'lembrete', ?, ?, ?, 1, NULL)`,
    crypto.randomUUID(),
    organizacao_id,
    conversa.id,
    JSON.stringify({ referencia }),
    JSON.stringify({ enfileirado: true }),
  );

  return conversa.id;
}

function fmt(ts: number, timezone: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ts));
}

/**
 * Lembretes de 24h e 2h antes. Cada um dispara uma única vez — a flag
 * `lembrete_enviado_*` é o que garante isso, e ela só é marcada depois do
 * envio ter sido enfileirado com sucesso.
 */
export function jobLembretes(sqlite: Database, organizacao_id: string): Record<string, unknown> {
  const cfg = carregarOrg(sqlite, organizacao_id);
  const agora = Date.now();

  const pendentes = sqlite
    .query(
      `SELECT a.id, a.inicio, a.lembrete_enviado_24h, a.lembrete_enviado_2h,
              c.nome AS cliente_nome, c.telefone,
              p.nome AS procedimento_nome, pr.nome AS profissional_nome
       FROM agendamentos a
       JOIN clientes c ON c.id = a.cliente_id AND c.organizacao_id = a.organizacao_id
       JOIN procedimentos p ON p.id = a.procedimento_id AND p.organizacao_id = a.organizacao_id
       JOIN profissionais pr ON pr.id = a.profissional_id AND pr.organizacao_id = a.organizacao_id
       WHERE a.organizacao_id = ?
         AND a.status IN ('agendado', 'confirmado')
         AND a.inicio BETWEEN ? AND ?
         AND (a.lembrete_enviado_24h = 0 OR a.lembrete_enviado_2h = 0)
       ORDER BY a.inicio`,
    )
    .all(organizacao_id, agora, agora + 25 * 60 * min) as {
    id: string;
    inicio: number;
    lembrete_enviado_24h: number;
    lembrete_enviado_2h: number;
    cliente_nome: string;
    telefone: string;
    procedimento_nome: string;
    profissional_nome: string;
  }[];

  const enviados24h: string[] = [];
  const enviados2h: string[] = [];

  for (const a of pendentes) {
    const faltam = a.inicio - agora;
    const quando = fmt(a.inicio, cfg.timezone);

    // Janela de 24h: entre 23h e 25h antes. A de 2h: entre 1h30 e 2h30.
    const faixa24h = faltam <= 25 * 60 * min && faltam >= 23 * 60 * min;
    const faixa2h = faltam <= 150 * min && faltam >= 90 * min;

    if (!a.lembrete_enviado_24h && faixa24h) {
      enfileirarEnvio(
        sqlite,
        organizacao_id,
        a.telefone,
        `Olá, ${a.cliente_nome}! Lembrete do seu horário: ${a.procedimento_nome} com ${a.profissional_nome} em ${quando}. Responda *confirmar* para confirmar ou *remarcar* se precisar mudar.`,
        a.id,
      );
      sqlite.run(`UPDATE agendamentos SET lembrete_enviado_24h = 1 WHERE organizacao_id = ? AND id = ?`, organizacao_id, a.id);
      enviados24h.push(a.id);
    }

    if (!a.lembrete_enviado_2h && faixa2h) {
      enfileirarEnvio(
        sqlite,
        organizacao_id,
        a.telefone,
        `Faltam 2 horas para o seu atendimento: ${a.procedimento_nome} com ${a.profissional_nome}, às ${quando}. Te esperamos!`,
        a.id,
      );
      sqlite.run(`UPDATE agendamentos SET lembrete_enviado_2h = 1 WHERE organizacao_id = ? AND id = ?`, organizacao_id, a.id);
      enviados2h.push(a.id);
    }
  }

  return { lembretes_24h: enviados24h.length, lembretes_2h: enviados2h.length };
}

/**
 * Reativação de clientes inativos. Não marca o cliente: escreve em
 * `reativacoes_log` com `retornou = 0` e deixa o tempo fechar a métrica. Um
 * cliente só entra uma vez por ciclo — enquanto houver reativação sem retorno
 * dentro da janela, ele não é incomodado de novo.
 */
export function jobReativacao(sqlite: Database, organizacao_id: string): Record<string, unknown> {
  const cfg = carregarOrg(sqlite, organizacao_id);
  const agora = Date.now();
  const limite = agora - cfg.reativacao_dias * 86_400_000;

  const inativos = sqlite
    .query(
      `SELECT c.id, c.nome, c.telefone,
              COALESCE(MAX(t.criado_em), c.criado_em) AS ultima_atividade
       FROM clientes c
       LEFT JOIN atendimentos t
         ON t.organizacao_id = c.organizacao_id AND t.cliente_id = c.id AND t.status = 'concluido'
       WHERE c.organizacao_id = ? AND c.ativo = 1
         AND NOT EXISTS (
           SELECT 1 FROM reativacoes_log r
           WHERE r.organizacao_id = c.organizacao_id AND r.cliente_id = c.id
             AND r.retornou = 0 AND r.disparado_em > ?
         )
       GROUP BY c.id
       HAVING ultima_atividade < ?
       ORDER BY ultima_atividade
       LIMIT 50`,
    )
    .all(organizacao_id, limite, limite) as { id: string; nome: string; telefone: string; ultima_atividade: number }[];

  const disparadas: string[] = [];
  for (const c of inativos) {
    enfileirarEnvio(
      sqlite,
      organizacao_id,
      c.telefone,
      `Olá, ${c.nome}! Faz um tempo que não te vemos por aqui. Quer que eu veja um horário para você?`,
      `reativacao:${c.id}`,
    );
    sqlite.run(
      `INSERT INTO reativacoes_log (id, organizacao_id, cliente_id, disparado_em, retornou)
       VALUES (?, ?, ?, ?, 0)`,
      crypto.randomUUID(),
      organizacao_id,
      c.id,
      agora,
    );
    disparadas.push(c.id);
  }

  return { reativacoes: disparadas.length };
}

/**
 * No-show automático. Um agendamento cujo horário já passou há mais de 4h e
 * que ninguém registrou vira `falta` — mas só se não houver atendimento
 * vinculado, senão o cliente compareceu e a recepção é que não marcou.
 *
 * A janela é generosa de propósito: marcar falta cedo demais num cliente que
 * chegou atrasado é pior do que registrar a falta tarde.
 */
export function jobNoShow(sqlite: Database, organizacao_id: string): Record<string, unknown> {
  const agora = Date.now();
  const atrasados = sqlite
    .query(
      `SELECT a.id, a.cliente_id, a.profissional_id, a.procedimento_id, c.nome AS cliente_nome
       FROM agendamentos a
       JOIN clientes c ON c.id = a.cliente_id AND c.organizacao_id = a.organizacao_id
       WHERE a.organizacao_id = ?
         AND a.status IN ('agendado', 'confirmado')
         AND a.fim < ?
         AND NOT EXISTS (
           SELECT 1 FROM atendimentos t
           WHERE t.organizacao_id = a.organizacao_id AND t.agendamento_id = a.id
         )`,
    )
    .all(organizacao_id, agora - 4 * 60 * min) as {
    id: string;
    cliente_id: string;
    profissional_id: string;
    procedimento_id: string;
    cliente_nome: string;
  }[];

  const marcados: string[] = [];
  for (const a of atrasados) {
    confirmarAtendimento(sqlite, {
      organizacao_id,
      agendamento_id: a.id,
      cliente_id: a.cliente_id,
      profissional_id: a.profissional_id,
      procedimento_id: a.procedimento_id,
      status: "falta",
      observacoes: "Registrado automaticamente pelo job de no-show",
    });
    sqlite.run(`UPDATE agendamentos SET status = 'cancelado_pela_clinica' WHERE organizacao_id = ? AND id = ?`, organizacao_id, a.id);
    marcados.push(a.id);
  }

  return { faltas_marcadas: marcados.length };
}

/**
 * Limpeza. Sessões vencidas e log de jobs antigo não têm valor depois de um
 * tempo e só engordam o banco — o dado de negócio (atendimento, agendamento,
 * conversa) não é tocado por este job.
 */
export function jobLimpeza(sqlite: Database, organizacao_id: string): Record<string, unknown> {
  const agora = Date.now();

  const sessoes = sqlite.run(
    `DELETE FROM sessoes WHERE organizacao_id = ? AND expira_em < ?`,
    organizacao_id,
    agora,
  );

  const logs = sqlite.run(
    `DELETE FROM jobs_execucoes WHERE organizacao_id = ? AND criado_em < ?`,
    organizacao_id,
    agora - 30 * 86_400_000,
  );

  return {
    sessoes_removidas: sessoes.changes,
    logs_removidos: logs.changes,
  };
}

export const JOBS: { nome: string; intervalo_ms: number; executar: Job }[] = [
  { nome: "lembretes", intervalo_ms: 15 * min, executar: jobLembretes },
  { nome: "reativacao", intervalo_ms: 6 * 60 * min, executar: jobReativacao },
  { nome: "no_show", intervalo_ms: 60 * min, executar: jobNoShow },
  { nome: "limpeza", intervalo_ms: 24 * 60 * min, executar: jobLimpeza },
];

/**
 * Liga os timers. Guarda os handles para que o desligamento possa limpá-los —
 * um job rodando durante o shutdown escreveria em banco já fechado.
 */
export function iniciarJobs(sqlite: Database): () => void {
  const handles: Timer[] = [];

  for (const job of JOBS) {
    const handle = setInterval(() => {
      const rodada = rodarEmTodas(sqlite, job.nome, job.executar);
      for (const r of rodada) {
        if (r.erro) console.error(`[job ${r.job}] falhou em ${r.organizacao_id}: ${r.erro}`);
      }
    }, job.intervalo_ms);
    // Não segura o processo vivo só por causa do job.
    if (typeof handle === "object" && "unref" in handle) handle.unref();
    handles.push(handle);
  }

  return () => {
    for (const h of handles) clearInterval(h);
  };
}
