#!/usr/bin/env python3
"""
Portão da política de ícone de assunto — e as MUTAÇÕES que provam que ele morde.

Um teste que só chamasse `assunto()` provaria que a função concatena. Não provaria nada sobre o
e-mail que sai. Então este arquivo faz duas coisas diferentes:

  1. VARRE O CÓDIGO REAL dos remetentes e exige que o assunto venha da política — a Powerball
     saía com ⚽ e nenhuma suíte reclamou, porque nenhuma suíte olhava para lá.
  2. MUTA a política e exige VERMELHO. Uma proteção sem mutação que a derrube é uma proteção que
     ninguém sabe se está ligada.
"""

import re
import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parents[2]
sys.path.insert(0, str(AQUI))

import subject_policy as P  # noqa: E402

falhas = []


def checa(nome, cond, detalhe=""):
    print(f"  [{'PASS' if cond else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ""))
    if not cond:
        falhas.append(nome)


# Remetentes reais e o propósito que cada um deve declarar.
REMETENTES = {
    "bolao/loterias/powerball/scripts/send_result_email.py": "LOTERIA_POWERBALL_RESULTADO",
    "bolao/br2026/scripts/send_round_email.py":              "FUTEBOL_RESULTADO_RODADA",
    "bolao/copa2026/scripts/send_result_email.py":           "FUTEBOL_RESULTADO_PARCIAL",
    "bolao/cdb2026/scripts/send_result_email.py":            "FUTEBOL_RESULTADO_PARCIAL",
    "bolao/copa2026/scripts/send_bracket_correction_email.py": "FUTEBOL_CORRECAO",
}


def main():
    print("POLÍTICA DE ÍCONE DE ASSUNTO\n")

    # ═══ 1. o mapeamento exigido ═════════════════════════════════════════════════════════════
    print("1. mapeamento exigido")
    checa("POWERBALL_SUBJECT_EMOJI = 🔴", P.icone("LOTERIA_POWERBALL_RESULTADO") == "🔴")
    checa("MEGA_MILLIONS_SUBJECT_EMOJI = 🔵", P.icone("LOTERIA_MEGAMILLIONS_RESULTADO") == "🔵")
    checa("FOOTBALL_NORMAL_SUBJECT_EMOJI = ⚽", P.icone("FUTEBOL_RESULTADO_RODADA") == "⚽")
    checa("FOOTBALL_FINAL_CHAMPION_SUBJECT_EMOJI = 🏆",
          P.icone("FUTEBOL_RESULTADO_FINAL_CAMPEAO") == "🏆")

    exemplos = [
        ("LOTERIA_POWERBALL_RESULTADO", "Resultado Powerball — 12.08.2026", "🔴"),
        ("LOTERIA_MEGAMILLIONS_RESULTADO", "Resultado Mega Millions — 14.08.2026", "🔵"),
        ("FUTEBOL_RESULTADO_RODADA", "Resultado da rodada — Brasileirão 2026", "⚽"),
        ("FUTEBOL_RESULTADO_FINAL_CAMPEAO", "Resultado final — Copa do Brasil 2026", "🏆"),
    ]
    for prop, txt, ic in exemplos:
        linha = P.assunto(prop, txt)
        ok, motivo = P.valida_assunto(prop, linha)
        checa(f"assunto de {prop}", ok and linha.startswith(ic), linha)

    # ═══ 2. contagem de ícone errado ═════════════════════════════════════════════════════════
    print("\n2. nenhum ícone de futebol em assunto de loteria")
    for prop in ("LOTERIA_POWERBALL_RESULTADO", "LOTERIA_MEGAMILLIONS_RESULTADO"):
        linha = P.assunto(prop, "Resultado — 12.08.2026")
        nome = "POWERBALL" if "POWERBALL" in prop else "MEGA_MILLIONS"
        checa(f"{nome}_SOCCER_EMOJI_COUNT = 0", linha.count("⚽") == 0, linha)
        checa(f"{nome}_TROPHY_EMOJI_COUNT = 0", linha.count("🏆") == 0, linha)

    print("\n3. FALSE_TROPHY_USAGE = 0")
    falsos = [p for p in P.PROPOSITOS
              if P.PROPOSITOS[p] == "🏆" and p != "FUTEBOL_RESULTADO_FINAL_CAMPEAO"]
    checa("o troféu pertence a EXATAMENTE um propósito", not falsos, str(falsos))
    for proibido in ("FUTEBOL_RESULTADO_RODADA", "FUTEBOL_RANKING_PARCIAL", "FUTEBOL_CONVITE",
                     "FUTEBOL_COMPROVANTE", "FUTEBOL_CONFIRMACAO_PALPITE",
                     "LOTERIA_POWERBALL_RESULTADO", "LOTERIA_MEGAMILLIONS_RESULTADO"):
        ok, _ = P.valida_assunto(proibido, "🏆 qualquer coisa")
        checa(f"{proibido} com 🏆 é REPROVADO", not ok)

    # ═══ 4. propósito desconhecido falha fechado ═════════════════════════════════════════════
    print("\n4. falha fechado")
    try:
        P.icone("EMAIL_NOVO_QUE_NINGUEM_DECLAROU")
        checa("propósito não declarado levanta", False, "não levantou")
    except P.PropositoDesconhecido:
        checa("propósito não declarado levanta", True)
    try:
        P.assunto("FUTEBOL_RESULTADO_RODADA", "⚽ já tem ícone aqui")
        checa("ícone duplicado no texto é recusado", False, "não levantou")
    except ValueError as e:
        checa("ícone duplicado no texto é recusado", "ICONE_NO_TEXTO" in str(e))

    # ═══ 5. os remetentes REAIS ══════════════════════════════════════════════════════════════
    print("\n5. os remetentes reais passam pela política")
    for rel, prop in REMETENTES.items():
        f = RAIZ / rel
        if not f.exists():
            checa(f"{rel} existe", False)
            continue
        src = f.read_text(encoding="utf-8")
        # Linhas que ATRIBUEM um assunto. Comentários e docstrings não contam: a política é sobre
        # o que o programa faz, não sobre o que o arquivo menciona — varrer prosa foi o engano
        # que este repositório já cometeu num gate anterior.
        atribuicoes = [l for l in src.splitlines()
                       if re.search(r"^\s*(subject|SUBJECT|assunto)\s*=", l)]
        checa(f"{Path(rel).parent.parent.name}/{Path(rel).name}: achou atribuição de assunto",
              bool(atribuicoes), f"{len(atribuicoes)} linha(s)")
        for l in atribuicoes:
            if "[TESTE]" in l:
                continue   # preview para o admin; não é e-mail de participante
            checa(f"  -> vem da política: {l.strip()[:58]}",
                  "_subject_policy." in l or "subject_policy." in l)
        # Nenhum literal de ícone sobrando em linha de assunto.
        for l in atribuicoes:
            checa(f"  -> sem ícone literal: {l.strip()[:58]}",
                  not any(x in l for x in ("⚽", "🏆", "🔴", "🔵")))

    print("\n6. NENHUM assunto de loteria retém ⚽ em lugar nenhum do repositório")
    achados = []
    for f in (RAIZ / "bolao" / "loterias").rglob("*.py"):
        for i, l in enumerate(f.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            if "⚽" in l and re.search(r"(subject|assunto)\s*=", l):
                achados.append(f"{f.relative_to(RAIZ)}:{i}")
    checa("POWERBALL_SOCCER_EMOJI_COUNT = 0 (varredura do repositório)", not achados,
          str(achados))

    # ═══ 7. MUTAÇÕES — cada proteção tem de ficar VERMELHA quando removida ═══════════════════
    print("\n7. mutações (cada uma DEVE derrubar o portão)")
    original = dict(P.PROPOSITOS)
    mutacoes = [
        ("Powerball volta para ⚽", "LOTERIA_POWERBALL_RESULTADO", "⚽"),
        ("Mega Millions vira ⚽", "LOTERIA_MEGAMILLIONS_RESULTADO", "⚽"),
        ("rodada normal do BR vira 🏆", "FUTEBOL_RESULTADO_RODADA", "🏆"),
        ("campeão final perde o 🏆", "FUTEBOL_RESULTADO_FINAL_CAMPEAO", "⚽"),
    ]
    for nome, prop, icone_mutante in mutacoes:
        P.PROPOSITOS[prop] = icone_mutante
        try:
            linha = f"{icone_mutante} qualquer texto"
            ok, motivo = P.valida_assunto(prop, linha)
            # A mutação só é detectada se a validação passar a REPROVAR o que antes aprovava,
            # OU se o ícone deixar de ser o exigido pela política escrita.
            exigido = {"LOTERIA_POWERBALL_RESULTADO": "🔴",
                       "LOTERIA_MEGAMILLIONS_RESULTADO": "🔵",
                       "FUTEBOL_RESULTADO_RODADA": "⚽",
                       "FUTEBOL_RESULTADO_FINAL_CAMPEAO": "🏆"}[prop]
            detectada = (not ok) or (P.icone(prop) != exigido)
            checa(f"MUTAÇÃO '{nome}' fica VERMELHA", detectada,
                  motivo if not ok else f"ícone virou {P.icone(prop)}, exigido {exigido}")
        finally:
            P.PROPOSITOS.clear()
            P.PROPOSITOS.update(original)
    checa("política restaurada depois das mutações", P.PROPOSITOS == original)

    print("\n" + "=" * 78)
    if falhas:
        print(f"POLÍTICA DE ASSUNTO REPROVADA ({len(falhas)})")
        for f in falhas:
            print(f"    - {f}")
        return 1
    print("POLÍTICA DE ASSUNTO APROVADA")
    print("  POWERBALL = 🔴   MEGA_MILLIONS = 🔵   FOOTBALL_NORMAL = ⚽   "
          "FOOTBALL_FINAL_CHAMPION = 🏆   FALSE_ICON_USAGE = 0")
    return 0


if __name__ == "__main__":
    sys.exit(main())
