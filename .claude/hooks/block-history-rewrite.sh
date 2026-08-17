#!/usr/bin/env bash
# PreToolUse hook (Bash matcher) — soft-blocks git history-rewrite commands that
# aren't already covered by the machine-local .claude/settings.local.json deny list.
# That deny list is gitignored and never travels to other clones/devices; this script
# is git-tracked so the same protection applies everywhere, per CLAUDE.md's
# "Repository is the source of truth (all devices, all sessions)" rule.
#
# Soft block only: emits permissionDecision "ask" with an explanation, so a human can
# still approve a genuinely intended history rewrite. Never a silent/hard failure.

input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)"

[ -z "$cmd" ] && exit 0

reason=""

if [ -z "$reason" ] && printf '%s' "$cmd" | grep -Eq '(^|[;&|[:space:]])git[[:space:]]+rebase([[:space:]]|$)'; then
  reason="git rebase rewrites commit history. This repo's git-safety rules and CLAUDE.md's cross-device source-of-truth rule require never rewriting history as a routine step. If this is a deliberate, explicitly authorized history rewrite, approve this once."
fi

if [ -z "$reason" ] && printf '%s' "$cmd" | grep -Eq 'git[[:space:]]+commit' && printf '%s' "$cmd" | grep -Eq -- '--amend'; then
  reason="git commit --amend rewrites the previous commit. Convention here is to always create a NEW commit instead, unless amending was explicitly requested. Approve only if that's the case."
fi

if [ -z "$reason" ] && printf '%s' "$cmd" | grep -Eq 'git[[:space:]]+filter-(branch|repo)'; then
  reason="git filter-branch/filter-repo rewrites the entire repository history — the highest-blast-radius git operation. Disallowed except under explicit, deliberate authorization."
fi

if [ -z "$reason" ] && printf '%s' "$cmd" | grep -Eq 'git[[:space:]]+push' \
   && printf '%s' "$cmd" | grep -Eq -- '(--force([^-]|$)|--force-with-lease|(^|[[:space:]])-f([[:space:]]|$))'; then
  reason="This push includes a force flag not already caught by the local settings.local.json deny-list. Force-pushing can overwrite remote history. Approve only if this force-push was already discussed with the user and is explicitly intended."
fi

if [ -n "$reason" ]; then
  jq -n --arg reason "$reason" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"ask",permissionDecisionReason:$reason}}'
fi

exit 0
