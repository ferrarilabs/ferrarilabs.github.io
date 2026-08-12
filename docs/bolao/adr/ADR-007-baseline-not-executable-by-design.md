# ADR-007 — Baseline versionado é deliberadamente não-executável

**Status:** Aceito com limitação explícita e temporária.
**Data:** 2026-08-08. **Aplica-se a:** `supabase/migrations/BASELINE_current_production_state.reference.sql`.

## Contexto
Seis policies RLS legadas em `public.bolao_state` embutem três literais. A restrição do operador é
clara: **nenhum literal capturado privadamente entra em arquivo versionado**, mesmo para tornar o
baseline executável.

Classificação dos três (feita programaticamente, sem imprimir valores): comprimento 4/6/7, slugs
minúsculos, entropia 2.00–2.52 bits/char, **zero** correspondência com as listas privadas de
participantes e de referências de pagamento, e presentes em **129 / 83 / 117 arquivos rastreados** do
repositório. Ou seja: `IDENTIFIER`, já públicos. Nenhum é `SECRET`, PII ou referência de pagamento.

## Decisão
O baseline é commitado com os literais substituídos por variáveis psql
(`:'policy_literal_1..3'`, 19 ocorrências → 3 valores distintos) e **nomeado de forma que o Supabase
CLI não o reconheça como migration** (`BASELINE_*.reference.sql`, sem prefixo de timestamp). Assim
`supabase db push` **não pode aplicá-lo por acidente**.

## Consequências
- O arquivo é revisável e commitável, mas **não roda**. Quem tratá-lo como executável criará policies
  referenciando strings-placeholder.
- Substituição é feita em tempo de deploy a partir da captura privada (`DEPLOYMENT.md`).
- `supabase db pull` (ADR-006) grava literais **inline** — logo esta decisão precisa ser resolvida
  *antes* de rodar `db pull`, ou a restrição é violada automaticamente.

## Alternativas
- **Inline após ratificação:** defensável — os valores já aparecem em 83–129 arquivos rastreados, então
  commitá-los não adiciona exposição. Requer que o operador levante a restrição explicitamente.
- **Redesenho das policies (RECOMENDADO a prazo):** DR-1 provou que as seis policies não são
  identity-aware e fornecem **zero** autorização. No modelo-alvo elas não têm sucessor — a dependência
  desaparece em vez de ser gerenciada.
- **Tabela de configuração / GUC:** over-engineering para três identificadores públicos.

## Recomendação
Substituição em deploy **agora**; redesenho de policy **permanentemente**. Registrado como limitação
temporária, não como arquitetura desejada.
