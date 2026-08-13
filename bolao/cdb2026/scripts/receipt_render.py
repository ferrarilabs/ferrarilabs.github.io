#!/usr/bin/env python3
"""
Renderizador do comprovante do CDB2026 — a partir do SNAPSHOT congelado no evento.

═══ POR QUE LÊ SÓ O SNAPSHOT ═══════════════════════════════════════════════════════════════════

Nada aqui consulta o banco. O recibo é montado exclusivamente com o que o evento carrega, então
ele prova a versão que o gerou — mesmo que a entrada já tenha sido salva outra vez, mesmo que a
CBF tenha mexido nos confrontos, mesmo que o consumidor rode horas depois. Já rodou 14 minutos
atrasado uma vez; um recibo que relesse o estado atual afirmaria, com hash próprio, algo que nunca
foi gravado daquele jeito.

═══ A INVERSÃO DA VOLTA (AUDIT-05) ═════════════════════════════════════════════════════════════

`legTeams()` no app.js carrega este aviso, de uma auditoria de 2026-08:

    o comprovante, o detalhe "Ver palpites" do ranking e o CSV imprimiam `teamA × teamB` fixo
    com `goalsHome × goalsAway`, invertendo o placar da VOLTA -- um palpite "Fluminense 3 × 0
    Vasco" aparecia como "Vasco 3 × 0 Fluminense"

`goalsHome`/`goalsAway` são SEMPRE relativos ao mandante REAL daquela perna, e o mandante inverte
na volta. `legTeams()` aqui é a mesma regra: `second` -> mandante é teamB. Renderizar `teamA ×
teamB` fixo reintroduziria exatamente o defeito que já enganou três documentos — e num documento
que existe para ser evidência.

═══ PRIVACIDADE ════════════════════════════════════════════════════════════════════════════════

O recibo mostra: nome da entrada, competição, campeão/vice, palpites por fase, quando foi salvo.

Nunca: endereço, token, hash de token, id de entrada, id de outbox, hash de destinatário, nome do
pagador, método/confirmação de pagamento. O comprovante da Copa expunha e-mail, responsável e
pagamento — aquilo não volta. `test_receipt_pii.py` varre o HTML gerado.
"""

import html
import re
from datetime import datetime, timezone, timedelta

# Espelho de `bolao/cdb2026/js/data.js` -> `phases`. `test_receipt_phases_match_data_js.py`
# compara os dois e falha se divergirem: uma fase nova no torneio não pode sumir do recibo
# silenciosamente.
FASES = [
    ("fase-1",    "1ª Fase",           "SINGLE_MATCH"),
    ("fase-2",    "2ª Fase",           "SINGLE_MATCH"),
    ("fase-3",    "3ª Fase",           "SINGLE_MATCH"),
    ("fase-4",    "4ª Fase",           "SINGLE_MATCH"),
    ("fase-5",    "5ª Fase",           "TWO_LEG"),
    ("oitavas",   "Oitavas de Final",  "TWO_LEG"),
    ("quartas",   "Quartas de Final",  "TWO_LEG"),
    ("semifinal", "Semifinal",         "TWO_LEG"),
    ("final",     "Final",             "SINGLE_MATCH"),
]
ORDEM = {fid: i for i, (fid, _, _) in enumerate(FASES)}
NOME_FASE = {fid: nome for fid, nome, _ in FASES}

BRT = timezone(timedelta(hours=-3))   # America/Sao_Paulo


def esc(x):
    return html.escape(str(x if x is not None else ""), quote=True)


def brt(iso):
    """Horário de Brasília, legível. O produto já usa BRT em recibo (formatBrtTimestamp)."""
    if not iso:
        return "—"
    try:
        t = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        return t.astimezone(BRT).strftime("%d/%m/%Y às %H:%M") + " — horário de Brasília"
    except Exception:  # noqa: BLE001
        return "—"


def leg_teams(tie, leg):
    """Mandante REAL da perna. Na volta o mando inverte — ver AUDIT-05 no cabeçalho."""
    if leg == "second":
        return tie.get("teamB"), tie.get("teamA")
    return tie.get("teamA"), tie.get("teamB")


def _lado(tie, side):
    return tie.get("teamA") if side == "A" else tie.get("teamB")


