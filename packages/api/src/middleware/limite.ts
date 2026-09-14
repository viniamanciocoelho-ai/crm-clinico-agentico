/**
 * Limitador de taxa por IP, janela fixa.
 *
 * Existe para as rotas PÚBLICAS da demo: `POST /demo/reset` apaga e re-semeia a
 * organização inteira — escrita pesada e sincronizada em SQLite — então um loop
 * simples derruba a demo para todos os visitantes ao mesmo tempo. Sem sessão não
 * há usuário a quem responsabilizar, e por isso o limite é por IP.
 *
 * Não é defesa distribuída: o contador vive na memória do processo. Serve para
 * conter laço acidental e abuso trivial de um cliente só, não um ataque
 * coordenado de várias origens.
 */

export interface RegraLimite {
  /** Máximo de requisições dentro da janela. */
  max: number;
  /** Tamanho da janela, em milissegundos. */
  janelaMs: number;
}

/**
 * Baldes. O reset é o caro, então tem balde próprio e mais apertado — mas ainda
 * folgado: recarregar a demo algumas vezes sem esperar precisa funcionar.
 */
export const BALDES: Record<string, RegraLimite> = {
  // ~1 recarga a cada 3s em média. Derruba o loop, não o visitante.
  "demo-reset": { max: 20, janelaMs: 60_000 },
  // Leitura e simulação: bem mais frequentes, teto generoso.
  demo: { max: 600, janelaMs: 60_000 },
  // Teto de tudo que é limitado, soma dos baldes. Pega um cliente que martela
  // vários endpoints ao mesmo tempo sem ter de limitar cada rota isolada.
  global: { max: 1200, janelaMs: 60_000 },
};

interface Contador {
  contagem: number;
  expiraEm: number;
}

const contadores = new Map<string, Contador>();

/**
 * Descarta janelas vencidas. Roda de forma preguiçosa a cada chamada — sem
 * timer, o Map só cresce com o número de IPs distintos vistos na janela atual.
 */
function expurgar(agora: number): void {
  for (const [chave, c] of contadores) {
    if (c.expiraEm <= agora) contadores.delete(chave);
  }
}

/**
 * Consome uma unidade do balde para aquele IP. Retorna `null` se passou, ou os
 * segundos restantes até liberar, se estourou.
 */
export function consumir(balde: string, ip: string, agora = Date.now()): number | null {
  const regra = BALDES[balde];
  if (!regra) return null; // balde desconhecido não limita — falha aberta

  // Expurgo barato: só quando o Map já está grande o bastante para importar.
  if (contadores.size > 5000) expurgar(agora);

  const chave = `${balde}:${ip}`;
  const atual = contadores.get(chave);

  if (!atual || atual.expiraEm <= agora) {
    contadores.set(chave, { contagem: 1, expiraEm: agora + regra.janelaMs });
    return null;
  }

  if (atual.contagem >= regra.max) {
    return Math.max(1, Math.ceil((atual.expiraEm - agora) / 1000));
  }

  atual.contagem += 1;
  return null;
}

/** Só para os testes: zera o estado entre casos. */
export function resetarLimites(): void {
  contadores.clear();
}

/**
 * IP do cliente para efeito de limite.
 *
 * `requestIP()` é o caminho normal (o Bun preenche no `serve`). `X-Forwarded-For`
 * só conta quando `CONFIAR_EM_PROXY` está ligado: sem proxy na frente qualquer
 * cliente forja esse header e escaparia do limite trocando de IP a cada request.
 */
export function ipDoCliente(
  requestIP: unknown,
  cabecalhos: Headers,
  confiarEmProxy = process.env.CONFIAR_EM_PROXY === "1",
): string {
  const doSocket =
    requestIP && typeof requestIP === "object" && "address" in requestIP
      ? String((requestIP as { address: unknown }).address)
      : typeof requestIP === "string"
        ? requestIP
        : null;
  if (doSocket) return doSocket;

  if (confiarEmProxy) {
    const encaminhado = cabecalhos.get("X-Forwarded-For");
    if (encaminhado) {
      const primeiro = encaminhado.split(",")[0]?.trim();
      if (primeiro) return primeiro;
    }
  }

  // Sem IP conhecido, tudo cai no mesmo balde. Limita agressivo demais se
  // estiver errado, mas falhar fechado é o certo para uma rota destrutiva.
  return "desconhecido";
}
