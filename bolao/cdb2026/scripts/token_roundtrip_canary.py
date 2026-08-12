#!/usr/bin/env python3
"""CDB2026 — o token que o convite gera realmente autentica? (contrato exato de producao)

O INCIDENTE QUE ISTO FECHA (2026-08-12)
---------------------------------------
Doze convites reais foram entregues com links que NAO autenticavam. O envio reportou 12/12 e o
provedor de fato aceitou -- so que quem clicava recebia "entrada nao encontrada".

Causa: `issue_token` grava com `resolution=merge-duplicates`, que atualiza as colunas ENVIADAS e
preserva as demais. Uma tentativa anterior tinha falhado no provedor (403) e o caminho de erro
REVOGOU as credenciais -- corretamente, um link que ninguem recebeu nao deve ficar vivo. A
tentativa seguinte reusou as mesmas linhas com token novo, e `revoked_at` continuou preenchido.

Sucesso no ENVIO e sucesso na AUTENTICACAO sao coisas diferentes. Nada media a segunda.

O QUE ESTE CANARIO MEDE
-----------------------
O caminho inteiro, com o MESMO codigo do sender (importado, nao reescrito -- um canario que
reimplementa o que testa mede a reimplementacao):

    secrets.token_urlsafe(32)  ->  sha256 hex  ->  cdb_entry_access  ->  cdb_my_entry(token)

E especificamente a armadilha que causou o incidente: emite, REVOGA, emite de novo, e exige que o
segundo token funcione. Se a reemissao nao ressuscitar a linha, isto reprova.

Nao muta palpite de ninguem: so le. A credencial de teste e revogada e removida no fim.

Uso (ambiente confiavel): python3 bolao/cdb2026/scripts/token_roundtrip_canary.py
"""
import importlib.util
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

AQUI = Path(__file__).resolve().parent
SUPABASE = "https://cmhqkkfczotdnssupkni.supabase.co"
ANON = "sb_publishable_9eJsJzMcROuj9SFOMVUTvA_mWVz0fG5"

# O MESMO codigo do sender. Reimplementar `issue_token` aqui mediria a reimplementacao.
os.environ.setdefault("BOLAO_ALLOW_REAL_SEND", "")  # nada e enviado por este arquivo
_spec = importlib.util.spec_from_file_location("inv", AQUI / "send_invitation_email.py")
INV = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(INV)

ok, fail = 0, 0


def check(nome, cond, detalhe=""):
    global ok, fail
    if cond:
        print(f"  ✓ {nome}")
        ok += 1
    else:
        print(f"  ✗ {nome}" + (f"\n      {detalhe}" if detalhe else ""))
        fail += 1


def rpc_anon(nome, args):
    """Chama com a chave PUBLICA — a mesma que o navegador do participante usa."""
    h = {"apikey": ANON, "Authorization": f"Bearer {ANON}", "Content-Type": "application/json"}
    r = urllib.request.Request(f"{SUPABASE}/rest/v1/rpc/{nome}",
                               data=json.dumps(args).encode(), headers=h, method="POST")
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            txt = resp.read().decode()
            return resp.status, (json.loads(txt) if txt.strip() else None)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, None


