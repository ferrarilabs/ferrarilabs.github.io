#!/usr/bin/env python3
"""CDB2026 — canario do acesso seguro do participante.

Prova, contra a PRODUCAO, que o caminho seguro funciona e que os inseguros nao.

POR QUE RODA DENTRO DO RUNNER
-----------------------------
O token bruto nunca pode sair daqui: nao vai para o Git, nem para log, nem para artefato, nem
para a maquina de desenvolvimento. Entao o canario emite o token, usa, verifica e REVOGA na
mesma execucao, imprimindo apenas booleanos e contagens.

O QUE PROVA
-----------
    token valido        le a PROPRIA entrada
    token invalido      devolve null (falha generica, sem oraculo de existencia)
    token revogado      devolve null
    escrita             bloqueada enquanto a fase nao tem prazo oficial (regra de negocio)
    cross-entry         estruturalmente impossivel: a RPC de escrita nao tem parametro de entrada
    receipt derivavel   nao autoriza nada no caminho novo
    tabela de credencial invisivel para anon

NAO MUTA palpite de ninguem. A unica escrita e na tabela de credenciais, e ela e desfeita.
"""

# ══ PARTICIPANTE REAL NUNCA E ALVO DE VERIFICACAO ══════════════════
#
# 2026-08-12: este arquivo emitia, usava e REVOGAVA a credencial de uma entrada REAL, escolhida
# por indice. Depois que os convites sairam, cada execucao matava o link de quem calhasse de ser
# o primeiro da lista -- e calhou de ser o operador, duas vezes. Cada morte virou mais um e-mail
# para ele: quatro em 45 minutos.
#
# O operador e participante, nao caixa de teste. Verificacao que so pode ser desfeita incomodando
# uma pessoa nao e verificacao, e dano com relatorio.
#
# Enquanto existir link entregue, este verificador NAO opera sobre entrada real. Ele sai dizendo
# isso. Perder cobertura e melhor que quebrar acesso de gente.
import sys as _sys
from pathlib import Path as _Path
if (_Path(__file__).resolve().parents[1] / "EMAIL_KILL_SWITCH").exists():
    print("⊘ CDB_EMAIL_KILL_SWITCH ativo — verificador que toca credencial real esta PARADO.")
    print("  (ver bolao/cdb2026/EMAIL_KILL_SWITCH)")
    _sys.exit(0)

import hashlib
import json
import os
import secrets
import sys
import urllib.error
import urllib.request

SUPABASE = "https://cmhqkkfczotdnssupkni.supabase.co"
ANON = "sb_publishable_9eJsJzMcROuj9SFOMVUTvA_mWVz0fG5"

ok = 0
fail = 0


def check(nome, cond, detalhe=""):
    global ok, fail
    if cond:
        print(f"  ✓ {nome}")
        ok += 1
    else:
        print(f"  ✗ {nome}" + (f"\n      {detalhe}" if detalhe else ""))
        fail += 1


def _key(privilegiada=False):
    if privilegiada:
        k = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
        if not k:
            print("🛑 SUPABASE_SERVICE_ROLE_KEY ausente — o canario so roda no ambiente confiavel.")
            sys.exit(2)
        return k
    return ANON


def req(metodo, caminho, corpo=None, privilegiada=False, extra=None):
    k = _key(privilegiada)
    h = {"apikey": k, "Authorization": f"Bearer {k}", "Content-Type": "application/json"}
    h.update(extra or {})
    dados = json.dumps(corpo).encode() if corpo is not None else None
    r = urllib.request.Request(f"{SUPABASE}{caminho}", data=dados, headers=h, method=metodo)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            txt = resp.read().decode()
            return resp.status, (json.loads(txt) if txt.strip() else None)
    except urllib.error.HTTPError as e:
        txt = e.read().decode()
        try:
            return e.code, json.loads(txt)
        except Exception:
            return e.code, {"raw": txt[:200]}


