#!/usr/bin/env bash
# publish_data_via_pr.sh — publica DADO gerado por workflow via branch + PR, nunca direto em main.
#
# POR QUE EXISTE (2026-10-21)
# O ruleset `main-protection` exige PR e o status `npm run check` em refs/heads/main. O GITHUB_TOKEN
# nao tem bypass (e nao deve ter), entao o antigo `git push` direto em main passou a ser recusado
# com GH013 desde 2026-10-14: bolao_provider_snapshot.yml (br2026) e br2026_broadcast_epg.yml
# vermelhos a cada execucao com dado novo, e o dado NUNCA chegou a main.
#
# A correcao nao afrouxa o gate: o dado vai para um branch proprio `auto/data/<nome>`, um PR
# rolante (um por branch, nunca duplicado) aponta para main, e o `npm run check` exigido e
# DISPARADO explicitamente no topo do branch — push e PR feitos com GITHUB_TOKEN nao acordam
# outro workflow (anti-loop do GitHub), workflow_dispatch acorda. Quem decide o merge continua
# sendo o ruleset: sem check verde no topo atual, nao entra.
#
# Sem force-push: o branch so anda para frente. A cada execucao ele recebe origin/main (o ruleset
# e strict, o PR precisa estar atualizado com o tronco) e por cima o dado novo.
#
# Uso: publish_data_via_pr.sh <branch auto/data/...> <titulo> <corpo> <caminho>...
# Pre-condicao: HEAD e o commit LOCAL de dado (ja validado) que o workflow acabou de criar sobre
# origin/main. Ele nunca e empurrado para main; seus arquivos de dado sao levados para o branch.
set -euo pipefail

BRANCH="${1:?branch}"; TITLE="${2:?titulo}"; BODY="${3:?corpo}"; shift 3
[ "$#" -gt 0 ] || { echo "::error::nenhum caminho de dado informado"; exit 1; }

case "$BRANCH" in
  auto/data/*) ;;
  *) echo "::error::branch '$BRANCH' fora de auto/data/ — este script nunca escreve em outra ref."; exit 1 ;;
esac

SRC="$(git rev-parse HEAD)"
MSG="$(git log -1 --format=%B "$SRC")"

# actions/checkout baixa so o ultimo commit. Com o branch ja existente, o merge abaixo nao acha base
# comum num clone raso e morre com "refusing to merge unrelated histories" (br2026_broadcast_epg.yml
# e bolao_provider_snapshot.yml vermelhos assim desde 2026-10-22). Historico completo antes do merge.
if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
  git fetch --quiet --unshallow origin
fi
git fetch --quiet origin main
if git ls-remote --exit-code --heads origin "refs/heads/$BRANCH" >/dev/null; then
  git fetch --quiet origin "refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
  git checkout --quiet -f -B "$BRANCH" "origin/$BRANCH"
  # Conflito so pode existir nos proprios arquivos de dado (o branch nao toca em mais nada), e eles
  # sao sobrescritos logo abaixo pelo dado validado.
  git merge --quiet --no-edit -X theirs origin/main
else
  git checkout --quiet -f -B "$BRANCH" origin/main
fi

git checkout "$SRC" -- "$@"

if ! git diff --cached --quiet; then
  git commit --quiet -m "$MSG"
fi

# O conjunto alterado do PR precisa ser SO dado. Qualquer outro caminho e um erro de construcao.
EXTRA=""
while IFS= read -r f; do
  ok=false
  for p in "$@"; do
    case "$p" in */) [[ "$f" == "$p"* ]] && ok=true ;; *) [[ "$f" == "$p" ]] && ok=true ;; esac
  done
  $ok || EXTRA="$EXTRA $f"
done < <(git diff --name-only origin/main...HEAD)
if [ -n "$EXTRA" ]; then
  echo "::error::o branch de dado alteraria arquivos que nao sao dado: $EXTRA"
  exit 1
fi

# Push sem --force: se a ref andou no meio tempo, falha alto e a proxima execucao refaz.
git push origin "HEAD:refs/heads/$BRANCH"
echo "Dado publicado em $BRANCH ($(git rev-parse --short HEAD)) — NAO em main."

PR="$(gh pr list --head "$BRANCH" --base main --state open --json number --jq '.[0].number // empty')"
if [ -z "$PR" ]; then
  if ! PR_URL="$(gh pr create --base main --head "$BRANCH" --title "$TITLE" --body "$BODY")"; then
    echo "::error::nao foi possivel abrir o PR de $BRANCH. Se a mensagem acima diz que GitHub Actions nao pode criar pull requests, e a configuracao do repositorio (decisao do owner). O dado esta em $BRANCH, NAO em main."
    exit 1
  fi
  echo "PR aberto: $PR_URL"
else
  echo "PR #$PR ja aberto para $BRANCH — atualizado pelo push acima, nenhum PR novo."
fi

# O status exigido pelo ruleset. Sem isto o PR ficaria esperando um check que nunca roda.
gh workflow run safety_check.yml --ref "$BRANCH"
echo "npm run check disparado em $BRANCH."
