#!/usr/bin/env python3
"""CDB2026 — convite das quartas, com link de acesso pessoal por participante.

O QUE ESTE SCRIPT ENTREGA
-------------------------
Um e-mail por participante contendo um link que abre a PRÓPRIA entrada já carregada. Nada de
"digite seu e-mail para encontrar seus palpites": o navegador não tem mais como procurar por
e-mail, porque não enxerga mais o e-mail de ninguém (migração 20260812080000).

POR QUE O TOKEN VIVE SÓ AQUI DENTRO
-----------------------------------
O token em claro é gerado, usado para montar o link, enviado ao provedor e ESQUECIDO. O banco
guarda apenas o SHA-256. Não existe caminho que recupere o token depois — nem para mim, nem para
um operador, nem para quem obtiver uma cópia do banco. Reenviar convite = emitir token NOVO
(`--reissue`), o que invalida o anterior. Essa é a propriedade que se quer: um convite vazado
deixa de valer assim que o legítimo pede outro.

Por isso o script só roda no runner confiável, e por isso ele imprime nome e e-mail MASCARADO —
nunca o token, nunca o endereço inteiro.

OS PORTÕES (todos fecham por padrão)
------------------------------------
    autorização     BOLAO_ALLOW_REAL_SEND="I UNDERSTAND"; sem isso, nada sai
    credencial      SUPABASE_SERVICE_ROLE_KEY; sem isso, aborta (não cai para a anon)
    prazo publicado a fase precisa ter `cutoffAt` -- é a regra do Eduardo (§50) executável:
                    convidar para um formulário sem data oficial confirmada é o que não pode
                    acontecer. Aqui isso não é disciplina, é impossibilidade.
    prazo no futuro cutoff vencido => convite não faz sentido, aborta
    sorteio completo os 4 confrontos precisam estar definidos, senão o palpite não tem o que
                    responder
    idempotência    quem já tem credencial viva NÃO é convidado de novo. Rodar duas vezes não
                    manda dois e-mails.

Uso:
    python3 bolao/cdb2026/scripts/send_invitation_email.py --dry-run
    python3 bolao/cdb2026/scripts/send_invitation_email.py --apply
    python3 bolao/cdb2026/scripts/send_invitation_email.py --apply --reissue
"""
import argparse
import hashlib
import json
import os
import secrets
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

SUPABASE_URL = "https://cmhqkkfczotdnssupkni.supabase.co"
STATE_ID = "cdb2026"
SITE_URL = "https://www.ferrarilabs.com/bolao/cdb2026/"
FASE = "quartas"

EMAILJS_URL = "https://api.emailjs.com/api/v1.0/email/send"
EMAILJS_KEY = "GBZFujsJBET6modve"
EMAILJS_SVC = "service_o4hyzxr"
EMAILJS_TMPL = "template_xq7yzzb"
EMAILJS_HEADERS = {"Content-Type": "application/json", "origin": "https://www.ferrarilabs.com"}

_TRANSPORT = None  # teste injeta callable(url, body, headers) -> (status, texto)
_ALLOW_ENV = "BOLAO_ALLOW_REAL_SEND"
_ALLOW_TOKEN = "I UNDERSTAND"


def real_send_allowed():
    """(permitido, motivo). Fail-closed — mesma trava do sender de resultado (AUD-02)."""
    if os.environ.get("PYTEST_CURRENT_TEST") or os.environ.get("BOLAO_TEST_RUN"):
        return False, "processo de teste"
    if os.environ.get(_ALLOW_ENV) == _ALLOW_TOKEN:
        return True, None
    return False, f"sem autorizacao explicita ({_ALLOW_ENV})"


def _sb_key():
    """Credencial PRIVILEGIADA. Falha fechado.

    Cair para a chave anon aqui seria pior do que abortar: desde a migração 20260812080000 a anon
    não enxerga a linha crua, então a consulta voltaria `[]` e o script concluiria "não há
    ninguém para convidar" -- tratando "não posso ver" como "não existe". Foi exatamente esse
    silêncio que derrubou três execuções agendadas em 2026-08-12.
    """
    k = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not k:
        raise RuntimeError(
            "SUPABASE_SERVICE_ROLE_KEY ausente — este script lê a linha crua (e-mails dos "
            "participantes) e emite credenciais; só roda no ambiente confiável."
        )
    return k


