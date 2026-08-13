#!/usr/bin/env python3
"""
Prova do comprovante do CDB2026 — renderização pura, sem banco e sem rede.

Quatro perguntas:

  1. o recibo é EVIDÊNCIA? (campeão/vice no topo, chaveamento completo, semântica por fase)
  2. ele vaza PII? (o comprovante da Copa expunha e-mail, responsável e pagamento)
  3. ele prova a VERSÃO que o gerou, mesmo que a entrada já tenha mudado?
  4. ele empata com a Copa no que a Copa acertava, sem herdar o que ela errava?

Nada aqui toca banco, provedor ou estado. `receipt_render` é função pura de snapshot.
"""

import json
import re
import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parents[2]
sys.path.insert(0, str(AQUI))

import receipt_render as R  # noqa: E402

falhas = []


def checa(nome, cond, detalhe=""):
    print(f"  [{'PASS' if cond else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ""))
    if not cond:
        falhas.append(nome)


# ── Snapshot sintético, mesma FORMA da produção (medida na perícia) ──────────────────────────
SNAP_A = {
    "entryName": "Entrada de Teste",
    "savedAt": "2026-08-13T00:22:14Z",
    "picks": {
        "matches": {
            "espn-gremio_internacional": {"first": {"goalsHome": 2, "goalsAway": 1},
                                          "second": {"goalsHome": 0, "goalsAway": 3}},
            "espn-atletico-mg_cruzeiro": {"first": {"goalsHome": 1, "goalsAway": 0},
                                          "second": {"goalsHome": 1, "goalsAway": 1}},
            "espn-vasco_vitoria": {"first": {"goalsHome": 2, "goalsAway": 0},
                                   "second": {"goalsHome": 1, "goalsAway": 1}},
            "espn-palmeiras_santos": {"first": {"goalsHome": 3, "goalsAway": 1},
                                      "second": {"goalsHome": 0, "goalsAway": 0}},
            "sf-1": {"first": {"goalsHome": 1, "goalsAway": 1},
                     "second": {"goalsHome": 2, "goalsAway": 0}},
            "sf-2": {"first": {"goalsHome": 2, "goalsAway": 0},
                     "second": {"goalsHome": 3, "goalsAway": 2}},
            "final-1": {"single": {"goalsHome": 2, "goalsAway": 0}},
        },
        "qualified": {
            "espn-gremio_internacional": "B", "espn-atletico-mg_cruzeiro": "A",
            "espn-vasco_vitoria": "A", "espn-palmeiras_santos": "A",
            "sf-1": "A", "sf-2": "B", "final-1": "A",
        },
    },
    "phases": {
        "quartas": {"ties": {
            "espn-gremio_internacional": {"teamA": "Internacional", "teamB": "Grêmio"},
            "espn-atletico-mg_cruzeiro": {"teamA": "Cruzeiro", "teamB": "Atlético-MG"},
            "espn-vasco_vitoria": {"teamA": "Vasco", "teamB": "Vitória"},
            "espn-palmeiras_santos": {"teamA": "Palmeiras", "teamB": "Santos"},
        }, "topology": {}},
        "semifinal": {"ties": {}, "topology": {
            "sf-1": {"sideA": {"winnerOf": "espn-gremio_internacional"},
                     "sideB": {"winnerOf": "espn-atletico-mg_cruzeiro"}},
            "sf-2": {"sideA": {"winnerOf": "espn-vasco_vitoria"},
                     "sideB": {"winnerOf": "espn-palmeiras_santos"}},
        }},
        "final": {"ties": {}, "topology": {}},
    },
}


def main():
    print("PROVA — comprovante do CDB2026 (renderização pura)\n")
    html = R.monta_recibo(SNAP_A, "37842fb6d8f2019c")

    # ═══ 1. O RECIBO É EVIDÊNCIA ═════════════════════════════════════════════════════════════
    print("1. o recibo registra o que foi salvo")
    checa("ENTRY_PRESENT", "Entrada de Teste" in html)
    checa("competição identificada", "Copa do Brasil 2026" in html)
    checa("declara que registra os palpites salvos",
          "exatamente os palpites salvos" in html)

    # Grêmio passa nas quartas (qualified B), Cruzeiro passa (A) -> sf-1 = Grêmio × Cruzeiro,
    # sf-1 qualified A -> Grêmio. Vasco (A) e Palmeiras (A) -> sf-2 = Vasco × Palmeiras,
    # qualified B -> Palmeiras. Final = Grêmio × Palmeiras, qualified A -> CAMPEÃO Grêmio.
    camp, vice = R.podio(SNAP_A)
    checa("CHAMPION_PRESENT", camp == "Grêmio", f"campeão={camp}")
    checa("RUNNER_UP_PRESENT", vice == "Palmeiras", f"vice={vice}")
    checa("campeão rotulado no topo", "🏆 CAMPEÃO" in html and camp in html)
    checa("vice rotulado no topo", "🥈 VICE-CAMPEÃO" in html and vice in html)

    checa("QF_PRESENT", "Quartas de Final" in html)
    checa("SF_PRESENT", "Semifinal" in html)
    checa("FINAL_PRESENT", ">Final<" in html or "Final</div>" in html)
    checa("THIRD_PLACE_PRESENT = NO",
          not re.search(r"3º lugar|terceiro lugar|4º lugar|quarto lugar", html, re.I))

    # ═══ 2. SEMÂNTICA POR FASE ═══════════════════════════════════════════════════════════════
    print("\n2. CLASSIFICADO nas fases; CAMPEÃO na final")
    depois_final = html[html.rindex("Final</div>"):] if "Final</div>" in html else ""
    checa("a final NÃO usa 'CLASSIFICADO'", "CLASSIFICADO" not in depois_final,
          depois_final[:120])
    checa("a final usa 'CAMPEÃO'", "CAMPEÃO" in depois_final)
    checa("as quartas usam 'CLASSIFICADO'", "CLASSIFICADO:" in html)

    # A seção da final registra as DUAS posições — não só o campeão, como antes.
    checa("FINAL_CHAMPION_PRESENT", "🏆 CAMPEÃO:" in depois_final)
    checa("FINAL_RUNNER_UP_PRESENT", "🥈 VICE-CAMPEÃO:" in depois_final)
    checa("FINAL_CHAMPION_CORRECT", f"🏆 CAMPEÃO:</span> <b>{camp}</b>" in depois_final,
          depois_final[-260:])
    checa("FINAL_RUNNER_UP_CORRECT", f"🥈 VICE-CAMPEÃO:</span> <b>{vice}</b>" in depois_final,
          depois_final[-260:])
    # O vice da final tem de ser o mesmo do topo: os dois saem do mesmo snapshot.
    checa("final e topo concordam sobre o vice",
          depois_final.count(vice) >= 1 and vice in html)
    checa("a final NÃO ganhou 3º/4º lugar",
          not re.search(r"3º|terceiro|4º|quarto", depois_final, re.I))

    # ═══ 3. A VOLTA NÃO PODE INVERTER (AUDIT-05) ═════════════════════════════════════════════
    print("\n3. o mando inverte na volta — o defeito AUDIT-05 não volta")
    casa1, fora1 = R.leg_teams({"teamA": "Internacional", "teamB": "Grêmio"}, "first")
    casa2, fora2 = R.leg_teams({"teamA": "Internacional", "teamB": "Grêmio"}, "second")
    checa("ida: mandante é teamA", (casa1, fora1) == ("Internacional", "Grêmio"))
    checa("volta: mandante é teamB", (casa2, fora2) == ("Grêmio", "Internacional"))
    # No HTML: Jogo 2 do confronto Internacional × Grêmio é "Grêmio 0 × 3 Internacional".
    checa("o HTML imprime a volta com o mandante certo",
          "Grêmio <b>0 × 3</b> Internacional" in html,
          "procurado: 'Grêmio <b>0 × 3</b> Internacional'")
    checa("o HTML NÃO imprime a volta invertida",
          "Internacional <b>0 × 3</b> Grêmio" not in html)

    # ═══ 4. PII ══════════════════════════════════════════════════════════════════════════════
    print("\n4. PII_SCAN — o que a Copa expunha não volta")
    achados = R.varre_pii(html, extras=["03e9fe14-d777-4a71-9c31-3d54dd21a07c"])
    checa("PII_SCAN", achados == [], f"encontrado: {achados}")
    for campo in ("participantEmail", "payerName", "paymentMethod", "token"):
        checa(f"sem '{campo}'", campo.lower() not in html.lower())
    checa("sem endereço de e-mail", "@" not in html)
    checa("sem UUID interno",
          not re.search(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b",
                        html, re.I))

    # ═══ 5. TIMESTAMP HUMANO ═════════════════════════════════════════════════════════════════
    print("\n5. horário legível, com fuso rotulado corretamente")
    # 2026-08-13T00:22:14Z = 12/08/2026 21:22 em Brasília (UTC-3).
    checa("HUMAN_TIMESTAMP", "12/08/2026 às 21:22 — horário de Brasília" in html,
          R.brt(SNAP_A["savedAt"]))
    checa("não mostra 'UTC' cru ao participante", "(UTC)" not in html)
    checa("não rotula UTC como local",
          not re.search(r"00:22.*Brasília", html))

    # ═══ 6. CONSISTÊNCIA DE SNAPSHOT ═════════════════════════════════════════════════════════
    print("\n6. o recibo de A continua sendo A depois da entrada virar B")
    snap_b = json.loads(json.dumps(SNAP_A))
    snap_b["picks"]["qualified"]["final-1"] = "B"     # agora o campeão seria Palmeiras
    snap_b["entryName"] = "Entrada Alterada"
    html_b = R.monta_recibo(snap_b, "outra-versao")
    # O recibo A é remontado DEPOIS de B existir. Como só depende do snapshot, não muda.
    html_a2 = R.monta_recibo(SNAP_A, "37842fb6d8f2019c")
    checa("RECEIPT_MATCHES_VERSION — A remontado é idêntico", html_a2 == html)
    checa("A continua com o campeão de A", "Grêmio" in R.podio(SNAP_A)[0])
    checa("B tem campeão diferente", R.podio(snap_b)[0] == "Palmeiras",
          str(R.podio(snap_b)))
    checa("o recibo de A não contém o nome da entrada de B",
          "Entrada Alterada" not in html_a2)

    # ═══ 7. FASE NOVA NÃO PODE SUMIR ═════════════════════════════════════════════════════════
    print("\n7. as fases do renderizador batem com data.js")
    ds = (RAIZ / "bolao" / "cdb2026" / "js" / "data.js").read_text()
    bloco = ds[ds.index("phases: ["):ds.index("],", ds.index("phases: ["))]
    do_js = re.findall(r'id:\s*"([^"]+)"[^}]*?name:\s*"([^"]+)"[^}]*?format:\s*"([^"]+)"', bloco)
    checa("mesma quantidade de fases", len(do_js) == len(R.FASES),
          f"data.js={len(do_js)} renderizador={len(R.FASES)}")
    checa("mesmos id/nome/formato, na mesma ordem", do_js == R.FASES,
          f"data.js={do_js}\n      render={R.FASES}")

    # ═══ 8. COMPARAÇÃO ESTRUTURAL COM A COPA ═════════════════════════════════════════════════
    print("\n8. empata com a Copa no que a Copa acertava")
    copa = (RAIZ / "bolao" / "copa2026" / "js" / "app.js").read_text()
    copa_receipt = copa[copa.index("function receiptHtml"):copa.index("function openReceipt")]
    # O que a Copa fazia CERTO e o CDB precisa igualar:
    checa("Copa: pódio em destaque -> CDB também",
          "podcard" in copa_receipt and "🏆 CAMPEÃO" in html)
    checa("Copa: lista completa dos palpites -> CDB também",
          "<tbody>" in copa_receipt and "Detalhamento dos palpites" in html)
    checa("Copa: frase de que o comprovante registra os palpites -> CDB também",
          "receiptIntro" in copa_receipt and "exatamente os palpites salvos" in html)
    # O que a Copa fazia ERRADO e o CDB NÃO pode herdar:
    checa("Copa expunha e-mail/pagamento; o CDB não",
          "participantEmail" in copa_receipt and "participantEmail" not in html)
    checa("Copa tinha 3º/4º; o CDB não tem (não existe na Copa do Brasil)",
          "receiptThird" in copa_receipt
          and not re.search(r"3º lugar|terceiro lugar", html, re.I))

    # ═══ 9. ASSUNTO ══════════════════════════════════════════════════════════════════════════
    print("\n9. assunto — o que o participante VÊ, já composto com o prefixo do transporte")
    visivel = R.assunto_visivel("Eduardo Ferrari")
    print(f"      {visivel}")
    # A duplicação nascia da COMPOSIÇÃO: a parte de cima sozinha parecia certa, e o Gmail mostrava
    # "Bolão do Ferrari - Bolão do Ferrari — …". Testar só `monta_assunto` deixaria isso passar.
    checa("VISIBLE_SUBJECT_BOLAO_DO_FERRARI_OCCURRENCES = 1",
          visivel.count("Bolão do Ferrari") == 1,
          f"ocorrências={visivel.count('Bolão do Ferrari')} em {visivel!r}")
    checa("a parte enviada NÃO assina a marca",
          "Bolão do Ferrari" not in R.monta_assunto("Eduardo Ferrari"))
    for parte in ("Bolão do Ferrari", "Comprovante", "CDB 2026", "Eduardo Ferrari"):
        checa(f"assunto visível contém '{parte}'", parte in visivel)
    checa("assunto NÃO é o genérico antigo", "Palpites salvos" not in visivel)
    checa("assunto visível cabe na prévia do Gmail (<= 90 chars)", len(visivel) <= 90,
          f"len={len(visivel)}")

    # ═══ 10. RESPONSIVO ══════════════════════════════════════════════════════════════════════
    print("\n10. renderização em telefone")
    checa("largura máxima fluida", "max-width:600px" in html)
    # `max-width` é justamente o que mantém o e-mail fluido; a regex anterior o acusava por
    # conter a substring "width:600px". O que não pode existir é `width:` fixo e largo.
    checa("sem largura FIXA e larga (max-width é o correto)",
          not re.search(r"(?<!max-)width:\s*[3-9]\d\dpx", html))
    checa("sem imagem remota (bloqueada por cliente de e-mail)", "<img" not in html)

    # ═══ 11. O CAMINHO DE ENVIO ACEITA O QUE O RENDERIZADOR PRODUZ ═══════════════════════════
    print("\n11. envia() aceita (endereço, assunto, corpo) — transporte falso")
    # A primeira tentativa real morreu com NameError DENTRO de `envia`, montando o corpo da
    # requisição: a renomeação do parâmetro tinha ficado pela metade. Nenhum teste chamava esse
    # caminho, então 40 verificações passaram com o remetente quebrado. Agora chamam.
    sys.path.insert(0, str(AQUI))
    import send_entry_saved_confirmation as C
    capturado = {}

    def _falso(url, body, headers):
        capturado["body"] = body
        return 200, "fake"

    C.set_transport(_falso)
    ok, detalhe, msg = C.envia("ninguem@exemplo.invalido", R.monta_assunto("X"), html)
    # O que segue para o provedor não pode conter a marca — o template dele a prefixa.
    checa("envia() não levanta e reporta sucesso", ok is True, f"{detalhe}")
    corpo_json = json.loads(capturado.get("body", b"{}").decode())
    tp = corpo_json.get("template_params", {})
    checa("o assunto vai nos campos que o template usa",
          "Comprovante CDB 2026" in (tp.get("entry_name") or "")
          and "Comprovante CDB 2026" in (tp.get("receipt_code") or ""),
          json.dumps({k: v for k, v in tp.items() if k != "html_message"}, ensure_ascii=False))
    checa("o corpo do e-mail é o recibo", "🏆 CAMPEÃO" in (tp.get("html_message") or ""))
    checa("nenhum campo extra além dos quatro esperados",
          set(tp) == {"to_email", "entry_name", "receipt_code", "html_message"}, str(set(tp)))

    print("\n" + "=" * 78)
    if falhas:
        print(f"FALHOU — {len(falhas)}: {falhas}")
        return 1
    print("COMPROVANTE APROVADO — evidência completa, sem PII")
    return 0


if __name__ == "__main__":
    sys.exit(main())
