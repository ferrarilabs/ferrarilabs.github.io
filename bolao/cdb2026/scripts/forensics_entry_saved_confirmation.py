#!/usr/bin/env python3
"""
Perícia SÓ LEITURA do comprovante de entrada salva — por que o save real não virou e-mail.

Não envia. Não grava. Não altera permissão. Não toca em palpite. Nenhuma chamada a provedor
existe neste arquivo — não há import de transporte, não há EmailJS, não há `--run`.

NÃO IMPRIME PII: nem endereço, nem token, nem nome de participante, nem `client_ref` em claro
(client_ref é um identificador de retry do cliente, mas sai como hash curto por precaução — quem
depura precisa saber se ele MUDOU, não qual é).

O que responde, com evidência de produção:

  · o save aconteceu? gravou? qual a versão canônica do estado hoje persistido?
  · a obrigação existe — no formato de chave NOVO e também no ANTIGO?
  · a permissão estava lá no momento do save, e está agora?
  · o produtor implantado é o novo? (a checagem que separa PRODUCER_NOT_DEPLOYED de
    OLD_RPC_VERSION_EXECUTED de PRODUCER_LOGIC_DEFECT)
"""

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(RAIZ / "bolao" / "shared" / "scripts"))
import m8m9  # noqa: E402

SUPABASE = "https://cmhqkkfczotdnssupkni.supabase.co"
ENTRADA_OPERADOR = "03e9fe14-d777-4a71-9c31-3d54dd21a07c"
EVENT_TYPE = "cdb2026.entry_saved_confirmation"
NY = timezone(timedelta(hours=-4))   # America/New_York em agosto (EDT)


def _key():
    k = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not k:
        print("🛑 SUPABASE_SERVICE_ROLE_KEY ausente — só roda no ambiente confiável.")
        sys.exit(2)
    return k