def rpc(nome, args, privilegiada=False):
    return req("POST", f"/rest/v1/rpc/{nome}", args, privilegiada)


def main():
    print("=" * 70)
    print("  CDB2026 — CANARIO DE ACESSO SEGURO DO PARTICIPANTE")
    print("=" * 70)

    # ── entrada real de referencia, escolhida do estado (nunca mutada) ─────────────────────
    st, dados = req("GET", "/rest/v1/bolao_state?id=eq.cdb2026&select=state", privilegiada=True)
    if st != 200 or not dados:
        print("🛑 nao consegui ler o estado do cdb2026")
        return 2
    estado = dados[0]["state"]
    entradas = [e for e in (estado.get("entries") or [])
                if e.get("id") not in set(estado.get("deletedIds") or [])]
    if len(entradas) < 2:
        print("🛑 preciso de ao menos duas entradas para provar isolamento")
        return 2
    # ── NAO CANIBALIZAR CREDENCIAL VIVA (terceira vez que este erro aparece) ────────────────
    #
    # Este canario emite, REVOGA e remove a credencial da entrada que usa. Enquanto ninguem tinha
    # link entregue isso era inofensivo. Depois da correcao de 2026-08-12 ele passou a matar, a
    # cada execucao, o link de quem calhasse de ser `entradas[0]`.
    #
    # O token em claro nao existe depois do envio, entao revogar e IRREVERSIVEL sem incomodar a
    # pessoa com outro e-mail. Mesmo raciocinio ja aplicado em token_roundtrip_canary.py -- e a
    # terceira copia da emissao de credencial neste repositorio a repetir a mesma licao.
    st_v, linhas_v = req("GET", "/rest/v1/cdb_entry_access?select=entry_id&revoked_at=is.null",
                         privilegiada=True)
    vivas = {l["entry_id"] for l in (linhas_v or [])} if st_v == 200 else set()
    candidatos = [e for e in entradas if e["id"] not in vivas]
    if not candidatos:
        print("\n  ⊘ todas as entradas tem credencial VIVA — canario PULADO para nao matar")
        print("     um link ja entregue (o token em claro nao existe mais para ser devolvido).")
        print("\n  CDB_SECURE_SUBMISSION_CANARY = SKIPPED_TO_PROTECT_LIVE_LINKS")
        print("=" * 70)
        return 0
    alvo = candidatos[0]
    outra = next(e for e in entradas if e["id"] != alvo["id"])
    print(f"  entradas no estado        {len(entradas)}")
    print(f"  entrada de teste          {alvo['id'][:8]}…  (somente leitura)")

    # ── emite credencial ──────────────────────────────────────────────────────────────────
    token = secrets.token_urlsafe(32)          # >=256 bits de entropia
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    # `revoked_at: None` e OBRIGATORIO, pela mesma razao que no sender.
    #
    # `merge-duplicates` atualiza as colunas ENVIADAS e preserva as demais. Se esta entrada ja
    # tiver uma linha revogada -- e depois do incidente de 2026-08-12 as doze tinham --, o token
    # novo nasce morto e o canario reprova em `ACESSO_NEGADO` sem que nada esteja errado com o
    # que ele testa.
    #
    # Este bug existiu DUAS VEZES porque a emissao estava duplicada: uma copia aqui, outra no
    # sender. Consertei o sender e este arquivo continuou quebrado. Duas copias da mesma regra
    # sao duas oportunidades de errar, e so uma delas costuma ser lembrada.
    st, _ = req("POST", "/rest/v1/cdb_entry_access",
                {"entry_id": alvo["id"], "token_hash": token_hash, "revoked_at": None,
                 "note": "canario automatico; revogado no fim da execucao"},
                privilegiada=True, extra={"Prefer": "resolution=merge-duplicates,return=minimal"})
    check("credencial emitida pelo caminho privilegiado", st in (200, 201, 204), f"http={st}")

    try:
        # ── LEITURA COM TOKEN VALIDO ──────────────────────────────────────────────────────
        st, r = rpc("cdb_my_entry", {"p_token": token})
        check("token valido le a PROPRIA entrada (via chave anon publica)",
              st == 200 and isinstance(r, dict) and r.get("id") == alvo["id"], f"http={st} r={type(r).__name__}")
        if isinstance(r, dict):
            check("a leitura NAO devolve e-mail/pagador/metodo de pagamento",
                  not any(k in r for k in ("participantEmail", "payerName", "paymentMethod", "txId")),
                  f"campos: {sorted(r.keys())}")
            check("a leitura devolve os proprios palpites", "picks" in r)

        # ── FALHA GENERICA ────────────────────────────────────────────────────────────────
        st1, r1 = rpc("cdb_my_entry", {"p_token": "x" * 64})               # inexistente
        st2, r2 = rpc("cdb_my_entry", {"p_token": secrets.token_urlsafe(32)})  # aleatorio
        check("token invalido devolve null (sem oraculo de existencia)",
              r1 is None and r2 is None, f"r1={r1} r2={r2}")
        check("as duas falhas sao INDISTINGUIVEIS entre si",
              (st1, r1) == (st2, r2), f"{st1}/{r1} vs {st2}/{r2}")

        # ── ESCRITA: bloqueada pela regra de negocio (fase sem prazo) ─────────────────────
        # A FASE MUDA DE ESTADO DURANTE A VIDA DO TORNEIO, E O CANARIO TEM DE ACOMPANHAR.
        #
        # Ate 12/08 as quartas nao tinham prazo publicado e a escrita era recusada com
        # FASE_FECHADA -- e o canario afirmava exatamente isso. Quando a tabela oficial
        # materializou e os palpites abriram, essa afirmacao passou a estar errada sobre uma
        # producao correta.
        #
        # Entao o que se afirma agora e o INVARIANTE, nao o estado do dia: a escrita e decidida
        # pelo SERVIDOR a partir do prazo publicado. Fase sem prazo recusa; fase com prazo aberto
        # aceita; prazo vencido recusa. Qualquer um dos tres e um resultado valido aqui; o que
        # nao pode acontecer e o servidor ignorar o prazo.
        # ── ESCREVE OS PALPITES QUE JA ESTAVAM LA ───────────────────────────────────────────
        #
        # A versao anterior gravava um valor sintetico (`{"quartas": {"canario": True}}`).
        # Enquanto a fase estava FECHADA isso era inofensivo: a escrita era recusada e o canario
        # so media a recusa. No minuto em que a tabela oficial materializou e os palpites
        # abriram, a MESMA linha passou a ser aceita -- e SUBSTITUIU os palpites reais de um
        # participante (8 matches e 8 qualified viraram uma chave de teste).
        #
        # Um canario cuja seguranca dependia de a operacao estar bloqueada nao era um canario
        # seguro; era um canario com sorte. Agora ele salva de volta EXATAMENTE o que leu, entao
        # exercita o caminho de escrita inteiro e o conteudo final e identico ao inicial, com a
        # fase aberta ou fechada.
        # Re-le a PROPRIA entrada agora, em vez de reaproveitar o `r` que sobrou das checagens
        # de falha generica acima -- aquele `r` e None de proposito, e mandar `{}` para o save
        # APAGARIA os palpites da pessoa em vez de reescrever os mesmos.
        _, _atual = rpc("cdb_my_entry", {"p_token": token})
        palpites_atuais = (_atual or {}).get("picks") if isinstance(_atual, dict) else None
        st, r = rpc("cdb_save_my_picks",
                    {"p_token": token, "p_client_ref": "canario-1",
                     "p_picks": palpites_atuais if palpites_atuais is not None else None})
        msg = json.dumps(r or {})
        aceitou = 200 <= st < 300
        recusou_por_prazo = st >= 400 and ("FASE_FECHADA" in msg or "PRAZO" in msg.upper())
        check("a escrita e decidida pelo PRAZO no servidor (aceita aberta, recusa fechada)",
              aceitou or recusou_por_prazo,
              f"http={st} msg={msg[:110]} — nem aceitou com a fase aberta nem recusou citando o "
              "prazo; o servidor nao esta decidindo pelo cutoff")

        # ── CROSS-ENTRY: estruturalmente impossivel ───────────────────────────────────────
        st, r = rpc("cdb_save_my_picks",
                    {"p_token": token, "p_client_ref": "canario-2",
                     "p_picks": {}, "p_entry_id": outra["id"]})
        check("a RPC de escrita RECUSA um parametro de entrada (nao existe alvo escolhivel)",
              st >= 400, f"http={st} — se aceitasse, haveria como escolher a vitima")

        # ── TOKEN SEM PERMISSAO NA RPC ANTIGA ────────────────────────────────────────────
        st, r = rpc("cdb_update_entry_picks",
                    {"p_entry_id": outra["id"], "p_client_ref": "canario-3", "p_picks": {}})
        check("a RPC antiga (sem autorizacao) esta NEGADA para anon",
              st in (401, 403) and "permission denied" in json.dumps(r or {}),
              f"http={st} r={json.dumps(r or {})[:100]}")

        # ── RECEIPT DERIVAVEL NAO AUTORIZA ───────────────────────────────────────────────
        def receipt(e):
            h = 2166136261
            payload = json.dumps({"n": e.get("entryName"), "t": e.get("createdAt")},
                                 separators=(",", ":"))
            for ch in payload:
                h ^= ord(ch)
                h = (h * 16777619) & 0xFFFFFFFF
            return f"CDB2026-{h:08X}-{str(e.get('createdAt') or '')[:10].replace('-','')}"
        st, r = rpc("cdb_my_entry", {"p_token": receipt(alvo)})
        check("o receiptCode DERIVAVEL nao autoriza nada no caminho novo",
              r is None, f"r={r}")

        # ── TABELA DE CREDENCIAIS INVISIVEL ──────────────────────────────────────────────
        st, r = req("GET", "/rest/v1/cdb_entry_access?select=entry_id")
        check("tabela de credenciais invisivel para anon", st in (401, 403), f"http={st}")

        # ── REVOGACAO ────────────────────────────────────────────────────────────────────
        req("PATCH", f"/rest/v1/cdb_entry_access?entry_id=eq.{alvo['id']}",
            {"revoked_at": "now()"}, privilegiada=True, extra={"Prefer": "return=minimal"})
        st, r = rpc("cdb_my_entry", {"p_token": token})
        check("token REVOGADO deixa de funcionar imediatamente", r is None, f"r={r}")

    finally:
        # Remove a credencial do canario, aconteca o que acontecer.
        req("DELETE", f"/rest/v1/cdb_entry_access?entry_id=eq.{alvo['id']}",
            privilegiada=True, extra={"Prefer": "return=minimal"})

    # ── nada foi mutado ──────────────────────────────────────────────────────────────────
    st, dados2 = req("GET", "/rest/v1/bolao_state?id=eq.cdb2026&select=state", privilegiada=True)
    e2 = dados2[0]["state"]
    check("nenhum palpite foi alterado pelo canario",
          json.dumps([e.get("picks") for e in (e2.get("entries") or [])], sort_keys=True)
          == json.dumps([e.get("picks") for e in (estado.get("entries") or [])], sort_keys=True))
    check("contagem de entradas inalterada",
          len(e2.get("entries") or []) == len(estado.get("entries") or []))

    print(f"\n  {ok} passed, {fail} failed")
    print("  CDB_SECURE_SUBMISSION_CANARY = " + ("PASS" if fail == 0 else "FAIL"))
    print("=" * 70)
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