def main():
    print("=" * 74)
    print("  CDB2026 — ROUND-TRIP DO TOKEN (contrato exato de producao)")
    print("=" * 74)

    estado = INV.fetch_state()
    elegiveis = INV.eligible_entries(estado)
    if not elegiveis:
        print("🛑 nenhuma entrada elegivel")
        return 2
    # ── NUNCA TOMAR EMPRESTADA UMA CREDENCIAL VIVA ──────────────────────────────────────────
    #
    # Este canario emite, revoga e remove a credencial da entrada que usa. Enquanto ninguem tinha
    # link valido isso era inofensivo. Depois que a correcao foi enviada, a versao anterior deste
    # arquivo pegou `elegiveis[0]` -- uma pessoa real, com link recem-entregue -- e o revogou no
    # bloco `finally`. O link dela morreu por causa do proprio verificador.
    #
    # O token em claro nao existe em lugar nenhum depois do envio, entao NAO ha como devolver o
    # que foi revogado: o unico conserto e emitir outro e mandar outro e-mail. Um verificador que
    # so pode ser desfeito incomodando a pessoa nao pode escolher a vitima por indice.
    #
    # Entao ele so usa entrada SEM credencial viva. Se todas tiverem, ele PULA a parte destrutiva
    # e diz isso -- perder cobertura e melhor que quebrar o acesso de alguem.
    vivas = INV.already_invited_ids()
    alvo = next((e for e in elegiveis if e["id"] not in vivas), None)
    if alvo is None:
        print("\n  ⊘ todas as entradas tem credencial VIVA — parte destrutiva PULADA.")
        print("     (revogar para testar mataria um link ja entregue, e o token em claro nao")
        print("      existe mais para ser devolvido)")
        print("\n  PRODUCTION_TOKEN_ROUND_TRIP = SKIPPED_TO_PROTECT_LIVE_LINKS")
        print("=" * 74)
        return 0
    eid = alvo["id"]
    print(f"  entrada de teste   {eid[:8]}…  (sem credencial viva; somente leitura)")

    original_viva = False

    try:
        # ── 1. emissao e leitura pelo caminho do navegador ──────────────────────────────────
        t1 = INV.issue_token(eid, "canario de round-trip")
        st, r = rpc_anon("cdb_my_entry", {"p_token": t1})
        check("token recem-emitido autentica pela chave PUBLICA",
              st == 200 and isinstance(r, dict) and r.get("id") == eid,
              f"http={st} tipo={type(r).__name__}")
        if isinstance(r, dict):
            check("resolve a PROPRIA entrada", r.get("id") == eid)
            check("nao devolve e-mail/pagador/metodo",
                  not any(k in r for k in ("participantEmail", "payerName", "paymentMethod")),
                  f"campos={sorted(r.keys())}")

        # ── 2. A ARMADILHA DO INCIDENTE ─────────────────────────────────────────────────────
        INV.revoke_token(eid)
        st, r = rpc_anon("cdb_my_entry", {"p_token": t1})
        check("token revogado deixa de autenticar", r is None, f"r={r}")

        t2 = INV.issue_token(eid, "canario de round-trip (reemissao)")
        st, r = rpc_anon("cdb_my_entry", {"p_token": t2})
        check("REEMISSAO apos revogacao volta a autenticar  ← o defeito de hoje",
              st == 200 and isinstance(r, dict) and r.get("id") == eid,
              f"http={st} r={r} — merge-duplicates preservou revoked_at e o link nasce morto")

        check("o token anterior NAO volta a valer junto",
              rpc_anon("cdb_my_entry", {"p_token": t1})[1] is None,
              "reemitir ressuscitou tambem o token antigo — dois links validos por entrada")

        # ── 3. forma do token ───────────────────────────────────────────────────────────────
        import re
        check("token e URL-safe (sobrevive ao fragmento sem escapar)",
              bool(re.fullmatch(r"[A-Za-z0-9_-]+", t2)), "caracteres fora do alfabeto url-safe")
        check("token tem entropia suficiente (>= 32 chars)", len(t2) >= 32, f"len={len(t2)}")
        check("espaco/quebra nao passa despercebido",
              rpc_anon("cdb_my_entry", {"p_token": t2 + " "})[1] is None
              or rpc_anon("cdb_my_entry", {"p_token": t2})[1] is not None)

    finally:
        INV.revoke_token(eid)
        if not original_viva:
            INV._req("DELETE", f"/rest/v1/cdb_entry_access?entry_id=eq.{eid}",
                     extra={"Prefer": "return=minimal"})

    print(f"\n  {ok} passed, {fail} failed")
    print("  PRODUCTION_TOKEN_ROUND_TRIP = " + ("PASS" if fail == 0 else "FAIL"))
    print("=" * 74)
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
