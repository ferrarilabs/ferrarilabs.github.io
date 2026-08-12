#!/usr/bin/env python3
"""Duas perguntas diferentes: "este evento ja saiu?" e "esta PESSOA ja recebeu?".

O INCIDENTE (2026-08-12)
------------------------
O operador recebeu QUATRO e-mails do CDB em 45 minutos. A idempotencia por EVENTO funcionou o
tempo todo -- nenhum evento saiu duas vezes. O problema e que cada conserto criava um evento NOVO
(correcao v1, v2, v3), e cada evento novo era, para o sistema, uma obrigacao legitima de escrever
para a mesma pessoa.

Este teste mede a camada que faltava, contra a PRODUCAO:

    reserve_delivery   unicidade (app, evento, destinatario, geracao) no BANCO
    janela de anomalia mesma pessoa, mesmo app, OUTRO evento, minutos atras -> bloqueia

E reproduz o padrao exato de hoje: original aceito -> correcao aceita -> rerun -> canario ->
rerun de workflow. Esperado: 1 + 1 e ZERO depois.

Nao envia e-mail. Nao toca em destinatario real: todos os enderecos usados sao sinteticos e
todas as chaves usam o prefixo `canary:`, removido no fim.

Uso (ambiente confiavel): python3 bolao/scripts/test_delivery_uniqueness.py
"""
import json
import os
import sys
import urllib.error
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor

SUPABASE = "https://cmhqkkfczotdnssupkni.supabase.co"
ANON = "sb_publishable_9eJsJzMcROuj9SFOMVUTvA_mWVz0fG5"

ok, fail = 0, 0


def check(nome, cond, detalhe=""):
    global ok, fail
    if cond:
        print(f"  ✓ {nome}")
        ok += 1
    else:
        print(f"  ✗ {nome}" + (f"\n      {detalhe}" if detalhe else ""))
        fail += 1


def _key(priv=True):
    if not priv:
        return ANON
    k = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not k:
        print("🛑 SUPABASE_SERVICE_ROLE_KEY ausente — só roda no ambiente confiável.")
        sys.exit(2)
    return k


def rpc(nome, args, priv=True):
    k = _key(priv)
    h = {"apikey": k, "Authorization": f"Bearer {k}", "Content-Type": "application/json"}
    r = urllib.request.Request(f"{SUPABASE}/rest/v1/rpc/{nome}",
                               data=json.dumps(args).encode(), headers=h, method="POST")
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            t = resp.read().decode()
            return resp.status, (json.loads(t) if t.strip() else None)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, None


def reservar(evento, destinatario, geracao=1, bypass=True):
    """bypass=True por padrão: a maioria dos casos mede UNICIDADE, não a janela de anomalia."""
    st, r = rpc("reserve_delivery", {
        "p_app": "canary", "p_business_key": evento, "p_recipient": destinatario,
        "p_generation": geracao, "p_bypass_anomaly": bypass})
    return (r[0] if isinstance(r, list) and r else r) or {}