def ties_virtuais(snapshot, phase_id):
    """
    Semifinal e final não existem como confronto gravado enquanto a CBF não os materializa: são
    derivados do palpite do participante. Mesma regra de `virtualDerivedTies()` no app.js, aplicada
    ao snapshot congelado.
    """
    fases = snapshot.get("phases") or {}
    qual = (snapshot.get("picks") or {}).get("qualified") or {}

    if phase_id == "semifinal":
        slots = (fases.get("semifinal") or {}).get("topology") or {}
        quartas = (fases.get("quartas") or {}).get("ties") or {}
        saida = []
        for slot_id in sorted(slots):
            slot = slots[slot_id]
            a_de = (slot.get("sideA") or {}).get("winnerOf")
            b_de = (slot.get("sideB") or {}).get("winnerOf")
            ta, tb = quartas.get(a_de), quartas.get(b_de)
            pa, pb = qual.get(a_de), qual.get(b_de)
            if ta and tb and pa in ("A", "B") and pb in ("A", "B"):
                saida.append((slot_id, {"teamA": _lado(ta, pa), "teamB": _lado(tb, pb)}))
        return saida

    if phase_id == "final":
        semi = ties_virtuais(snapshot, "semifinal")
        if len(semi) != 2:
            return []
        lados = []
        for tid, tie in semi:
            p = qual.get(tid)
            if p not in ("A", "B"):
                return []
            lados.append(_lado(tie, p))
        return [("final-1", {"teamA": lados[0], "teamB": lados[1]})]

    return []


def podio(snapshot):
    """Campeão e vice são os dois lados da final. Sem 3º e sem 4º — a Copa do Brasil não tem."""
    qual = (snapshot.get("picks") or {}).get("qualified") or {}
    fases = snapshot.get("phases") or {}
    reais = (fases.get("final") or {}).get("ties") or {}
    if reais:
        tid = sorted(reais)[0]
        tie = reais[tid]
    else:
        virt = ties_virtuais(snapshot, "final")
        if not virt:
            return None, None
        tid, tie = virt[0]
    p = qual.get(tid)
    if p not in ("A", "B"):
        return None, None
    return (_lado(tie, p), _lado(tie, "B" if p == "A" else "A"))


def _placar(m):
    if not isinstance(m, dict):
        return None
    h, a = m.get("goalsHome"), m.get("goalsAway")
    if h is None or a is None:
        return None
    return int(h), int(a)


def linhas_do_confronto(tie_id, tie, picks, formato, eh_final):
    """Uma linha por perna, mais a linha de quem passou. Devolve HTML de <tr>."""
    matches = (picks.get("matches") or {}).get(tie_id) or {}
    qual = (picks.get("qualified") or {}).get(tie_id)
    pernas = [("single", "Jogo único")] if formato == "SINGLE_MATCH" else \
             [("first", "Jogo 1"), ("second", "Jogo 2")]

    corpo = ""
    for chave, rotulo in pernas:
        pl = _placar(matches.get(chave))
        casa, fora = leg_teams(tie, chave) if formato == "TWO_LEG" else (tie.get("teamA"),
                                                                        tie.get("teamB"))
        if pl is None:
            corpo += (f'<tr><td style="padding:6px 8px;color:#8a8a8a;font-size:12px">{esc(rotulo)}</td>'
                      f'<td colspan="2" style="padding:6px 8px;color:#8a8a8a;font-size:13px">'
                      f'sem palpite</td></tr>')
        else:
            corpo += (f'<tr><td style="padding:6px 8px;color:#8a8a8a;font-size:12px">{esc(rotulo)}</td>'
                      f'<td style="padding:6px 8px;font-size:14px">{esc(casa)} '
                      f'<b>{pl[0]} × {pl[1]}</b> {esc(fora)}</td>'
                      f'<td style="width:1px"></td></tr>')

    if qual in ("A", "B"):
        time = _lado(tie, qual)
        if eh_final:
            # A final resolve DUAS posições, e a seção que registra a final tem de registrar as
            # duas. Antes só o campeão aparecia aqui e o vice existia apenas no resumo do topo —
            # a mesma ambiguidade que a tela de produção já teve: quem lê a seção da final via um
            # nome só e precisava deduzir o outro pela ordem dos times. O vice sai do MESMO
            # snapshot congelado que o campeão, então os dois não podem discordar.
            outro = _lado(tie, "B" if qual == "A" else "A")
            marca = (f'<span style="color:#0b6b3a;font-weight:800">🏆 CAMPEÃO:</span> '
                     f'<b>{esc(time)}</b><br>'
                     f'<span style="color:#0b6b3a;font-weight:800">🥈 VICE-CAMPEÃO:</span> '
                     f'<b>{esc(outro)}</b>')
        else:
            marca = (f'<span style="color:#0b6b3a;font-weight:800">CLASSIFICADO:</span> '
                     f'<b>{esc(time)}</b>')
    else:
        marca = '<span style="color:#8a8a8a">sem classificado escolhido</span>'

    # `corpo` (as pernas) VEM ANTES da linha de classificação. Faltava concatenar aqui, e o
    # comprovante saía só com "CLASSIFICADO: X" — sem nenhum placar. Um recibo sem os placares não
    # é evidência de nada.
    return corpo + (f'<tr><td colspan="3" style="padding:2px 8px 10px;font-size:13px;'
                    f'border-bottom:1px solid #ececec">{marca}</td></tr>')


