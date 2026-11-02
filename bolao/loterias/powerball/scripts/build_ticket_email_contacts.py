#!/usr/bin/env python3
"""
Contatos do e-mail de BILHETES PUBLICADOS, montados pelo MESMO caminho do e-mail de resultado.

─── POR QUE EXISTE ─────────────────────────────────────────────────────────────────────────────

`email/send_ticket_publication_real.mjs` le os contatos de `POWERBALL_PRIVATE_PARTICIPANT_DATA`
pela chave do PROPRIO sorteio (`{draw_id: {nome: {email}}}`). Um sorteio novo nao tem essa chave:
o segredo so pode ser escrito, nunca lido, e ninguem a acrescenta. Em agosto o envio rodava de uma
maquina com um arquivo local de contatos; sem ele, o script nao acha ninguem -- e, pior,
`eligibleRecipients` PULA quem nao tem e-mail em vez de bloquear, entao um conjunto parcial
sairia como se fosse completo.

O e-mail de resultado ja resolve isto (`send_result_email.load_participants_from_private_env`):
procura o endereco nos outros sorteios, aplica o segredo suplementar e falha fechado em
ambiguidade. Este script reusa essa funcao -- um parser so -- e acrescenta o portao que o lado
JS nao tem: TODO participante do sorteio precisa de contato, ou nada e escrito.

Escreve `{draw_id: {nome_exato_do_data.js: {"email": ...}}}` num arquivo temporario do runner,
que o passo seguinte injeta no script JS. Nunca imprime endereco, so contagens e nomes.

Uso (no runner, com os segredos no ambiente):
    python3 build_ticket_email_contacts.py --draw 2026-10-28 --out "$RUNNER_TEMP/contatos.json"
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import send_result_email as S  # noqa: E402


def esperados(draw_id):
    for lista in S.DRAWS.values():
        for d in lista:
            if d.get("id") == draw_id:
                return [p["name"].strip() for p in (d.get("participants") or []) if p.get("name")]
    return None


def monta(draw_id, resolvidos, nomes):
    """Puro. Devolve (mapa, faltando)."""
    por_chave = {}
    for p in resolvidos or []:
        email = p.get("email")
        if isinstance(email, str) and "@" in email:
            por_chave[S._normalize_name(p.get("name") or "")] = email
    mapa, faltando = {}, []
    for nome in nomes:
        email = por_chave.get(S._normalize_name(nome))
        if email:
            mapa[nome] = {"email": email}
        else:
            faltando.append(nome)
    return {draw_id: mapa}, faltando


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--draw", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)

    nomes = esperados(a.draw)
    if not nomes:
        print(f"🛑 sorteio {a.draw} sem participantes no data.js")
        return 1
    mapa, faltando = monta(a.draw, S.load_participants_from_private_env(a.draw), nomes)
    print(f"CONTATOS — sorteio {a.draw}: esperados {len(nomes)}, resolvidos {len(nomes) - len(faltando)}")
    if faltando:
        # Tudo ou nada, como o e-mail de resultado: um conjunto parcial nao e enviado.
        print(f"🛑 sem contato: {faltando} — nada foi escrito, nenhum e-mail sera enviado")
        return 1
    fd = os.open(a.out, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(mapa, f, ensure_ascii=False)
    print("✓ conjunto completo")
    return 0


if __name__ == "__main__":
    sys.exit(main())
