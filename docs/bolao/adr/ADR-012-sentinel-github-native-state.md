# ADR-012 — Engineering Sentinel usa estado nativo do GitHub, sem Supabase

**Status:** Aceito.
**Data:** 2026-08-18. **Aplica-se a:** `scripts/sentinel/`.

## Contexto

O Sentinel precisa lembrar, entre execuções: identidade de um finding (fingerprint), primeira/
última observação, contagem de ocorrências, resolução e recorrência. Um design inicial (revisado
adversarialmente antes da implementação) propôs uma tabela Supabase dedicada, reusando o padrão de
claim atômico já provado em `bolao_notif_jobs`.

## Decisão

Não usar Supabase no v1. Todo o estado listado acima já é um atributo nativo do GitHub (Issue
`created_at`, estado aberto/fechado) ou pequeno o bastante para viver embutido no corpo da própria
Issue, num bloco `<!-- ferrarilabs-sentinel {...} -->` — ver `scripts/sentinel/github_state.mjs`.

## Por que é suficiente

No volume de escrita real do v1.0-A/v1.1 (poucos findings, observados no máximo algumas vezes por
dia), não existe padrão de consulta, contenção de escrita ou necessidade de analytics histórica que
a API do GitHub não resolva. Buscar Supabase porque "já existe e é provado" — sem uma necessidade
concreta do Sentinel especificamente — seria exatamente o tipo de "resolver o problema de amanhã
antes do de hoje" que a revisão adversarial deste desenho existiu para pegar.

## O que é armazenado / o que é recomputado

Armazenado (bloco embutido): `fingerprint`, `finding_type`, `detector_id`, `detector_version`,
`first_seen_at`, `last_seen_at`, `occurrence_count`, `source_sha`, `policy_version`, `status`,
`clean_cycle_count`, `recurrence_count`, `canonical_last_written`, `intended_canonical`,
`provenance`. Nunca PII, nunca log bruto — lista fechada, aplicada por allowlist explícito em
`github_state.mjs`, não por convenção.

Recomputado, nunca guardado: as entradas do fingerprint em si (função pura), se um finding ainda é
reproduzível (sempre reavaliado, nunca assumido da história).

## Gatilhos de migração futura (documentados para quem revisitar isto depois)

1. O rate limit de busca de Issues do GitHub (30 req/min) virar restrição prática, não teórica.
2. Surgir uma necessidade real de analytics entre findings que a API do GitHub não expresse bem.
3. O v2 (monitoramento Supabase read-only) entrar em produção — nesse ponto reusar essa conexão já
   existente para o próprio estado do Sentinel passa a ter custo marginal baixo, e essa é a
   transição natural, não antes.

## Consequência

Nenhuma credencial Supabase existe para o Sentinel em v1.0-A/v1.1/v1.2 — não é uma restrição de
política que poderia ser mal configurada, é a ausência simples de uma capacidade.
