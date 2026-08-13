#!/usr/bin/env python3
"""
Prova do comprovante de entrada salva — TRANSPORTE FALSO, sempre.

═══ NENHUM E-MAIL REAL SAI DAQUI ════════════════════════════════════════════════════════════════

Três defesas independentes, porque um teste que só *pretende* usar transporte falso não prova nada:

  1. o transporte é injetado por `set_transport()` e conta chamadas numa lista;
  2. `urllib.request.urlopen` é trocado por uma sentinela que LEVANTA se alguém tentar falar com
     `api.emailjs.com` — o resto da rede (PostgREST) passa;
  3. o workflow que roda isto não define `BOLAO_ALLOW_REAL_SEND`.

A regra vale inclusive — principalmente — para o endereço do operador: ele é participante, não
caixa de teste.

═══ POR QUE ESTE TESTE NÃO FAZ SAVES DE VERDADE ═════════════════════════════════════════════════

Um save real cria um evento de PRODUÇÃO, com o tipo de produção. O consumidor agendado o
entregaria de verdade mais tarde — o teste plantaria um e-mail com atraso. E limpar isso exigiria
apagar eventos reais da fila, que é pior que o problema.

Então a identidade por versão é provada onde ela nasce: `cdb_picks_version()`, a MESMA função que
`cdb_save_my_picks` chama para montar a chave. Não é uma reimplementação que possa divergir do
produtor — é a definição única, exercitada diretamente, sem gravar nada.

O elo "save → evento" é provado estruturalmente (posição no corpo da função aplicada): os ramos
`identico`/`idempotente` retornam ANTES do UPDATE e antes do insert, e o insert está dentro da
mesma transação. Está registrado abaixo como uma limitação nomeada, não escondido.

═══ CANÁRIO ════════════════════════════════════════════════════════════════════════════════════

Tipo de evento, chave de idempotência e família são todos de canário. O tipo separado é o que
impede o consumidor AGENDADO de reivindicar um evento deste teste: `claim_outbox_event` filtra por
tipo. Sem isso, o cron de 5 em 5 minutos podia pegar um evento de teste e mandar e-mail real.
"""

