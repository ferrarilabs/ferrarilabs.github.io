#!/usr/bin/env python3
"""
Catch-up de comprovantes do CDB2026 — ferramenta genérica, escopo SEMPRE explícito.

Substitui os dois scripts one-off (`receipt_catchup.py`, 12/08, e `receipt_catchup_20260816.py`,
16/08), que estão arquivados e desarmados em `scripts/archive/` como evidência dos incidentes.

═══ O QUE MUDOU EM RELAÇÃO AOS ONE-OFFS ═════════════════════════════════════════════════════════

1. DEDUPE É CROSS-PATH E É O CONTROLE PRIMÁRIO.
   A elegibilidade pergunta `cdb_has_accepted_receipt(entrada, versão)` — uma pergunta, todos os
   transportes. Os one-offs perguntavam "esta família já entregou?", e havia quatro famílias para
   um fato só; foi assim que Bossle e Rodrigo Hajj receberam duas vezes.

2. A RESERVA USA A CHAVE CANÔNICA DE PRODUÇÃO.
   `cdb2026:entry-saved-confirmation:<versão>:v1`, mesma família. Um catch-up não é outro evento
   de negócio — é o mesmo recibo por outro transporte. Com isso o UNIQUE do banco resolve
   NORMAL→CATCHUP e CATCHUP→NORMAL sozinho, sem depender de nenhuma checagem em Python.
   Consequência deliberada: o disjuntor de 45 minutos volta a valer sem bypass. Um catch-up
   bloqueado por ele é PULADO e reportado — falhar fechado e o operador rodar de novo mais tarde
   é melhor que abrir exceção num remetente em lote.

3. O RECORTE DE DATA É SECUNDÁRIO E EXPLÍCITO.
   `--target-date` define a POPULAÇÃO pretendida, não a proteção contra duplicata. E um envio real
   sem `--target-date` é RECUSADO: nenhuma operação irreversível pode mudar de significado
   conforme o dia em que alguém a reroda. Só `--medir` aceita o default de hoje.

4. MANIFESTO IMUTÁVEL EM ARQUIVO.
   `--medir` grava o manifesto; `--enviar` exige `--manifest` e recusa se o hash não bater com uma
   remedição. Aprovação humana vale para uma lista concreta, não para uma consulta que pode
   devolver outra coisa dez minutos depois.

═══ TESTABILIDADE ═══════════════════════════════════════════════════════════════════════════════

Toda dependência externa entra pelo construtor (`rpc`, `estado_fn`, `envia_fn`). O teste offline
`test_receipt_catchup_dedupe.py` reproduz o incidente de 16/08 sem tocar em rede nenhuma, e as
mutações que removem o dedupe cross-path deixam a suíte vermelha.

Nenhum endereço é impresso. O relatório usa nome de entrada.
"""

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parents[2]
sys.path.insert(0, str(RAIZ / "bolao" / "shared" / "scripts"))
sys.path.insert(0, str(AQUI))

import receipt_identity as ID   # noqa: E402
import receipt_render as R      # noqa: E402

SUPABASE = "https://cmhqkkfczotdnssupkni.supabase.co"
APP = "cdb2026"
NY = timezone(timedelta(hours=-4))   # America/New_York em agosto (EDT)


def dia_ny(iso):
    if not iso:
        return None
    try:
        t = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        return t.astimezone(NY).strftime("%Y-%m-%d")
    except Exception:  # noqa: BLE001
        return None


def snapshot_de(entrada, est):
    """Lista de PERMISSÃO, igual à do produtor: nada da entrada entra sozinho."""
    picks = entrada.get("picks") or {}
    canon = {"matches": picks.get("matches") or {}, "qualified": picks.get("qualified") or {}}
    fases = {}
    for fid, fase in (est.get("phases") or {}).items():
        if not isinstance(fase, dict):
            continue
        fases[fid] = {
            "ties": {tid: {"teamA": t.get("teamA"), "teamB": t.get("teamB")}
                     for tid, t in (fase.get("ties") or {}).items()},
            "topology": ((fase.get("topology") or {}).get("slots")) or {},
        }
    return {"picks": canon, "entryName": entrada.get("entryName"),
            "savedAt": entrada.get("updatedAt"), "phases": fases}


