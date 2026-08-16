#!/usr/bin/env python3
"""
Identidade canônica do comprovante do CDB2026 — UMA definição, todos os transportes.

═══ O QUE ESTE MÓDULO EXISTE PARA IMPEDIR ═══════════════════════════════════════════════════════

Em 2026-08-16 Bossle e Rodrigo Hajj receberam um comprovante que já tinham. O post-mortem do dia
culpou o filtro de data do `receipt_catchup_20260816.py` — que de fato tinha sido removido, e foi
reposto. Mas o filtro de data nunca foi o controle de duplicata: ele só recorta a POPULAÇÃO que
interessa. O controle de duplicata era a unicidade de `reserve_delivery`, e ela estava dividida em
quatro chaves para um fato só:

    produção           cdb2026:entry-saved-confirmation:<versão>:v1
    catch-up 12/08     cdb2026:entry-saved-confirmation-catchup-20260812:<entrada>:<versão>:v1
    catch-up 16/08     cdb2026:entry-saved-confirmation-catchup-20260816:<entrada>:<versão>:v1
    teste de template  cdb2026:entry-saved-confirmation-template-test:<versão>:v3

Cada caminho estava protegido contra si mesmo e nenhum estava protegido contra os outros. Nome de
transporte tinha virado identidade semântica.

A identidade real de um comprovante é:

    ENTRADA + VERSÃO GRAVADA DOS PALPITES

e nada mais. Se essa dupla já recebeu por QUALQUER caminho reconhecido, todo remetente automático
devolve NOOP.

═══ DUAS CAMADAS ════════════════════════════════════════════════════════════════════════════════

  1. `canonical_business_key(versão)` — todo remetente automático reserva na chave de PRODUÇÃO.
     Um catch-up não é outro evento de negócio; é o mesmo recibo por outro transporte. Com isso
     NORMAL→CATCHUP e CATCHUP→NORMAL colidem no UNIQUE do banco, sem depender de código nenhum.

  2. `has_accepted_receipt()` → RPC `cdb_has_accepted_receipt`. Alcança o que a chave canônica não
     alcança: as famílias históricas que gravaram com chave própria e a entrega LEGADA pelo
     navegador, que nunca escreveu em `notification_deliveries`.

A camada 1 sozinha deixa TEMPLATE→CATCHUP passar; a camada 2 sozinha tem janela de corrida entre
consultar e reservar. Juntas, não.

═══ FALHA FECHADA ═══════════════════════════════════════════════════════════════════════════════

`UNCERTAIN` (provedor chamado e resposta perdida, reserva nunca liquidada, entrega legada sem
versão provável) **bloqueia** o envio automático e vai para revisão do operador. "Talvez tenha
recebido" nunca autoriza um segundo e-mail — foi assim que este incidente começou.

RPC ausente ou inalcançável também é bloqueio: sem a pergunta canônica respondida, não há
elegibilidade. Nunca cair para o critério antigo (data + `lastClientRef`).

Nenhuma função aqui conhece, imprime ou devolve endereço de e-mail.
"""

import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI))

import receipt_render as R  # noqa: E402

# ── A CHAVE CANÔNICA ─────────────────────────────────────────────────────────────────────────
#
# É literalmente `business_key()` de `send_entry_saved_confirmation.py`. Duplicar a expressão aqui
# permitiria as duas divergirem em silêncio — `test_receipt_catchup_dedupe.py` compara as duas
# fontes e falha se saírem do lugar.
CANONICAL_FAMILY = "cdb2026:entry-saved-confirmation"
CATCHUP_FAMILY = "cdb2026:entry-saved-confirmation-catchup"
LEGACY_FAMILY = "cdb2026:entry-saved-confirmation-legacy-attested"


def canonical_business_key(picks_version):
    """A identidade de entrega de um comprovante. Mesma para todo transporte, por construção."""
    if not picks_version:
        raise ValueError("canonical_business_key: versão obrigatória — chave sem versão suprimiria "
                         "recibos legítimos de outros estados gravados")
    return f"{CANONICAL_FAMILY}:{picks_version}:v1"