def monta_recibo(snapshot, picks_version):
    """HTML completo do comprovante. Só o snapshot entra; nada é lido de fora."""
    picks = snapshot.get("picks") or {}
    fases = snapshot.get("phases") or {}
    entry_name = snapshot.get("entryName") or "sua entrada"
    campeao, vice = podio(snapshot)

    # ── Fases, em ordem de torneio ────────────────────────────────────────────────────────────
    blocos = ""
    ids = sorted(set(list(fases.keys()) + ["semifinal", "final"]),
                 key=lambda f: ORDEM.get(f, 99))
    for fid in ids:
        formato = next((f for i, _, f in FASES if i == fid), "TWO_LEG")
        eh_final = fid == "final"
        reais = (fases.get(fid) or {}).get("ties") or {}
        confrontos = sorted(reais.items()) if reais else ties_virtuais(snapshot, fid)
        # Só entra fase em que o participante realmente palpitou algo.
        confrontos = [(tid, t) for tid, t in confrontos
                      if (picks.get("matches") or {}).get(tid)
                      or (picks.get("qualified") or {}).get(tid)]
        if not confrontos:
            continue

        linhas = ""
        for tid, tie in confrontos:
            linhas += (f'<tr><td colspan="3" style="padding:12px 8px 4px;font-weight:800;'
                       f'font-size:14px;color:#111">{esc(tie.get("teamA"))} × '
                       f'{esc(tie.get("teamB"))}</td></tr>')
            linhas += linhas_do_confronto(tid, tie, picks, formato, eh_final)

        blocos += (f'<div style="margin:22px 0 0">'
                   f'<div style="background:#0b6b3a;color:#fff;padding:8px 12px;border-radius:8px;'
                   f'font-weight:800;font-size:13px;letter-spacing:.04em;text-transform:uppercase">'
                   f'{esc(NOME_FASE.get(fid, fid))}</div>'
                   f'<table style="width:100%;border-collapse:collapse;margin-top:6px">'
                   f'{linhas}</table></div>')

    podio_html = ""
    if campeao and vice:
        podio_html = f"""
  <div style="background:linear-gradient(135deg,#07281a,#0b6b3a);border-radius:14px;padding:18px;
              margin:18px 0;color:#fff">
    <div style="text-align:center;font-size:12px;letter-spacing:.08em;text-transform:uppercase;
                opacity:.85;margin-bottom:12px">Palpite final do participante</div>
    <div style="background:#ffd35a;color:#111;border-radius:10px;padding:12px;text-align:center;
                margin-bottom:8px">
      <div style="font-size:12px;font-weight:800;letter-spacing:.06em">🏆 CAMPEÃO</div>
      <div style="font-size:22px;font-weight:900;margin-top:2px">{esc(campeao)}</div>
    </div>
    <div style="background:#ffffff22;border-radius:10px;padding:12px;text-align:center">
      <div style="font-size:12px;font-weight:800;letter-spacing:.06em">🥈 VICE-CAMPEÃO</div>
      <div style="font-size:20px;font-weight:900;margin-top:2px">{esc(vice)}</div>
    </div>
  </div>"""
    else:
        podio_html = ('<div style="background:#fff8e1;border:1px solid #f0d78a;border-radius:12px;'
                      'padding:14px;margin:18px 0;font-size:13px;color:#6b5300">'
                      'A final ainda não está completa neste palpite — campeão e vice aparecem '
                      'quando você preencher o caminho até a final.</div>')

    return f"""<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;
max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;background:#ffffff">

  <div style="border-bottom:3px solid #0b6b3a;padding-bottom:12px;margin-bottom:6px">
    <div style="font-size:12px;color:#0b6b3a;font-weight:800;letter-spacing:.08em;
                text-transform:uppercase">Bolão do Ferrari</div>
    <h1 style="margin:4px 0 0;font-size:21px;color:#111">Comprovante de palpites</h1>
    <div style="font-size:14px;color:#666;margin-top:2px">Copa do Brasil 2026</div>
  </div>

  <p style="font-size:14px;line-height:1.6;margin:14px 0 0">
    Este comprovante registra <b>exatamente os palpites salvos</b> nesta versão da sua entrada.
  </p>

  <table style="width:100%;border-collapse:collapse;font-size:14px;margin:14px 0 0">
    <tr><td style="padding:7px 0;color:#666;border-bottom:1px solid #eee">Entrada</td>
        <td style="padding:7px 0;text-align:right;border-bottom:1px solid #eee">
          <b>{esc(entry_name)}</b></td></tr>
    <tr><td style="padding:7px 0;color:#666;border-bottom:1px solid #eee">Competição</td>
        <td style="padding:7px 0;text-align:right;border-bottom:1px solid #eee">
          Copa do Brasil 2026</td></tr>
    <tr><td style="padding:7px 0;color:#666;border-bottom:1px solid #eee">Salvo em</td>
        <td style="padding:7px 0;text-align:right;border-bottom:1px solid #eee">
          {esc(brt(snapshot.get('savedAt')))}</td></tr>
    <tr><td style="padding:7px 0;color:#666">Código do comprovante</td>
        <td style="padding:7px 0;text-align:right;font-family:ui-monospace,Menlo,monospace;
                   font-size:12px;color:#0b6b3a">{esc(picks_version)}</td></tr>
  </table>

  {podio_html}

  <div style="font-size:12px;color:#666;letter-spacing:.06em;text-transform:uppercase;
              font-weight:800;margin:24px 0 0">Detalhamento dos palpites</div>
  {blocos or '<p style="color:#8a8a8a;font-size:13px">Nenhum palpite registrado nesta versão.</p>'}

  <div style="margin-top:26px;padding:14px;background:#f6f8f7;border-radius:10px;
              font-size:12px;line-height:1.6;color:#666">
    Este e-mail confirma a versão dos palpites que foi salva com sucesso. Você pode continuar
    editando até o prazo de cada fase; toda alteração relevante gera uma nova versão salva, com um
    novo comprovante. Não é preciso responder.
  </div>

</div>"""


