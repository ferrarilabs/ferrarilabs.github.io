/**
 * monitor_live_pipeline.mjs — saúde do pipeline ao vivo, observável sem depender de ninguém olhar.
 *
 * ─── POR QUE ESTE MONITOR EXISTE ────────────────────────────────────────────────────────────
 *
 * Todos os incidentes do pipeline ao vivo em 2026-08 foram descobertos da mesma forma: alguém
 * abriu o site e viu que estava errado. Nenhum foi descoberto por um sinal. A CI de browser e
 * acessibilidade chegou a tropeçar em alguns deles por acidente — o que é pior que não detectar,
 * porque cria a impressão de cobertura sem a propriedade de cobertura.
 *
 * Este monitor não renderiza nada, não depende de navegador e não olha participante. Ele responde
 * uma pergunta só: **o dado ao vivo está chegando?**
 *
 * ─── O QUE ELE MEDE, E POR QUE ESSES LIMIARES ───────────────────────────────────────────────
 *
 * Os limiares NÃO são inventados aqui: vêm do contrato de frescor que o gateway e o store já
 * compartilham (`STALE_AFTER_MS` = 10 min, `CRITICAL_STALE_AFTER_MS` = 30 min). Um monitor com
 * limiar próprio seria uma terceira fonte de verdade sobre frescor, e a terceira sempre discorda.
 *
 * ─── IDENTIDADE DE INCIDENTE ────────────────────────────────────────────────────────────────
 *
 * Um incidente é identificado por `(competicao, estado)`. Enquanto o mesmo incidente persiste, o
 * monitor não repete alarme — ele só fala em TRANSIÇÃO (abertura e recuperação). Um monitor que
 * grita a cada execução é um monitor que as pessoas silenciam, e um monitor silenciado é pior que
 * nenhum, porque ainda parece existir.
 *
 * Nenhum dado de participante é lido, e nenhuma escrita de produção acontece.
 */
import { fixtureDatesFor, isWithinWindow } from "../shared/scripts/produce_live_cache.mjs";

const GATEWAY = "https://cmhqkkfczotdnssupkni.supabase.co/functions/v1/live-football";

// Os mesmos numeros do contrato compartilhado (bolao/shared/js/football_live_store.js).
export const STALE_MS = 10 * 60_000;
export const CRITICAL_MS = 30 * 60_000;

export const ESTADO = Object.freeze({
  OK: "OK",
  PRODUCER_LATE: "PRODUCER_LATE",
  CACHE_STALE: "CACHE_STALE",
  CACHE_CRITICAL: "CACHE_CRITICAL",
  GATEWAY_UNAVAILABLE: "GATEWAY_UNAVAILABLE",
  GATEWAY_INVALID_PAYLOAD: "GATEWAY_INVALID_PAYLOAD",
  /**
   * Nao ha o que observar: nenhuma partida daquela competicao esta na janela derivada do
   * calendario commitado, entao o produtor nao escreveu (`SKIPPED_OUT_OF_WINDOW`) e o gateway
   * expoe a ultima falha de refresh da ESPN. Isso e o estado ESPERADO, nao degradacao.
   */
  SEM_JANELA: "SEM_JANELA",
});

/**
 * Classifica UMA resposta de gateway. Pura: sem rede, sem relógio implícito.
 *
 * A ordem importa e é do mais grave para o mais brando: uma resposta ilegível não pode ser lida
 * como "cache velho", porque não se sabe sequer se há cache.
 */
