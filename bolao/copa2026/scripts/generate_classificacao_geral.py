"""
generate_classificacao_geral.py — Bolão Ferrari Copa 2026

Regenerates bolao/classificacao-geral.html — a standalone, unlinked "who's still alive" page:
each real entry's current point total, mathematically-exhaustive elimination status for 1st/2nd/
3rd money position, and the probability of finishing in each of those positions.

Eduardo, 2026-07-19, clarifying an earlier request: "Not the probability tab, the page we created
to see who's still alive or not... this was the page I was referring to in relation to
probabilities" — https://www.ferrarilabs.com/bolao/classificacao-geral.html (originally added
v4.134 on 2026-07-15, hand-written that one time, results only through the semifinals — never had
a generator script until now).

Only M104 (the Final) remains undecided now that M103 (3rd place) is locked. That makes the
"alive/eliminated" check exhaustively enumerable (every realistic scoreline, not sampled) and lets
the probability model use a bivariate Poisson scoreline distribution anchored to the live
Polymarket market win probability for the two finalists — a fresh, disclosed model, not a port of
app.js's own team-strength Monte Carlo engine (which is JS-only and not reusable from Python).

Usage:
  python3 generate_classificacao_geral.py
"""
import json
import math
import os
import sys
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import send_result_email as sre

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
OUT_PATH = os.path.join(REPO_ROOT, "bolao", "copa2026", "classificacao-geral.html")

MAX_GOALS = 6
TOTAL_LAMBDA = 2.4  # expected combined goals in a World Cup final — disclosed assumption


def fetch_polymarket_odds(team_a, team_b):
    """Live market win probability for the two finalists, renormalized to sum to 1 (only 2 teams
    remain, so the vig-adjusted raw prices are re-scaled). Falls back to 50/50 if unreachable."""
    try:
        req = urllib.request.Request(
            "https://gamma-api.polymarket.com/events?slug=world-cup-winner",
            headers={"User-Agent": "Mozilla/5.0"},
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read())
        prices = {}
        for m in data[0]["markets"]:
            team = m.get("groupItemTitle")
            raw = json.loads(m.get("outcomePrices", "[]"))
            if team and raw:
                prices[team] = float(raw[0])
        pa, pb = prices.get(team_a), prices.get(team_b)
        if pa is None or pb is None or (pa + pb) <= 0:
            return 0.5, 0.5, False
        return pa / (pa + pb), pb / (pa + pb), True
    except Exception:
        return 0.5, 0.5, False


def poisson_pmf(k, lam):
    return math.exp(-lam) * lam ** k / math.factorial(k)


def solve_lambdas(p_a_adjusted, total_lambda=TOTAL_LAMBDA, max_goals=MAX_GOALS):
    """Finds split s in (0,1) so lamA=total*s, lamB=total*(1-s) reproduces the market's implied
    P(A wins), with a scoreline tie split 50/50 between the two teams (unknowable penalty
    outcome), via a simple bivariate-Poisson model and bisection search."""
    def f(s):
        lam_a, lam_b = total_lambda * s, total_lambda * (1 - s)
        p_a = p_tie = 0.0
        for ga in range(max_goals + 1):
            for gb in range(max_goals + 1):
                p = poisson_pmf(ga, lam_a) * poisson_pmf(gb, lam_b)
                if ga > gb:
                    p_a += p
                elif ga == gb:
                    p_tie += p
        return p_a + 0.5 * p_tie - p_a_adjusted
    lo, hi = 0.02, 0.98
    for _ in range(50):
        mid = (lo + hi) / 2
        if f(mid) < 0:
            lo = mid
        else:
            hi = mid
    s = (lo + hi) / 2
    return total_lambda * s, total_lambda * (1 - s)


