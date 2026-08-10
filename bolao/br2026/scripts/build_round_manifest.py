"""
build_round_manifest.py — GERADOR do manifesto canônico de rodadas do Brasileirão 2026.

O manifesto versionado (`bolao/br2026/data/round_manifest.json`) é o CONTRATO DE NEGÓCIO.
Este script o produz e o valida; o runtime nunca chama este script — ele lê o arquivo commitado.

─── POR QUE UM MANIFESTO, E NÃO METADADO DO UPSTREAM ───────────────────────────────────────

Verificado empiricamente em 2026-08-10:
  - `site.api.espn.com/.../scoreboard` → `event.week` é `None` para bra.1
  - `sports.core.api.espn.com/.../seasons/2026/types/1/weeks` → `count: 0`
A ESPN não expõe número de rodada para o Brasileirão. Não há identidade canônica a consumir.

─── POR QUE ISTO NÃO É UMA JANELA DE DATAS DISFARÇADA ──────────────────────────────────────

A pertinência à rodada NÃO vem de proximidade de datas. Vem de uma propriedade ESTRUTURAL da
competição, que é verificável e falha ruidosamente quando o agrupamento está errado:

    Uma rodada do Brasileirão é uma PARTIÇÃO dos 20 clubes em 10 jogos —
    cada clube aparece exatamente uma vez.

O agrupamento candidato usa a numeração sequencial de eventos da ESPN (que atribui blocos
contíguos de ids por rodada), e cada bloco só entra no manifesto se satisfizer a partição.
Um jogo adiado mantém seu id e portanto sua rodada de origem, mesmo jogado meses depois —
que é exatamente o comportamento exigido: o adiado pertence para sempre à rodada original.

Datas entram como METADADO informativo (`dateRangeUtc`), nunca como identidade.

Uso:
  python3 bolao/br2026/scripts/build_round_manifest.py            # valida o manifesto commitado
  python3 bolao/br2026/scripts/build_round_manifest.py --write    # regenera a partir do upstream
"""

import json
import os
import sys
from datetime import date, datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

MANIFEST_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "data", "round_manifest.json"
)

SEASON = 2026
COMPETITION = "bra.1"
TEAMS_IN_LEAGUE = 20
FIXTURES_PER_ROUND = TEAMS_IN_LEAGUE // 2      # 10
TOTAL_ROUNDS = 2 * (TEAMS_IN_LEAGUE - 1)       # 38 (turno e returno)
SCHEMA_VERSION = 1


# ── Construção ────────────────────────────────────────────────────────────────
def fetch_season_fixtures():
    """Todos os jogos da temporada, do upstream. Só usado com --write."""
    import send_round_email as S

    fixtures = {}
    d = date(SEASON, 1, 1)
    end = date(SEASON + 1, 1, 15)
    while d < end:
        chunk_end = min(d + timedelta(days=45), end)
        fixtures.update(S.fetch_scoreboard_window(d, chunk_end))
        d = chunk_end + timedelta(days=1)
    return fixtures


def partition_into_rounds(fixtures):
    """Agrupa por blocos contíguos de id de evento e EXIGE a partição round-robin.

    Devolve (rounds, rejeitados). Um bloco que não seja uma partição perfeita dos 20 clubes
    é REJEITADO — nunca "consertado" por data, que seria voltar ao modelo antigo por outro
    caminho.
    """
    by_id = {}
    for fid, f in fixtures.items():
        try:
            by_id[int(fid)] = f
        except (TypeError, ValueError):
            continue

    ids = sorted(by_id)
    # A ESPN atribui ids sequenciais POR RODADA. A ordem é a do id, não a da data: os jogos
    # futuros ainda não têm data definitiva, e um adiado carrega a data original — ordenar por
    # data embaralharia as rodadas (medido: 26 de 38 blocos deixavam de ser partição).
    #
    # Um jogo adiado e REJOGADO recebe um id novo, muito distante. O original permanece na
    # tabela como `completed=False` para sempre. Esses ids distantes não participam da
    # aritmética de blocos — são reatribuídos à rodada de origem por identidade de confronto
    # (mandante x visitante), preservando a regra de que o adiado pertence à sua rodada original.
    ID_BLOCK_LIMIT = 401850000
    main = sorted(i for i in ids if i < ID_BLOCK_LIMIT)
    outliers = [i for i in ids if i >= ID_BLOCK_LIMIT]

    rounds, rejected = [], []
    for n in range(0, len(main), FIXTURES_PER_ROUND):
        block = main[n:n + FIXTURES_PER_ROUND]
        if len(block) != FIXTURES_PER_ROUND:
            rejected.append({"reason": "BLOCO_INCOMPLETO", "ids": [str(i) for i in block]})
            continue
        teams = []
        for i in block:
            teams.extend([by_id[i]["home"], by_id[i]["away"]])
        if len(set(teams)) != TEAMS_IN_LEAGUE:
            dup = sorted({t for t in teams if teams.count(t) > 1})
            rejected.append({
                "reason": "NAO_E_PARTICAO_ROUND_ROBIN",
                "ids": [str(i) for i in block],
                "clubesRepetidos": dup,
            })
            continue
        dates = sorted(by_id[i]["date"] for i in block)
        rounds.append({
            "roundNumber": len(rounds) + 1,
            "canonicalFixtureIds": [str(i) for i in block],
            "expectedFixtureCount": FIXTURES_PER_ROUND,
            # METADADO. Não é identidade — ver docstring.
            "dateRangeUtc": [dates[0].isoformat(), dates[-1].isoformat()],
            # id canônico -> id do jogo efetivamente realizado, quando foi adiado e rejogado.
            "replacements": {},
        })

    # Reatribuição dos rejogados à rodada de ORIGEM, por identidade de confronto.
    by_pair = {}
    for r in rounds:
        for fid in r["canonicalFixtureIds"]:
            f = by_id[int(fid)]
            by_pair.setdefault((f["home"], f["away"]), []).append((r, fid))

    for i in outliers:
        f = by_id[i]
        cands = by_pair.get((f["home"], f["away"]), [])
        if len(cands) != 1:
            rejected.append({
                "reason": "REJOGO_SEM_ORIGEM_UNICA",
                "ids": [str(i)],
                "confronto": f'{f["home"]} x {f["away"]}',
                "candidatos": len(cands),
            })
            continue
        r, orig = cands[0]
        r["replacements"][orig] = str(i)
    return rounds, rejected