def main():
    print("=" * 78)
    print("  ENTREGA: unicidade por DESTINATARIO + disjuntor de anomalia")
    print("=" * 78)
    marca = uuid.uuid4().hex[:8]
    ev1 = f"canary:original:{marca}"
    ev2 = f"canary:correcao:{marca}"
    alguem = f"pessoa-{marca}@exemplo-invalido.test"

    try:
        # ── UNICIDADE ───────────────────────────────────────────────────────────────────────
        print("\n── unicidade por destinatario ──")
        a = reservar(ev1, alguem)
        check("primeira reserva e concedida", a.get("reserved") is True, f"{a}")

        b = reservar(ev1, alguem)
        check("SEGUNDA reserva do mesmo evento/destinatario e NEGADA",
              b.get("reserved") is False and "JA_ENTREGUE" in (b.get("reason") or ""), f"{b}")

        outro = reservar(ev1, f"outra-{marca}@exemplo-invalido.test")
        check("outro destinatario no mesmo evento e concedido",
              outro.get("reserved") is True, f"{outro}")

        # ── RERUN DE WORKFLOW ───────────────────────────────────────────────────────────────
        print("\n── rerun de workflow (mesma chave de negocio) ──")
        rerun = reservar(ev1, alguem)
        check("rerun NAO gera nova entrega (providerCalls = 0)",
              rerun.get("reserved") is False, f"{rerun}")

        # ── DOIS WORKERS SIMULTANEOS ────────────────────────────────────────────────────────
        print("\n── dois workers simultaneos ──")
        ev_conc = f"canary:concorrencia:{marca}"
        alvo = f"concorrente-{marca}@exemplo-invalido.test"
        with ThreadPoolExecutor(max_workers=8) as ex:
            res = list(ex.map(lambda _: reservar(ev_conc, alvo), range(8)))
        concedidas = sum(1 for r in res if r.get("reserved") is True)
        check("8 workers simultaneos -> EXATAMENTE 1 reserva",
              concedidas == 1, f"concedidas={concedidas} — {concedidas} chamadas ao provedor")

        # ── ACEITO E TERMINAL ───────────────────────────────────────────────────────────────
        print("\n── aceito e terminal ──")
        st, novo = rpc("settle_delivery", {"p_delivery_id": a["delivery_id"],
                                           "p_status": "accepted"})
        check("liquidar como aceito funciona", novo == "accepted", f"{novo}")
        st, de_novo = rpc("settle_delivery", {"p_delivery_id": a["delivery_id"],
                                              "p_status": "failed"})
        check("reabrir um ACEITO e recusado", de_novo == "JA_TERMINAL", f"{de_novo}")

        # ── O PADRAO EXATO DE HOJE ──────────────────────────────────────────────────────────
        print("\n── o padrao de 2026-08-12 (evento novo a cada conserto) ──")
        vitima = f"operador-{marca}@exemplo-invalido.test"
        orig = reservar(ev1 + ":op", vitima, bypass=False)
        check("convite original: concedido", orig.get("reserved") is True, f"{orig}")

        corr = reservar(ev2 + ":op", vitima, bypass=False)
        check("correcao (evento DIFERENTE) minutos depois: BLOQUEADA pela anomalia",
              corr.get("reserved") is False and "ANOMALIA" in (corr.get("reason") or ""),
              f"{corr} — era exatamente assim que o operador levava o 3o e o 4o e-mail")

        terceiro = reservar(f"canary:correcao-v3:{marca}:op", vitima, bypass=False)
        check("terceira tentativa (outro evento ainda): BLOQUEADA",
              terceiro.get("reserved") is False, f"{terceiro}")

        # A anomalia e um DISJUNTOR, nao uma proibicao: com aprovacao explicita, passa.
        aprovado = reservar(f"canary:aprovado:{marca}:op", vitima, bypass=True)
        check("com aprovacao explicita (bypass), a anomalia nao trava para sempre",
              aprovado.get("reserved") is True, f"{aprovado}")

        # ── ANON NAO ALCANCA ────────────────────────────────────────────────────────────────
        print("\n── anon ──")
        st, r = rpc("reserve_delivery", {"p_app": "x", "p_business_key": "y",
                                         "p_recipient": "z@w.test"}, priv=False)
        check("anon NAO consegue reservar entrega", st in (401, 403, 404), f"http={st}")
        st, r = rpc("purge_canary_deliveries", {}, priv=False)
        check("anon NAO consegue purgar entregas", st in (401, 403, 404), f"http={st}")

    finally:
        st, n = rpc("purge_canary_deliveries", {})
        print(f"\n  limpeza: {n} reserva(s) de canario removida(s)")

    print(f"\n  {ok} passed, {fail} failed")
    print("  DB_RECIPIENT_EVENT_UNIQUENESS = " + ("PASS" if fail == 0 else "FAIL"))
    print("=" * 78)
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
