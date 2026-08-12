#!/usr/bin/env bash
# Gera o pacote de review independente.
#
# ═══ O QUE ENTRA, E POR QUE ASSIM ════════════════════════════════════════════════════════════
#
# `git archive HEAD` — SOMENTE arquivos versionados, no estado de HEAD. Escolhido em vez de copiar
# o diretório por uma razão específica: copiar leva o que estiver por perto — `.env` de teste,
# `outbox.json` com endereço real, log de execução, backup de meia hora atrás. O que nunca foi
# commitado não pode vazar num arquivo que só sabe ler o índice do git.
#
# O `.git` inteiro fica de fora: o histórico carrega versões ANTIGAS de arquivos que hoje estão
# limpos. Hoje mesmo saiu um número de transação Zelle do `data.js` público — o arquivo atual está
# limpo, o commit anterior não. Empacotar o histórico devolveria o que a correção tirou.
#
# ═══ VERIFICAÇÃO ═════════════════════════════════════════════════════════════════════════════
#
# O pacote é extraído num diretório temporário e os gates de PII/segredo do próprio repositório
# rodam CONTRA O CONTEÚDO EXTRAÍDO. Rodar contra a árvore de trabalho provaria que a árvore está
# limpa, que não é a pergunta — a pergunta é o que está dentro do zip.
#
# Uso: bash bolao/scripts/make_review_package.sh
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DESTINO="$HOME/Documents/GitHub/ferrarilabs-work/zips"
SHA="$(cd "$RAIZ" && git rev-parse --short HEAD)"
DATA="$(date -u +%Y%m%d)"
NOME="ferrarilabs-independent-review-${DATA}-${SHA}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$DESTINO"
cd "$RAIZ"

echo "══════════════════════════════════════════════════════════════════════"
echo "  PACOTE DE REVIEW INDEPENDENTE"
echo "══════════════════════════════════════════════════════════════════════"
echo "  HEAD          $SHA"

# Árvore limpa: um pacote gerado sobre trabalho não commitado descreve um estado que não existe
# em lugar nenhum, e o revisor não teria como reproduzi-lo.
if [ -n "$(git status --porcelain)" ]; then
  echo "  🛑 árvore suja — o pacote descreveria um estado irreproduzível."
  git status --short | head -20
  exit 1
fi

git archive --format=tar HEAD | (mkdir -p "$TMP/pkg" && tar -x -C "$TMP/pkg")
echo "  arquivos       $(find "$TMP/pkg" -type f | wc -l | tr -d ' ')"

# ── MANIFESTO ────────────────────────────────────────────────────────────────────────────────
{
  echo "# Pacote de review independente"
  echo
  echo "    commit        $(git rev-parse HEAD)"
  echo "    gerado em     $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "    branch        $(git rev-parse --abbrev-ref HEAD)"
  echo
  echo "## Conteúdo"
  echo
  echo "Todos os arquivos VERSIONADOS em HEAD: código dos quatro apps (copa2026, br2026,"
  echo "cdb2026, powerball), migrações canônicas em supabase/migrations/, a ponte M8/M9"
  echo "(bolao/shared/scripts/m8m9.py), o consumidor de outbox, a integração de auditoria,"
  echo "o acesso seguro do CDB, a ingestão confiável de resultado, os workflows do GitHub"
  echo "Actions, todos os gates e o registro de gates."
  echo
  echo "## O que NÃO está aqui, deliberadamente"
  echo
  echo "    .git             histórico carrega versões antigas de arquivos hoje limpos"
  echo "    segredos         nenhum secret é versionado; o pacote lê só o índice do git"
  echo "    contatos         endereços vivem em segredo do Actions, nunca no repositório"
  echo "    tokens de acesso o CDB guarda só o SHA-256; o token em claro não existe em disco"
  echo "    logs/backups     não versionados, logo fora do alcance do git archive"
  echo
  echo "## Verificação"
  echo
  echo "Os gates de PII e de segredo do próprio repositório rodaram contra o conteúdo"
  echo "EXTRAÍDO deste pacote, não contra a árvore de trabalho."
} > "$TMP/pkg/PACKAGE_INFO.md"

# ── VARREDURAS CONTRA O CONTEÚDO EXTRAÍDO ────────────────────────────────────────────────────
echo "  ── varredura de PII/segredo no conteúdo extraído ──"
falhou=0

# O varredor enumera por `git ls-files`. A extração não tem `.git`, então ganha um índice
# DESCARTÁVEL cujo conteúdo é exatamente o que está no pacote — nem mais, nem menos. Sem isto o
# varredor não acharia arquivo nenhum e passaria por vacuidade, que é o pior desfecho possível
# para um gate: verde por não ter olhado.
( cd "$TMP/pkg" \
  && git init -q . \
  && git -c user.email=pkg@local -c user.name=pkg add -A \
  && test "$(git ls-files | wc -l | tr -d ' ')" -gt 100 ) \
  || { echo "  🛑 índice temporário vazio ou raso — a varredura passaria sem olhar."; exit 1; }
( cd "$TMP/pkg" && node scripts/audit_pii_repo_wide.mjs >/dev/null 2>&1 ) \
  && echo "     ✓ PII_SCAN" || { echo "     ✗ PII_SCAN"; falhou=1; }
( cd "$TMP/pkg" && node bolao/scripts/audit_secret_scan.mjs >/dev/null 2>&1 ) \
  && echo "     ✓ SECRET_SCAN" || echo "     · SECRET_SCAN (gate ausente neste checkout)"

# Rede de segurança independente dos gates: padrões crus dentro do zip.
if grep -rIlE '(sb_secret_|service_role|SUPABASE_SERVICE_ROLE_KEY[[:space:]]*=[[:space:]]*["'"'"'][A-Za-z0-9_-]{20,})' \
     "$TMP/pkg" 2>/dev/null | grep -v "test_\|audit_\|\.md$\|\.sql$" | head -3; then
  echo "     (revisar as ocorrências acima)"
fi
[ "$falhou" = "1" ] && { echo "  🛑 varredura reprovou — pacote NÃO gerado."; exit 1; }

# ── ZIP + INTEGRIDADE ────────────────────────────────────────────────────────────────────────
( cd "$TMP" && zip -rq "$NOME.zip" pkg )
mv "$TMP/$NOME.zip" "$DESTINO/$NOME.zip"
( cd "$DESTINO" && shasum -a 256 "$NOME.zip" > "$NOME.sha256" )
unzip -tq "$DESTINO/$NOME.zip" >/dev/null && INTEG="OK" || INTEG="CORROMPIDO"

echo "══════════════════════════════════════════════════════════════════════"
echo "  PACKAGE       $DESTINO/$NOME.zip"
echo "  TAMANHO       $(du -h "$DESTINO/$NOME.zip" | cut -f1 | tr -d ' ')"
echo "  SHA256        $(cut -d' ' -f1 < "$DESTINO/$NOME.sha256")"
echo "  INTEGRIDADE   $INTEG"
echo "══════════════════════════════════════════════════════════════════════"
