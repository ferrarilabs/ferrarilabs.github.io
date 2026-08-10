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


def resolvable_contacts():
    """Chaves com contato resolvível dentro do segredo. NUNCA devolve o valor."""
    raw = os.environ.get("POWERBALL_PRIVATE_PARTICIPANT_DATA", "")
    if not raw.strip():
        return None, "SEGREDO_AUSENTE"
    try:
        dados = json.loads(raw)
    except json.JSONDecodeError as e:
        return None, f"SEGREDO_ILEGIVEL: {type(e).__name__}"

    chaves = set()

    def coletar(no):
        if isinstance(no, dict):
            for k, v in no.items():
                if isinstance(v, str) and "@" in v:
                    chaves.add(k.strip().lower())
                else:
                    coletar(v)
        elif isinstance(no, list):
            for item in no:
                if isinstance(item, dict):
                    nome = item.get("nome") or item.get("name")
                    email = item.get("email") or item.get("participantEmail")
                    if nome and isinstance(email, str) and "@" in email:
                        chaves.add(str(nome).strip().lower())
                coletar(item)

    coletar(dados)
    return chaves, None


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

    chaves, erro = resolvable_contacts()
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
    if faltando:
        # Nome de exibicao apenas -- nunca endereco.
        print(f"  MISSING  = {faltando}")
        print(f"  RESULT   = RECIPIENT_SET_INCOMPLETE")
        print(f"  PROVIDER_CALLS = 0")
        return 1

    print(f"  MISSING  = []")
    print(f"  RESULT   = PASS")
    print(f"  PROVIDER_CALLS = 0  (preflight nunca envia)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
