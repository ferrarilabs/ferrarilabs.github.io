"""
operator_cli.py — CLI canônica de operação do BR2026.

NOME DO ARQUIVO: não pode ser `operator.py`. O Python tem um módulo `operator` na stdlib, e
`collections` faz `from operator import eq` durante a própria inicialização — um arquivo com esse
nome no diretório do script sombreia o da stdlib e quebra o interpretador antes da primeira linha
rodar. Descoberto na primeira execução.

Substitui as escritas administrativas que saíram do navegador público (N22, 2026-08-10). O painel
no navegador ficou somente leitura; estas são as operações reais.

─── POR QUE ESTE ARQUIVO EXISTE ────────────────────────────────────────────────────────────────

Até 2026-08-10 marcar alguém como pago era um clique no admin, que gravava o DOCUMENTO JSON
INTEIRO com a anon key pública. Quem tivesse a chave — que vai no `js/config.js` servido a todo
navegador — podia reescrever entradas, pagamentos e resultados de uma vez só.

As mutações viraram RPCs estreitas, e as de operador foram revogadas de `anon`. Isso fecha o
buraco e cria uma obrigação: sem esta CLI, o Eduardo perderia a capacidade de operar o bolão.
Esta ferramenta é a metade que faltava, não um extra.

─── AUTENTICAÇÃO ───────────────────────────────────────────────────────────────────────────────

Usa a sessão da CLI do Supabase (`supabase login` + `link`), executando as RPCs por
`supabase db query`. A credencial nunca aparece aqui, nunca é impressa e nunca vai para o log.

─── SEGURANÇA POR DESENHO ──────────────────────────────────────────────────────────────────────

  • DRY-RUN É O PADRÃO. Nada muda sem `--apply` explícito.
  • Nenhuma operação substitui o documento inteiro — cada uma chama uma RPC que altera um aspecto.
  • `confirm-payment` e `unconfirm-payment` são comandos SEPARADOS. Não existe
    `set-payment --paid=<bool>`: um valor booleano vindo de texto ambíguo é como se marca a
    pessoa errada.
  • O diff mostra o que muda sem despejar PII: e-mail e pagador aparecem mascarados.
  • Saída não-zero em qualquer falha.

Uso:
  python3 operator_cli.py list
  python3 operator_cli.py confirm-payment --entry-ref e_abc123
  python3 operator_cli.py confirm-payment --entry-ref e_abc123 --apply
  python3 operator_cli.py add-participant --name "Fulano" --email fulano@example.invalid --picks-file picks.json --apply
  python3 operator_cli.py update-participant --entry-ref e_abc --email novo@example.invalid --apply
  python3 operator_cli.py remove-participant --entry-ref e_abc --apply
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
import urllib.request
from datetime import datetime, timezone

POOL = "br2026"
SUPABASE_URL = "https://cmhqkkfczotdnssupkni.supabase.co"
ANON_KEY = "sb_publishable_9eJsJzMcROuj9SFOMVUTvA_mWVz0fG5"
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
LOG_DIR = os.path.expanduser("~/Documents/GitHub/ferrarilabs-work/logs")

PAYMENT_METHODS = ("zelle", "venmo", "cashapp", "pix", "other")


# ── Log operacional ───────────────────────────────────────────────────────────
def audit(operation, **campos):
    """JSONL na mesma pasta e no mesmo formato da política de retenção/ZIP-9 já existente.

    NUNCA registra e-mail, nome de pagador, token ou credencial — só a referência opaca da
    entrada e o resultado. Um log de operação que carrega PII vira o próprio vazamento.
    """
    os.makedirs(LOG_DIR, exist_ok=True)
    ts = datetime.now(timezone.utc)
    registro = {"timestamp": ts.isoformat(), "schemaVersion": 1,
                "environment": "operator-cli", "application": "br2026",
                "eventType": operation, **campos}
    proibido = {"email", "participantEmail", "payerName", "token", "apikey", "password"}
    registro = {k: v for k, v in registro.items() if k.lower() not in {p.lower() for p in proibido}}
    caminho = os.path.join(LOG_DIR, f"br2026-operator-{ts.strftime('%Y-%m-%d')}.jsonl")
    with open(caminho, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(registro, ensure_ascii=False) + "\n")


def mask(valor):
    """Mascara PII para o diff. Mostra o suficiente para conferir, não para vazar."""
    if not valor:
        return "(vazio)"
    v = str(valor)
    if "@" in v:
        u, _, d = v.partition("@")
        return f"{u[:2]}{'*' * max(1, len(u) - 2)}@{d}"
    return f"{v[:2]}{'*' * max(1, len(v) - 2)}"


# ── Acesso ────────────────────────────────────────────────────────────────────
def read_public_state():
    """Estado público (sem PII). Serve para validar referências e montar o diff."""
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/bolao_state_public?id=eq.{POOL}&select=state",
        headers={"apikey": ANON_KEY, "Authorization": f"Bearer {ANON_KEY}"})
    with urllib.request.urlopen(req, timeout=25) as r:
        linhas = json.loads(r.read())
    if not linhas:
        raise RuntimeError(f"estado inexistente para {POOL}")
    return linhas[0]["state"]


def sql_literal(v):
    """Literal SQL seguro. `None` vira NULL; texto tem aspas duplicadas."""
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (dict, list)):
        return "'" + json.dumps(v, ensure_ascii=False).replace("'", "''") + "'::jsonb"
    return "'" + str(v).replace("'", "''") + "'"


def run_rpc(chamada_sql):
    """Executa via sessão privilegiada da CLI do Supabase. Credencial nunca é impressa."""
    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, encoding="utf-8") as fh:
        fh.write(chamada_sql + "\n")
        caminho = fh.name
    try:
        proc = subprocess.run(
            ["npx", "--yes", "supabase@latest", "db", "query", "--linked", "--file", caminho],
            cwd=REPO_ROOT, capture_output=True, text=True, timeout=180)
        if proc.returncode != 0:
            raise RuntimeError(f"RPC falhou: {(proc.stderr or proc.stdout)[:300]}")
        return proc.stdout
    finally:
        os.unlink(caminho)


def find_entry(state, entry_ref):
    for e in state.get("entries") or []:
        if e.get("id") == entry_ref:
            return e
    return None


def require_entry(state, entry_ref):
    e = find_entry(state, entry_ref)
    if e is None:
        raise SystemExit(f"🛑 entrada '{entry_ref}' nao existe em {POOL}. "
                         f"Use `operator.py list` para ver as referencias validas.")
    if entry_ref in (state.get("deletedIds") or []):
        raise SystemExit(f"🛑 entrada '{entry_ref}' ja esta cancelada.")
    return e


def diff_linha(campo, antes, depois, mascarar=False):
    a = mask(antes) if mascarar else (antes if antes not in (None, "") else "(vazio)")
    d = mask(depois) if mascarar else (depois if depois not in (None, "") else "(vazio)")
    marca = "  " if a == d else "→ "
    return f"    {marca}{campo:<18} {a}  =>  {d}"


def confirmar(args, resumo, chamada_sql, operation, **log_extra):
    """Imprime o diff e executa somente com --apply. Dry-run é o padrão."""
    print(resumo)
    if not args.apply:
        print("\n  DRY-RUN — nada foi alterado. Repita com --apply para executar.")
        audit(operation, mode="dry-run", applied=False, **log_extra)
        return 0
    saida = run_rpc(chamada_sql)
    print("\n  ✓ aplicado.")
    audit(operation, mode="apply", applied=True, **log_extra)
    return 0


# ── Comandos ──────────────────────────────────────────────────────────────────
def cmd_list(args):
    st = read_public_state()
    ents = st.get("entries") or []
    deletados = set(st.get("deletedIds") or [])
    pagos = st.get("paid") or {}
    print(f"{POOL}: {len(ents)} entrada(s)\n")
    print(f"  {'entry_ref':<36} {'nome':<24} {'pago':<5} estado")
    for e in ents:
        estado = "cancelada" if e["id"] in deletados else "ativa"
        print(f"  {e['id']:<36} {(e.get('entryName') or '')[:24]:<24} "
              f"{'sim' if pagos.get(e['id']) else 'nao':<5} {estado}")
    print("\n  (e-mail e nome do pagador NAO sao exibidos: sairam do estado publico)")
    return 0


def cmd_confirm_payment(args, paid=True):
    st = read_public_state()
    e = require_entry(st, args.entry_ref)
    atual = bool((st.get("paid") or {}).get(args.entry_ref))
    verbo = "CONFIRMAR" if paid else "DESFAZER"
    if atual == paid:
        print(f"  Nada a fazer: '{e.get('entryName')}' ja esta "
              f"{'pago' if paid else 'nao pago'}.")
        return 0
    resumo = (f"\n{verbo} PAGAMENTO — {POOL}\n"
              f"  entrada: {args.entry_ref}  ({e.get('entryName')})\n"
              + diff_linha("paid", atual, paid))
    sql = (f"select op_confirm_payment({sql_literal(POOL)}, {sql_literal(args.entry_ref)}, "
           f"{sql_literal(paid)});")
    return confirmar(args, resumo, sql, "operator_confirm_payment",
                     entryRef=args.entry_ref, paidBefore=atual, paidAfter=paid)


def cmd_add_participant(args):
    if not args.name or len(args.name) > 80:
        raise SystemExit("🛑 --name obrigatorio, ate 80 caracteres.")
    if "@" not in (args.email or ""):
        raise SystemExit("🛑 --email com sintaxe invalida.")
    if args.method and args.method not in PAYMENT_METHODS:
        raise SystemExit(f"🛑 --method precisa ser um de {PAYMENT_METHODS}.")
    try:
        picks = json.loads(open(args.picks_file, encoding="utf-8").read()) if args.picks_file else {}
    except Exception as ex:
        raise SystemExit(f"🛑 --picks-file ilegivel: {ex}")
    if not isinstance(picks, dict):
        raise SystemExit("🛑 picks precisa ser um objeto JSON.")

    # Reusa a MESMA RPC do formulario publico: as regras de negocio ficam num lugar so. Uma
    # segunda implementacao para o operador seria exatamente a deriva que este repo ja viveu.
    resumo = (f"\nADICIONAR PARTICIPANTE — {POOL}\n"
              f"  nome  : {args.name}\n"
              f"  e-mail: {mask(args.email)}\n"
              f"  pagador: {mask(args.payer) if args.payer else '(nao informado)'}\n"
              f"  metodo: {args.method or '(nao informado)'}\n"
              f"  picks : {len(picks)} chave(s)\n"
              f"  (o servidor atribui o entry_ref e valida prazo, e-mail e forma dos palpites)")
    ref = args.client_ref or f"operator-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}"
    sql = (f"select submit_entry({sql_literal(POOL)}, {sql_literal(args.name)}, "
           f"{sql_literal(args.email)}, {sql_literal(picks)}, {sql_literal(args.payer)}, "
           f"{sql_literal(args.method)}, {sql_literal(ref)});")
    return confirmar(args, resumo, sql, "operator_add_participant", clientRef=ref)


def cmd_update_participant(args):
    st = read_public_state()
    e = require_entry(st, args.entry_ref)
    if not any([args.name, args.email, args.payer, args.method]):
        raise SystemExit("🛑 informe ao menos um campo para alterar.")
    if args.email and "@" not in args.email:
        raise SystemExit("🛑 --email com sintaxe invalida.")
    if args.method and args.method not in PAYMENT_METHODS:
        raise SystemExit(f"🛑 --method precisa ser um de {PAYMENT_METHODS}.")

    linhas = [f"\nATUALIZAR PARTICIPANTE — {POOL}",
              f"  entrada: {args.entry_ref}  ({e.get('entryName')})"]
    if args.name:   linhas.append(diff_linha("entryName", e.get("entryName"), args.name))
    if args.email:  linhas.append(diff_linha("participantEmail", "(privado)", args.email, mascarar=True))
    if args.payer:  linhas.append(diff_linha("payerName", "(privado)", args.payer, mascarar=True))
    if args.method: linhas.append(diff_linha("paymentMethod", "(privado)", args.method))
    linhas.append("    (paid, results e estado de rodada NAO sao alcancaveis por este comando)")

    sql = (f"select op_update_entry({sql_literal(POOL)}, {sql_literal(args.entry_ref)}, "
           f"{sql_literal(args.name)}, {sql_literal(args.email)}, "
           f"{sql_literal(args.payer)}, {sql_literal(args.method)});")
    campos = [k for k, v in (("entryName", args.name), ("participantEmail", args.email),
                             ("payerName", args.payer), ("paymentMethod", args.method)) if v]
    return confirmar(args, "\n".join(linhas), sql, "operator_update_participant",
                     entryRef=args.entry_ref, fieldsChanged=campos)


def cmd_remove_participant(args):
    st = read_public_state()
    e = require_entry(st, args.entry_ref)
    resumo = (f"\nCANCELAR PARTICIPANTE — {POOL}\n"
              f"  entrada: {args.entry_ref}  ({e.get('entryName')})\n"
              f"    → cancelamento LOGICO: a entrada entra em deletedIds.\n"
              f"      Nada e destruido; ranking e historico continuam auditaveis.")
    sql = f"select op_remove_entry({sql_literal(POOL)}, {sql_literal(args.entry_ref)});"
    return confirmar(args, resumo, sql, "operator_remove_participant", entryRef=args.entry_ref)


def cmd_correct(args):
    """Correção administrativa — apenas categorias com API estreita definida.

    Deliberadamente NÃO existe edição de JSON arbitrário. Uma categoria sem API segura falha
    aqui e exige que alguém adicione a RPC correspondente de propósito, em vez de abrir um
    caminho genérico que recria a vulnerabilidade.
    """
    suportadas = {"entry-name": "use `update-participant --name`",
                  "payment": "use `confirm-payment` / `unconfirm-payment`",
                  "contact": "use `update-participant --email/--payer/--method`"}
    print(f"\nCORRECAO ADMINISTRATIVA — categorias com caminho seguro:\n")
    for k, v in suportadas.items():
        print(f"  {k:<12} {v}")
    print(f"\n  Categoria pedida: {args.category or '(nenhuma)'}")
    if args.category in suportadas:
        print(f"  → {suportadas[args.category]}")
        return 0
    print("\n  🛑 Sem API estreita para esta categoria. Adicione uma RPC especifica em")
    print("     bolao/shared/sql/ antes de operar — nao existe edicao de JSON arbitrario.")
    audit("operator_correction_unsupported", category=args.category or None)
    return 1


def main():
    p = argparse.ArgumentParser(description="Operacao canonica do BR2026 (dry-run por padrao)")
    sub = p.add_subparsers(dest="cmd", required=True)

    def comum(sp):
        sp.add_argument("--apply", action="store_true",
                        help="executa de verdade (sem isto, apenas dry-run)")
        return sp

    sub.add_parser("list", help="lista entradas (sem PII)")

    for nome, ajuda in (("confirm-payment", "marca pago"), ("unconfirm-payment", "desfaz pago")):
        sp = comum(sub.add_parser(nome, help=ajuda))
        sp.add_argument("--entry-ref", required=True)

    sp = comum(sub.add_parser("add-participant", help="adiciona participante"))
    sp.add_argument("--name", required=True); sp.add_argument("--email", required=True)
    sp.add_argument("--payer"); sp.add_argument("--method", choices=PAYMENT_METHODS)
    sp.add_argument("--picks-file"); sp.add_argument("--client-ref")

    sp = comum(sub.add_parser("update-participant", help="atualiza dados do participante"))
    sp.add_argument("--entry-ref", required=True)
    sp.add_argument("--name"); sp.add_argument("--email")
    sp.add_argument("--payer"); sp.add_argument("--method", choices=PAYMENT_METHODS)

    sp = comum(sub.add_parser("remove-participant", help="cancela (logicamente) uma entrada"))
    sp.add_argument("--entry-ref", required=True)

    sp = comum(sub.add_parser("correct", help="correcao administrativa (categorias estreitas)"))
    sp.add_argument("--category")

    args = p.parse_args()
    try:
        if args.cmd == "list":                 return cmd_list(args)
        if args.cmd == "confirm-payment":      return cmd_confirm_payment(args, paid=True)
        if args.cmd == "unconfirm-payment":    return cmd_confirm_payment(args, paid=False)
        if args.cmd == "add-participant":      return cmd_add_participant(args)
        if args.cmd == "update-participant":   return cmd_update_participant(args)
        if args.cmd == "remove-participant":   return cmd_remove_participant(args)
        if args.cmd == "correct":              return cmd_correct(args)
    except SystemExit:
        raise
    except Exception as ex:
        print(f"🛑 falhou: {ex}", file=sys.stderr)
        audit("operator_error", operation=args.cmd, error=type(ex).__name__)
        return 1
    return 1


if __name__ == "__main__":
    sys.exit(main())