def rest(caminho):
    req = urllib.request.Request(
        f"{SUPABASE}/rest/v1/{caminho}",
        headers={"apikey": _key(), "Authorization": f"Bearer {_key()}",
                 "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return {"_erro": f"http={e.code} {e.read()[:200].decode(errors='replace')}"}
    except Exception as e:  # noqa: BLE001
        return {"_erro": f"{type(e).__name__}: {e}"}


def ny(iso):
    if not iso:
        return "(nenhum)"
    try:
        t = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return (t.astimezone(NY).strftime("%Y-%m-%d %H:%M:%S")
                + " NY   /   " + t.astimezone(timezone.utc).strftime("%H:%M:%S") + " UTC")
    except Exception:  # noqa: BLE001
        return f"{iso} (ilegível)"


def h12(txt):
    import hashlib
    return hashlib.sha256((txt or "").encode()).hexdigest()[:12] if txt else "(ausente)"


def sec(t):
    print("\n" + "═" * 78)
    print(f"  {t}")
    print("═" * 78)


def main():
    print("PERÍCIA — comprovante de entrada salva (SÓ LEITURA)")
    print(f"gerado em {ny(datetime.now(timezone.utc).isoformat())}")

    # ── 1. O SAVE ────────────────────────────────────────────────────────────────────────────
    sec("1. O SAVE REAL")
    linha = rest("bolao_state?id=eq.cdb2026&select=state,updated_at")
    if isinstance(linha, dict) and linha.get("_erro"):
        print(f"  ESTADO ILEGÍVEL: {linha['_erro']}")
        return 1
    estado = (linha[0] if linha else {}).get("state") or {}
    row_updated = (linha[0] if linha else {}).get("updated_at")

    entrada = next((e for e in estado.get("entries", [])
                    if e.get("id") == ENTRADA_OPERADOR), None)
    if entrada is None:
        print("  ENTRADA DO OPERADOR NÃO ENCONTRADA no estado.")
        return 1

    picks = entrada.get("picks") or {}
    n_matches = len((picks.get("matches") or {}))
    n_qual = len((picks.get("qualified") or {}))
    versao = m8m9._rpc("cdb_picks_version", {"p_picks": picks})

    print(f"  SAVE_OCCURRED        = {'SIM' if entrada.get('updatedAt') else 'NAO'}")
    print(f"  entry.updatedAt      = {ny(entrada.get('updatedAt'))}")
    print(f"  bolao_state.updated_at = {ny(row_updated)}")
    print(f"  lastClientRef (hash) = {h12(entrada.get('lastClientRef'))}")
    print(f"  PICKS_VERSION        = {versao}")
    print(f"  volume dos palpites  = {n_matches} confronto(s), {n_qual} classificado(s)")

    # ── 2. O PRODUTOR IMPLANTADO ─────────────────────────────────────────────────────────────
    sec("2. O PRODUTOR QUE ESTÁ NO BANCO")
    # `cdb_picks_version` só existe a partir de 20260813030000. Se responde, aquela migração
    # entrou. Isso separa PRODUCER_NOT_DEPLOYED das outras hipóteses.
    print(f"  cdb_picks_version existe   = {'SIM' if versao else 'NAO'}")
    tem_allow = m8m9._rpc("cdb_confirmation_allowance_count", {})
    print(f"  cdb_confirmation_allowance = {'SIM' if tem_allow is not None else 'NAO'}")

    # ── 3. A OBRIGAÇÃO ───────────────────────────────────────────────────────────────────────
    sec("3. A OBRIGAÇÃO NO OUTBOX")
    chave_nova = f"cdb2026:entry-saved-confirmation:{ENTRADA_OPERADOR}:{versao}:v1"
    chave_velha = f"cdb2026:entry-saved-confirmation:{ENTRADA_OPERADOR}:v1"

    st_nova = m8m9.status(chave_nova)
    st_velha = m8m9.status(chave_velha)
    print(f"  chave NOVA (por versão)  ...:{versao}:v1")
    print(f"    -> {st_nova or 'NÃO EXISTE'}")
    print(f"  chave ANTIGA (por entrada)")
    print(f"    -> {st_velha or 'NÃO EXISTE'}")

    # Qualquer evento do tipo, independente de chave — pega inclusive versão intermediária que
    # tenha sido salva e depois substituída.
    try:
        q = m8m9._rpc("outbox_pending_count", {"p_event_type": EVENT_TYPE})
        print(f"  fila inteira do tipo     = {q[0] if q else '(vazia)'}")
    except Exception as e:  # noqa: BLE001
        print(f"  fila inteira do tipo     = (RPC indisponível: {type(e).__name__})")

    # ── 4. A PERMISSÃO ───────────────────────────────────────────────────────────────────────
    sec("4. A PERMISSÃO")
    print(f"  ALLOWANCE_ROWS           = {tem_allow}")
    r = m8m9._rpc("cdb_confirmation_recipient", {"p_entry_id": ENTRADA_OPERADOR})
    linha_r = r[0] if r else {}
    print(f"  operador liberado agora  = {linha_r.get('allowed')}")
    print(f"  endereço resolvível      = {'SIM' if linha_r.get('recipient') else 'NAO'}"
          "   (valor deliberadamente não impresso)")

    # ── 5. ENTREGAS ──────────────────────────────────────────────────────────────────────────
    sec("5. ENTREGAS REGISTRADAS")
    for fam in ("cdb2026:entry-saved-confirmation",):
        try:
            c = m8m9._rpc("delivery_count_family", {"p_app": "cdb2026", "p_family": fam})
            print(f"  família {fam}")
            print(f"    -> {c[0] if c else '(nenhuma)'}")
        except Exception as e:  # noqa: BLE001
            print(f"    -> (indisponível: {type(e).__name__})")

    # ── 6. KILL SWITCH ───────────────────────────────────────────────────────────────────────
    sec("6. KILL SWITCH")
    ks = RAIZ / "bolao" / "cdb2026" / "EMAIL_KILL_SWITCH"
    print(f"  arquivo presente         = {ks.exists()}")
    import send_entry_saved_confirmation as C  # noqa: E402
    permitido, nota = C.kill_switch_permite()
    print(f"  política para ESTE evento= {'PERMITE' if permitido else 'BLOQUEIA'}")
    print(f"  nota                     = {nota}")

    print("\n" + "═" * 78)
    print("  FIM — nenhuma escrita, nenhuma chamada a provedor")
    print("═" * 78)
    return 0


if __name__ == "__main__":
    sys.exit(main())