def _req(metodo, caminho, corpo=None, extra=None):
    k = _sb_key()
    h = {"apikey": k, "Authorization": f"Bearer {k}", "Content-Type": "application/json"}
    h.update(extra or {})
    dados = json.dumps(corpo).encode() if corpo is not None else None
    r = urllib.request.Request(f"{SUPABASE_URL}{caminho}", data=dados, headers=h, method=metodo)
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


def fetch_state():
    st, dados = _req("GET", f"/rest/v1/bolao_state?id=eq.{STATE_ID}&select=state")
    if st != 200:
        raise RuntimeError(f"leitura do estado falhou: http={st}")
    if not dados:
        # "Não posso ver" e "não existe" são coisas diferentes; só uma é bug de dados.
        raise RuntimeError(
            "consulta devolveu lista VAZIA — credencial sem permissão ou linha ausente. "
            "Não trato isso como 'bolão sem participantes'."
        )
    return dados[0]["state"]


def mask_email(addr):
    """t***@gmail.com — o suficiente para o operador reconhecer, insuficiente para vazar."""
    addr = (addr or "").strip()
    if "@" not in addr:
        return "(sem e-mail)"
    user, _, dom = addr.partition("@")
    return f"{user[:1]}***@{dom}"


# ── Portões de negócio ───────────────────────────────────────────────────────────────────────
def check_ready_to_invite(state):
    """(pronto, motivo, cutoff_iso). Executa a regra §50 do Eduardo.

    A regra em palavras: não abrir/convidar para as quartas antes de a data E o horário oficiais
    estarem confirmados por fonte autoritativa. `cutoffAt` só existe depois que a tabela oficial
    foi materializada com proveniência (ver reconcile_official_schedule.py), então exigir
    `cutoffAt` aqui é a mesma regra, só que impossível de esquecer.
    """
    fase = (state.get("phases") or {}).get(FASE) or {}

    # Os confrontos vivem em `phase.ties` (DICT keyed por id), e `officialDraw` é o registro de
    # PROVENIÊNCIA — não a lista. Eu li errado na primeira versão e o script anunciou "0 de 4
    # confrontos" contra uma produção que tem os 4. Errar para o lado de recusar é o lado certo,
    # mas a mensagem culpava o dado em vez do leitor.
    confrontos = fase.get("ties") or {}
    if len(confrontos) != 4:
        return False, f"sorteio oficial incompleto ({len(confrontos)} de 4 confrontos)", None
    for tid, t in confrontos.items():
        if not t.get("teamA") or not t.get("teamB"):
            return False, f"confronto sem os dois times definidos: {tid}", None

    # Proveniência: o app trata `officialDraw` sem `validatedAt` como NÃO validado (fail closed,
    # ver officialDrawProvenanceIsValid() em app.js). O convite segue a mesma régua — convidar
    # para um chaveamento cuja origem o app se recusa a reconhecer seria incoerente.
    if not (fase.get("officialDraw") or {}).get("validatedAt"):
        return False, "o sorteio oficial não tem proveniência validada (officialDraw.validatedAt)", None

    cutoff = fase.get("cutoffAt")
    if not cutoff:
        return False, (
            "a fase NÃO tem cutoffAt — a tabela oficial ainda não foi materializada. "
            "Convidar agora entregaria um formulário sem prazo oficial confirmado (§50)."
        ), None

    try:
        quando = datetime.fromisoformat(cutoff.replace("Z", "+00:00"))
    except ValueError:
        return False, f"cutoffAt ilegível: {cutoff!r}", None
    if quando <= datetime.now(timezone.utc):
        return False, f"o prazo já venceu ({cutoff}) — convite não faz sentido", None

    return True, None, cutoff


def eligible_entries(state):
    apagados = set(state.get("deletedIds") or [])
    saida = []
    for e in state.get("entries") or []:
        if e.get("id") in apagados:
            continue
        if not (e.get("participantEmail") or "").strip():
            continue
        saida.append(e)
    return saida


def already_invited_ids():
    """entry_ids com credencial VIVA (emitida e não revogada) = já convidados."""
    st, linhas = _req(
        "GET", "/rest/v1/cdb_entry_access?select=entry_id,revoked_at&revoked_at=is.null"
    )
    if st != 200:
        raise RuntimeError(f"leitura de credenciais falhou: http={st}")
    return {l["entry_id"] for l in (linhas or [])}


