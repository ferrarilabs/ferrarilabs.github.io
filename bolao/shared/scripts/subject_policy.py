#!/usr/bin/env python3
"""
Política ÚNICA de ícone de assunto de e-mail — para as loterias e para os bolões de futebol.

═══ O DEFEITO QUE ISTO FECHA ════════════════════════════════════════════════════════════════════

O e-mail de resultado da Powerball saía com bola de futebol:

    ⚽ Resultado Powerball — 12.08.2026

Loteria não é futebol. O ícone é a primeira coisa que a pessoa vê na caixa de entrada, e ali ele
não decora: ele DIZ do que o e-mail é. Um ⚽ num resultado de loteria faz dezesseis pessoas
lerem "bolão de futebol" antes de abrir.

A correção óbvia — trocar o caractere naquela linha — não resolve o problema, resolve a ocorrência.
Cada remetente monta o próprio assunto com um literal solto, então nada impede o próximo de
escolher outro ícone, nem impede alguém de colar aquela linha num remetente novo. O ícone vira
uma convenção que mora na cabeça de quem escreveu por último.

Então o ícone deixa de ser literal e passa a ser DERIVADO do propósito semântico do e-mail. Para
escolher errado agora é preciso declarar o propósito errado, que é uma afirmação visível numa
revisão, e não um caractere invisível no meio de uma f-string.

═══ O TROFÉU É RESERVADO ════════════════════════════════════════════════════════════════════════

🏆 significa UMA coisa: este e-mail anuncia o campeão final de uma competição de futebol. Não é
"e-mail importante", não é "resultado bom", não é "encerramento de fase".

Um troféu em resultado de rodada, ranking parcial, convite, comprovante ou confirmação gasta o
significado: quando o campeão for de fato decidido, o ícone já não distingue nada. Por isso
`FUTEBOL_RESULTADO_FINAL_CAMPEAO` é um propósito separado e único, e todo o resto do futebol —
inclusive o resultado da última rodada de um turno — é ⚽.
"""

# ── Os quatro ícones, e nada mais ────────────────────────────────────────────────────────────
POWERBALL = "🔴"
MEGA_MILLIONS = "🔵"
FUTEBOL = "⚽"
FUTEBOL_CAMPEAO = "🏆"

# ── Propósito semântico -> ícone ─────────────────────────────────────────────────────────────
#
# A chave descreve O QUE O E-MAIL É, não como ele deve parecer. Quem adiciona um remetente novo
# escolhe um propósito; o ícone vem junto e não é negociável no ponto de uso.
PROPOSITOS = {
    # Loterias — o jogo decide a cor, sempre.
    "LOTERIA_POWERBALL_RESULTADO":      POWERBALL,
    "LOTERIA_POWERBALL_ABERTURA":       POWERBALL,
    "LOTERIA_POWERBALL_COMPROVANTE":    POWERBALL,
    "LOTERIA_MEGAMILLIONS_RESULTADO":   MEGA_MILLIONS,
    "LOTERIA_MEGAMILLIONS_ABERTURA":    MEGA_MILLIONS,
    "LOTERIA_MEGAMILLIONS_COMPROVANTE": MEGA_MILLIONS,

    # Futebol — tudo é ⚽ ...
    "FUTEBOL_RESULTADO_RODADA":         FUTEBOL,
    "FUTEBOL_RESULTADO_PARCIAL":        FUTEBOL,
    "FUTEBOL_RANKING_PARCIAL":          FUTEBOL,
    "FUTEBOL_STATUS":                   FUTEBOL,
    "FUTEBOL_CONVITE":                  FUTEBOL,
    "FUTEBOL_COMPROVANTE":              FUTEBOL,
    "FUTEBOL_CONFIRMACAO_PALPITE":      FUTEBOL,
    "FUTEBOL_CORRECAO":                 FUTEBOL,

    # ... exceto UM propósito.
    "FUTEBOL_RESULTADO_FINAL_CAMPEAO":  FUTEBOL_CAMPEAO,
}

