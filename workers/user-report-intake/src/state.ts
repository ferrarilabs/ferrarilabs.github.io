/**
 * state.ts — o estado durável do intake (Issue #321).
 *
 * ─── POR QUE UM DURABLE OBJECT, E NAO KV ────────────────────────────────────────────────────
 *
 * Idempotencia e uma CORRIDA, nao um cache. Dois envios simultaneos do mesmo relato precisam
 * resultar em exatamente uma Issue -- e KV e eventualmente consistente, entao os dois poderiam ler
 * "nao existe" e os dois criariam. Nao ha compare-and-set em KV.
 *
 * Durable Object com storage SQLite da transacao serializavel e um objeto por chave, executando
 * uma requisicao por vez. A corrida deixa de existir por construcao, em vez de ser improvavel.
 *
 * ─── POR QUE NAO O BINDING DE RATE LIMITING PARA ISTO ───────────────────────────────────────
 *
 * O binding nativo e otimo no que ele faz e explicitamente errado aqui: a propria documentacao da
 * Cloudflare diz que ele e local ao colo, eventualmente consistente e "intencionalmente desenhado
 * para NAO ser usado como sistema de contabilidade preciso"; e o periodo aceita apenas 10 ou 60
 * segundos. Ele nao consegue expressar "10 por dia", nao tem janela deslizante, e nao serve para
 * idempotencia. Ele fica como PRE-FILTRO de rajada; a politica mora aqui.
 *
 * ─── JANELA DESLIZANTE (F-09) ───────────────────────────────────────────────────────────────
 *
 * O limite longo guarda os INSTANTES dos envios e conta os que caem na janela. Isso elimina o
 * problema do balde por dia civil: antes, ~20 envios cabiam em minutos em volta da meia-noite UTC,
 * porque o contador zerava. Guardar instante custa mais que guardar inteiro, e e o preco de o
 * limite significar o que promete.
 *
 * ─── O QUE ESTE OBJETO NAO GUARDA ───────────────────────────────────────────────────────────
 *
 * Nunca IP. Nunca texto de relato. Nunca identidade. Ele ve uma chave PSEUDONIMA (HMAC com
 * componente de data, derivada fora daqui) e impressoes de duplicata. Nada disto volta a ser um
 * identificador de pessoa.
 */

/** Politica de abuso. Constantes de CONFIGURACAO, com razao operacional escrita. */
export const POLITICA = {
  /** Curto: cobre "tentei de novo" sem virar canal de spam. */
  curto: { limite: 3, janelaSeg: 600 },
  /** Longo, DESLIZANTE: um participante de boa-fe nao passa disso num dia. */
  longo: { limite: 10, janelaSeg: 86400 },
  /** Teto global do canal inteiro numa janela curta. */
  global: { limite: 30, janelaSeg: 600 },
  /**
   * Tolerancia a pico de incidente (F-03) — e o que ela HONESTAMENTE faz.
   *
   * A primeira versao disto tentava separar "ataque" de "quebra real" pela concentracao do
   * trafego, e o proprio teste provou que a ideia nao se sustenta: com 3 envios por remetente a
   * cada 10 minutos, chegar ao teto global de 30 na mesma janela EXIGE pelo menos 10 remetentes
   * distintos. Ou seja, o limite por remetente ja e a defesa contra concentracao, e o ramo
   * "concentrado" do disjuntor era codigo inalcancavel se fingindo de protecao.
   *
   * O que sobra e verdadeiro: o servidor NAO consegue distinguir uma quebra real de uma botnet --
   * as duas produzem muitos remetentes distintos. Entao esta regra nao afirma deteccao. Ela diz
   * apenas: quando o trafego vem de MUITA gente diferente, o teto sobe ate um limite ainda RIGIDO,
   * em vez de a porta fechar no minuto em que o canal teria mais valor.
   *
   * A cardinalidade e contada dentro da janela e descartada com ela -- nao guarda identidade.
   */
  diversidade: { remetentesMinimos: 8, globalDiverso: 120 },
  /**
   * O disjuntor abre por REINCIDENCIA no teto, nao por concentracao.
   *
   * Bater no teto uma vez e um pico. Bater repetidamente na mesma janela significa que a pressao
   * nao passou, e ai fechar por um tempo protege custo e cota do GitHub. Isso e mensuravel e
   * alcancavel -- ao contrario da regra que substituiu.
   */
  reincidenciaParaDisjuntor: 5,
  /** Mesma pessoa, mesmo texto, nesta janela => e reenvio, nao relato novo. */
  duplicataSeg: 600,
  /** Cobre reenvio manual muito depois. */
  idempotenciaSeg: 604800,
  /** Quanto tempo o intake fica fechado depois de um pico CONCENTRADO. */
  disjuntorSeg: 900,
  /** Reserva de idempotencia orfa (processo morreu no meio) expira rapido e libera a retentativa. */
  reservaSeg: 60,
} as const;