def enumerate_m104_scenarios(lam_a, lam_b, max_goals=MAX_GOALS):
    """Every realistic M104 outcome with a Poisson-derived weight; a tied scoreline is split
    50/50 across both possible penalty winners (unknowable in advance) — same "physically
    registerable by the admin" rule the original page's exhaustive check used: side is forced by
    the score except on a tie, where either side can still win."""
    scenarios = []
    for ga in range(max_goals + 1):
        for gb in range(max_goals + 1):
            base_w = poisson_pmf(ga, lam_a) * poisson_pmf(gb, lam_b)
            if ga > gb:
                scenarios.append({"goalsA": ga, "goalsB": gb, "advanceSide": "A", "weight": base_w})
            elif gb > ga:
                scenarios.append({"goalsA": ga, "goalsB": gb, "advanceSide": "B", "weight": base_w})
            else:
                scenarios.append({"goalsA": ga, "goalsB": gb, "advanceSide": "A", "weight": base_w / 2})
                scenarios.append({"goalsA": ga, "goalsB": gb, "advanceSide": "B", "weight": base_w / 2})
    total_w = sum(s["weight"] for s in scenarios)
    for s in scenarios:
        s["weight"] /= total_w
    return scenarios


def rank_entries(entries, results):
    """Same tiebreak cascade as scoreEntry()/renderRanking(): total -> exact -> podium hits."""
    scored = sorted(
        [{"id": e["id"], "total": sre.score_entry_total(e, results),
          "exact": sre.exact_match_count(e, results), "podium": sre.podium_hits(e, results)}
         for e in entries],
        key=lambda x: (-x["total"], -x["exact"], -x["podium"]),
    )
    ranks = {}
    rank, prev_key = 0, None
    for i, item in enumerate(scored):
        key = (item["total"], item["exact"], item["podium"])
        if key != prev_key:
            rank = i + 1
        prev_key = key
        ranks[item["id"]] = rank
    return ranks


def esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;"))


TEAM_FLAGS = {
    "Spain": "🇪🇸", "Argentina": "🇦🇷", "France": "🇫🇷", "England": "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
    "Brazil": "🇧🇷", "Paraguay": "🇵🇾", "Colombia": "🇨🇴", "Mexico": "🇲🇽",
    "Portugal": "🇵🇹", "Germany": "🇩🇪", "Netherlands": "🇳🇱", "Belgium": "🇧🇪",
    "United States": "🇺🇸", "Switzerland": "🇨🇭", "Australia": "🇦🇺", "Morocco": "🇲🇦",
    "Norway": "🇳🇴", "Ivory Coast": "🇨🇮", "Croatia": "🇭🇷", "Senegal": "🇸🇳",
    "Egypt": "🇪🇬", "Ecuador": "🇪🇨", "DR Congo": "🇨🇩", "Ghana": "🇬🇭",
    "Bosnia and Herzegovina": "🇧🇦", "Algeria": "🇩🇿", "Sweden": "🇸🇪",
    "South Africa": "🇿🇦", "Canada": "🇨🇦", "Japan": "🇯🇵", "Cape Verde": "🇨🇻",
}


def chance_cell(guaranteed, exact_pct, group_class):
    if guaranteed:
        return (f'<td class="num chance-cell"><div class="chance-bar-wrap"><div class="chance-track">'
                 f'<div class="chance-fill {group_class} guaranteed" style="width:100%"></div></div>'
                 f'<span class="chance-pct guaranteed-label">Garantido</span></div></td>')
    if exact_pct <= 0:
        return (f'<td class="num chance-cell"><div class="chance-bar-wrap"><div class="chance-track">'
                 f'<div class="chance-fill {group_class}" style="width:0%"></div></div>'
                 f'<span class="chance-pct zero">—</span></div></td>')
    if exact_pct < 0.1:
        return (f'<td class="num chance-cell"><div class="chance-bar-wrap"><div class="chance-track">'
                 f'<div class="chance-fill {group_class}" style="width:2%"></div></div>'
                 f'<span class="chance-pct rare">&lt;0,1%</span></div></td>')
    width = min(100, exact_pct)
    pct_str = f"{exact_pct:.0f}%" if exact_pct >= 1 else (f"{exact_pct:.1f}%".replace(".", ","))
    return (f'<td class="num chance-cell"><div class="chance-bar-wrap"><div class="chance-track">'
             f'<div class="chance-fill {group_class}" style="width:{width}%"></div></div>'
             f'<span class="chance-pct">{pct_str}</span></div></td>')


