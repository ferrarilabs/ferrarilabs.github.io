#!/usr/bin/env python3
"""CDB2026 — registra o caminho oficial ate a final (quartas -> semifinal).

O FATO
------
O sorteio da CBF de 2026-08-11 definiu, alem dos confrontos das quartas, o CAMINHO ate a final:

    vencedor(Internacional x Gremio)  x  vencedor(Cruzeiro x Atletico-MG)
    vencedor(Vasco x Vitoria)         x  vencedor(Palmeiras x Santos)

PROVENIENCIA -- E O QUE ELA NAO E
---------------------------------
O cbf.com.br NAO expoe isso de forma legivel por maquina. Medido de novo em 2026-08-12: a pagina
de tabela da Copa do Brasil responde 200 e nao contem UM nome de clube; a sala de imprensa idem.
Foi a mesma constatacao de 2026-08-07 que levou o sorteio das quartas a ser ingerido por cobertura
jornalistica, com `authority: CBF` e a limitacao escrita no proprio registro.

Entao a autoridade e a CBF (o evento do sorteio); o CANAL e a imprensa. Este script exige DUAS
fontes independentes e grava as duas. Nao e melhor que isso -- e e exatamente o mesmo padrao que
ja sustenta o bracket das quartas, que move dinheiro desde 11/08. Aplicar um criterio mais duro a
fase derivada do que a fase primaria seria incoerente, nao mais seguro.

O QUE ESTE SCRIPT NAO FAZ
-------------------------
Nao deriva emparelhamento. As vagas estao escritas abaixo, vindas das fontes, e sao validadas
contra os confrontos REAIS gravados em producao antes de qualquer escrita. Se o bracket em
producao nao casar exatamente com o que as fontes descrevem, o script recusa.

Nao envia e-mail. Nao toca em palpite de ninguem.

Uso: python3 bolao/cdb2026/scripts/register_semifinal_topology.py [--apply]
"""
import argparse
import json
import os
import sys
import unicodedata
import urllib.error
import urllib.request

SUPABASE = "https://cmhqkkfczotdnssupkni.supabase.co"

# ── O FATO, COMO AS FONTES O DESCREVEM ──────────────────────────────────────────────────────
# Pares de CLUBES, nao ids: os ids sao resolvidos contra o estado real logo abaixo. Escrever id
# aqui seria assumir uma forma de identificador que pode mudar; escrever clube e citar a fonte.
CAMINHO = [
    (("Internacional", "Grêmio"), ("Cruzeiro", "Atlético-MG")),
    (("Vasco", "Vitória"), ("Palmeiras", "Santos")),
]

FONTES = [
    {"outlet": "ge.globo (Grupo Globo)",
     "url": "https://ge.globo.com/rs/futebol/copa-do-brasil/noticia/2026/08/11/"
            "quartas-da-copa-do-brasil-2026-veja-datas-e-horarios-dos-jogos.ghtml",
     "trecho": "O vencedor do clássico gaúcho enfrentará nas semifinais o time que passar do "
               "confronto mineiro. Do outro lado da chave, o ganhador do confronto entre Vasco e "
               "Vitória medirá forças nas semifinais contra o vencedor do clássico paulista."},
    {"outlet": "CNN Brasil",
     "url": "https://www.cnnbrasil.com.br/esportes/futebol/copa-do-brasil/"
            "copa-do-brasil-2026-veja-confrontos-das-quartas-e-caminho-ate-a-final/",
     "trecho": "Quem vencer do confronto entre Grêmio x Internacional encara quem passar de "
               "Atlético-MG x Cruzeiro, enquanto a outra semifinal será entre os vencedores de "
               "Vasco x Vitória e Palmeiras x Santos."},
]