export function classificar({ status, corpo, agoraMs }) {
  if (status === 0 || status >= 500) {
    if (corpo && corpo.status === "SOURCE_UNAVAILABLE") {
      return { estado: ESTADO.GATEWAY_UNAVAILABLE, detalhe: corpo.staleReason || "sem detalhe" };
    }
    return { estado: ESTADO.GATEWAY_UNAVAILABLE, detalhe: `http ${status}` };
  }
  if (!corpo || typeof corpo !== "object" || !("observedAt" in corpo)) {
    return { estado: ESTADO.GATEWAY_INVALID_PAYLOAD, detalhe: "resposta sem forma esperada" };
  }
  if (corpo.observedAt == null) {
    return { estado: ESTADO.GATEWAY_UNAVAILABLE, detalhe: corpo.staleReason || "sem observacao" };
  }
  const idade = agoraMs - Date.parse(corpo.observedAt);
  if (!Number.isFinite(idade)) {
    return { estado: ESTADO.GATEWAY_INVALID_PAYLOAD, detalhe: "observedAt ilegivel" };
  }
  const min = Math.round(idade / 60000);
  if (idade > CRITICAL_MS) return { estado: ESTADO.CACHE_CRITICAL, detalhe: `${min} min` };
  if (idade > STALE_MS)    return { estado: ESTADO.CACHE_STALE, detalhe: `${min} min` };
  return { estado: ESTADO.OK, detalhe: `${min} min` };
}

/**
 * A MESMA classificacao, situada na janela de atividade da competicao (#372).
 *
 * ─── POR QUE ESTA CAMADA EXISTE ─────────────────────────────────────────────────────────────
 *
 * A Issue #372 ficou ABERTA de 2026-08-28 a 2026-09-01 com o pipeline saudavel. Nenhuma das 18
 * sondas seguintes conseguiu fecha-la, e nao por falta de recuperacao: `cdb2026` teve uma lacuna
 * de calendario de cinco dias (ultima partida 2026-08-27T23:00Z, proxima 2026-09-02T00:00Z).
 * Sem partida na janela, `produceOne()` devolve `SKIPPED_OUT_OF_WINDOW` ANTES de qualquer rede,
 * o cache nao e reescrito, o gateway cai no proprio egresso — que a Akamai nega — e responde
 * `SOURCE_UNAVAILABLE` / `UPSTREAM_403`. O monitor lia isso como `GATEWAY_UNAVAILABLE` e mantinha
 * o incidente aberto para sempre, inclusive em sondas onde `br2026` reportava `OK 0 min`.
 *
 * A distincao que faltava e semantica, nao de limiar:
 *
 *     DENTRO da janela  + pipeline indisponivel   ->  degradacao, incidente
 *     FORA  da janela   + nenhuma observacao esperada  ->  inatividade esperada, NAO e incidente
 *
 * ─── O QUE ESTA CAMADA NAO FAZ ──────────────────────────────────────────────────────────────
 *
 * Ela NAO esconde queda real. Estar fora da janela abranda apenas o que o proprio produtor ja
 * decidiu nao produzir. Dentro da janela, 403 continua alarmando exatamente como antes — e ha
 * controle negativo provando que uma mutacao nesse sentido reprova a suite.
 *
 * Uma observacao SAUDAVEL fora da janela continua valendo `OK`: dado fresco e dado fresco, e e
 * ele que autoriza a recuperacao. Inatividade nunca autoriza.
 *
 * A janela vem de `produce_live_cache.mjs` — de quem ESCREVE. Um limiar de janela proprio aqui
 * seria uma segunda fonte de verdade sobre a mesma pergunta, e a segunda sempre discorda.
 */
export function classificarComJanela({ status, corpo, agoraMs, emJanela }) {
  const r = classificar({ status, corpo, agoraMs });
  if (emJanela) return r;
  if (r.estado === ESTADO.OK) return r;
  return { estado: ESTADO.SEM_JANELA, detalhe: `sem partida na janela (gateway: ${r.detalhe})` };
}

/**
 * Reduz as linhas de competicao a UM estado de pipeline. Pura: sem rede, sem relogio.
 *
 * Regra, na ordem: qualquer competicao ruim EM JANELA manda (uma competicao inativa nunca mascara
 * outra que esta quebrada de verdade); senao, uma observacao saudavel autoriza `OK`; senao, todas
 * estao inativas e a resposta e `SEM_JANELA` — que nao abre NEM fecha incidente. Recuperacao
 * exige observacao positiva, nunca ausencia de observacao.
 */