# Ícone -> propósitos que podem usá-lo. Existe para o teste provar a reserva do troféu sem
# reimplementar o mapa (um teste que recopia a tabela prova a cópia, não a tabela).
EXCLUSIVOS_DO_TROFEU = {p for p, i in PROPOSITOS.items() if i == FUTEBOL_CAMPEAO}

# Um assunto de loteria nunca pode conter estes. Não é "não começa com": um ⚽ no meio da frase
# erra pelo mesmo motivo que no começo.
ICONES_DE_FUTEBOL = (FUTEBOL, FUTEBOL_CAMPEAO)
ICONES_DE_LOTERIA = (POWERBALL, MEGA_MILLIONS)


class PropositoDesconhecido(ValueError):
    """Propósito não declarado na política. Falha fechado: sem ícone inventado."""


def icone(proposito):
    """O ícone do propósito. Propósito não declarado LEVANTA — nunca cai num padrão."""
    if proposito not in PROPOSITOS:
        raise PropositoDesconhecido(
            f"PROPOSITO_NAO_DECLARADO: {proposito!r}. Adicione-o a `PROPOSITOS` com o ícone "
            f"correto em vez de escolher um caractere no ponto de uso — foi assim que o "
            f"resultado da Powerball acabou com bola de futebol. "
            f"Conhecidos: {sorted(PROPOSITOS)}")
    return PROPOSITOS[proposito]


def assunto(proposito, texto):
    """
    Monta o assunto completo: ícone do propósito + o texto do remetente.

        assunto("LOTERIA_POWERBALL_RESULTADO", "Resultado Powerball — 12.08.2026")
        -> "🔴 Resultado Powerball — 12.08.2026"

    O texto NÃO pode trazer ícone próprio: dois ícones num assunto significa que alguém montou
    metade aqui e metade no remetente, que é o estado do qual estamos saindo.
    """
    ic = icone(proposito)
    achados = [x for x in (POWERBALL, MEGA_MILLIONS, FUTEBOL, FUTEBOL_CAMPEAO) if x in texto]
    if achados:
        raise ValueError(
            f"ICONE_NO_TEXTO: {achados} já está no texto do assunto ({texto!r}). O ícone vem do "
            f"propósito; o remetente escreve só o texto.")
    return f"{ic} {texto}"


def valida_assunto(proposito, linha):
    """
    Confere um assunto JÁ MONTADO contra a política. Devolve (ok, motivo).

    É o que os testes usam para varrer os assuntos reais dos remetentes: prova a saída, não a
    intenção. Um teste que só chamasse `assunto()` provaria que esta função concatena — não que
    o remetente da Powerball parou de usar bola de futebol.
    """
    esperado = icone(proposito)
    if not linha.startswith(esperado):
        return False, (f"esperado começar com {esperado!r} para {proposito}, "
                       f"veio {linha[:8]!r}")
    e_loteria = proposito.startswith("LOTERIA_")
    proibidos = ICONES_DE_FUTEBOL if e_loteria else ICONES_DE_LOTERIA
    intrusos = [x for x in proibidos if x in linha]
    if intrusos:
        return False, (f"{proposito} não pode conter {intrusos} — "
                       f"{'loteria não é futebol' if e_loteria else 'futebol não é loteria'}")
    if FUTEBOL_CAMPEAO in linha and proposito not in EXCLUSIVOS_DO_TROFEU:
        return False, (f"{FUTEBOL_CAMPEAO} é reservado ao anúncio do campeão final "
                       f"({sorted(EXCLUSIVOS_DO_TROFEU)}); {proposito} não é isso")
    if esperado == FUTEBOL_CAMPEAO and FUTEBOL_CAMPEAO not in linha:
        return False, f"{proposito} PRECISA do {FUTEBOL_CAMPEAO}"
    return True, "ok"