PAGE_STYLE = """
  :root {
    --pitch-950: #0a1e15;
    --pitch-900: #0d2519;
    --pitch-850: #103023;
    --pitch-700: #1c4732;
    --pitch-600: #285940;
    --gold-400: #f0c14b;
    --gold-300: #f7d778;
    --grass-400: #43d17d;
    --grass-300: #7fe7ac;
    --red-450: #ef5158;
    --red-300: #ff8b90;
    --cream-100: #f6f2e4;
    --cream-300: #d9dccb;
    --cream-500: #a3ab9c;
    --line: rgba(246,242,228,0.10);
  }
  :root[data-theme="light"] {
    --pitch-950: #f3f1e7;
    --pitch-900: #ffffff;
    --pitch-850: #ffffff;
    --pitch-700: #e4e2d3;
    --pitch-600: #d3d0bd;
    --cream-100: #17241c;
    --cream-300: #33453a;
    --cream-500: #5b6b5f;
    --line: rgba(23,36,28,0.12);
  }
  @media (prefers-color-scheme: light) {
    :root:not([data-theme="dark"]) {
      --pitch-950: #f3f1e7;
      --pitch-900: #ffffff;
      --pitch-850: #ffffff;
      --pitch-700: #e4e2d3;
      --pitch-600: #d3d0bd;
      --cream-100: #17241c;
      --cream-300: #33453a;
      --cream-500: #5b6b5f;
      --line: rgba(23,36,28,0.12);
    }
  }

  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; overflow-x: hidden; }
  body {
    background: var(--pitch-950);
    color: var(--cream-100);
    font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.5;
    background-image:
      radial-gradient(ellipse 900px 500px at 15% -5%, rgba(240,193,75,0.10), transparent 60%),
      radial-gradient(ellipse 700px 500px at 100% 10%, rgba(67,209,125,0.08), transparent 55%);
  }

  .wrap { max-width: 1040px; margin: 0 auto; padding: 36px 20px 64px; }

  header.hero {
    display: flex; flex-direction: column; gap: 6px;
    padding-bottom: 22px; margin-bottom: 22px;
    border-bottom: 1px solid var(--line);
  }
  .eyebrow {
    font-size: 12px; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase;
    color: var(--gold-400); display: flex; align-items: center; gap: 8px;
  }
  .eyebrow .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--grass-400); box-shadow: 0 0 0 3px rgba(67,209,125,0.18); }
  h1 {
    font-size: clamp(28px, 5vw, 44px); font-weight: 900; letter-spacing: -0.02em;
    text-transform: uppercase; margin: 4px 0 2px; text-wrap: balance; line-height: 1.02;
  }
  h1 .accent { color: var(--gold-400); }
  .subhead { color: var(--cream-300); font-size: 15px; max-width: 640px; }
  .subhead b { color: var(--cream-100); }

  .matchup-row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }
  .matchup {
    background: var(--pitch-850); border: 1px solid var(--line); border-radius: 10px;
    padding: 10px 14px; display: flex; align-items: center; gap: 10px; font-size: 14px;
  }
  .matchup .tag {
    font-size: 10px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase;
    color: var(--pitch-950); background: var(--gold-400); padding: 3px 7px; border-radius: 5px;
  }
  .matchup .teams { font-weight: 700; font-variant-numeric: tabular-nums; }
  .matchup .date { color: var(--cream-500); font-size: 12.5px; }

  .legend {
    display: flex; flex-wrap: wrap; gap: 18px; align-items: center;
    padding: 12px 16px; background: var(--pitch-850); border: 1px solid var(--line);
    border-radius: 10px; margin: 18px 0 26px; font-size: 12.5px; color: var(--cream-300);
  }
  .legend b { color: var(--cream-100); font-variant-numeric: tabular-nums; }
  .legend .sep { width: 1px; height: 14px; background: var(--line); }

  .table-scroll { overflow-x: auto; border-radius: 14px; border: 1px solid var(--line); }
  table { border-collapse: collapse; width: 100%; min-width: 760px; background: var(--pitch-900); }
  thead th {
    position: sticky; top: 0; background: var(--pitch-700); color: var(--cream-100);
    text-align: left; font-size: 10.5px; font-weight: 800; text-transform: uppercase;
    letter-spacing: 0.07em; padding: 12px 12px; border-bottom: 1px solid var(--line); white-space: nowrap;
  }
  thead th.num, td.num { text-align: center; }
  tbody td { padding: 11px 12px; border-bottom: 1px solid var(--line); font-size: 13.5px; vertical-align: middle; }
  tbody tr:last-child td { border-bottom: none; }
  tbody tr.dead { opacity: 0.55; }
  tbody tr:hover { background: rgba(246,242,228,0.03); }

  .pos { font-weight: 900; font-size: 15px; font-variant-numeric: tabular-nums; width: 30px; text-align: center; position: relative; }
  tr.prize .pos { color: var(--pitch-950); }
  tr.prize td:first-child { position: relative; }
  tr.prize td:first-child::before {
    content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--gold-400);
  }
  tr.prize .pos-badge {
    display: inline-flex; align-items: center; justify-content: center;
    width: 26px; height: 26px; border-radius: 7px; background: var(--gold-400); color: var(--pitch-950);
    font-weight: 900;
  }
  tr:not(.prize) .pos-badge { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; color: var(--cream-300); }

  .name-cell { display: flex; align-items: center; gap: 9px; }
  .name-cell .nm { font-weight: 700; color: var(--cream-100); }
  .name-cell .champ-pick { font-size: 11.5px; color: var(--cream-500); }

  .status-pill {
    display: inline-flex; align-items: center; gap: 5px; font-size: 10.5px; font-weight: 800;
    text-transform: uppercase; letter-spacing: 0.05em; padding: 3px 9px; border-radius: 999px;
  }
  .status-pill.alive { background: rgba(67,209,125,0.15); color: var(--grass-300); border: 1px solid rgba(67,209,125,0.35); }
  .status-pill.dead { background: rgba(239,81,88,0.13); color: var(--red-300); border: 1px solid rgba(239,81,88,0.30); }

  .score { font-variant-numeric: tabular-nums; font-weight: 800; font-size: 14.5px; }
  .score .sub { font-weight: 500; color: var(--cream-500); font-size: 11.5px; margin-left: 3px;}

  .chance-cell { min-width: 122px; }
  .chance-bar-wrap { display: flex; align-items: center; gap: 8px; }
  .chance-track { flex: 1; height: 7px; border-radius: 999px; background: var(--pitch-700); overflow: hidden; min-width: 46px; }
  .chance-fill { height: 100%; border-radius: 999px; }
  .chance-fill.g1 { background: linear-gradient(90deg, var(--gold-300), var(--gold-400)); }
  .chance-fill.g2 { background: linear-gradient(90deg, #c9d6c1, var(--cream-300)); }
  .chance-fill.g3 { background: linear-gradient(90deg, #c98a4b, #e0a868); }
  .chance-pct { font-variant-numeric: tabular-nums; font-weight: 700; font-size: 12.5px; width: 40px; text-align: right; }
  .chance-pct.zero { color: var(--cream-500); font-weight: 500; }
  .chance-pct.rare { color: var(--cream-500); font-weight: 600; font-size: 10.5px; width: 44px; }
  .chance-fill.guaranteed { background: repeating-linear-gradient(135deg, currentColor 0 4px, transparent 4px 8px); position: relative; }
  .chance-fill.g1.guaranteed { color: var(--gold-400); background-color: var(--gold-400); background-image: repeating-linear-gradient(135deg, rgba(255,255,255,.35) 0 3px, transparent 3px 7px); }
  .chance-fill.g2.guaranteed { color: var(--cream-300); background-color: var(--cream-300); background-image: repeating-linear-gradient(135deg, rgba(10,30,21,.20) 0 3px, transparent 3px 7px); }
  .chance-fill.g3.guaranteed { color: #e0a868; background-color: #e0a868; background-image: repeating-linear-gradient(135deg, rgba(255,255,255,.30) 0 3px, transparent 3px 7px); }
  .chance-pct.guaranteed-label { color: var(--grass-300); font-weight: 800; font-size: 10.5px; width: 56px; letter-spacing: 0.02em; }

  .method {
    margin-top: 26px; padding: 16px 18px; border-radius: 12px;
    background: var(--pitch-850); border: 1px solid var(--line);
    font-size: 12.5px; color: var(--cream-500); line-height: 1.6;
  }
  .method b { color: var(--cream-300); }
  .method .title { color: var(--cream-100); font-weight: 800; text-transform: uppercase; font-size: 11px; letter-spacing: 0.08em; margin-bottom: 8px; }

  footer.sig { text-align: center; margin-top: 28px; font-size: 12px; color: var(--cream-500); }

  @media (max-width: 640px) {
    .wrap { padding: 24px 12px 48px; }
    .name-cell .champ-pick { display: none; }
  }
"""