export function agregar(linhas) {
  let ruim = null;
  for (const l of linhas) {
    if (l.estado !== ESTADO.OK && l.estado !== ESTADO.SEM_JANELA) ruim = l.estado;
  }
  if (ruim) return ruim;
  return linhas.some((l) => l.estado === ESTADO.OK) ? ESTADO.OK : ESTADO.SEM_JANELA;
}

/**
 * Decide o que REPORTAR, dado o estado anterior. Esta é a parte que impede alarme repetido.
 *
 * @returns {{acao: "ABRIR"|"RECUPERAR"|"SILENCIO", incidente: string|null}}
 */
export function transicao(anterior, atual) {
  // `SEM_JANELA` nao e observacao. Nao abre incidente e — o que importa mais — NAO fecha um
  // incidente aberto: fechar por ausencia de dado seria declarar recuperacao sem ter medido
  // nenhuma. O incidente anterior continua nomeado para quem le a saida.
  const ruim = (e) => !!e && e !== ESTADO.OK && e !== ESTADO.SEM_JANELA;
  if (atual === ESTADO.SEM_JANELA) return { acao: "SILENCIO", incidente: ruim(anterior) ? anterior : null };
  const antesRuim = ruim(anterior);
  const agoraRuim = ruim(atual);
  if (!antesRuim && agoraRuim) return { acao: "ABRIR", incidente: atual };
  if (antesRuim && !agoraRuim) return { acao: "RECUPERAR", incidente: anterior };
  // Incidente que MUDA de natureza (stale -> critical) merece ser dito uma vez.
  if (antesRuim && agoraRuim && anterior !== atual) return { acao: "ABRIR", incidente: atual };
  return { acao: "SILENCIO", incidente: agoraRuim ? atual : null };
}

/** Deriva PRODUCER_LATE do intervalo entre execuções — o defeito estrutural medido em #246. */
export function produtorAtrasado(ultimaExecucaoMs, agoraMs) {
  if (!Number.isFinite(ultimaExecucaoMs)) return null;
  const atraso = agoraMs - ultimaExecucaoMs;
  return atraso > CRITICAL_MS
    ? { estado: ESTADO.PRODUCER_LATE, detalhe: `${Math.round(atraso / 60000)} min sem produzir` }
    : null;
}

// ─── Execução ───────────────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const competicoes = ["cdb2026", "br2026"];
  const agora = Date.now();
  const linhas = [];

  for (const c of competicoes) {
    let status = 0, corpo = null;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20000);
      const r = await fetch(`${GATEWAY}?competition=${c}`, { signal: ctrl.signal });
      clearTimeout(t);
      status = r.status;
      try { corpo = await r.json(); } catch { corpo = null; }
    } catch (e) {
      status = 0;
    }
    // A janela e a MESMA que o produtor usa para decidir se vale ir a fonte (#372). Ler daqui
    // qualquer outro criterio faria monitor e produtor discordarem sobre o que e "ativo".
    const emJanela = isWithinWindow(fixtureDatesFor(c), agora);
    const { estado, detalhe } = classificarComJanela({ status, corpo, agoraMs: agora, emJanela });
    linhas.push({ competicao: c, estado, detalhe });
  }

  const pior = agregar(linhas);

  console.log("MONITOR DO PIPELINE AO VIVO");
  for (const l of linhas) console.log(`  ${l.competicao.padEnd(9)} ${l.estado.padEnd(24)} ${l.detalhe}`);
  console.log(`\nPIPELINE_STATUS = ${pior}`);
  // Nao falha o processo: um monitor que quebra o job vira um monitor desligado. Quem decide
  // alarme e o workflow, comparando com o estado anterior.
  process.exit(0);
}
