#!/usr/bin/env python3
"""
Concede permissão de comprovante para as 12 entradas do roster (CONGELADO — ver
`entryRosterFrozen` em config.js) via `cdb_grant_confirmation_allowance`, a função já existente
e já auditada em 20260813020000_cdb_confirmation_recipient_resolution.sql.

Por que uma lista nominal fixa, e não uma query dinâmica em `entries`: o design original desta
permissão é deliberadamente NOMINAL ("liberar envio para uma pessoa real merece um verbo com
nome próprio") — uma concessão automática por query reabriria a porta categórica que o modelo
foi desenhado para evitar. Como o roster está congelado, a lista abaixo é a lista completa e
final; não há entrada futura para esquecer.

Idempotente: `cdb_grant_confirmation_allowance` já é `on conflict (entry_id) do nothing`. Rodar
este script mais de uma vez não duplica nem reabre permissão já consumida — só preenche o que
ainda estiver faltando.

NÃO envia e-mail nenhum. Só abre a permissão; quem envia é o consumidor de sempre
(`send_entry_saved_confirmation.py`, cron de 5 em 5 min), com todas as camadas de proteção dele
(idempotência por versão, reserva UNIQUE, disjuntor de 45min) inalteradas.
"""

import argparse
import os
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(RAIZ / "bolao" / "shared" / "scripts"))
import m8m9  # noqa: E402

# id -> nota (nome da entrada, só para auditoria humana da concessão — nunca e-mail).
ROSTER = {
    "3954c9f0-6c4c-4b84-b3f3-05cb8333c545": "Alan CDB",
    "d61962d8-3256-407c-8ee4-03b6bebec5bd": "Aline",
    "09959213-3e1b-4eaa-a22c-9f4c93445bad": "Bossle",
    "03e9fe14-d777-4a71-9c31-3d54dd21a07c": "Eduardo Ferrari",
    "2a0eb9e8-7210-4645-aa45-016f7abfa776": "Gabriel Ferrari",
    "697ff5e5-2304-40a4-a803-d198c1032b0a": "Gustavo Ferrari",
    "3ea26fa2-828d-49e5-81e5-11a15f23f168": "REDACTED_PARTICIPANT #1",
    "355e973c-aa67-4d39-a750-bbf4a49226a2": "REDACTED_PARTICIPANT #2",
    "5e931947-8009-436d-b745-1fd145bb196d": "Matheus Ferrari",
    "381e2c93-4be4-428e-86f1-e84ad87d84a5": "Nathalia",
    "8dac5116-0506-400c-b2f6-8e5bda4f3c8b": "Rodrigo Hajj",
    "af623309-5fc7-452f-8258-69e9071f7d37": "Simone Hirle",
}

NOTE_SUFFIX = " — liberação em lote pós-estabilização 2026-08-16, roster congelado"


def main():
    ap = argparse.ArgumentParser(description="Concede permissão de comprovante (CDB2026)")
    ap.add_argument("--run", action="store_true", help="concede de verdade")
    ap.add_argument("--status", action="store_true", help="só relata a contagem atual")
    args = ap.parse_args()

    if args.status:
        n = m8m9._rpc("cdb_confirmation_allowance_count", {})
        print(f"permissoes_abertas = {n} / {len(ROSTER)} no roster")
        return

    if not args.run:
        print("nada a fazer: use --run ou --status")
        return

    if os.environ.get("BOLAO_ALLOW_REAL_SEND") != "I UNDERSTAND":
        print("recusado: BOLAO_ALLOW_REAL_SEND ausente (mesmo portão do consumidor de e-mail)")
        sys.exit(1)

    for entry_id, nome in ROSTER.items():
        n = m8m9._rpc("cdb_grant_confirmation_allowance", {
            "p_entry_id": entry_id,
            "p_note": f"{nome}{NOTE_SUFFIX}",
        })
        print(f"concedido: {nome} -> permissoes_abertas agora = {n}")


if __name__ == "__main__":
    main()