def build():
    fixtures = fetch_season_fixtures()
    rounds, rejected = partition_into_rounds(fixtures)
    return {
        "schemaVersion": SCHEMA_VERSION,
        "season": SEASON,
        "competition": COMPETITION,
        "teamsInLeague": TEAMS_IN_LEAGUE,
        "expectedRounds": TOTAL_ROUNDS,
        "provenance": {
            "source": "ESPN site API bra.1 scoreboard (ids canônicos do pipeline normalizado)",
            "method": (
                "Blocos contíguos de id de evento, cada bloco ACEITO somente se for uma partição "
                "round-robin perfeita dos 20 clubes (cada clube exatamente uma vez). "
                "Datas são metadado, nunca identidade."
            ),
            "retrievedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "note": (
                "A ESPN não expõe número de rodada para bra.1 (event.week=None; "
                "core API weeks count=0) — verificado 2026-08-10."
            ),
        },
        "rounds": rounds,
        "rejected": rejected,
    }


# ── Validação (roda sempre, inclusive sem --write) ────────────────────────────
def validate(manifest):
    """Devolve lista de problemas. Vazia = manifesto íntegro."""
    problems = []
    rounds = manifest.get("rounds") or []

    if manifest.get("schemaVersion") != SCHEMA_VERSION:
        problems.append(f"schemaVersion inesperada: {manifest.get('schemaVersion')}")
    if not rounds:
        problems.append("manifesto sem rodadas")
        return problems

    prov = manifest.get("provenance") or {}
    for k in ("source", "method", "retrievedAt"):
        if not prov.get(k):
            problems.append(f"provenance.{k} ausente ou vazio")

    seen = {}
    numbers = []
    for r in rounds:
        n = r.get("roundNumber")
        numbers.append(n)
        ids = r.get("canonicalFixtureIds") or []

        if not isinstance(n, int) or n < 1:
            problems.append(f"roundNumber inválido: {n!r}")
        if r.get("expectedFixtureCount") != len(ids):
            problems.append(
                f"R{n}: expectedFixtureCount={r.get('expectedFixtureCount')} != {len(ids)} ids"
            )
        if len(ids) != FIXTURES_PER_ROUND:
            problems.append(f"R{n}: {len(ids)} jogos (esperado {FIXTURES_PER_ROUND})")
        if len(set(ids)) != len(ids):
            problems.append(f"R{n}: ids duplicados dentro da própria rodada")
        for fid in ids:
            if fid in seen:
                problems.append(f"jogo {fid} atribuído a DUAS rodadas: R{seen[fid]} e R{n}")
            seen[fid] = n

    if sorted(numbers) != list(range(1, len(rounds) + 1)):
        problems.append("numeração de rodadas não é 1..N contígua")
    if len(rounds) != manifest.get("expectedRounds"):
        problems.append(
            f"{len(rounds)} rodadas no manifesto, {manifest.get('expectedRounds')} esperadas"
        )
    return problems


def load():
    with open(MANIFEST_PATH, encoding="utf-8") as fh:
        return json.load(fh)


def round_for_fixture(manifest, fixture_id):
    """Rodada de um jogo. O adiado mantém seu id, logo mantém sua rodada de origem."""
    for r in manifest["rounds"]:
        if str(fixture_id) in r["canonicalFixtureIds"]:
            return r
    return None


def main():
    if "--write" in sys.argv:
        print("Buscando temporada completa no upstream...")
        m = build()
        problems = validate(m)
        print(f"  rodadas: {len(m['rounds'])}  rejeitados: {len(m['rejected'])}")
        for rej in m["rejected"]:
            print(f"    - {rej['reason']}: {rej.get('confronto') or rej['ids']}")
        if problems:
            print("\n🛑 manifesto gerado NÃO passa na validação — não será escrito:")
            for p in problems:
                print(f"    - {p}")
            sys.exit(1)
        os.makedirs(os.path.dirname(MANIFEST_PATH), exist_ok=True)
        with open(MANIFEST_PATH, "w", encoding="utf-8") as fh:
            json.dump(m, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
        print(f"\n✓ escrito: {MANIFEST_PATH}")
        return

    m = load()
    problems = validate(m)
    print(f"Manifesto canônico BR{m['season']} — {len(m['rounds'])} rodadas, "
          f"{sum(len(r['canonicalFixtureIds']) for r in m['rounds'])} jogos")
    if problems:
        print("\n🛑 VALIDAÇÃO FALHOU:")
        for p in problems:
            print(f"    - {p}")
        sys.exit(1)
    print("✓ manifesto íntegro (partição, unicidade, contagem, numeração, proveniência).")


if __name__ == "__main__":
    main()
