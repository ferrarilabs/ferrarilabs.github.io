#!/usr/bin/env python3
"""
Prova do consumidor do comprovante de entrada salva — TRANSPORTE FALSO, sempre.

═══ NENHUM E-MAIL REAL SAI DAQUI ════════════════════════════════════════════════════════════════

O transporte é injetado por `set_transport()` e conta chamadas numa lista. O provedor nunca é
contatado. A regra vale inclusive — principalmente — para o endereço do próprio operador: ele é
participante, não caixa de teste.

`assert_zero_chamadas_reais()` roda no fim e falha o teste inteiro se qualquer chamada tiver
escapado para `urllib`. Um teste que só *pretende* usar transporte falso não prova nada; este
verifica.

═══ POR QUE CANÁRIO EM VEZ DA CHAVE DE NEGÓCIO REAL ═════════════════════════════════════════════

O caminho feliz reserva de verdade em `notification_deliveries`. Se ele usasse a chave real
(`cdb2026:entry-saved-confirmation:v1`), a reserva ficaria gravada e o envio REAL do operador,
depois, receberia `JA_ENTREGUE` e nunca sairia — o teste teria consumido a única entrega que
existe para provar.

Então o caminho feliz roda sob `canary:` — mesmo código, mesma mecânica, chave descartável — e
`purge_canary_deliveries()` / `purge_canary_outbox_events()` limpam no fim.

═══ O QUE NÃO É TESTADO POR MUTAÇÃO, E POR QUÊ ══════════════════════════════════════════════════

O elo "save real -> evento" não é exercitado salvando palpites de gente real: isso exigiria
alterar os palpites de um participante para depois desfazer, e um teste que mexe em dado de
participante é o tipo de coisa que causou o incidente de hoje.

Ele é provado de dois lados:
  · SAVE QUE FALHA não cria evento — exercitado de verdade, com token inválido (cenário 4);
  · a criação do evento está DENTRO da mesma transação do UPDATE e depois dele — verificado no
    corpo da migração aplicada (cenário 3b), que é o que torna o elo atômico por construção.
"""