def hash_manifesto(elegiveis):
    """Identidade imutável do lote: entrada + versão, ordenado. Sem endereço."""
    corpo = sorted((r["entryId"], r["picksVersion"]) for r in elegiveis)
    return hashlib.sha256(json.dumps(corpo, sort_keys=True).encode()).hexdigest()[:16]


class Catchup:
    """
    Medição e envio. Nada aqui abre conexão: `rpc`, `estado_fn` e `envia_fn` são injetados.
    """

    def __init__(self, *, rpc, estado_fn, envia_fn, target_date, excluir=()):
        self.rpc = rpc
        self.estado_fn = estado_fn
        self.envia_fn = envia_fn
        self.target_date = target_date
        self.excluir = set(excluir or ())
        self.provider_calls = 0

    # ── MEDIÇÃO ──────────────────────────────────────────────────────────────────────────────
    def medir(self):
        """
        Devolve (todas, elegiveis). Só leitura — nenhuma reserva, nenhuma permissão, nenhum envio.

        Elegibilidade:

            versão gravada atual identificada     (identidade do documento)
          AND nenhum recibo aceito dessa entrada+versão em NENHUM caminho reconhecido
                                                  (o CONTROLE DE DUPLICATA, cross-path)
          AND save material na janela alvo        (recorte da POPULAÇÃO)

        A ordem em que os motivos são AVALIADOS é deliberada e é o oposto da que os one-offs
        usavam: a pergunta canônica vem primeiro, a janela depois. Uma entrada que já tem recibo
        desta versão sai rotulada `SKIP_ALREADY_RECEIVED_SAME_VERSION` mesmo quando a janela
        também a excluiria — se o rótulo fosse `SKIP_FORA_DA_JANELA`, o relatório daria a
        impressão de que foi a data que protegeu o participante, e foi exatamente essa impressão
        que sobreviveu ao post-mortem de 16/08 e teria deixado o defeito de pé.
        """
        est = self.estado_fn()
        apagadas = set(est.get("deletedIds") or [])
        todas, elegiveis = [], []

        for e in est.get("entries", []):
            eid = e.get("id")
            if not eid or eid in apagadas:
                continue

            tem_ref = bool(e.get("lastClientRef"))
            dia = dia_ny(e.get("updatedAt"))
            picks = e.get("picks") or {}
            versao = self.rpc("cdb_picks_version", {"p_picks": picks})
            snap = snapshot_de(e, est)

            # ── A LEITURA AUTORITATIVA ────────────────────────────────────────────────────────
            # Completude sai da MESMA resolução que o comprovante usa (confrontos virtuais
            # incluídos), nunca da contagem de confrontos registrados — ver
            # `authoritative_pick_completeness` em receipt_identity.py.
            completude = ID.authoritative_pick_completeness(snap)

            material = tem_ref and dia == self.target_date
            # A pergunta canônica é feita para TODA entrada, inclusive as que a janela excluiria.
            # É só leitura, e é o que permite o relatório dizer a verdade sobre quem protegeu quem.
            decisao = ID.has_accepted_receipt(eid, versao, self.rpc)

            if decisao.blocks_send:
                estado_reg = decisao.label
                motivo = decisao.reason
            elif not tem_ref:
                estado_reg = "SKIP_SEM_SAVE_DO_PARTICIPANTE"
                motivo = "lastClientRef ausente — nunca gravou pelo caminho seguro"
            elif dia != self.target_date:
                estado_reg = "SKIP_FORA_DA_JANELA"
                motivo = f"salvou em {dia or '(nunca)'} — fora da janela alvo {self.target_date}"
            elif eid in self.excluir:
                estado_reg = "SKIP_EXCLUIDO_NOMINALMENTE"
                motivo = "excluído por decisão explícita do operador"
            else:
                estado_reg = "ELIGIBLE"
                motivo = decisao.reason

            reg = {
                "entryId": eid,
                "entryName": e.get("entryName") or "(sem nome)",
                "materialSave": material,
                "savedAt": e.get("updatedAt"),
                "savedAtNY": dia,
                "picksVersion": versao,
                "estado": estado_reg,
                "caminhos": decisao.paths,
                "bracket": {
                    "campeao": completude["campeao"],
                    "vice": completude["vice"],
                    "confrontosRegistrados": completude["confrontosRegistrados"],
                    "ultimaFaseComPalpite": completude["ultimaFaseComPalpite"],
                    "chegaAteFinal": completude["chegaAteFinal"],
                },
                "motivo": motivo,
            }
            todas.append(reg)

            if estado_reg == "ELIGIBLE":
                elegiveis.append(reg)

        return todas, elegiveis

    # ── ENVIO ────────────────────────────────────────────────────────────────────────────────
    def enviar(self, elegiveis_congelados):
        est = self.estado_fn()
        apagadas = set(est.get("deletedIds") or [])
        por_id = {e.get("id"): e for e in est.get("entries", []) if e.get("id") not in apagadas}

        teto = len(elegiveis_congelados)
        aceitos = incertos = pulados = 0

        for alvo in elegiveis_congelados:
            eid, versao_manifesto = alvo["entryId"], alvo["picksVersion"]
            nome = alvo["entryName"]

            entrada = por_id.get(eid)
            if entrada is None:
                print(f"  PULADO {nome}: entrada sumiu entre medir e enviar"); pulados += 1
                continue

            snap = snapshot_de(entrada, est)
            versao_agora = self.rpc("cdb_picks_version", {"p_picks": entrada.get("picks") or {}})
            if versao_agora != versao_manifesto:
                print(f"  PULADO {nome}: salvou de novo depois da medição "
                      f"({versao_manifesto} -> {versao_agora}); recibo sairia com versão errada")
                pulados += 1
                continue
            conferida = self.rpc("cdb_picks_version", {"p_picks": snap["picks"]})
            if conferida != versao_manifesto:
                print(f"  PULADO {nome}: snapshot não confere com a versão"); pulados += 1
                continue

            # ── ÚLTIMA PERGUNTA CANÔNICA, IMEDIATAMENTE ANTES DE RESERVAR ────────────────────
            #
            # Já foi feita na medição. É feita de novo aqui porque entre medir e enviar o
            # consumidor agendado pode ter entregue esta mesma versão — e aí o alvo deixou de
            # ser alvo. Custa uma consulta; evita exatamente o e-mail deste incidente.
            decisao = ID.has_accepted_receipt(eid, versao_manifesto, self.rpc)
            if decisao.blocks_send:
                print(f"  PULADO {nome}: {decisao.label} ({decisao.reason}) {decisao.paths}")
                pulados += 1
                continue

            corpo = R.monta_recibo(snap, versao_manifesto)
            assunto = R.monta_assunto(snap.get("entryName") or "sua entrada")
            camp, vice = R.podio(snap)

            self.rpc("cdb_grant_confirmation_allowance",
                     {"p_entry_id": eid,
                      "p_note": f"catch-up {self.target_date} autorizado pelo operador"})
            try:
                r = self.rpc("cdb_confirmation_recipient", {"p_entry_id": eid})
                linha = r[0] if r else {}
                if not linha.get("allowed") or not linha.get("recipient"):
                    print(f"  PULADO {nome}: destinatário não resolvível no servidor")
                    pulados += 1
                    continue
                addr = linha["recipient"]

                pii = R.varre_pii(corpo, extras=[addr, eid])
                if pii:
                    print(f"  PULADO {nome}: PII_SCAN falhou {pii}"); pulados += 1; continue

                # TETO DURO. A chamada N+1 levanta antes de tocar no provedor.
                if self.provider_calls >= teto:
                    raise RuntimeError(f"TETO ESTOURADO: {self.provider_calls} >= {teto}")

                # A CHAVE E A FAMÍLIA SÃO AS DE PRODUÇÃO. Ver o cabeçalho: transporte diferente
                # não é evento diferente. Sem `p_bypass_anomaly` — o disjuntor volta a valer.
                rr = self.rpc("reserve_delivery", {
                    "p_app": APP,
                    "p_business_key": ID.canonical_business_key(versao_manifesto),
                    "p_recipient": addr,
                    "p_generation": 1,
                    "p_family": ID.CANONICAL_FAMILY,
                })
                reserva = rr[0] if rr else {}
                if not reserva.get("reserved"):
                    print(f"  PULADO {nome}: {reserva.get('reason')}"); pulados += 1; continue
                did = reserva["delivery_id"]

                self.provider_calls += 1
                ok, detalhe, msg_id = self.envia_fn(addr, assunto, corpo)
                if ok:
                    self.rpc("settle_delivery", {"p_delivery_id": did, "p_status": "accepted",
                                                 "p_provider_msg_id": msg_id})
                    aceitos += 1
                    print(f"  ENVIADO {nome} — versão {versao_manifesto}, "
                          f"campeão={camp}, vice={vice}")
                else:
                    # Incerto, nunca 'failed': o provedor pode ter aceitado e a resposta ter se
                    # perdido. Liberar a reserva autorizaria um segundo envio.
                    self.rpc("settle_delivery", {"p_delivery_id": did, "p_status": "uncertain"})
                    incertos += 1
                    print(f"  INCERTO {nome}: {detalhe}")
            finally:
                self.rpc("cdb_close_confirmation_allowance", {"p_entry_id": eid})

        print(f"\n  PROVIDER_CALLS = {self.provider_calls}   ACCEPTED = {aceitos}   "
              f"UNCERTAIN = {incertos}   PULADOS = {pulados}")
        return {"providerCalls": self.provider_calls, "accepted": aceitos,
                "uncertain": incertos, "skipped": pulados}