def _slug(t):
    s = unicodedata.normalize("NFD", str(t or ""))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    import re
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


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
    print("  CDB2026 — TOPOLOGIA OFICIAL DA SEMIFINAL")
    print("=" * 76)

    st, dados = req("GET", "/rest/v1/bolao_state?id=eq.cdb2026&select=state")
    if st != 200 or not dados:
        print(f"🛑 leitura do estado falhou: http={st}")
        return 2
    estado = dados[0]["state"]
    quartas = ((estado.get("phases") or {}).get("quartas") or {}).get("ties") or {}
    if len(quartas) != 4:
        print(f"🛑 quartas tem {len(quartas)} confrontos; esperava 4")
        return 2

    # Resolve cada par de clubes para o id REAL do confronto gravado. Se algum par das fontes nao
    # existir exatamente no bracket de producao, isto para -- e parar e o certo: significaria que
    # a topologia descreve um torneio diferente do que esta gravado.
    por_par = {tuple(sorted((_slug(t["teamA"]), _slug(t["teamB"])))): tid
               for tid, t in quartas.items()}
    slots, n = {}, 0
    for lado_a, lado_b in CAMINHO:
        n += 1
        ka = tuple(sorted((_slug(lado_a[0]), _slug(lado_a[1]))))
        kb = tuple(sorted((_slug(lado_b[0]), _slug(lado_b[1]))))
        if ka not in por_par or kb not in por_par:
            faltando = [x for x, k in ((lado_a, ka), (lado_b, kb)) if k not in por_par]
            print(f"🛑 confronto das fontes NAO existe no bracket gravado: {faltando}")
            print("   A topologia descreveria um torneio diferente do que está em produção.")
            return 1
        slots[f"sf-{n}"] = {"sideA": {"winnerOf": por_par[ka]},
                            "sideB": {"winnerOf": por_par[kb]}}
        print(f"  sf-{n}  vencedor({lado_a[0]} x {lado_a[1]})  ×  vencedor({lado_b[0]} x {lado_b[1]})")
        print(f"         {por_par[ka]}  ×  {por_par[kb]}")

    # A NUMERACAO sf-1/sf-2 e derivada da ordem das fontes, nao um dado oficial: nenhuma delas
    # numera as semifinais. Fica registrado na proveniencia para ninguem ler como fato da CBF.
    provenancia = {
        "authority": "CBF",
        "event": "Sorteio das quartas de final da Copa do Brasil 2026, realizado pela CBF em "
                 "2026-08-11, que definiu tambem o caminho ate a final",
        "channel": "cobertura jornalistica — o cbf.com.br nao expoe os confrontos de forma "
                   "legivel por maquina (remedido em 2026-08-12: a pagina de tabela responde 200 "
                   "sem um unico nome de clube; a sala de imprensa idem)",
        "sourceUrl": FONTES[0]["url"],
        "sources": FONTES,
        "independentSources": len({f["outlet"] for f in FONTES}),
        "slotNumbering": "sf-1/sf-2 seguem a ordem das fontes; a CBF nao numera as semifinais. "
                         "A numeracao NAO e afirmada como dado oficial — o dado oficial e o "
                         "emparelhamento.",
        "validatedAgainst": "confrontos reais gravados em phases.quartas.ties",
        "ingestedAt": "2026-08-12T19:00:00Z",
        "validatedAt": "2026-08-12T19:00:00Z",
    }

    print(f"\n  fontes independentes  {provenancia['independentSources']}")
    for f in FONTES:
        print(f"    · {f['outlet']}")

    if not args.apply:
        print("\n  DRY-RUN — nada gravado. Use --apply.")
        print("\n  TOPOLOGY_STATUS = DRY_RUN")
        return 0

    st, r = req("POST", "/rest/v1/rpc/cdb_register_bracket_topology", {
        "p_phase_id": "semifinal", "p_slots": slots, "p_provenance": provenancia,
        "p_actor": "operator:register_semifinal_topology"})
    if not (200 <= st < 300):
        print(f"\n🛑 registro recusado: http={st} {json.dumps(r or {})[:220]}")
        return 1
    print(f"\n  resultado  {json.dumps(r)}")
    print("\n  TOPOLOGY_STATUS = REGISTERED")
    print("=" * 76)
    return 0


if __name__ == "__main__":
    sys.exit(main())
