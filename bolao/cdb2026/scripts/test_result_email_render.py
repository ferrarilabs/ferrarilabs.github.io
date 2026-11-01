"""
CDB2026 — `send_result_email.py --render`: o e-mail EXATO, a partir de um arquivo, sem enviar.

Por que existe (2026-11-01): depois da correcao da semifinal Palmeiras x Vasco, o operador precisa
ver o e-mail que sairia ANTES de qualquer envio. O unico jeito era rodar o sender de verdade. O
modo `--render <phaseId> <tieId> <leg> --state-file <json> --out <html>` monta o mesmo HTML de
build_html() a partir de um snapshot e grava num arquivo.

O que este teste prova:
  1. nunca envia: send_email/_send_to_all/sb_fetch/ledger explodem se tocados, e o render passa;
  2. pela linha de comando (subprocesso), com o snapshot corrigido, o arquivo sai com o placar
     corrigido e com o palpite de cada entrada -- "sem palpite" so para quem nao palpitou;
  3. recusa perna sem placar, confronto inexistente, e --render sem --state-file/--out;
  4. aceita o documento cru do estado e o envelope {"state": ...}.

Hermetico: sem rede, sem Supabase, sem e-mail. Uso: BOLAO_TEST_RUN=1 python3 test_result_email_render.py
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI))
os.environ["BOLAO_TEST_RUN"] = "1"

import send_result_email as S  # noqa: E402

FIX = AQUI / "fixtures" / "cdb_email_parity_state_2026-11-01.json"
PLANO = AQUI.parent / "data" / "corrections" / "2026-11-01-semifinal.json"
SF = "espn-palmeiras_vasco"

ok = fail = 0


def T(nome, f):
    global ok, fail
    try:
        f()
        print(f"  ✓ {nome}")
        ok += 1
    except Exception as ex:  # noqa: BLE001
        print(f"  ✗ {nome}\n      {type(ex).__name__}: {ex}")
        fail += 1


def estado_corrigido():
    s = json.loads(FIX.read_text(encoding="utf-8"))
    s.pop("_o_que_e", None)
    for op in json.loads(PLANO.read_text(encoding="utf-8"))["operations"]:
        tie = s["phases"][op["phaseId"]]["ties"][op["tieId"]]
        m = tie["matches"][op["leg"]]
        if op["op"] == "clear-leg":
            m.update(goalsHome=None, goalsAway=None, status="SCHEDULED")
            tie["qualifiedTeamId"] = None
        elif op["op"] == "save-leg":
            m.update(goalsHome=op["goalsHome"], goalsAway=op["goalsAway"], status="FINAL")
        elif op["op"] == "kickoff":
            m["kickoff"] = op["kickoff"]
    return s


TMP = Path(tempfile.mkdtemp(prefix="cdb_render_"))
STATE_FILE = TMP / "estado.json"
STATE_FILE.write_text(json.dumps(estado_corrigido(), ensure_ascii=False), encoding="utf-8")


def _explode(*a, **k):
    raise AssertionError("o dry-run tocou um caminho de envio/rede")


def t_nunca_envia():
    guard = {n: getattr(S, n) for n in ("send_email", "_send_to_all", "sb_fetch", "_default_ledger", "_sb_rpc")}
    try:
        for n in guard:
            setattr(S, n, _explode)
        out = TMP / "inproc.html"
        subject, html = S.render_from_file("semifinal", SF, "first", str(STATE_FILE), str(out))
        assert out.read_text(encoding="utf-8") == html
        assert "Vasco × Palmeiras" in subject, subject
    finally:
        for n, f in guard.items():
            setattr(S, n, f)


def t_cli_correcao():
    out = TMP / "cli.html"
    env = {"PATH": os.environ.get("PATH", ""), "BOLAO_TEST_RUN": "1", "HOME": os.environ.get("HOME", "")}
    r = subprocess.run([sys.executable, str(AQUI / "send_result_email.py"), "--render", "semifinal", SF, "first",
                        "--state-file", str(STATE_FILE), "--out", str(out)],
                       capture_output=True, text=True, env=env, timeout=60)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "DRY-RUN (nada enviado)" in r.stdout, r.stdout
    html = out.read_text(encoding="utf-8")
    assert "Vasco 0–1 Palmeiras" in html, "placar corrigido ausente"
    assert "(volta)" not in html.split("Pontuação")[0], "o e-mail da IDA nao pode falar da volta"
    # 12 entradas, so uma (Entrada 02) nao palpitou a semifinal.
    assert html.count("sem palpite") == 1, f"'sem palpite' apareceu {html.count('sem palpite')}x"
    assert "<td style=\"padding:6px 10px\">Entrada 07</td>" in html
    # Entrada 07 cravou 0x1 (10 pts), e esta no topo da tabela da perna.
    tabela = html.split("Pontuação")[1].split("Ranking atual")[0]
    assert tabela.index("Entrada 07") < tabela.index("Entrada 01"), "tabela da perna fora de ordem de pontos"


def t_envelope_state():
    env_file = TMP / "envelope.json"
    env_file.write_text(json.dumps({"state": estado_corrigido()}, ensure_ascii=False), encoding="utf-8")
    _, html = S.render_from_file("semifinal", SF, "first", str(env_file), None)
    assert "Vasco 0–1 Palmeiras" in html


def t_recusas():
    for args, quero in [(("semifinal", SF, "second"), "nao tem placar"),
                        (("semifinal", "nao-existe", "first"), "nao existe"),
                        (("semifinal", SF, "single"), "invalida")]:
        try:
            S.render_from_file(*args, str(STATE_FILE), None)
        except SystemExit as ex:
            assert quero in str(ex), str(ex)
        else:
            raise AssertionError(f"{args} deveria recusar")
    env = {"PATH": os.environ.get("PATH", ""), "BOLAO_TEST_RUN": "1", "HOME": os.environ.get("HOME", "")}
    r = subprocess.run([sys.executable, str(AQUI / "send_result_email.py"), "--render", "semifinal", SF, "first"],
                       capture_output=True, text=True, env=env, timeout=60)
    assert r.returncode != 0 and "--state-file" in r.stdout, r.stdout + r.stderr


def t_render_nao_referencia_envio():
    src = (AQUI / "send_result_email.py").read_text(encoding="utf-8")
    ini = src.index("def render_from_file(")
    fim = src.index("# ── Main ──", ini)
    corpo = src[ini:fim]
    for proibido in ("send_email", "_send_to_all", "sb_fetch", "_sb_rpc", "ledger", "BOLAO_ALLOW_REAL_SEND"):
        assert proibido not in corpo, f"o caminho de --render referencia {proibido}"


print("CDB2026 — send_result_email.py --render (dry-run)\n")
T("render em processo nunca toca envio, Supabase nem ledger", t_nunca_envia)
T("CLI: e-mail da correcao (ida 0x1) com o palpite de cada entrada", t_cli_correcao)
T("aceita {\"state\": ...}", t_envelope_state)
T("recusa perna sem placar, confronto inexistente, perna invalida e falta de --state-file", t_recusas)
T("o codigo do --render nao referencia nenhum caminho de envio", t_render_nao_referencia_envio)
print(f"\n{'✗' if fail else '✓'} {ok} ok, {fail} falha(s)")
sys.exit(1 if fail else 0)
