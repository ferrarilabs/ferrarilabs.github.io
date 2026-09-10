#!/usr/bin/env python3
"""CDB2026 — registra a topologia da final (semifinal -> final).

O FATO, E POR QUE NAO PRECISA DE FONTE EXTERNA
-----------------------------------------------
`register_semifinal_topology.py` precisa de cobertura jornalistica porque o caminho das quartas
ate a final foi um FATO do sorteio da CBF de 2026-08-11 -- uma escolha entre varios emparelhamentos
possiveis, que so a CBF fez e so a imprensa registrou.

A final nao tem essa ambiguidade. Uma vez que a semifinal tem EXATAMENTE duas chaves (confirmado
abaixo contra o estado real, nunca assumido), a final so pode ser "vencedor da chave 1 x vencedor
da chave 2" -- e um fato ESTRUTURAL do formato eliminatorio, nao uma decisao de sorteio. Nao ha
segunda fonte a citar porque nao ha fato contingente a confirmar: e a mesma razao pela qual a Copa
do Mundo nunca precisou "sortear" quem joga a final depois das semifinais definidas.

O QUE ESTE SCRIPT NAO FAZ
-------------------------
Nao deriva vencedor. As vagas da final apontam para as DUAS chaves da semifinal ja gravadas em
producao (`winnerOf: <tieId>`) -- quem de fato as vence continua vindo de `qualifiedTeamId`,
persistido so depois do jogo, via `materialize-derived-phase` (#410), que segue separado e manual.

Nao registra se a semifinal nao tiver exatamente 2 confrontos: registrar com 1 ou 3+ inventaria
uma final que o chaveamento real nao produz.

Nao envia e-mail. Nao toca em palpite de ninguem.

Uso: python3 bolao/cdb2026/scripts/register_final_topology.py [--apply]
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

SUPABASE = "https://cmhqkkfczotdnssupkni.supabase.co"


def _key():
    k = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not k:
        print("🛑 SUPABASE_SERVICE_ROLE_KEY ausente — só roda no ambiente confiável.")
        sys.exit(2)
    return k


def req(metodo, caminho, corpo=None):
    k = _key()
    h = {"apikey": k, "Authorization": f"Bearer {k}", "Content-Type": "application/json"}
    d = json.dumps(corpo).encode() if corpo is not None else None
    r = urllib.request.Request(f"{SUPABASE}{caminho}", data=d, headers=h, method=metodo)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            t = resp.read().decode()
            return resp.status, (json.loads(t) if t.strip() else None)
    except urllib.error.HTTPError as e:
        t = e.read().decode()
        try:
            return e.code, json.loads(t)
        except Exception:
            return e.code, {"raw": t[:300]}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--apply", action="store_true")
    args = p.parse_args()

    print("=" * 76)
    print("  CDB2026 — TOPOLOGIA OFICIAL DA FINAL")
    print("=" * 76)

    st, dados = req("GET", "/rest/v1/bolao_state?id=eq.cdb2026&select=state")
    if st != 200 or not dados:
        print(f"🛑 leitura do estado falhou: http={st}")
        return 2
    estado = dados[0]["state"]
    semifinal = ((estado.get("phases") or {}).get("semifinal") or {}).get("ties") or {}
    if len(semifinal) != 2:
        print(f"🛑 semifinal tem {len(semifinal)} confronto(s); esperava exatamente 2 — "
              "registrar com outra contagem inventaria uma final que o chaveamento real não produz.")
        return 2

    ids = sorted(semifinal)
    slots = {"final-1": {"sideA": {"winnerOf": ids[0]}, "sideB": {"winnerOf": ids[1]}}}
    for tid in ids:
        t = semifinal[tid]
        print(f"  {tid}  {t.get('teamA')} x {t.get('teamB')}")
    print(f"\n  final-1  vencedor({ids[0]})  ×  vencedor({ids[1]})")

    provenancia = {
        "authority": "CBF",
        # `source` e OBRIGATORIO para o app: topologyProvenanceIsValid() exige
        # ["authority", "source", "ingestedAt", "validatedAt"]. Aqui a fonte e o FORMATO do
        # torneio (eliminatorio, duas semifinais), nao uma cobertura jornalistica -- nao ha fato
        # de sorteio a confirmar, so a estrutura matematica de "duas chaves -> uma final".
        "source": "Estrutural: formato eliminatorio da Copa do Brasil garante que, com exatamente "
                  "duas semifinais, a final é definicionalmente entre as duas vencedoras — não "
                  "depende de sorteio nem de fonte jornalística externa.",
        "event": "Derivado da contagem de confrontos da semifinal já gravados em produção "
                 f"(phases.semifinal.ties): {ids[0]} e {ids[1]}",
        "channel": "n/a — fato estrutural, não fato de sorteio",
        "sourceUrl": None,
        "sources": [],
        "independentSources": 0,
        "slotNumbering": "final-1 é o único slot possível — não há numeração a resolver.",
        "validatedAgainst": "confrontos reais gravados em phases.semifinal.ties (exigido == 2)",
        "ingestedAt": "2026-09-10T00:00:00Z",
        "validatedAt": "2026-09-10T00:00:00Z",
    }

    if not args.apply:
        print("\n  DRY-RUN — nada gravado. Use --apply.")
        print("\n  TOPOLOGY_STATUS = DRY_RUN")
        return 0

    st, r = req("POST", "/rest/v1/rpc/cdb_register_bracket_topology", {
        "p_phase_id": "final", "p_slots": slots, "p_provenance": provenancia,
        "p_actor": "operator:register_final_topology"})
    if not (200 <= st < 300):
        print(f"\n🛑 registro recusado: http={st} {json.dumps(r or {})[:220]}")
        return 1
    if isinstance(r, dict) and r.get("applied") is False:
        print(f"  (já registrada — refrescando proveniência)")
        st2, r2 = req("POST", "/rest/v1/rpc/cdb_refresh_topology_provenance", {
            "p_phase_id": "final", "p_slots": slots, "p_provenance": provenancia})
        if not (200 <= st2 < 300):
            print(f"\n🛑 refresh recusado: http={st2} {json.dumps(r2 or {})[:220]}")
            return 1
        r = r2
    print(f"\n  resultado  {json.dumps(r)}")
    print("\n  TOPOLOGY_STATUS = REGISTERED")
    print("=" * 76)
    return 0


if __name__ == "__main__":
    sys.exit(main())