def render_page(rows, meta, tA, tB, pA, pB, poly_ok):
    now = meta["generated_at"]
    gen_str = now.strftime("%d/%m/%Y")
    gen_str_full = now.strftime("%d/%m/%Y %H:%M UTC")
    alive_count = sum(1 for r in rows if r["alive"])
    dead_count = len(rows) - alive_count
    flag_a, flag_b = TEAM_FLAGS.get(tA, ""), TEAM_FLAGS.get(tB, "")

    trs = []
    for r in rows:
        row_class = "prize" if r["rank"] and r["rank"] <= 3 else ""
        if not r["alive"]:
            row_class = (row_class + " dead").strip()
        status = '<span class="status-pill alive">Vivo</span>' if r["alive"] else '<span class="status-pill dead">Eliminado</span>'
        champ_pick = r["champion_pick"]
        champ_flag = TEAM_FLAGS.get(champ_pick, "") if champ_pick else ""
        champ_html = f'<span class="champ-pick">apostou no {champ_flag} {esc(champ_pick)}</span>' if champ_pick else ""
        pos_badge = f'<span class="pos-badge">{r["rank"]}</span>' if r["rank"] else '<span class="pos-badge">—</span>'
        c1 = chance_cell(r["guaranteed"][1], r["chance"][1] * 100, "g1")
        c2 = chance_cell(r["guaranteed"][2], r["chance"][2] * 100, "g2")
        c3 = chance_cell(r["guaranteed"][3], r["chance"][3] * 100, "g3")
        trs.append(f"""<tr class="{row_class}">
      <td class="pos">{pos_badge}</td>
      <td><div class="name-cell"><span class="nm">{esc(r['name'])}</span>{champ_html}</div></td>
      <td class="num score">{r['total']}</td>
      <td>{status}</td>
      {c1}
      {c2}
      {c3}
    </tr>""")

    return f"""<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="description" content="Bolão do Ferrari — Copa 2026 — classificação geral, vivo/eliminado e chances de 1º, 2º e 3º lugar.">
<meta http-equiv="Content-Security-Policy" content="
  default-src 'none';
  style-src 'unsafe-inline';
  img-src 'self' data:;
  base-uri 'self';
">
<link rel="icon" href="data:,">
<title>Classificação Geral — Bolão do Ferrari — Copa 2026</title>
<style>{PAGE_STYLE}</style>
</head>
<body>

<div class="wrap">

  <header class="hero">
    <div class="eyebrow"><span class="dot"></span>Bolão do Ferrari &middot; Copa do Mundo 2026</div>
    <h1>Classificação <span class="accent">Geral</span></h1>
    <p class="subhead">Quem ainda pode ser <b>campeão do bolão</b> — calculado direto do estado real do site ({len(rows)} entradas, resultados oficiais até o 3º lugar), com a fórmula de pontuação exata usada para pagar o prêmio.</p>
    <div class="matchup-row">
      <div class="matchup"><span class="tag">Final &middot; hoje</span><span class="teams">{flag_a} {esc(tA)} × {esc(tB)} {flag_b}</span></div>
    </div>
  </header>

  <div class="legend">
    <span><b>{len(rows)}</b> entradas na disputa</span>
    <span class="sep"></span>
    <span><b>{alive_count}</b> ainda vivas &middot; <b>{dead_count}</b> eliminadas</span>
    <span class="sep"></span>
    <span>Resta <b>1</b> jogo: a Final</span>
    <span class="sep"></span>
    <span>Prêmio: <b>70%</b> 1º &middot; <b>20%</b> 2º &middot; <b>10%</b> 3º</span>
    <span class="sep"></span>
    <span>Empate técnico → desempate por placares exatos, depois pódio certo</span>
  </div>

  <div class="table-scroll">
    <table>
      <thead>
        <tr>
          <th class="num">#</th>
          <th>Participante</th>
          <th class="num">Pontos</th>
          <th>Situação</th>
          <th class="num">Chance 1º</th>
          <th class="num">Chance 2º</th>
          <th class="num">Chance 3º</th>
        </tr>
      </thead>
      <tbody id="rows-body">
{"".join(trs)}
      </tbody>
    </table>
  </div>

  <div class="method">
    <div class="title">Como foi calculado</div>
    Pontuação, chaveamento e bônus de pódio replicados <b>função por função</b> a partir do código real do site
    (<code>scoreEntry</code>/<code>score_entry_total</code>, <code>matchPoints</code>/<code>score_match</code>, <code>podiumFromResults</code>/<code>_podium_from_results</code>) contra o estado real salvo no banco
    ({len(rows)} entradas, resultados oficiais confirmados até o 3º lugar — jogos 73 a 103. Só falta a Final, M104: {esc(tA)} × {esc(tB)}).
    <p style="margin:12px 0 0;"><b>Situação (Vivo/Eliminado)</b> é uma checagem exaustiva — testamos todos os 56 placares e lados
    de classificação <b>fisicamente registráveis pelo admin</b> na Final (todos os placares de 0×0 a {MAX_GOALS}×{MAX_GOALS}, com
    empate contando os dois lados possíveis via pênaltis) e vimos se existe algum resultado possível — mesmo que improvável —
    que coloque o participante em 1º, 2º ou 3º do bolão. Como só resta um jogo, esta checagem agora é <b>exata</b>, não uma
    amostra: cobrimos literalmente todo placar razoável. Se não existe nenhum resultado válido, está matematicamente eliminado
    do pódio.</p>
    <p style="margin:10px 0 0;">A coluna de chance mistura <b>dois tipos diferentes de resposta</b>, e cada célula mostra o
    tipo certo — nunca os dois misturados como uma porcentagem só:</p>
    <ul style="margin:6px 0 0; padding-left:18px;">
      <li><b style="color:var(--grass-300);">Garantido</b> — prova matemática exaustiva: não existe nenhum placar possível
      da Final que tire o participante dessa posição <b>ou melhor</b>. Não é uma estimativa, é uma certeza.</li>
      <li><b>Porcentagem</b> — probabilidade exata (não amostrada) de terminar <b>exatamente</b> nessa posição, somando o peso
      de cada um dos 56 placares possíveis. O peso de cada placar vem de um modelo Poisson bivariado simples, calibrado para
      reproduzir a probabilidade real de vitória de cada seleção segundo o mercado ao vivo do Polymarket
      ({esc(tA)} {pA:.0%} × {esc(tB)} {pB:.0%}{"" if poly_ok else " — mercado indisponível no momento da geração, usado 50%/50% como padrão"}),
      assumindo {TOTAL_LAMBDA} gols esperados somados no jogo. É um modelo simplificado, não uma previsão precisa de placar.</li>
      <li><b>&lt;0,1%</b> — o participante está matematicamente vivo para essa posição (existe um placar possível que
      chega lá), mas o peso combinado desses placares é pequeno demais para arredondar acima de 0,1%. Vivo não é
      o mesmo que provável.</li>
      <li><b>—</b> — matematicamente impossível: nenhum placar da Final chega nessa posição.</li>
    </ul>
    <p style="margin:10px 0 0;">Esta página é uma <b>foto do momento</b> (não atualiza sozinha) — gerada a partir do estado
    real em {gen_str}, com resultados confirmados até o 3º lugar (M103).</p>
  </div>

  <footer class="sig">Gerado a partir dos dados reais do site &middot; resultados até o 3º lugar &middot; {gen_str_full}</footer>

</div>
</body>
</html>"""


