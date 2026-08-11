"""
recipient_preflight.py — verifica o conjunto de destinatários SEM expor contato nenhum.

─── POR QUE EXISTE ─────────────────────────────────────────────────────────────────────────────

O segredo `POWERBALL_PRIVATE_PARTICIPANT_DATA` é a única fonte de e-mail dos participantes desde
que o `data.js` deixou de carregar contato. Não dá para inspecioná-lo localmente, e ninguém deve
colar o conteúdo em lugar nenhum para "conferir".

Sem uma verificação, a primeira vez que se descobre que falta alguém é no meio do envio real —
com o portão de completude corretamente bloqueando tudo, mas tarde demais para corrigir antes do
sorteio.

Este script roda no MESMO ambiente que teria o segredo (o runner do GitHub Actions) e responde a
única pergunta que importa:

    todo participante do sorteio canônico tem contato resolvível?

Ele imprime CONTAGENS e, quando falta alguém, o NOME de exibição — nunca endereço, nunca o
conteúdo do segredo, nunca uma amostra dele.

Uso:
  python3 recipient_preflight.py                 # sorteio incompleto atual
  python3 recipient_preflight.py --draw 2026-08-10
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_JS = os.path.join(HERE, "..", "js", "data.js")


def load_draws():
    src = open(DATA_JS, encoding="utf-8").read()
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as t:
        t.write(src)
        caminho = t.name
    try:
        reader = ("const fs=require('fs'),vm=require('vm');const sb={window:{}};"
                  "vm.createContext(sb);vm.runInContext(fs.readFileSync(process.argv[1],'utf8'),sb);"
                  "process.stdout.write(JSON.stringify(sb.window.POWERBALL_DRAWS||[]))")
        out = subprocess.run(["node", "-e", reader, caminho], capture_output=True, text=True, timeout=20)
        return json.loads(out.stdout) if out.returncode == 0 and out.stdout.strip() else []
    finally:
        os.unlink(caminho)


def resolvable_contacts(draw_id):
    """Nomes com contato resolvivel. NUNCA devolve o endereco.

    REUSA `load_participants_from_private_env()` do sender -- o parser autoritativo. A primeira
    versao disto reimplementava a leitura do segredo com uma varredura recursiva generica, e
    discordava do sender: colhia a CHAVE do campo ("email") em vez do nome do participante, e
    reportava RESOLVED = 0 para um segredo perfeitamente valido. Dois parsers para o mesmo dado
    e uma divergencia esperando acontecer -- ou o preflight mente sobre estar completo, ou mente
    sobre estar faltando. Aqui existe um parser so.
    """
    raw = os.environ.get("POWERBALL_PRIVATE_PARTICIPANT_DATA", "")
    if not raw.strip():
        return None, "SEGREDO_AUSENTE"
    try:
        import send_result_email as S
    except Exception as e:
        return None, f"SENDER_ILEGIVEL: {type(e).__name__}"
    try:
        participantes = S.load_participants_from_private_env(draw_id)
    except Exception as e:
        return None, f"SEGREDO_ILEGIVEL: {type(e).__name__}"

    nomes = set()
    for p in participantes or []:
        nome = p.get("name") or p.get("nome")
        email = p.get("email") or p.get("participantEmail")
        if nome and isinstance(email, str) and "@" in email:
            nomes.add(str(nome).strip().lower())
    return nomes, None


def main():
    ap = argparse.ArgumentParser(description="Preflight de destinatarios do Powerball (sem PII)")
    ap.add_argument("--draw", help="id do sorteio (padrao: ultimo sem resultado)")
    args = ap.parse_args()

    draws = load_draws()
    if not draws:
        print("🛑 nao foi possivel ler POWERBALL_DRAWS")
        return 1

    if args.draw:
        alvo = next((d for d in draws if d["id"] == args.draw), None)
    else:
        alvo = next((d for d in reversed(draws)
                     if (d.get("participants") or d.get("sharedTickets"))
                     and not ((d.get("result") or {}).get("numbers"))), None)
    if not alvo:
        print("🛑 sorteio alvo nao encontrado")
        return 1

    participantes = alvo.get("participants") or []
    esperados = [str(p.get("nome") or p.get("name") or "").strip() for p in participantes]
    esperados = [n for n in esperados if n]

    chaves, erro = resolvable_contacts(alvo['id'])
    print(f"POWERBALL_RECIPIENT_PREFLIGHT — sorteio {alvo['id']}")
    print(f"  EXPECTED = {len(esperados)}")

    if erro:
        # Falha fechada: sem o segredo NAO se pode afirmar que o conjunto esta completo.
        print(f"  RESOLVED = desconhecido ({erro})")
        print(f"  RESULT   = FAIL — rode isto no ambiente que tem o segredo (GitHub Actions).")
        print(f"  PROVIDER_CALLS = 0")
        return 1

    faltando = [n for n in esperados if n.lower() not in chaves]
    print(f"  RESOLVED = {len(esperados) - len(faltando)}")

    # EXTRA — o outro lado do portao TUDO-OU-NADA (2026-08-11).
    #
    # O `build_send_plan` recusa o envio inteiro tanto por `missing` quanto por `extra`
    # (contato resolvido que NAO participa do sorteio). Este preflight so olhava `missing`, entao
    # em 2026-08-10 imprimiu "MISSING = [] / RESULT = PASS" para um conjunto que o sender
    # recusaria minutos depois -- e recusou, com 0 e-mails enviados.
    #
    # Um preflight que aprova o que o sender bloqueia nao e um preflight, e um falso verde.
    # Os dois lados do portao tem de ser verificados aqui.
    esperados_lower = {n.lower() for n in esperados}
    sobrando = sorted(c for c in chaves if c not in esperados_lower)

    if faltando or sobrando:
        # Nome de exibicao apenas -- nunca endereco.
        print(f"  MISSING  = {faltando}")
        print(f"  EXTRA    = {sobrando}")
        print(f"  RESULT   = RECIPIENT_SET_INCOMPLETE")
        print(f"  PROVIDER_CALLS = 0")
        return 1

    print(f"  MISSING  = []")
    print(f"  EXTRA    = []")
    print(f"  RESULT   = PASS")
    print(f"  PROVIDER_CALLS = 0  (preflight nunca envia)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
