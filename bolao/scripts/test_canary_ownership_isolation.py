#!/usr/bin/env python3
"""Um verificador so pode destruir o que ele mesmo criou.

O QUE ACONTECEU EM 2026-08-12
-----------------------------
`token_roundtrip_canary.py` e `secure_access_canary.py` pegavam uma entrada REAL por INDICE
(`entradas[0]`, `elegiveis[0]`), emitiam credencial para ela, e revogavam no `finally`. Enquanto
ninguem tinha link entregue, inofensivo. Depois dos convites, cada execucao matava o acesso de
quem calhasse de ser o primeiro da lista -- e calhou de ser o operador, duas vezes. Cada morte
virou outro e-mail de correcao para ele.

O erro nao foi revogar. Foi revogar algo que o verificador NAO CRIOU.

A REGRA
-------
Um verificador pode apagar/revogar SOMENTE recurso que ele proprio criou e que carrega marca
explicita de teste (`canary:`, `test_`, `__canary`). Recurso de terceiro e intocavel, mesmo que
mexer nele seja conveniente.

Quando isolamento nao for possivel -- porque a operacao exige um recurso real que ja existe --,
o verificador PULA e diz que pulou. Perder cobertura e mais barato que estragar dado de gente.

O QUE E MEDIDO (hermetico: le fonte)
------------------------------------
  1. nenhum verificador escolhe recurso real por INDICE
  2. quem revoga/apaga contra producao ou opera em namespace de teste, ou desiste
  3. os dois canarios do CDB continuam com a guarda que os faz desistir

Uso: python3 bolao/scripts/test_canary_ownership_isolation.py
"""
import re
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
ok, fail = 0, 0


def test(nome, fn):
    global ok, fail
    try:
        fn()
        print(f"  ✓ {nome}")
        ok += 1
    except AssertionError as e:
        print(f"  ✗ {nome}\n      {e}")
        fail += 1
    except Exception as e:
        print(f"  ✗ {nome}\n      {type(e).__name__}: {e}")
        fail += 1


def _assert(c, m):
    if not c:
        raise AssertionError(m)


def verificadores():
    out = subprocess.run(["git", "ls-files"], cwd=RAIZ, capture_output=True, text=True).stdout
    return [f for f in out.split("\n")
            if re.search(r"(^|/)(test_|audit_|check_)|canary|probe", f)
            and f.endswith((".py", ".mjs"))]


def codigo(f):
    """Só linhas executáveis: prosa que descreve o defeito não é o defeito."""
    txt = (RAIZ / f).read_text(encoding="utf8", errors="replace")
    txt = re.sub(r"/\*[\s\S]*?\*/", "", txt)
    return "\n".join(l for l in txt.split("\n")
                     if not l.strip().startswith(("#", "//", "*")))


ARQUIVOS = verificadores()
# Mutação é VERBO de escrita. `revoked_at` sozinho não conta: `check_access_credentials.py` só
# LÊ essa coluna para contar credenciais vivas, e ler não é mutar.
MUTA = re.compile(r'method\s*=\s*"?(POST|PATCH|DELETE|PUT)|"(DELETE|PATCH|PUT)"|revoke_token\s*\(')
PROD = re.compile(r"supabase\.co|SUPABASE_SERVICE_ROLE_KEY")

# Marca de teste: o recurso nasce identificado como descartável.
NAMESPACE = re.compile(r"canary[-:_]|__canary|test[-:_]|CANARY|_canario|canario|probe[-:_]")

print("\nIsolamento de propriedade dos verificadores\n")