def issue_token(entry_id, nota):
    """Emite credencial e devolve o token EM CLARO — que só existe nesta variável, nunca no banco."""
    token = secrets.token_urlsafe(32)  # >= 256 bits
    st, r = _req(
        "POST", "/rest/v1/cdb_entry_access",
        {"entry_id": entry_id, "token_hash": hashlib.sha256(token.encode()).hexdigest(),
         "note": nota},
        extra={"Prefer": "resolution=merge-duplicates,return=minimal"},
    )
    if st not in (200, 201, 204):
        raise RuntimeError(f"emissão de credencial falhou para {entry_id[:8]}…: http={st} {r}")
    return token


def revoke_token(entry_id):
    _req("PATCH", f"/rest/v1/cdb_entry_access?entry_id=eq.{entry_id}",
         {"revoked_at": "now()"}, extra={"Prefer": "return=minimal"})


# ── E-mail ───────────────────────────────────────────────────────────────────────────────────
def _fmt_prazo(cutoff_iso):
    """Prazo em horário de Brasília — que é o fuso em que essas pessoas vivem."""
    q = datetime.fromisoformat(cutoff_iso.replace("Z", "+00:00"))
    brt = q.astimezone(timezone.utc).timestamp() - 3 * 3600
    d = datetime.fromtimestamp(brt, timezone.utc)
    dias = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"]
    return f"{dias[d.weekday()]}, {d.day:02d}/{d.month:02d} às {d.hour:02d}h{d.minute:02d} (Brasília)"


def build_html(entry, state, cutoff_iso, link):
    fase = (state.get("phases") or {}).get(FASE) or {}
    confrontos = (fase.get("ties") or {}).values()

    linhas = ""
    for t in confrontos:
        linhas += (
            '<tr>'
            f'<td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;'
            f'font-weight:600;color:#0f172a;width:44%">{t.get("teamA","")}</td>'
            '<td style="padding:10px 6px;border-bottom:1px solid #e2e8f0;text-align:center;'
            'color:#94a3b8;font-size:12px">×</td>'
            f'<td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;'
            f'color:#0f172a;width:44%">{t.get("teamB","")}</td>'
            '</tr>'
        )

    nome = entry.get("entryName") or "Participante"
    prazo = _fmt_prazo(cutoff_iso)

    return f"""
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
            background:#f8fafc;padding:24px 12px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;
              padding:28px 24px;box-shadow:0 1px 3px rgba(0,0,0,.08)">

    <div style="text-align:center;margin-bottom:22px">
      <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#059669;
                  font-weight:700;margin-bottom:6px">Copa do Brasil 2026</div>
      <div style="font-size:22px;font-weight:800;color:#0f172a">As quartas estão definidas</div>
    </div>

    <p style="color:#334155;font-size:15px;line-height:1.6;margin:0 0 16px">
      Olá, <strong>{nome}</strong> — a CBF sorteou as quartas de final e os palpites já estão
      abertos.
    </p>

    <table style="width:100%;border-collapse:collapse;margin:0 0 20px;background:#f8fafc;
                  border-radius:10px;overflow:hidden">{linhas}</table>

    <div style="background:#fffbeb;border-left:3px solid #f59e0b;border-radius:6px;
                padding:12px 14px;margin:0 0 22px">
      <div style="font-size:13px;color:#92400e;line-height:1.5">
        <strong>Prazo:</strong> {prazo} — uma hora antes do primeiro jogo de ida.
        Depois disso o formulário fecha sozinho.
      </div>
    </div>

    <div style="text-align:center;margin:0 0 20px">
      <a href="{link}"
         style="display:inline-block;background:#059669;color:#fff;text-decoration:none;
                font-weight:700;font-size:15px;padding:14px 30px;border-radius:9px">
        Abrir meus palpites
      </a>
    </div>

    <p style="color:#64748b;font-size:13px;line-height:1.6;margin:0 0 4px">
      Esse link é <strong>seu</strong> e já abre a sua entrada — não precisa digitar e-mail nem
      código. Não repasse: quem tiver o link edita os seus palpites.
    </p>
    <p style="color:#64748b;font-size:13px;line-height:1.6;margin:0">
      Pode alterar quantas vezes quiser até o prazo; vale o último salvo.
    </p>

    <div style="height:1px;background:#e2e8f0;margin:20px 0"></div>
    <div style="text-align:center;font-size:12px;color:#9ca3af">
      <a href="{SITE_URL}" style="color:#059669;text-decoration:none">ferrarilabs.com/bolao/cdb2026/</a>
      &nbsp;·&nbsp; Bolão do Ferrari · Copa do Brasil 2026
    </div>

  </div>
</div>
"""