export type Decisao =
  | { ok: true; estado: "novo" }
  | { ok: true; estado: "ja-criado"; issue: number }
  | { ok: false; motivo: "EM_CURSO" | "RATE_LIMITED" | "CIRCUIT_OPEN"; retryAfter: number };

interface Corpo {
  acao: string;
  chaveRede?: string;
  chaveIdem?: string;
  impressao?: string;
  issue?: number;
  agora?: number;
}

/**
 * Um unico objeto global (`singleton`) guarda o teto global e o disjuntor; a idempotencia e por
 * chave. Isso e deliberado: espalhar o teto global por muitos objetos o tornaria aproximado, que e
 * exatamente o defeito do binding nativo que motivou este arquivo.
 */
export class EstadoDoIntake {
  // Campos explicitos em vez de "parameter properties": aquela forma nao e sintaxe APAGAVEL, e
  // este arquivo precisa rodar tanto no workerd quanto direto no Node (que so remove tipos) para
  // que os testes exercitem o codigo REAL em vez de uma copia dele.
  sql;
  ctx;
  env;

  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    this.ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS envios (
          chave TEXT NOT NULL,
          instante INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS envios_chave_instante ON envios (chave, instante);

        CREATE TABLE IF NOT EXISTS idem (
          chave TEXT PRIMARY KEY,
          estado TEXT NOT NULL,
          issue INTEGER,
          expira_em INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS duplicatas (
          impressao TEXT PRIMARY KEY,
          ocorrencias INTEGER NOT NULL,
          expira_em INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS disjuntor (
          id INTEGER PRIMARY KEY,
          aberto_ate INTEGER NOT NULL
        );
      `);
    });
  }

  async fetch(req) {
    const corpo = await req.json();
    const agora = typeof corpo.agora === "number" ? corpo.agora : Date.now();
    this.limpar(agora);

    switch (corpo.acao) {
      case "avaliar":
        return Response.json(this.avaliar(corpo, agora));
      case "confirmar":
        this.confirmar(corpo, agora);
        return Response.json({ ok: true });
      case "liberar":
        // A reserva morreu sem virar Issue (o GitHub recusou). Liberar deixa a pessoa tentar de
        // novo agora, em vez de esperar a reserva expirar sozinha.
        this.sql.exec(`DELETE FROM idem WHERE chave = ? AND estado = 'reservado'`, corpo.chaveIdem);
        return Response.json({ ok: true });
      case "metricas":
        return Response.json(this.metricas(agora));
      default:
        return Response.json({ erro: "ACAO_DESCONHECIDA" }, { status: 400 });
    }
  }

  /** Remove tudo que ja venceu. Barato, e evita que o objeto cresca sem limite. */
  limpar(agora) {
    const corte = agora - POLITICA.longo.janelaSeg * 1000;
    this.sql.exec(`DELETE FROM envios WHERE instante < ?`, corte);
    this.sql.exec(`DELETE FROM idem WHERE expira_em < ?`, agora);
    this.sql.exec(`DELETE FROM duplicatas WHERE expira_em < ?`, agora);
    this.sql.exec(`DELETE FROM disjuntor WHERE aberto_ate < ?`, agora);
  }

  contar(chave, janelaSeg, agora) {
    const desde = agora - janelaSeg * 1000;
    const r = this.sql
      .exec(`SELECT COUNT(*) AS n FROM envios WHERE chave = ? AND instante >= ?`, chave, desde)
      .one();
    return Number(r.n);
  }

  avaliar(corpo, agora) {
    const chaveRede = String(corpo.chaveRede || "");
    const chaveIdem = String(corpo.chaveIdem || "");

    // 1. Idempotencia ANTES do limite: um reenvio legitimo do MESMO relato nao pode consumir cota.
    //    Punir a retentativa de quem ja foi aceito seria cobrar duas vezes pelo mesmo envio.
    const ja = this.sql
      .exec(`SELECT estado, issue FROM idem WHERE chave = ?`, chaveIdem)
      .toArray()[0];
    if (ja?.estado === "criado") return { ok: true, estado: "ja-criado", issue: Number(ja.issue) };
    if (ja?.estado === "reservado") return { ok: false, motivo: "EM_CURSO", retryAfter: 5 };

    // 2. Disjuntor.
    const db = this.sql
      .exec(`SELECT aberto_ate FROM disjuntor WHERE id = 1`)
      .toArray()[0];
    if (db && Number(db.aberto_ate) > agora) {
      return { ok: false, motivo: "CIRCUIT_OPEN", retryAfter: Math.ceil((Number(db.aberto_ate) - agora) / 1000) };
    }

    // 3. Limites por remetente. O curto e o longo DESLIZANTE.
    if (this.contar(chaveRede, POLITICA.curto.janelaSeg, agora) >= POLITICA.curto.limite) {
      return { ok: false, motivo: "RATE_LIMITED", retryAfter: POLITICA.curto.janelaSeg };
    }
    if (this.contar(chaveRede, POLITICA.longo.janelaSeg, agora) >= POLITICA.longo.limite) {
      return { ok: false, motivo: "RATE_LIMITED", retryAfter: 3600 };
    }

    // 4. Teto global, com tolerancia a pico DIVERSO (F-03).
    const desdeGlobal = agora - POLITICA.global.janelaSeg * 1000;
    const g = this.sql
      .exec(
        `SELECT COUNT(*) AS n, COUNT(DISTINCT chave) AS distintos FROM envios WHERE instante >= ? AND chave != '__teto__'`,
        desdeGlobal,
      )
      .one();
    const total = Number(g.n);
    const distintos = Number(g.distintos);
    const diverso = distintos >= POLITICA.diversidade.remetentesMinimos;
    const teto = diverso ? POLITICA.diversidade.globalDiverso : POLITICA.global.limite;

    if (total >= teto) {
      // Registra a batida no teto. Uma batida e pico; reincidencia e pressao que nao passou.
      this.sql.exec(`INSERT INTO envios (chave, instante) VALUES (?, ?)`, "__teto__", agora);
      const batidas = this.contar("__teto__", POLITICA.global.janelaSeg, agora);
      if (batidas >= POLITICA.reincidenciaParaDisjuntor) {
        this.sql.exec(
          `INSERT INTO disjuntor (id, aberto_ate) VALUES (1, ?)
             ON CONFLICT(id) DO UPDATE SET aberto_ate = excluded.aberto_ate`,
          agora + POLITICA.disjuntorSeg * 1000,
        );
        return { ok: false, motivo: "CIRCUIT_OPEN", retryAfter: POLITICA.disjuntorSeg };
      }
      return { ok: false, motivo: "RATE_LIMITED", retryAfter: POLITICA.global.janelaSeg };
    }

    // 5. Reserva a idempotencia e registra o envio, na mesma execucao serializada.
    this.sql.exec(
      `INSERT INTO idem (chave, estado, issue, expira_em) VALUES (?, 'reservado', NULL, ?)`,
      chaveIdem,
      agora + POLITICA.reservaSeg * 1000,
    );
    this.sql.exec(`INSERT INTO envios (chave, instante) VALUES (?, ?)`, chaveRede, agora);
    return { ok: true, estado: "novo" };
  }

  confirmar(corpo, agora) {
    this.sql.exec(
      `INSERT INTO idem (chave, estado, issue, expira_em) VALUES (?, 'criado', ?, ?)
         ON CONFLICT(chave) DO UPDATE SET estado = 'criado', issue = excluded.issue, expira_em = excluded.expira_em`,
      String(corpo.chaveIdem || ""),
      Number(corpo.issue || 0),
      agora + POLITICA.idempotenciaSeg * 1000,
    );
    if (corpo.impressao) {
      this.sql.exec(
        `INSERT INTO duplicatas (impressao, ocorrencias, expira_em) VALUES (?, 1, ?)
           ON CONFLICT(impressao) DO UPDATE SET ocorrencias = duplicatas.ocorrencias + 1, expira_em = excluded.expira_em`,
        corpo.impressao,
        agora + POLITICA.duplicataSeg * 1000,
      );
    }
  }

  /** Agregado, sem conteudo e sem chave: so numeros que descrevem o canal, nunca as pessoas. */
  metricas(agora) {
    const janela = agora - POLITICA.global.janelaSeg * 1000;
    const g = this.sql
      .exec(
        `SELECT COUNT(*) AS n, COUNT(DISTINCT chave) AS distintos FROM envios WHERE instante >= ? AND chave != '__teto__'`,
        janela,
      )
      .one();
    const db = this.sql
      .exec(`SELECT aberto_ate FROM disjuntor WHERE id = 1`)
      .toArray()[0];
    return {
      envios_na_janela: Number(g.n),
      remetentes_distintos: Number(g.distintos),
      disjuntor_aberto: Boolean(db && Number(db.aberto_ate) > agora),
    };
  }
}
