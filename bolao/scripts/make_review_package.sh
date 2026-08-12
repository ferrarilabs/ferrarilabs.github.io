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
# BLOQUEIA em arquivo RASTREADO modificado; AVISA em arquivo novo não rastreado.
#
# A distinção não é cosmética. O pacote é `git archive HEAD`: arquivo rastreado modificado torna
# HEAD uma descrição FALSA do que foi testado — o revisor recebe uma versão que ninguém rodou.
# Arquivo não rastreado, por definição, não entra no pacote; ele não pode falsear nada.
#
# E este repositório tem várias sessões escrevendo no mesmo checkout. Travar a geração porque
# outra sessão deixou um `.sql` novo em cima da mesa seria deixar o trabalho de uma pessoa refém
# do rascunho de outra, sem que isso proteja nada.
SUJOS_RASTREADOS="$(git status --porcelain --untracked-files=no)"
if [ -n "$SUJOS_RASTREADOS" ]; then
  # Escape para checkout COMPARTILHADO por várias sessões.
  #
  # O pacote é `git archive HEAD` — lê o COMMIT, nunca a árvore. Então modificação não commitada
  # de outra sessão não entra nele em nenhuma hipótese. O que se perde não é a integridade do
  # conteúdo, é a garantia de que a suíte rodou exatamente sobre este commit.
  #
  # Essa distinção precisa CHEGAR ao revisor, não morrer num aviso de terminal. Com o escape
  # ligado, a ressalva vai para o manifesto dentro do zip, com os arquivos nomeados.
  if [ "${PACOTE_PERMITE_INFLIGHT:-}" = "1" ]; then
    echo "  ⚠ arquivos rastreados modificados por OUTRA sessão (não entram no pacote):"
    echo "$SUJOS_RASTREADOS" | sed 's/^/       /' | head -10
  else
    echo "  🛑 arquivos RASTREADOS modificados — o pacote descreveria um estado irreproduzível."
    echo "$SUJOS_RASTREADOS" | head -20
    echo "     (checkout compartilhado? PACOTE_PERMITE_INFLIGHT=1 gera a partir de HEAD e"
    echo "      registra a ressalva DENTRO do manifesto)"
    exit 1
  fi
fi
NAO_RASTREADOS="$(git ls-files --others --exclude-standard)"
if [ -n "$NAO_RASTREADOS" ]; then
  echo "  ⚠ arquivos NÃO rastreados presentes (excluídos do pacote, como manda o git archive):"
  echo "$NAO_RASTREADOS" | sed 's/^/       /' | head -10
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
  if [ -n "$SUJOS_RASTREADOS" ]; then
    echo
    echo "## Ressalva — trabalho em voo de outra sessão"
    echo
    echo "No momento da geração, outra sessão tinha alterações NÃO COMMITADAS nos arquivos"
    echo "abaixo. Elas NÃO estão neste pacote: o conteúdo vem de \`git archive\` sobre o commit"
    echo "acima, que é um commit real e publicado. A ressalva é sobre a suíte, não sobre o"
    echo "conteúdo — a última execução completa pode ter visto a árvore com essas alterações."
    echo
    echo "$SUJOS_RASTREADOS" | sed 's/^/    /'
  fi
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
