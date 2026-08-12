#!/usr/bin/env python3
"""COPA2026 — operacoes de operador do lado do servidor.

POR QUE ESTE ARQUIVO EXISTE
---------------------------
COPA-IDENTITY, opcao (b): runtime confiavel com service_role.

O inventario de contrato provou que TODO `admin_only` do copa2026 e uma guarda de INTERFACE. O
navegador carrega a MESMA chave anon publica que qualquer visitante e nunca se autentica, de modo
que o banco nao consegue distinguir um administrador de um visitante. As RPCs privilegiadas
(`op_*`, `copa_apply_operator_mutation`) sao concedidas so a service_role -- e conceder a anon
seria exposicao MAIOR, nao menor, porque sao SECURITY DEFINER e passam por cima da RLS.

Este CLI e o unico caminho por onde uma mutacao administrativa do copa2026 chega ao banco.

EM QUE ELE DIFERE DO CLI DO CDB2026
-----------------------------------
O CLI do cdb2026 faz leitura-modificacao-escrita e grava com PATCH do documento. Aqui isso NAO
acontece: cada comando chama uma RPC que aplica um caminho jsonb estreito no servidor, sob `for
update`, com idempotencia por client_ref. Nao ha PATCH, nao ha upsert, nao ha documento saindo
daqui. A diferenca e deliberada -- o cdb2026 precisou do caminho amplo porque sua RPC nao cobria
criar confronto; a do copa2026 cobre tudo que o copa2026 precisa.

O QUE ELE DELIBERADAMENTE NAO EXPOE
-----------------------------------
  loadDemoData        escreve participantes sinteticos num bolao com dinheiro real. Classificado
                      como algo a REMOVER, nao a migrar.
  criar entrada       `submit_entry` e o caminho anonimo, e o prazo do copa2026 venceu em
                      2026-07-04. Um comando de operador para criar entrada seria uma regra de
                      negocio nova.
  publicar results{}  `op_set_results` substitui o mapa INTEIRO. Varios resultados sao varias
                      chamadas `set-result`, cada uma estreita e idempotente. Um comando que
                      aceita o mapa completo e um upsert de documento com outro nome.

Uso:
    SUPABASE_SERVICE_ROLE_KEY=... python3 operator_cli.py snapshot
    ... operator_cli.py set-payment --entry e_abc --paid true --dry-run
    ... operator_cli.py set-result --match 88 --goals-a 2 --goals-b 1 --apply
"""
import argparse
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

SUPABASE = "https://cmhqkkfczotdnssupkni.supabase.co"

# ISOLAMENTO ENTRE PRODUTOS. Constante, nunca um argumento.
#
# `op_confirm_payment` e `op_remove_entry` recebem p_pool_id e NAO tem lista branca -- elas
# gravam no bolao que o parametro nomear. Se este CLI aceitasse `--pool`, um erro de digitacao
# marcaria pagamento no br2026 a partir da ferramenta do copa2026. A barreira mora aqui.
STATE_ID = "main"
PRODUTO = "copa2026"


def _key():
    """A credencial vem SO do ambiente, e nunca sai daqui.

    Nao e impressa, nao entra em argv (visivel em `ps`), nao vai para arquivo, nao aparece em
    mensagem de erro. O unico sinal externo e a sua ausencia.
    """
    k = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not k:
        print("🛑 SUPABASE_SERVICE_ROLE_KEY ausente — este CLI so roda em ambiente confiavel.")
        sys.exit(2)
    return k


def _req(metodo, caminho, corpo=None, extra=None):
    k = _key()
    h = {"apikey": k, "Authorization": f"Bearer {k}", "Content-Type": "application/json"}
    h.update(extra or {})
    dados = json.dumps(corpo).encode() if corpo is not None else None
    r = urllib.request.Request(f"{SUPABASE}{caminho}", data=dados, headers=h, method=metodo)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            txt = resp.read().decode()
            return resp.status, (json.loads(txt) if txt.strip() else None)
    except urllib.error.HTTPError as e:
        # O corpo do erro do PostgREST traz a mensagem do RAISE, que e o diagnostico util. Ele
        # nunca contem a credencial -- mas o cabecalho conteria, e por isso so o corpo e lido.
        detalhe = e.read().decode()[:400]
        print(f"🛑 HTTP {e.code}: {detalhe}")
        sys.exit(2)