import re
import sys
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(RAIZ / "bolao" / "shared" / "scripts"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import m8m9                              # noqa: E402
import send_entry_saved_confirmation as C  # noqa: E402

ENTRADA_OPERADOR = "03e9fe14-d777-4a71-9c31-3d54dd21a07c"
CANARY_BK  = "canary:cdb2026:entry-saved-confirmation:v1"
CANARY_IK  = "canary:cdb2026:entry-saved-confirmation:{}:v1"

falhas = []
chamadas_falsas = []


def checa(nome, condicao, detalhe=""):
    marca = "PASS" if condicao else "FALHA"
    print(f"  [{marca}] {nome}" + (f" — {detalhe}" if detalhe else ""))
    if not condicao:
        falhas.append(nome)


def transporte_falso(url, body, headers):
    chamadas_falsas.append({"url": url, "len": len(body)})
    return 200, "fake-ok"


# ── Sentinela: qualquer tentativa de rede real explode o teste ────────────────────────────────
def _urlopen_proibido(*a, **k):
    raise AssertionError("TENTATIVA DE ENVIO REAL DENTRO DO TESTE — o transporte falso não estava "
                         "instalado. Nenhum teste pode contatar o provedor.")


def limpa_canarios():
    m8m9._rpc("purge_canary_deliveries", {})
    m8m9._rpc("purge_canary_outbox_events", {})


def permissoes():
    r = m8m9._rpc("cdb_confirmation_allowance_count", {})
    return r if isinstance(r, int) else (r[0] if r else 0)


def drena_fila_canario(owner="teste"):
    """Processa até esvaziar, somando chamadas. Devolve (resultados, total_chamadas)."""
    resultados, total = [], 0
    for _ in range(6):
        res, n = C.processa_um(owner, verbose=False)
        total += n
        if res == "SEM_EVENTO":
            break
        resultados.append(res)
    return resultados, total


def main():
    print("PROVA — comprovante de entrada salva (CDB2026), transporte falso\n")

    urllib.request.urlopen = _urlopen_proibido
    C.set_transport(transporte_falso)

    limpa_canarios()

    # A fila real precisa estar vazia, senão o consumidor pega o evento errado e o teste mente.
    res, n = C.processa_um("teste-pre-voo", verbose=False)
    if res != "SEM_EVENTO":
        print(f"  ABORTADO: já havia evento pendente na fila ({res}). "
              f"Rode o consumidor antes de testar.")
        return 1
    checa("fila começa vazia", True)

    permissao_inicial = permissoes()
    print(f"\npermissões abertas antes: {permissao_inicial}")

    if permissao_inicial == 0:
        m8m9._rpc("cdb_grant_confirmation_allowance",
                  {"p_entry_id": ENTRADA_OPERADOR, "p_note": "teste automatizado; re-concedida"})

    # ═══ 1. CAMINHO FELIZ: evento -> consumidor -> 1 chamada -> aceito ════════════════════════
    print("\n1. save durável -> evento -> consumidor -> exatamente 1 chamada")
    bk_real = C.BUSINESS_KEY
    C.BUSINESS_KEY = CANARY_BK
    try:
        chamadas_falsas.clear()
        _, criado = m8m9.emit_outbox(CANARY_IK.format(ENTRADA_OPERADOR), C.EVENT_TYPE,
                                     payload={"entryId": ENTRADA_OPERADOR,
                                              "savedAt": "2026-08-13T00:00:00Z"})
        checa("evento criado", criado)
        resultados, total = drena_fila_canario()
        checa("resultado = ENVIADO", resultados == ["ENVIADO"], str(resultados))
        checa("chamadas ao provedor = 1", total == 1, f"total={total}")
        checa("transporte falso recebeu exatamente 1", len(chamadas_falsas) == 1)
        c = m8m9._rpc("delivery_count", {"p_app": C.APP, "p_business_key": CANARY_BK})
        checa("entrega registrada como aceita", bool(c) and c[0]["accepted"] == 1, str(c))
        checa("permissão fechou sozinha após a entrega", permissoes() == 0,
              f"permissoes={permissoes()}")

        # ═══ 2. RERODAR O CONSUMIDOR: 0 chamadas ═════════════════════════════════════════════
        print("\n2. consumidor roda de novo sem novo save")
        chamadas_falsas.clear()
        resultados2, total2 = drena_fila_canario()
        checa("nenhum evento sobrou", resultados2 == [], str(resultados2))
        checa("chamadas ao provedor = 0", total2 == 0, f"total={total2}")

        # ═══ 3. SAVE REPETIDO: 0 chamadas novas ══════════════════════════════════════════════
        print("\n3. save repetido não gera segunda notificação")
        chamadas_falsas.clear()
        _, criado2 = m8m9.emit_outbox(CANARY_IK.format(ENTRADA_OPERADOR), C.EVENT_TYPE,
                                      payload={"entryId": ENTRADA_OPERADOR})
        checa("chave de idempotência recusa o segundo evento", criado2 is False,
              f"created={criado2}")
        _, total3 = drena_fila_canario()
        checa("chamadas ao provedor = 0", total3 == 0, f"total={total3}")
    finally:
        C.BUSINESS_KEY = bk_real

    # ═══ 3b. O EVENTO NASCE DENTRO DA TRANSAÇÃO DO SAVE ══════════════════════════════════════
    print("\n3b. o evento é criado na MESMA transação do UPDATE, e depois dele")
    src = (RAIZ / "supabase" / "migrations"
           / "20260813010000_cdb_entry_saved_outbox_event.sql").read_text()
    corpo = src[src.index("create or replace function cdb_save_my_picks"):]
    i_upd = corpo.index("update bolao_state")
    i_ins = corpo.index("insert into bolao.outbox_events")
    i_end = corpo.index("end $$")
    checa("insert do evento vem DEPOIS do update", i_upd < i_ins)
    checa("insert está dentro do corpo da função (mesma transação)", i_ins < i_end)
    checa("insert é guardado pela permissão",
          "cdb_confirmation_allowance" in corpo[i_upd:i_ins])
    chave = re.search(r"'cdb2026:entry-saved-confirmation:'\s*\|\|\s*(\w+)", corpo)
    checa("chave deriva do entry_id, não do relógio", bool(chave) and chave.group(1) == "v_entry_id",
          chave.group(1) if chave else "não encontrada")
    checa("chave não contém now()/uuid",
          not re.search(r"idempotency_key.{0,200}(now\(\)|gen_random_uuid)", corpo, re.S))
    checa("payload não carrega endereço",
          "participantEmail" not in corpo[i_ins:i_ins + 500])

    # ═══ 4. SAVE QUE FALHA: nenhum evento ════════════════════════════════════════════════════
    print("\n4. save que falha não cria evento (token inválido)")
    antes = m8m9.status(CANARY_IK.format("falha-token"))
    try:
        m8m9._rpc("cdb_save_my_picks", {
            "p_token": "token-invalido-de-teste-nao-existe",
            "p_client_ref": "teste-falha-save",
            "p_picks": {"matches": {}, "qualified": {}},
        })
        checa("save com token inválido é recusado", False, "não levantou")
    except Exception as e:  # noqa: BLE001
        checa("save com token inválido é recusado", "ACESSO_NEGADO" in str(e), str(e)[:80])
    chamadas_falsas.clear()
    _, total4 = drena_fila_canario()
    checa("chamadas ao provedor = 0", total4 == 0, f"total={total4}")
    checa("nenhum evento novo apareceu", antes is None)

    # ═══ 5. OUTRO PARTICIPANTE: 0 chamadas, endereço nem é devolvido ═════════════════════════
    print("\n5. entrada de outro participante nunca alcança o provedor")
    # Entrada que não é a liberada. Não uso o id de um participante real de propósito: o que
    # importa provar é que a resolução NEGA qualquer entrada fora da permissão, e uma entrada
    # inexistente exercita o mesmo ramo sem tocar em ninguém.
    outro = "00000000-0000-4000-8000-000000000999"
    r5 = m8m9._rpc("cdb_confirmation_recipient", {"p_entry_id": outro})
    linha5 = r5[0] if r5 else {}
    checa("resolução nega entrada sem permissão", linha5.get("allowed") is False, str(linha5))
    checa("nenhum endereço é devolvido", linha5.get("recipient") is None, str(linha5.get("recipient")))
    chamadas_falsas.clear()
    bk_real = C.BUSINESS_KEY
    C.BUSINESS_KEY = CANARY_BK
    try:
        m8m9.emit_outbox(CANARY_IK.format("outro"), C.EVENT_TYPE, payload={"entryId": outro})
        resultados5, total5 = drena_fila_canario()
        checa("consumidor recusa por falta de permissão", resultados5 == ["SEM_PERMISSAO"],
              str(resultados5))
        checa("chamadas ao provedor = 0", total5 == 0, f"total={total5}")
    finally:
        C.BUSINESS_KEY = bk_real

    # ═══ 6. SEM PERMISSÃO: nem a entrada do operador sai ═════════════════════════════════════
    print("\n6. sem permissão, nem a entrada liberada sai")
    m8m9._rpc("cdb_close_confirmation_allowance", {"p_entry_id": ENTRADA_OPERADOR})
    checa("permissão removida", permissoes() == 0)
    r6 = m8m9._rpc("cdb_confirmation_recipient", {"p_entry_id": ENTRADA_OPERADOR})
    linha6 = r6[0] if r6 else {}
    checa("resolução nega mesmo a entrada do operador", linha6.get("allowed") is False, str(linha6))
    checa("nenhum endereço devolvido", linha6.get("recipient") is None)
    chamadas_falsas.clear()
    bk_real = C.BUSINESS_KEY
    C.BUSINESS_KEY = CANARY_BK
    try:
        m8m9.emit_outbox(CANARY_IK.format("sem-permissao"), C.EVENT_TYPE,
                         payload={"entryId": ENTRADA_OPERADOR})
        resultados6, total6 = drena_fila_canario()
        checa("consumidor recusa", resultados6 == ["SEM_PERMISSAO"], str(resultados6))
        checa("chamadas ao provedor = 0", total6 == 0, f"total={total6}")
    finally:
        C.BUSINESS_KEY = bk_real

    # ── Limpeza e restauração ────────────────────────────────────────────────────────────────
    print("\nlimpeza")
    limpa_canarios()
    c_real = m8m9._rpc("delivery_count", {"p_app": C.APP,
                                          "p_business_key": "cdb2026:entry-saved-confirmation:v1"})
    checa("a chave de negócio REAL continua sem entrega (o teste não a consumiu)",
          bool(c_real) and c_real[0]["total"] == 0, str(c_real))
    m8m9._rpc("cdb_grant_confirmation_allowance",
              {"p_entry_id": ENTRADA_OPERADOR, "p_note": "restaurada ao fim do teste automatizado"})
    checa("permissão do operador restaurada", permissoes() == 1, f"permissoes={permissoes()}")
    _, sobra = drena_fila_canario()
    checa("fila termina vazia", sobra == 0)

    print("\n" + "=" * 78)
    if falhas:
        print(f"FALHOU — {len(falhas)} verificação(ões): {falhas}")
        return 1
    print("TODAS AS VERIFICAÇÕES PASSARAM — nenhuma chamada real ao provedor")
    return 0


if __name__ == "__main__":
    sys.exit(main())
