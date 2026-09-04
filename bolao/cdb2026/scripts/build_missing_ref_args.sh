#!/usr/bin/env bash
# build_missing_ref_args.sh — transforma `missing_refs` (lista separada por espaço) nos argumentos
# repetidos `--missing-ref <ref>` de `recover_result_email.py`. (#400)
#
# ─── POR QUE ISTO É UM ARQUIVO, E NÃO SEIS LINHAS DENTRO DO YAML ───────────────────────────────
#
# O que este script decide termina virando argumento de um comando que manda e-mail para gente
# real. Enterrado no `run:` do workflow ele seria inauditável e intestável: nenhum gate consegue
# exercitar um bloco de shell dentro de YAML. Aqui ele é chamável, e
# `test_missing_refs_parsing.sh` prova cada recusa.
#
# ─── SEGURANÇA ────────────────────────────────────────────────────────────────────────────────
#
# Nada de `eval`, nada de expansão de comando sobre a entrada, nada de reconstruir a linha de
# comando por string. A entrada chega por VARIÁVEL DE AMBIENTE (o workflow nunca interpola
# `${{ inputs... }}` dentro do corpo do script — essa interpolação é o vetor clássico de injeção
# em Actions), é quebrada por `read -ra` e cada token é validado contra uma lista branca de
# caracteres ANTES de virar argumento. Um token com `;`, `$`, backtick, aspas ou espaço não
# escapa: ele é REJEITADO, não escapado.
#
# A saída é UM REF POR LINHA. Quem chama monta o array com `mapfile`, então nem a saída daqui
# volta a passar por word-splitting.
#
# Este script faz apenas validação LÉXICA (forma, vazio, duplicata, teto). A validação
# SEMÂNTICA — o ref existe? já foi entregue? pertence ao conjunto faltante autoritativo? — é do
# `recover_result_email.py`, que tem credencial de operador e o ledger. As duas camadas são
# independentes de propósito: esta não alcança o ledger, e aquela não confia na forma.
set -euo pipefail

REFS_RAW="${MISSING_REFS:-}"
MAX_REFS="${MAX_MISSING_REFS:-50}"

# Lista branca deliberadamente estreita: id de entrada é UUID ou slug curto. Tudo que não for
# alfanumérico, hífen ou sublinhado está fora — inclusive todo metacaractere de shell.
REF_RE='^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'

erro() { echo "build_missing_ref_args: $*" >&2; exit 2; }

[ -n "${REFS_RAW//[[:space:]]/}" ] || erro "missing_refs vazio"

# `read -ra` com here-string lê APENAS A PRIMEIRA LINHA. Uma entrada com quebra de linha seria
# silenciosamente truncada — o operador colaria seis refs em duas linhas, o script pegaria os da
# primeira, e a "recuperação" reportaria sucesso deixando gente sem e-mail. Exatamente o modo de
# falha que esta feature existe para consertar. Então quebra de linha é RECUSA, não normalização:
# a entrada é documentada como uma linha separada por espaço, e algo multilinha significa que o
# operador colou outra coisa.
case "$REFS_RAW" in
  *$'\n'*|*$'\r'*) erro "missing_refs contem quebra de linha — use UMA linha separada por espaco" ;;
esac

# `read -ra` quebra só por IFS. Não interpreta nada do conteúdo.
read -ra TOKENS <<< "$REFS_RAW"

[ "${#TOKENS[@]}" -gt 0 ] || erro "missing_refs vazio depois de separar"
[ "${#TOKENS[@]}" -le "$MAX_REFS" ] || \
  erro "${#TOKENS[@]} refs excede o teto de $MAX_REFS — um lote desse tamanho não é recuperação pontual"

VISTOS=""
for t in "${TOKENS[@]}"; do
  [ -n "$t" ] || erro "token vazio"
  if ! [[ "$t" =~ $REF_RE ]]; then
    # O token NÃO é ecoado: se ele carrega metacaractere, imprimi-lo é o começo do problema.
    erro "token com formato invalido (posicao $((${#VISTOS} + 1))) — esperado ^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"
  fi
  case " $VISTOS " in
    *" $t "*) erro "ref duplicado: $t" ;;
  esac
  VISTOS="$VISTOS $t"
done

# Um ref por linha. O chamador usa `mapfile`, então isto nunca volta a ser word-split.
for t in "${TOKENS[@]}"; do
  printf '%s\n' "$t"
done
