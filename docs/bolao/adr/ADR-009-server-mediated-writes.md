# ADR-009 — Escritas críticas passam por Edge Functions, não pelo navegador

**Status:** Aceito (ratificado pelo operador como decisão E3, 2026-08-07).
**Data:** 2026-08-07/08. **Aplica-se a:** todo caminho de escrita de produção.

## Contexto
Evidência medida, não suposta:
- `anon` tem `SELECT/INSERT/UPDATE/DELETE/REFERENCES/TRIGGER/MAINTAIN` nas 7 tabelas de `public`;
  `PUBLIC` tem `USAGE` no schema, então os grants são exercíveis.
- **DR-1:** as 6 policies de `bolao_state` **não referenciam** `auth.uid`, `auth.role`, `auth.jwt` nem
  `current_setting`. São allowlists de linha — **zero autorização**.
- O gate de admin é SHA-256 **no navegador**; o banco vê o mesmo principal (`anon`) para admin e
  público, logo **nenhum acesso a PII é atribuível a um ator**.
- A chave `anon` está hardcoded em 2 scripts rastreados (`HARDCODED_ANON_JWT = OPEN`).

Conclusão: **a autorização do sistema mora em JavaScript de cliente.**

## Decisão
Edge Functions do Supabase passam a ser a fronteira transacional para escritas críticas iniciadas por
usuário/admin. O navegador lê por views `security_invoker` em `bolao_api` e **perde DML direto**.
GitHub Actions continua adequado para jobs agendados, sincronização e orquestração de batch, mas **não**
é a fronteira interativa.

## Consequência que determina a ordem de execução
**O revoke dos grants de tabela precisa acontecer na mesma mudança que introduz a RPC.** Introduzir
RPCs mantendo os grants deixa **dois** caminhos de escrita, e o mais fraco continua contornando todo
controle novo — a mediação vira cosmética.

E: dual-write a partir de três apps de navegador independentes **não pode ser atômico**. Portanto
ADR-009 é **pré-requisito** do dual-write, não um workstream paralelo (D-16).

## Alternativas rejeitadas
- **Endurecer as policies mantendo escrita direta:** RLS não consegue expressar "somente o admin pode"
  quando admin não é um principal de banco.
- **Status quo:** aceita permanentemente que a tabela que movimenta dinheiro não tem autorização no
  banco.

## Custo
Adiciona uma dependência de runtime (Edge Functions) a uma topologia que hoje não tem servidor.
Avaliado como proporcional; é a menor mudança que fornece o que falta (D-15, confiança MÉDIA — a
decisão com menor evidência do conjunto).