def send_email(addr, subject, html):
    if _TRANSPORT is None:
        permitido, motivo = real_send_allowed()
        if not permitido:
            return False, f"EMAIL_SEND_BLOCKED: {motivo}"
    addr = addr.strip().rstrip(",").strip()
    body = json.dumps({
        "service_id": EMAILJS_SVC, "template_id": EMAILJS_TMPL, "user_id": EMAILJS_KEY,
        "template_params": {"to_email": addr, "entry_name": subject,
                            "receipt_code": subject, "html_message": html},
    }).encode()
    if _TRANSPORT is not None:
        return _TRANSPORT(EMAILJS_URL, body, EMAILJS_HEADERS)
    req = urllib.request.Request(EMAILJS_URL, data=body, headers=EMAILJS_HEADERS, method="POST")
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.status, "ok"


# ── Orquestração ─────────────────────────────────────────────────────────────────────────────
def main():
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--apply", action="store_true")
    p.add_argument("--reissue", action="store_true",
                   help="emite token NOVO para quem já tem (invalida o link anterior)")
    args = p.parse_args()
    if not args.dry_run and not args.apply:
        p.error("escolha --dry-run ou --apply")

    print("=" * 72)
    print("  CDB2026 — CONVITE DAS QUARTAS (link de acesso pessoal)")
    print("=" * 72)

    state = fetch_state()
    pronto, motivo, cutoff = check_ready_to_invite(state)
    if not pronto:
        print(f"\n  🛑 NÃO CONVIDAR: {motivo}")
        print("\n  CDB_INVITATION_STATUS = BLOCKED")
        return 3  # distinto de erro: é estado de negócio, não falha

    elegiveis = eligible_entries(state)
    ja = already_invited_ids()
    alvos = [e for e in elegiveis if args.reissue or e.get("id") not in ja]

    print(f"\n  prazo publicado       {cutoff}  ({_fmt_prazo(cutoff)})")
    print(f"  entradas elegíveis    {len(elegiveis)}")
    print(f"  já convidados         {len(ja & {e.get('id') for e in elegiveis})}")
    print(f"  a convidar            {len(alvos)}" + ("  (reemissão)" if args.reissue else ""))

    if not alvos:
        print("\n  ✓ todo mundo já foi convidado — nada a fazer (idempotente)")
        print("\n  CDB_INVITATION_STATUS = ALREADY_COMPLETE")
        return 0

    print()
    for e in alvos:
        print(f"    · {(e.get('entryName') or '?'):<28} {mask_email(e.get('participantEmail'))}")

    if args.dry_run:
        print("\n  DRY-RUN — nenhuma credencial emitida, nenhum e-mail enviado")
        print("\n  CDB_INVITATION_STATUS = DRY_RUN_OK")
        return 0

    permitido, motivo = real_send_allowed()
    if not permitido:
        print(f"\n  🛑 envio real não autorizado: {motivo}")
        print("\n  CDB_INVITATION_STATUS = BLOCKED_UNAUTHORIZED")
        return 4

    enviados, falhos = 0, []
    carimbo = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    for e in alvos:
        nome = e.get("entryName") or "Participante"
        eid = e.get("id")
        token = None
        try:
            token = issue_token(eid, f"convite quartas; emitido {carimbo}")
            html = build_html(e, state, cutoff, f"{SITE_URL}#t={token}")
            st, _ = send_email(e["participantEmail"],
                               "Copa do Brasil 2026 — quartas de final", html)
            if st in (200, "ok") or (isinstance(st, int) and 200 <= st < 300):
                print(f"  ✓ {nome}")
                enviados += 1
            else:
                raise RuntimeError(f"provedor recusou: {st}")
        except Exception as exc:
            # A credencial emitida sem e-mail entregue é um link que ninguém tem: revoga, para
            # não deixar credencial viva órfã fazendo o próximo run pular essa pessoa.
            if token is not None:
                try:
                    revoke_token(eid)
                except Exception:
                    print(f"      ⚠ credencial de {nome} ficou viva sem convite entregue — "
                          f"rode com --reissue")
            print(f"  ✗ {nome}: {exc}")
            falhos.append(nome)

    print(f"\n  enviados {enviados}/{len(alvos)}")
    if falhos:
        print(f"  falharam: {', '.join(falhos)}")
        print("\n  CDB_INVITATION_STATUS = PARTIAL")
        return 1
    print("\n  CDB_INVITATION_STATUS = SENT")
    return 0


if __name__ == "__main__":
    sys.exit(main())