def sem_escolha_por_indice():
    """`entradas[0]` é como se escolhe uma vítima sem saber que se está escolhendo."""
    ofensores = []
    for f in ARQUIVOS:
        c = codigo(f)
        if not PROD.search(c):
            continue
        # `linhas[0]["state"]` / `dados[0]` é a leitura da ÚNICA linha de `bolao_state` — não há
        # escolha entre vítimas ali. O risco é escolher UMA ENTIDADE entre várias.
        for m in re.finditer(r"\b(entries|entradas|elegiveis|participants)\s*\[\s*0\s*\]", c):
            # Aceitável quando a linha já filtrou por namespace de teste.
            linha = c[max(0, c.rfind("\n", 0, m.start())):c.find("\n", m.end())]
            if NAMESPACE.search(linha):
                continue
            ofensores.append(f"{f}: {linha.strip()[:80]}")
    _assert(not ofensores,
            "verificador escolhe recurso REAL por indice:\n      " + "\n      ".join(ofensores) +
            "\n      Foi assim que o link do operador morreu duas vezes.")


test("nenhum verificador escolhe recurso real por indice", sem_escolha_por_indice)


def revogacao_so_do_proprio():
    """Quem revoga/apaga contra producao precisa de namespace de teste OU de desistencia."""
    ofensores = []
    for f in ARQUIVOS:
        c = codigo(f)
        if not (PROD.search(c) and MUTA.search(c)):
            continue
        tem_namespace = bool(NAMESPACE.search(c))
        # `EMAIL_KILL_SWITCH ... exists()` + saida = desiste em vez de tocar em dado real.
        desiste = bool(re.search(r"EMAIL_KILL_SWITCH.*exists\(\)", c)
                       and re.search(r"exit\(0\)", c))
        # Ou pula explicitamente quando o recurso ja tem dono.
        pula = bool(re.search(r"SKIPPED_TO_PROTECT|PULAD[OA]|not in vivas|e\[.id.\] not in", c))
        if not (tem_namespace or desiste or pula):
            ofensores.append(f)
    _assert(not ofensores,
            "verificador muta producao sem namespace de teste e sem desistir:\n      " +
            "\n      ".join(ofensores) +
            "\n      Ou o recurso nasce marcado como descartavel, ou o verificador pula.")


test("quem muta producao usa namespace de teste ou desiste", revogacao_so_do_proprio)


def canarios_do_cdb_desistem():
    for nome in ("token_roundtrip_canary.py", "secure_access_canary.py"):
        p = RAIZ / "bolao/cdb2026/scripts" / nome
        if not p.exists():
            continue
        c = codigo(f"bolao/cdb2026/scripts/{nome}")
        _assert(re.search(r"SKIPPED_TO_PROTECT", c),
                f"{nome} perdeu a saida que protege link ja entregue")
        _assert(re.search(r"not in vivas|vivas\b", c),
                f"{nome} nao consulta mais quais credenciais estao VIVAS antes de escolher alvo")


test("os canarios do CDB desistem em vez de matar link vivo", canarios_do_cdb_desistem)


def purga_tem_prefixo_soldado():
    """A funcao que apaga eventos de fila so sabe apagar canario -- e por corpo, nao parametro."""
    sql = list((RAIZ / "supabase" / "migrations").glob("*canary_purge*.sql"))
    _assert(sql, "sumiu a migracao da purga de canario")
    bruto = sql[0].read_text(encoding="utf8")
    # Só SQL executável. A primeira versão reprovou por causa do próprio comentário da migração,
    # que explica por que `p_prefixo` NÃO existe. Terceira vez hoje que um gate meu lê prosa.
    corpo = "\n".join(l for l in bruto.split("\n") if not l.strip().startswith("--"))
    _assert("like 'canary:%'" in corpo,
            "a purga deixou de filtrar pelo prefixo canary:")
    _assert("p_prefixo" not in corpo and "p_pattern" not in corpo,
            "a purga ganhou parametro de prefixo — isso e uma porta para apagar a fila inteira")


test("a purga de fila so alcanca o proprio canario (prefixo soldado)", purga_tem_prefixo_soldado)

print(f"\n  {ok} passed, {fail} failed\n")
print("✓ CANARY OWNERSHIP ISOLATION PASSED\n" if fail == 0
      else "✗ CANARY OWNERSHIP ISOLATION FAILED\n")
sys.exit(0 if fail == 0 else 1)