# ── RELATÓRIO ────────────────────────────────────────────────────────────────────────────────
def relatar(todas, elegiveis, titulo, target_date):
    print(f"\n{'═' * 78}\n  {titulo}\n{'═' * 78}")
    print(f"  JANELA_ALVO = {target_date}   (recorte de população; NÃO é o controle de duplicata)")
    for r in sorted(todas, key=lambda x: (x["estado"] != "ELIGIBLE", x["entryName"])):
        marca = "ALVO" if r["estado"] == "ELIGIBLE" else "fora"
        print(f"\n  [{marca:>4}] {r['entryName']}   -> {r['estado']}")
        print(f"        SAVED_AT = {r['savedAt'] or '(nunca)'}   VERSION = {r['picksVersion']}")
        b = r["bracket"]
        print(f"        BRACKET  = até '{b['ultimaFaseComPalpite']}'"
              f"; final completa={'SIM' if b['chegaAteFinal'] else 'NAO'}"
              f"; campeão={b['campeao']}; vice={b['vice']}"
              f"   (confrontos registrados no torneio: {b['confrontosRegistrados']})")
        if r["caminhos"]:
            print(f"        RECIBOS  = {r['caminhos']}")
        print(f"        MOTIVO   = {r['motivo']}")

    incertos = [r for r in todas if r["estado"] == "SKIP_UNCERTAIN_NEEDS_OPERATOR_REVIEW"]
    print(f"\n  TOTAL_CDB_ENTRIES     = {len(todas)}")
    print(f"  TARGETED_FOR_CATCHUP  = {len(elegiveis)}")
    print(f"  NEEDS_OPERATOR_REVIEW = {len(incertos)} {[r['entryName'] for r in incertos]}")
    print(f"  MANIFEST_HASH         = {hash_manifesto(elegiveis)}")
    print(f"  ALVOS                 = {[r['entryName'] for r in elegiveis]}")


