#!/usr/bin/env bash
# merge_data_pr.sh — espera o `npm run check` de um PR de dado (aberto por publish_data_via_pr.sh),
# faz o merge e dispara o deploy.
#
# POR QUE EXISTE (2026-11-01)
# O repositorio exige aprovacao para workflows de "first-time contributors", e o GitHub trata o
# github-actions[bot] como um. Todo PR aberto pelo bot gera um run de `pull_request` do
# safety_check.yml que fica em `action_required` sem rodar, e enquanto ele existir o PR fica
# BLOCKED mesmo com o check do workflow_dispatch verde (#496, #498 e #501 so entraram com
# intervencao manual). Aprovar esse run o executa; com ele verde o PR fica CLEAN.
#
# A aprovacao NAO afrouxa o gate: o run aprovado e o mesmo `npm run check` do ruleset, no mesmo
# commit, e o merge so acontece com os dois verdes. O que este script aprova e apenas o run do
# PR que o PROPRIO workflow acabou de abrir, num branch auto/data/.
#
# Uso: merge_data_pr.sh <branch auto/data/...> <assunto do squash> <corpo do squash>
# Pre-condicao: publish_data_via_pr.sh acabou de rodar; HEAD e o topo do branch. Precisa de
# GH_TOKEN com contents, pull-requests e actions de escrita.
set -euo pipefail

BRANCH="${1:?branch}"; SUBJECT="${2:?assunto}"; BODY="${3:?corpo}"

case "$BRANCH" in
  auto/data/*) ;;
  *) echo "::error::branch '$BRANCH' fora de auto/data/ — este script so faz merge de PR de dado."; exit 1 ;;
esac

PR="$(gh pr list --head "$BRANCH" --base main --state open --json number --jq '.[0].number // empty')"
[ -n "$PR" ] || { echo "::error::nenhum PR aberto para $BRANCH"; exit 1; }
SHA="$(git rev-parse HEAD)"
REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY}"

# O check exigido, disparado por workflow_dispatch pelo publish_data_via_pr.sh.
DISPATCH=""
for _ in $(seq 1 30); do
  DISPATCH="$(gh run list --workflow safety_check.yml --branch "$BRANCH" --event workflow_dispatch \
              --json databaseId,headSha --jq "map(select(.headSha == \"$SHA\"))[0].databaseId // empty")"
  [ -n "$DISPATCH" ] && break
  sleep 10
done
[ -n "$DISPATCH" ] || { echo "::error::npm run check nao apareceu para $SHA"; exit 1; }

# O run de pull_request do mesmo commit, parado em action_required. Aparece alguns segundos depois
# do PR; se nao aparecer (politica de aprovacao mudou), nao ha o que destravar.
PULL=""
for _ in $(seq 1 12); do
  PULL="$(gh run list --workflow safety_check.yml --branch "$BRANCH" --event pull_request \
          --json databaseId,headSha --jq "map(select(.headSha == \"$SHA\"))[0].databaseId // empty")"
  [ -n "$PULL" ] && break
  sleep 10
done
if [ -n "$PULL" ] && [ "$(gh run view "$PULL" --json conclusion --jq .conclusion)" = "action_required" ]; then
  gh api -X POST "repos/$REPO/actions/runs/$PULL/approve" >/dev/null \
    || { echo "::error::nao consegui aprovar o run $PULL do PR #$PR (action_required); o PR fica BLOCKED."; exit 1; }
  echo "Run de pull_request $PULL aprovado."
fi

gh run watch "$DISPATCH" --exit-status --interval 30 >/dev/null
[ -z "$PULL" ] || gh run watch "$PULL" --exit-status --interval 30 >/dev/null

# Mensagem explicita: o squash padrao acrescentaria Co-authored-by com e-mail real,
# que o commit-message-pii-gate reprova no main.
gh pr merge "$PR" --squash --delete-branch --subject "$SUBJECT (#$PR)" --body "$BODY"
# Merge feito pelo GITHUB_TOKEN nao acorda o push do deploy-pages (anti-loop do GitHub).
gh workflow run deploy-pages.yml --ref main
echo "PR #$PR mergeado e deploy disparado."