# ── FAMÍLIAS RECONHECIDAS ────────────────────────────────────────────────────────────────────
#
# Espelho do registro em `bolao.cdb_receipt_family_registry`. A autoridade é o banco; esta cópia
# existe para o teste offline e é comparada com o SQL da migração — divergir é falha de teste, não
# detalhe de documentação.
RECEIPT_FAMILIES = {
    CANONICAL_FAMILY: "automated",
    CATCHUP_FAMILY: "automated",
    "cdb2026:entry-saved-confirmation-catchup-20260812": "automated",
    "cdb2026:entry-saved-confirmation-catchup-20260816": "automated",
    "cdb2026:entry-saved-confirmation-template-test": "operator_manual",
    LEGACY_FAMILY: "legacy",
}

# Status de entrega que impedem um segundo envio. `claimed` entra porque uma reserva concedida e
# nunca liquidada pode ter chamado o provedor antes de o processo morrer.
STATUS_ACEITO = ("accepted",)
STATUS_INCERTO = ("claimed", "uncertain")


def key_carries_version(business_key, picks_version):
    """
    A versão aparece delimitada por ':' em TODAS as famílias registradas — produção
    (`…:<versão>:v1`), catch-ups (`…:<entrada>:<versão>:v1`) e teste de template (`…:<versão>:v3`).
    Exigir os dois-pontos dos dois lados evita casar com prefixo de outro hash.
    """
    if not business_key or not picks_version:
        return False
    return f":{picks_version}:" in business_key


class Decision:
    """Resposta da pergunta canônica. `blocks_send` é o que os remetentes consultam."""

    __slots__ = ("accepted", "uncertain", "paths", "reason")

    def __init__(self, accepted, uncertain, paths, reason):
        self.accepted = bool(accepted)
        self.uncertain = bool(uncertain)
        self.paths = list(paths or [])
        self.reason = reason

    @property
    def blocks_send(self):
        return self.accepted or self.uncertain

    @property
    def label(self):
        if self.accepted:
            return "SKIP_ALREADY_RECEIVED_SAME_VERSION"
        if self.uncertain:
            return "SKIP_UNCERTAIN_NEEDS_OPERATOR_REVIEW"
        return "ELIGIBLE"

    def __repr__(self):
        return f"<Decision {self.label} paths={self.paths} reason={self.reason!r}>"


def classify_ledger(linhas, picks_version, atestacoes=()):
    """
    O núcleo PURO da decisão cross-path — a mesma regra que a RPC aplica no banco, sem rede.

    `linhas`     iterável de dicts com `family`/`business_key` e `status`, como
                 `bolao.notification_deliveries` os guarda.
    `atestacoes` iterável de dicts com `certainty` e `picks_version` (entrega legada).

    Só famílias DECLARADAS contam. Família desconhecida não deduplica — o lado seguro e ruidoso
    do erro: um remetente novo que esqueceu de se registrar aparece como "elegível de novo" numa
    medição, e não como duplicata silenciosa numa caixa de entrada.
    """
    aceito, incerto, caminhos = False, False, []

    for linha in linhas or []:
        fam = linha.get("family") or linha.get("business_key")
        if fam not in RECEIPT_FAMILIES:
            continue
        if not key_carries_version(linha.get("business_key") or fam, picks_version):
            continue
        status = linha.get("status")
        if status in STATUS_ACEITO:
            aceito = True
            caminhos.append(f"{fam}#{status}")
        elif status in STATUS_INCERTO:
            incerto = True
            caminhos.append(f"{fam}#{status}")

    for a in atestacoes or []:
        if a.get("certainty") == "PROVEN" and a.get("picks_version") == picks_version:
            aceito = True
            caminhos.append(f"{LEGACY_FAMILY}#accepted")
        elif a.get("certainty") == "UNCERTAIN":
            # Não dá para provar de que versão era. Não chutar: bloquear e mandar para revisão.
            incerto = True
            caminhos.append(f"{LEGACY_FAMILY}#uncertain")

    if aceito:
        motivo = "RECIBO_ACEITO_EM_OUTRO_CAMINHO"
    elif incerto:
        motivo = "INCERTO: exige revisao do operador"
    else:
        motivo = "SEM_RECIBO_DESTA_VERSAO"
    return Decision(aceito, incerto, caminhos, motivo)