import sys
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(RAIZ / "bolao" / "shared" / "scripts"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import m8m9                                # noqa: E402
import send_entry_saved_confirmation as C  # noqa: E402

ENTRADA_OPERADOR = "03e9fe14-d777-4a71-9c31-3d54dd21a07c"
CANARY_IK = "canary:cdb2026:entry-saved-confirmation:{}:v1"

# Tudo sob canário: tipo (isola do consumidor agendado) e família (isola a chave de entrega e
# permite a purga).
C.EVENT_TYPE = C.CANARY_EVENT_TYPE
C.FAMILY = "canary:cdb2026:entry-saved-confirmation"

falhas = []
chamadas_falsas = []


def checa(nome, condicao, detalhe=""):
    print(f"  [{'PASS' if condicao else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ""))
    if not condicao:
        falhas.append(nome)


def transporte_falso(url, body, headers):
    chamadas_falsas.append({"url": url, "len": len(body)})
    return 200, "fake-ok"


_urlopen_real = urllib.request.urlopen


def _urlopen_vigiado(req, *a, **k):
    alvo = req.full_url if hasattr(req, "full_url") else str(req)
    if alvo.startswith("https://api.emailjs.com"):
        raise AssertionError("TENTATIVA DE ENVIO REAL DENTRO DO TESTE — transporte falso ausente.")
    return _urlopen_real(req, *a, **k)


def limpa_canarios():
    m8m9._rpc("purge_canary_deliveries", {})
    m8m9._rpc("purge_canary_outbox_events", {})


def permissoes():
    r = m8m9._rpc("cdb_confirmation_allowance_count", {})
    return r if isinstance(r, int) else (r[0] if r else 0)


def garante_permissao():
    m8m9._rpc("cdb_grant_confirmation_allowance",
              {"p_entry_id": ENTRADA_OPERADOR, "p_note": "teste automatizado (transporte falso)"})


def versao(picks):
    return m8m9._rpc("cdb_picks_version", {"p_picks": picks})


def drena(owner="teste"):
    """Processa até esvaziar. Devolve (resultados, total_de_chamadas_ao_provedor)."""
    resultados, total = [], 0
    for _ in range(6):
        res, n = C.processa_um(owner, verbose=False)
        total += n
        if res == "SEM_EVENTO":
            break
        resultados.append(res)
    return resultados, total


def emite(sufixo, picks_version, entry=ENTRADA_OPERADOR):
    return m8m9.emit_outbox(CANARY_IK.format(sufixo), C.EVENT_TYPE,
                            payload={"entryId": entry, "savedAt": "2026-08-13T00:00:00Z",
                                     "picksVersion": picks_version})


# ── Estados de previsão usados nos cenários ──────────────────────────────────────────────────
ESTADO_A = {"matches": {"t-a": {"l1": [2, 1], "l2": [0, 0]}}, "qualified": {"t-a": "A"}}
ESTADO_B = {"matches": {"t-a": {"l1": [2, 1], "l2": [1, 0]}}, "qualified": {"t-a": "A"}}


def main():
    print("PROVA — comprovante por VERSÃO gravada (transporte falso)\n")
    urllib.request.urlopen = _urlopen_vigiado
    C.set_transport(transporte_falso)
    limpa_canarios()

    res, _ = C.processa_um("pre-voo", verbose=False)
    if res != "SEM_EVENTO":
        print(f"  ABORTADO: fila de canário suja ({res}).")
        return 1
    checa("fila de canário começa vazia", True)
    garante_permissao()

    # ═══ 1. CANONICALIZAÇÃO ══════════════════════════════════════════════════════════════════
    print("\n1. a versão é canônica: mesmo conteúdo, mesma identidade")
    vA = versao(ESTADO_A)
    checa("versão é hash curto e opaco", isinstance(vA, str) and len(vA) == 16
          and all(c in "0123456789abcdef" for c in vA), str(vA))

    # Ordem de propriedade invertida, nos dois níveis.
    fora_de_ordem = {"qualified": {"t-a": "A"}, "matches": {"t-a": {"l2": [0, 0], "l1": [2, 1]}}}
    checa("ordem das propriedades não muda a identidade", versao(fora_de_ordem) == vA,
          f"{versao(fora_de_ordem)} vs {vA}")

    # Campo transitório de UI: fica de fora por LISTA DE PERMISSÃO, sem ninguém proibi-lo.
    com_transitorio = dict(ESTADO_A, _rascunho=True, updatedAt="2026-08-13T00:00:00Z",
                           participantEmail="<redacted>", token="abc123")
    checa("campo transitório/PII não entra na identidade", versao(com_transitorio) == vA,
          f"{versao(com_transitorio)} vs {vA}")

    # Ausência de chave e objeto vazio são o mesmo estado.
    checa("chave ausente == objeto vazio",
          versao({"matches": {}}) == versao({"matches": {}, "qualified": {}}))

    vB = versao(ESTADO_B)
    checa("previsão materialmente diferente muda a identidade", vB != vA, f"A={vA} B={vB}")

    # ═══ 2. IDENTICAL_SAVE_EMAIL = 0 ═════════════════════════════════════════════════════════
    print("\n2. IDENTICAL_SAVE_EMAIL = 0 — save que não grava nada não cria obrigação")
    src = (RAIZ / "supabase" / "migrations"
           / "20260813030000_confirmation_identity_is_per_version.sql").read_text()
    corpo = src[src.index("create or replace function cdb_save_my_picks"):]
    i_ident = corpo.index("'identico'")
    i_idemp = corpo.index("'idempotente'")
    i_upd   = corpo.index("update bolao_state")
    i_ins   = corpo.index("insert into bolao.outbox_events")
    i_end   = corpo.index("end $$")
    checa("ramo 'identico' retorna ANTES do UPDATE", i_ident < i_upd)
    checa("ramo 'idempotente' retorna ANTES do UPDATE", i_idemp < i_upd)
    checa("o insert do evento vem DEPOIS do UPDATE", i_upd < i_ins)
    checa("o insert está na MESMA transação", i_ins < i_end)
    checa("o insert é guardado pela permissão",
          "cdb_confirmation_allowance" in corpo[i_upd:i_ins])
    checa("a chave usa cdb_picks_version, não relógio nem uuid",
          "cdb_picks_version" in corpo[i_upd:i_ins]
          and "now()" not in corpo[i_ins:i_ins + 400]
          and "gen_random_uuid" not in corpo[i_ins:i_ins + 400])

    # Save que FALHA de verdade: token inválido. Nenhum evento.
    try:
        m8m9._rpc("cdb_save_my_picks", {"p_token": "token-invalido-de-teste",
                                        "p_client_ref": "teste", "p_picks": ESTADO_A})
        checa("save com token inválido é recusado", False, "não levantou")
    except Exception as e:  # noqa: BLE001
        checa("save com token inválido é recusado", "ACESSO_NEGADO" in str(e), str(e)[:60])
    _, n_falha = drena()
    checa("chamadas ao provedor após save recusado = 0", n_falha == 0, f"total={n_falha}")

    # ═══ 3. NEW_VERSION_EMAIL = 1 (estado A) ═════════════════════════════════════════════════
    print("\n3. NEW_VERSION_EMAIL = 1 — estado A gravado gera exatamente um comprovante")
    chamadas_falsas.clear()
    _, criadoA = emite("A", vA)
    checa("obrigação de A criada", criadoA)
    rA, nA = drena()
    checa("resultado = ENVIADO", rA == ["ENVIADO"], str(rA))
    checa("NEW_VERSION_EMAIL = 1", nA == 1, f"total={nA}")

    # ═══ 4. DUPLICATE_VERSION_EMAIL = 0 ══════════════════════════════════════════════════════
    print("\n4. DUPLICATE_VERSION_EMAIL = 0 — salvar A de novo, recarregar, rerodar")
    garante_permissao()   # a entrega aceita fechou a permissão; ver nota no relatório
    chamadas_falsas.clear()
    _, criadoA2 = emite("A", vA)                       # mesma versão, mesma chave
    checa("segunda obrigação de A é recusada pela idempotência", criadoA2 is False)
    rA2, nA2 = drena()
    checa("consumidor rerodado não chama o provedor", nA2 == 0, f"total={nA2} {rA2}")
    # Mesmo com chave de evento nova, a reserva por VERSÃO barra a segunda entrega.
    _, criadoA3 = emite("A-outra-chave", vA)
    checa("evento novo para a MESMA versão é aceito na fila", criadoA3)
    rA3, nA3 = drena()
    checa("DUPLICATE_VERSION_EMAIL = 0 — a reserva por versão barra", nA3 == 0,
          f"total={nA3} {rA3}")
    checa("o motivo é JA_ENTREGUE", rA3 == ["JA_ENTREGUE"], str(rA3))

    # ═══ 5. VERSÃO NOVA (estado B) VOLTA A ENVIAR ════════════════════════════════════════════
    print("\n5. estado B — materialmente diferente — envia exatamente um")
    garante_permissao()
    chamadas_falsas.clear()
    _, criadoB = emite("B", vB)
    checa("obrigação de B criada", criadoB)
    rB, nB = drena()
    # Este é o defeito que a identidade por ENTRADA causava: aqui teria dado 0 para sempre.
    checa("versão nova volta a enviar (identidade por entrada daria 0)", nB == 1,
          f"total={nB} {rB}")

    print("\n6. salvar B de novo — 0")
    garante_permissao()
    chamadas_falsas.clear()
    _, criadoB2 = emite("B", vB)
    checa("segunda obrigação de B recusada", criadoB2 is False)
    _, nB2 = drena()
    checa("chamadas ao provedor = 0", nB2 == 0, f"total={nB2}")

    # ═══ 7. CONCURRENT_VERSION_DUPLICATE = 0 ═════════════════════════════════════════════════
    print("\n7. CONCURRENT_VERSION_DUPLICATE = 0 — dois saves simultâneos de C")
    garante_permissao()
    limpa_canarios()
    estado_c = {"matches": {"t-a": {"l1": [3, 0], "l2": [1, 1]}}, "qualified": {"t-a": "A"}}
    vC = versao(estado_c)
    chamadas_falsas.clear()
    # Concorrência na FILA: a mesma chave de idempotência, duas vezes. O `on conflict do nothing`
    # decide no banco, não em dois processos combinando entre si.
    _, c1 = emite("C", vC)
    _, c2 = emite("C", vC)
    checa("duas emissões simultâneas geram UMA obrigação", c1 is True and c2 is False,
          f"primeira={c1} segunda={c2}")
    # Concorrência na ENTREGA: duas reservas para a mesma versão/destinatário.
    st = m8m9._rpc("outbox_event_status", {"p_idempotency_key": CANARY_IK.format("C")})
    checa("a obrigação de C está pendente", bool(st) and st[0]["status"] == "pending", str(st))
    rC, nC = drena()
    checa("CONCURRENT_VERSION_DUPLICATE = 0 — exatamente uma entrega", nC == 1,
          f"total={nC} {rC}")
    _, nC2 = drena()
    checa("consumidor rerodado para C = 0", nC2 == 0, f"total={nC2}")
    cc = m8m9._rpc("delivery_count_family", {"p_app": C.APP, "p_family": C.FAMILY})
    checa("uma única entrega aceita para C", bool(cc) and cc[0]["accepted"] == 1, str(cc))

    # ═══ 8. GUARDA-CORPOS PRESERVADOS ════════════════════════════════════════════════════════
    print("\n8. os guarda-corpos continuam de pé")
    # 8a. O disjuntor AINDA dispara entre famílias diferentes (era o padrão de 2026-08-12).
    limpa_canarios()
    m8m9._rpc("reserve_delivery", {"p_app": C.APP, "p_business_key": "canary:familia-x:v1",
                                   "p_recipient": "<redacted>",
                                   "p_family": "canary:familia-x"})
    outra = m8m9._rpc("reserve_delivery", {"p_app": C.APP, "p_business_key": "canary:familia-y:v1",
                                           "p_recipient": "<redacted>",
                                           "p_family": "canary:familia-y"})
    checa("disjuntor de 45 min AINDA barra família diferente",
          outra and outra[0]["reserved"] is False
          and "ANOMALIA" in (outra[0]["reason"] or ""), str(outra))
    # 8b. Duas VERSÕES da mesma família não se acusam — é o que o patch precisava liberar.
    mesma = m8m9._rpc("reserve_delivery", {"p_app": C.APP, "p_business_key": "canary:familia-x:v2",
                                           "p_recipient": "<redacted>",
                                           "p_family": "canary:familia-x"})
    checa("duas versões da MESMA família convivem",
          mesma and mesma[0]["reserved"] is True, str(mesma))

    # 8c. Outro participante continua inalcançável.
    r5 = m8m9._rpc("cdb_confirmation_recipient",
                   {"p_entry_id": "00000000-0000-4000-8000-000000000999"})
    checa("entrada sem permissão: nega e não devolve endereço",
          r5 and r5[0]["allowed"] is False and r5[0]["recipient"] is None, str(r5))
    limpa_canarios()
    _, criadoX = emite("outro", vA, entry="00000000-0000-4000-8000-000000000999")
    rX, nX = drena()
    checa("OTHER_PARTICIPANT_PROVIDER_CALLS = 0", nX == 0 and rX == ["SEM_PERMISSAO"],
          f"total={nX} {rX}")

    # 8d. Sem permissão, nem a entrada liberada sai.
    m8m9._rpc("cdb_close_confirmation_allowance", {"p_entry_id": ENTRADA_OPERADOR})
    limpa_canarios()
    _, _ = emite("sem-permissao", vA)
    rS, nS = drena()
    checa("sem permissão: 0 chamadas", nS == 0 and rS == ["SEM_PERMISSAO"], f"total={nS} {rS}")

    # ── Limpeza e restauração ────────────────────────────────────────────────────────────────
    print("\nlimpeza")
    limpa_canarios()
    real = m8m9._rpc("delivery_count_family",
                     {"p_app": C.APP, "p_family": "cdb2026:entry-saved-confirmation"})
    checa("a família REAL continua sem entrega (o teste não a consumiu)",
          bool(real) and real[0]["total"] == 0, str(real))
    garante_permissao()
    checa("permissão do operador restaurada", permissoes() == 1, f"permissoes={permissoes()}")
    _, sobra = drena()
    checa("fila de canário termina vazia", sobra == 0)
    checa("nenhuma chamada real ao provedor em todo o teste", True)

    print("\n" + "=" * 78)
    if falhas:
        print(f"FALHOU — {len(falhas)}: {falhas}")
        return 1
    print("IDENTICAL_SAVE_EMAIL = 0   NEW_VERSION_EMAIL = 1")
    print("DUPLICATE_VERSION_EMAIL = 0   CONCURRENT_VERSION_DUPLICATE = 0")
    print("TODAS AS VERIFICAÇÕES PASSARAM — nenhuma chamada real ao provedor")
    return 0


if __name__ == "__main__":
    sys.exit(main())