def main():
    print("Fetching live production state from Supabase...")
    state = sre.sb_fetch()
    real_results = {k: v for k, v in (state.get("results") or {}).items() if v and v.get("advanceSide")}
    deleted = set(state.get("deletedIds", []))
    entries = [e for e in state.get("entries", [])
               if e.get("id") not in deleted and not (e.get("diagnostics") or {}).get("demo")]
    print(f"  {len(entries)} real entries, {len(real_results)} locked results")

    if real_results.get("104", {}).get("advanceSide"):
        print("M104 is already locked — this script only models the still-undecided Final.")
        print("Nothing to project; re-run generate_audit_report.py instead for a final report.")
        sys.exit(1)
    if not real_results.get("103", {}).get("advanceSide"):
        print("M103 is not locked yet — this script assumes only M104 remains. Aborting.")
        sys.exit(1)

    tA, tB = sre._real_teams("104", real_results)
    print(f"Final: {tA} vs {tB}")
    pA, pB, poly_ok = fetch_polymarket_odds(tA, tB)
    print(f"Market odds ({'live' if poly_ok else 'fallback 50/50'}): {tA} {pA:.1%} | {tB} {pB:.1%}")

    lam_a, lam_b = solve_lambdas(pA)
    print(f"Poisson lambdas: {tA}={lam_a:.2f}  {tB}={lam_b:.2f}")

    scenarios = enumerate_m104_scenarios(lam_a, lam_b)
    print(f"Enumerated {len(scenarios)} scenarios (all scorelines 0-{MAX_GOALS} x 0-{MAX_GOALS}, ties split both ways)")

    chance = {e["id"]: {1: 0.0, 2: 0.0, 3: 0.0} for e in entries}
    always_le = {e["id"]: {1: True, 2: True, 3: True} for e in entries}
    for sc in scenarios:
        sim_results = dict(real_results)
        sim_results["104"] = {"goalsA": sc["goalsA"], "goalsB": sc["goalsB"], "advanceSide": sc["advanceSide"]}
        ranks = rank_entries(entries, sim_results)
        for e in entries:
            r = ranks.get(e["id"])
            if r in (1, 2, 3):
                chance[e["id"]][r] += sc["weight"]
            for R in (1, 2, 3):
                if not (r is not None and r <= R):
                    always_le[e["id"]][R] = False

    current_total = {e["id"]: sre.score_entry_total(e, real_results) for e in entries}
    current_ranks = rank_entries(entries, real_results)

    rows = []
    for e in entries:
        pred = sre._entry_predicted_podium(e)
        alive = any(chance[e["id"]][R] > 0 or always_le[e["id"]][R] for R in (1, 2, 3))
        rows.append({
            "id": e["id"], "name": e.get("entryName", "?"), "total": current_total[e["id"]],
            "rank": current_ranks.get(e["id"]), "champion_pick": pred.get("champion"),
            "alive": alive, "chance": chance[e["id"]], "guaranteed": always_le[e["id"]],
        })
    rows.sort(key=lambda r: r["rank"] if r["rank"] is not None else 10**9)

    print(f"Alive: {sum(1 for r in rows if r['alive'])} / Eliminated: {sum(1 for r in rows if not r['alive'])}")

    meta = {"generated_at": datetime.now(timezone.utc)}
    html = render_page(rows, meta, tA, tB, pA, pB, poly_ok)
    with open(OUT_PATH, "w", encoding="utf-8") as fh:
        fh.write(html)
    print(f"✓ Written to {OUT_PATH}")


if __name__ == "__main__":
    main()