def has_accepted_receipt(entry_id, picks_version, rpc):
    """
    A pergunta canônica, respondida pelo banco. `rpc` é injetado (`m8m9._rpc` em produção, falso
    nos testes) — este módulo não abre conexão nenhuma.

    Falha fechada em TODOS os modos de falha: versão ausente, RPC inexistente, rede caída, forma
    de resposta inesperada. Sem resposta não há elegibilidade.
    """
    if not picks_version:
        return Decision(False, True, [], "VERSAO_AUSENTE: falha fechada")
    try:
        r = rpc("cdb_has_accepted_receipt",
                {"p_entry_id": entry_id, "p_picks_version": picks_version})
    except Exception as e:  # noqa: BLE001 — qualquer falha vira bloqueio, nunca liberação
        return Decision(False, True, [],
                        f"RPC_INDISPONIVEL ({type(e).__name__}): falha fechada")
    linha = (r[0] if isinstance(r, list) and r else r) or {}
    if not isinstance(linha, dict) or "accepted" not in linha:
        return Decision(False, True, [], f"RESPOSTA_INESPERADA {type(linha).__name__}: falha fechada")
    return Decision(linha.get("accepted"), linha.get("uncertain"),
                    linha.get("paths") or [], linha.get("reason") or "")


# ── LEITURA AUTORITATIVA DOS PALPITES (item 6 do endurecimento) ──────────────────────────────
#
# ═══ POR QUE ESTA FUNÇÃO EXISTE ═════════════════════════════════════════════════════════════
#
# Durante a perícia do incidente, um diagnóstico concluiu que vários participantes tinham palpites
# "só até as quartas". Ele contava confrontos REGISTRADOS (`phases[*].ties`), que vão até as
# quartas e param — semifinal e final não existem como confronto gravado enquanto a CBF não os
# materializa. O renderizador do comprovante, lendo o MESMO documento persistido, encontrou o
# chaveamento completo até a final.
#
# Nenhum dos dois estava com dado velho e nenhum dos dois estava com bug: o diagnóstico
# perguntava à fonte errada. `phases[*].ties` é autoritativo para "que confrontos a CBF já
# materializou" e não responde "até onde este participante palpitou" — isso só se responde
# resolvendo os confrontos VIRTUAIS (topologia + o `qualified` do próprio participante), que é o
# que `virtualDerivedTies()` faz no app.js e `ties_virtuais()` faz aqui.
#
# Classificação: WRONG_DIAGNOSTIC_SOURCE. Não é defeito de sincronização e a projeção pública não
# precisa mudar — quem tem de mudar é a ferramenta de operador, que passa a usar esta leitura.
def authoritative_pick_completeness(snapshot):
    """
    Até onde este participante palpitou, segundo o documento persistido — a MESMA resolução que o
    comprovante usa. Não conta confronto registrado; conta fase em que existe palpite, resolvendo
    semifinal e final virtualmente quando a CBF ainda não as materializou.
    """
    picks = snapshot.get("picks") or {}
    matches = picks.get("matches") or {}
    qualified = picks.get("qualified") or {}
    fases = snapshot.get("phases") or {}

    por_fase, com_palpite = {}, []
    for fid, nome, _ in R.FASES:
        reais = (fases.get(fid) or {}).get("ties") or {}
        confrontos = sorted(reais) if reais else [t for t, _ in R.ties_virtuais(snapshot, fid)]
        n = sum(1 for t in confrontos if matches.get(t) or qualified.get(t))
        por_fase[fid] = {"nome": nome, "confrontos": len(confrontos), "comPalpite": n,
                         "virtual": not reais and bool(confrontos)}
        if n:
            com_palpite.append(fid)

    campeao, vice = R.podio(snapshot)
    return {
        "porFase": por_fase,
        "fasesComPalpite": com_palpite,
        "ultimaFaseComPalpite": com_palpite[-1] if com_palpite else None,
        "chegaAteFinal": bool(campeao and vice),
        "campeao": campeao,
        "vice": vice,
        "confrontosRegistrados": sum(len((f or {}).get("ties") or {}) for f in fases.values()),
    }