# ── FIAÇÃO DE PRODUÇÃO ───────────────────────────────────────────────────────────────────────
def _estado_real():
    import urllib.request
    k = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    req = urllib.request.Request(f"{SUPABASE}/rest/v1/bolao_state?id=eq.cdb2026&select=state",
                                 headers={"apikey": k, "Authorization": f"Bearer {k}"})
    with urllib.request.urlopen(req, timeout=25) as r:
        linha = json.loads(r.read().decode())
    return (linha[0] if linha else {}).get("state") or {}


def main(argv=None):
    ap = argparse.ArgumentParser(description="Catch-up de comprovantes do CDB2026")
    ap.add_argument("--medir", action="store_true", help="só leitura; grava o manifesto")
    ap.add_argument("--enviar", action="store_true", help="envia o manifesto congelado")
    ap.add_argument("--target-date", help="YYYY-MM-DD (America/New_York). "
                                          "OBRIGATÓRIO para --enviar.")
    ap.add_argument("--manifest", help="caminho do manifesto (gravado por --medir, exigido "
                                       "por --enviar)")
    ap.add_argument("--excluir", default="", help="ids de entrada separados por vírgula")
    ap.add_argument("--approve", help='para --enviar, exige "HUMAN_APPROVED"')
    args = ap.parse_args(argv)

    if not args.medir and not args.enviar:
        ap.print_help()
        return 2

    # ═══ ESCOPO EXPLÍCITO — REAL_RUN_WITHOUT_EXPLICIT_SCOPE = REFUSED ════════════════════════
    #
    # Um envio real não pode mudar de significado conforme o dia em que alguém o reroda. Só a
    # medição, que é só leitura, aceita o default de hoje.
    if args.enviar and not args.target_date:
        print("RECUSADO: --enviar exige --target-date YYYY-MM-DD explícito.\n"
              "          Um envio real cujo alvo depende de 'hoje' muda de significado a cada "
              "rerun — foi assim que o catch-up de 2026-08-16 alcançou quem não devia.")
        return 2
    if args.enviar and args.approve != "HUMAN_APPROVED":
        print("RECUSADO: --enviar exige --approve HUMAN_APPROVED")
        return 2
    if args.enviar and not args.manifest:
        print("RECUSADO: --enviar exige --manifest congelado por --medir")
        return 2

    target = args.target_date or datetime.now(timezone.utc).astimezone(NY).strftime("%Y-%m-%d")
    try:
        datetime.strptime(target, "%Y-%m-%d")
    except ValueError:
        print(f"RECUSADO: --target-date inválido ({target!r}); esperado YYYY-MM-DD")
        return 2

    import m8m9                                # noqa: E402
    import send_entry_saved_confirmation as C  # noqa: E402

    cat = Catchup(rpc=m8m9._rpc, estado_fn=_estado_real, envia_fn=C.envia,
                  target_date=target,
                  excluir=[x.strip() for x in args.excluir.split(",") if x.strip()])

    todas, elegiveis = cat.medir()
    relatar(todas, elegiveis, "MEDIÇÃO — só leitura, nenhuma reserva, nenhum envio", target)

    if args.medir and args.manifest:
        Path(args.manifest).write_text(json.dumps(
            {"targetDate": target, "hash": hash_manifesto(elegiveis), "alvos": elegiveis},
            ensure_ascii=False, indent=2))
        print(f"\n  manifesto gravado em {args.manifest}")

    if not args.enviar:
        return 0

    # ═══ MANIFESTO IMUTÁVEL ══════════════════════════════════════════════════════════════════
    congelado = json.loads(Path(args.manifest).read_text())
    if congelado.get("targetDate") != target:
        print(f"\nABORTADO: manifesto é de {congelado.get('targetDate')}, "
              f"--target-date é {target}")
        return 1
    if congelado.get("hash") != hash_manifesto(elegiveis):
        print(f"\nABORTADO: manifesto mudou ({congelado.get('hash')} -> "
              f"{hash_manifesto(elegiveis)}). Exige nova aprovação humana.")
        return 1

    print(f"\n{'═' * 78}\n  ENVIO — manifesto congelado {congelado['hash']}\n{'═' * 78}")
    if not congelado["alvos"]:
        print("  nenhum alvo — nada a enviar")
        return 0
    cat.enviar(congelado["alvos"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