def rpc(nome, args):
    """Chamada de RPC. NENHUM comando aqui grava a tabela diretamente."""
    _, d = _req("POST", f"/rest/v1/rpc/{nome}", args)
    return d


def le_estado():
    _, d = _req("GET", f"/rest/v1/bolao_state?id=eq.{STATE_ID}&select=state")
    if not d:
        print(f"🛑 estado do {PRODUTO} ({STATE_ID}) inexistente.")
        sys.exit(2)
    return d[0]["state"]


def _hash(o):
    return hashlib.sha256(json.dumps(o, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]


def invariantes(estado):
    """Fatos que NENHUM comando pode alterar por efeito colateral.

    Sem nome, sem e-mail, sem paymentTo: contagens e hashes bastam para detectar uma alteracao e
    nao carregam PII para o log do CI.
    """
    entradas = estado.get("entries") or []
    return {
        "entries": len(entradas),
        "paidTrue": sum(1 for v in (estado.get("paid") or {}).values() if v),
        "results": len(estado.get("results") or {}),
        "deletedIds": len(estado.get("deletedIds") or []),
        "deletedResults": len(estado.get("deletedResults") or []),
        "picksHash": _hash(sorted([(e.get("id"), _hash(e.get("picks") or {})) for e in entradas])),
        "moneyHash": _hash(sorted([(e.get("id"), e.get("paymentMethod"), e.get("paymentTo"))
                                   for e in entradas])),
    }


def compara(antes, depois, permitido):
    """Diferenca fora do que o comando declarou mudar e ABORTO, nao aviso."""
    return [f"{k}: {antes[k]} -> {depois[k]}"
            for k in antes if k not in permitido and antes[k] != depois[k]]


def imprime(rot, inv):
    print(f"  {rot}")
    print(f"    entries={inv['entries']} paidTrue={inv['paidTrue']} results={inv['results']} "
          f"deletedIds={inv['deletedIds']} deletedResults={inv['deletedResults']}")
    print(f"    picks={inv['picksHash']} money={inv['moneyHash']}")


def ref(entry_id):
    """Identificador SANITIZADO para log. Um id de entrada e opaco; um nome nao e."""
    return (entry_id or "")[:10] + "…"


def client_ref(comando, chave):
    """Idempotencia: o mesmo comando com o mesmo alvo reenviado nao aplica duas vezes.

    Deliberadamente DETERMINISTICO e sem relogio. Um uuid novo a cada tentativa transformaria um
    retry de rede -- o caso em que nao se sabe se a primeira chamada chegou -- em segunda
    aplicacao, que e exatamente o que a idempotencia existe para impedir.
    """
    return f"copa-cli:{comando}:{chave}"


def executa(a, comando, alvo, chamada, permitido, verifica):
    """Envelope comum: baseline -> dry-run ou aplica -> re-le -> compara invariantes.

    `verifica` recebe o estado depois e devolve uma lista de problemas especificos do comando.
    Invariante violada OU verificacao falha => codigo de saida 2, sempre.
    """
    antes_estado = le_estado()
    antes = invariantes(antes_estado)
    print("=" * 70)
    print(f"  COPA2026 — {comando}   alvo={alvo}")
    print("=" * 70)
    imprime("antes", antes)

    if not a.apply:
        print(f"\n  DRY-RUN — nada foi gravado. Repita com --apply.")
        print(f"    chamaria: {chamada['fn']}  clientRef={chamada['args'].get('p_client_ref', '(n/a)')}")
        print("=" * 70)
        return 0

    resposta = rpc(chamada["fn"], chamada["args"])
    print(f"\n  resposta: {json.dumps(resposta, ensure_ascii=False)}")

    depois_estado = le_estado()
    depois = invariantes(depois_estado)
    imprime("depois", depois)

    problemas = compara(antes, depois, permitido)
    problemas += verifica(depois_estado) or []
    if problemas:
        print(f"\n  🛑 INVARIANTES VIOLADAS: {problemas}")
        print("=" * 70)
        return 2
    print(f"\n  ✓ {comando} aplicado")
    print("=" * 70)
    return 0


# ── comandos ───────────────────────────────────────────────────────────────────────────────────
def cmd_snapshot(a):
    estado = le_estado()
    inv = invariantes(estado)
    print("=" * 70)
    print(f"  COPA2026 — BASELINE DE PRODUCAO ({STATE_ID})")
    print("=" * 70)
    imprime("estado atual", inv)
    if a.out:
        # PII: o estado bruto tem e-mail, payerName e paymentTo. Vai para o workspace privado,
        # NUNCA para o repositorio -- e o caminho e recusado se apontar para dentro dele.
        destino = os.path.abspath(a.out)
        raiz_repo = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
        if destino.startswith(raiz_repo + os.sep):
            print(f"🛑 --out aponta para dentro do repositorio ({destino}). O estado bruto tem PII.")
            return 2
        os.makedirs(os.path.dirname(destino), exist_ok=True)
        with open(destino, "w", encoding="utf-8") as fh:
            json.dump({"capturedAt": datetime.now(timezone.utc).isoformat(),
                       "invariants": inv, "state": estado}, fh, ensure_ascii=False, indent=1)
        print(f"\n  baseline gravada em {destino}")
    print("=" * 70)
    return 0


def cmd_set_payment(a):
    pago = a.paid == "true"
    return executa(
        a, "set-payment", ref(a.entry),
        {"fn": "op_confirm_payment",
         "args": {"p_pool_id": STATE_ID, "p_entry_ref": a.entry, "p_paid": pago}},
        permitido={"paidTrue"},
        verifica=lambda s: ([] if bool((s.get("paid") or {}).get(a.entry)) == pago
                            else [f"paid[{ref(a.entry)}] nao gravou"]))


def cmd_set_result(a):
    resultado = {"goalsA": a.goals_a, "goalsB": a.goals_b}
    if a.advance_side:
        resultado["advanceSide"] = a.advance_side
    return executa(
        a, "set-result", f"match {a.match}",
        {"fn": "copa_apply_operator_mutation",
         "args": {"p_type": "set-result",
                  "p_payload": {"matchId": a.match, "result": resultado},
                  "p_actor": a.actor, "p_client_ref": client_ref("set-result", f"{a.match}:{_hash(resultado)}")}},
        permitido={"results", "deletedResults"},
        verifica=lambda s: ([] if (s.get("results") or {}).get(a.match, {}).get("goalsA") == a.goals_a
                            else [f"results[{a.match}] nao gravou"]))


def cmd_clear_result(a):
    return executa(
        a, "clear-result", f"match {a.match}",
        {"fn": "copa_apply_operator_mutation",
         "args": {"p_type": "clear-result", "p_payload": {"matchId": a.match},
                  "p_actor": a.actor, "p_client_ref": client_ref("clear-result", a.match)}},
        permitido={"results", "deletedResults"},
        verifica=lambda s: ([] if a.match not in (s.get("results") or {})
                            else [f"results[{a.match}] continua presente"]))


def cmd_update_entry(a):
    campos = {k: v for k, v in {
        "entryName": a.entry_name, "participantEmail": a.email, "payerName": a.payer_name,
        "paymentMethod": a.payment_method, "paymentTo": a.payment_to,
    }.items() if v is not None}
    if not campos:
        print("🛑 nenhum campo para atualizar.")
        return 2
    campos["entryId"] = a.entry
    return executa(
        a, "update-entry", ref(a.entry),
        {"fn": "copa_apply_operator_mutation",
         "args": {"p_type": "update-entry", "p_payload": campos, "p_actor": a.actor,
                  "p_client_ref": client_ref("update-entry", f"{a.entry}:{_hash(campos)}")}},
        # `moneyHash` MUDA por desenho aqui: e o unico comando autorizado a mexer em
        # paymentMethod/paymentTo, e e a correcao do defeito em que editar a entrada trocava o
        # metodo e deixava o destino antigo.
        permitido={"moneyHash"},
        verifica=lambda s: [])


def cmd_remove_entry(a):
    return executa(
        a, "remove-entry", ref(a.entry),
        {"fn": "op_remove_entry", "args": {"p_pool_id": STATE_ID, "p_entry_ref": a.entry}},
        permitido={"deletedIds"},
        verifica=lambda s: ([] if a.entry in (s.get("deletedIds") or [])
                            else [f"deletedIds nao recebeu {ref(a.entry)}"]))


def cmd_clear_all(a):
    # DESTRUTIVO. Alem de --apply exige --i-understand-this-wipes-the-pool, porque um comando que
    # apaga um bolao inteiro nao pode ter a mesma cerimonia de marcar um pagamento.
    if not a.i_understand_this_wipes_the_pool:
        print("🛑 clear-all exige --i-understand-this-wipes-the-pool.")
        return 2
    return executa(
        a, "clear-all", STATE_ID,
        {"fn": "copa_apply_operator_mutation",
         "args": {"p_type": "clear-all", "p_payload": {}, "p_actor": a.actor,
                  "p_client_ref": client_ref("clear-all", a.confirm_ref)}},
        # Uma limpeza muda quase tudo -- por isso as LAPIDES sao verificadas explicitamente
        # abaixo em vez de ficarem no conjunto permitido: preservar deletedIds e deletedResults e
        # a correcao, e uma correcao que nao e verificada e uma intencao.
        permitido={"entries", "paidTrue", "results", "picksHash", "moneyHash"},
        verifica=lambda s: [])


def main():
    p = argparse.ArgumentParser(description="COPA2026 operator CLI (trusted runtime, service_role)")
    sub = p.add_subparsers(dest="cmd", required=True)

    def mut(nome):
        c = sub.add_parser(nome)
        c.add_argument("--actor", default="operator-cli")
        c.add_argument("--dry-run", action="store_true")
        c.add_argument("--apply", action="store_true")
        return c

    s = sub.add_parser("snapshot"); s.add_argument("--out", default=None)

    c = mut("set-payment"); c.add_argument("--entry", required=True)
    c.add_argument("--paid", required=True, choices=["true", "false"])

    c = mut("set-result"); c.add_argument("--match", required=True)
    c.add_argument("--goals-a", required=True, type=int); c.add_argument("--goals-b", required=True, type=int)
    c.add_argument("--advance-side", default=None, choices=["A", "B"])

    c = mut("clear-result"); c.add_argument("--match", required=True)

    c = mut("update-entry"); c.add_argument("--entry", required=True)
    for f in ("entry-name", "email", "payer-name", "payment-method", "payment-to"):
        c.add_argument(f"--{f}", default=None)

    c = mut("remove-entry"); c.add_argument("--entry", required=True)

    c = mut("clear-all")
    c.add_argument("--i-understand-this-wipes-the-pool", action="store_true")
    c.add_argument("--confirm-ref", required=True, help="identificador da decisao, para idempotencia")

    a = p.parse_args()
    if a.cmd != "snapshot" and not (a.dry_run or a.apply):
        p.error("escolha --dry-run ou --apply")
    if a.cmd != "snapshot" and a.dry_run and a.apply:
        p.error("--dry-run e --apply sao mutuamente exclusivos")

    return {
        "snapshot": cmd_snapshot, "set-payment": cmd_set_payment, "set-result": cmd_set_result,
        "clear-result": cmd_clear_result, "update-entry": cmd_update_entry,
        "remove-entry": cmd_remove_entry, "clear-all": cmd_clear_all,
    }[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