# ── O TRANSPORTE JÁ ASSINA A MARCA ───────────────────────────────────────────────────────────
#
# O template do EmailJS monta o assunto como `Bolão do Ferrari - {{entry_name}}`. Esse prefixo não
# está neste repositório — é configuração do provedor —, mas o assunto que chegou ao Gmail o prova
# exatamente:
#
#   recebido:  Bolão do Ferrari - Bolão do Ferrari — ✅ Comprovante de palpites · … — Eduardo Ferrari
#   enviado:                      Bolão do Ferrari — ✅ Comprovante de palpites · … — Eduardo Ferrari
#
# A diferença é o prefixo literal. Como o transporte já assina, o assunto daqui NÃO assina: uma
# camada só é dona da marca. Repetir era o que produzia "Bolão do Ferrari - Bolão do Ferrari".
TRANSPORT_SUBJECT_PREFIX = "Bolão do Ferrari - "


def monta_assunto(entry_name):
    """A parte do assunto que ESTE código controla. Sem marca — quem assina é o transporte."""
    return f"✅ Comprovante CDB 2026 — {entry_name}"


def assunto_visivel(entry_name):
    """
    O assunto como o participante o vê. É este que precisa ser testado: testar só a parte de cima
    deixaria a duplicação passar de novo, porque ela nasce da COMPOSIÇÃO.
    """
    return TRANSPORT_SUBJECT_PREFIX + monta_assunto(entry_name)


# Campos que NUNCA podem aparecer no HTML. Varridos por `test_receipt_pii.py`.
PROIBIDOS = ["participantEmail", "payerName", "paymentMethod", "paymentTo", "paymentConfirmed",
             "accessToken", "tokenHash", "recipient_hash", "recipientHash", "outbox",
             "entryId", "delivery_id", "lastClientRef", "@"]


def varre_pii(html_txt, extras=()):
    """Devolve a lista de marcadores proibidos encontrados. Vazia = limpo."""
    achados = [p for p in PROIBIDOS if p.lower() in html_txt.lower()]
    for e in extras:
        if e and str(e) in html_txt:
            achados.append(f"valor-proibido:{str(e)[:6]}…")
    # UUID solto é id interno vazando.
    if re.search(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", html_txt, re.I):
        achados.append("uuid-interno")
    return achados
