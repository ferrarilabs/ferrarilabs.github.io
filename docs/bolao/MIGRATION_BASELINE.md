# Baseline de migração do Supabase — sistema canônico

**Estabelecido em 2026-08-11.** Projeto: `cmhqkkfczotdnssupkni` (produção).

## O problema que isto resolve

O repositório tinha DOIS sistemas de deploy de SQL competindo:

1. `bolao/shared/sql/0NN_*.sql` — arquivos numerados sequencialmente, aplicados **à mão** pelo
   painel do Supabase. Nenhum registro de qual foi aplicado, quando, ou se o banco realmente
   corresponde ao arquivo.
2. `supabase_migrations.schema_migrations` no banco — 17 versões com carimbo de tempo, aplicadas
   pelo programa de modernização, **sem nenhum arquivo local correspondente** em `main`.

O sintoma concreto: `supabase db push` recusava qualquer coisa com

```
Remote migration versions not found in local migrations directory.
```

e sugeria `migration repair --status reverted` para as 17. Seguir essa sugestão marcaria como
NÃO-aplicado um programa que **está aplicado**, e o push seguinte tentaria reexecutar as 17
migrações contra produção. Numa base com o dinheiro de 12 pessoas, isso não é um erro de
processo — é perda de dados.

## O que foi feito

Nada foi inventado e nada foi reparado. A história local foi **adotada a partir da própria
produção**:

```
supabase migration fetch --linked      # reconstrói os 17 arquivos a partir do banco
```

Os arquivos reconstruídos foram comparados com os do worktree `ferrarilabs-db-modernization`
(branch `db-modernization-architecture`), que é quem aplicou o programa:

| Grupo | Arquivos | Resultado da comparação |
|---|---|---|
| Migrações EXPAND (m1–m13) | 13 | **SQL idêntico** (a diferença é só o `;` que o `fetch` acrescenta) |
| Marcadores BASELINE_ADOPTED | 4 | Registrados no banco **sem statements** (`;`), por desenho: são estado que precede o rastreamento e foi *adotado*, não *executado*. O worktree guarda o SQL documentado do que a produção já continha. |

Adotados em `supabase/migrations/` os arquivos do worktree (mesma verdade, melhor documentados).

### Verificação

```
supabase db push --dry-run --linked
→ {"upToDate":true,"migrations":[]}
```

Zero pendências, zero replay de histórico. É esta a propriedade que torna o sistema utilizável:
um `db push` a partir do `main` agora só pode empurrar o que é genuinamente novo.

## Regra a partir daqui

**`supabase/migrations/<timestamp>_<descrição>.sql` é o único caminho de deploy de SQL.**

`bolao/shared/sql/0NN_*.sql` permanece como **arquivo histórico e documentação de arquitetura**.
Não é mais mecanismo de deploy. Não apagar: é a única explicação escrita de por que várias
políticas e RPCs existem.

## Mapa de proveniência — `bolao/shared/sql`

Classificação **medida contra produção** (sondagem PostgREST com a chave anon pública;
`404` = invisível/inexistente para anon, `401/403` = existe e nega, `200` = legível).

| Arquivo | Objetos declarados | Estado em produção | Classificação |
|---|---|---|---|
| `010_notification_durability.sql` | 7 RPCs de notificação + `bolao_notif_jobs` | tabela existe (RLS devolve `[]` para anon); RPCs invisíveis a anon | `EQUIVALENT_TO_PRODUCTION` |
| `011_live_cache_deny_anon_writes.sql` | grants/policies | — | `EQUIVALENT_TO_PRODUCTION` |
| `012_seed_notification_history.sql` | seed | — | `SUPERSEDED` (dado, não esquema) |
| `013_notif_status_by_pool.sql` | `bolao_notif_status_by_pool` | invisível a anon (esperado) | `EQUIVALENT_TO_PRODUCTION` |
| `014_fix_release_expired_cast.sql` | `release_expired_bolao_notif` | idem | `EQUIVALENT_TO_PRODUCTION` |
| `015_f10_private_pii_and_public_projection.sql` | `bolao_entry_private`, `resolve_notification_recipients` | tabela responde `401` a anon (**correto**) | `EQUIVALENT_TO_PRODUCTION` |
| `016_f10_backfill_private_pii.sql` | backfill | — | `SUPERSEDED` (dado) |
| `017_n22_narrow_mutations.sql` | 9 RPCs estreitas (`submit_entry`, `op_*`) | invisíveis a anon | `EQUIVALENT_TO_PRODUCTION` |
| `018_seed_powerball_notification_history.sql` | seed | — | `SUPERSEDED` (dado) |
| `019_backfill_powerball_0808_partial.sql` | backfill do 08/08 | — | `SUPERSEDED` (dado) |
| `020_notif_recipient_rpcs.sql` | 4 RPCs por destinatário | invisíveis a anon | `EQUIVALENT_TO_PRODUCTION` |
| `021_n24_revoke_anon_notification_rpcs.sql` | revoke de anon | confirmado: RPCs de notificação invisíveis a anon | `EQUIVALENT_TO_PRODUCTION` |
| `022_powerball_0808_manual_action.sql` | `get_bolao_notif_manual_flag` | invisível a anon | `EQUIVALENT_TO_PRODUCTION` |
| `023_claim_skips_manual_action.sql` | `claim_bolao_notif` (redefinida) | idem | `EQUIVALENT_TO_PRODUCTION` |
| `024_cdb2026_public_projection.sql` | `bolao_state_public`, `submit_cdb_entry` | view legível por anon (3 bolões) | `EQUIVALENT_TO_PRODUCTION` |
| `025_cdb2026_participant_picks.sql` | `cdb_update_entry_picks` | invisível a anon | `EQUIVALENT_TO_PRODUCTION` |
| `026_cdb2026_operator_mutations.sql` | `cdb_apply_operator_mutation` | invisível a anon (**correto**: só `service_role`) | `EQUIVALENT_TO_PRODUCTION` |

Nenhum arquivo ficou em `NEVER_APPLIED` ou `UNKNOWN`.

## `migration repair` — não foi usado

`repair` altera **apenas o histórico**, nunca executa SQL. Usá-lo aqui teria feito o registro
mentir sobre o banco em vez de descrever o banco. Não havia divergência entre esquema e
histórico a corrigir: a divergência era entre **histórico e repositório**, e essa se resolve
trazendo os arquivos, não reescrevendo o histórico.

## Coordenação com o programa de modernização

`ferrarilabs-db-modernization` (branch `db-modernization-architecture`) é quem conduz as
migrações EXPAND. No momento desta adoção existia **uma migração local ainda não aplicada**
(`20260812060000_expand_m14_migration_lineage.sql`), pertencente àquele trabalho em andamento.

Ela **não** foi adotada em `main` e **não** foi empurrada: `db push` aplica todas as pendências em
ordem, então empurrar qualquer migração nova a partir daqui arrastaria junto a m14 — trabalho de
outra sessão, possivelmente ainda em revisão. Empurrar migração alheia não revisada para produção
é exatamente como se cria um incidente.

**Consequência operacional:** enquanto houver migração pendente de outra sessão, uma migração nova
originada aqui só pode ser aplicada depois que a m14 for aplicada (ou retirada) por quem a
escreveu. Isto é coordenação, não bloqueio técnico.

## 2026-08-12 — reconciliação com o workstream de modernização

`migration list --linked` acusou DRIFT = 2: `20260812120000` e `20260812150000` constavam como
APLICADAS no remoto e não existiam em `main`.

Não eram desconhecidas. São M15 (`match_location_tie_lock_provenance_and_the_official_draw`) e
M16 (`normalized_read_surface`), aplicadas a partir do worktree canônico
`ferrarilabs-db-modernization` (branch `db-modernization-architecture`), que é a origem
arquitetural das migrações M1–M16.

O banco é UM só; os worktrees são vários. Quem aplica de um worktree deixa `main` descrevendo um
passado que não é o do banco — e a próxima pessoa a rodar `migration list` a partir de `main` vê
"drift" e não tem como saber se é uma migração perdida ou de outro fluxo.

**Ação:** os dois arquivos foram COPIADOS para `supabase/migrations/` em `main`. Nenhum registro
remoto foi tocado, nenhum `repair`, nenhum replay — `db push --dry-run` confirma
`upToDate: true`, porque as duas já constam no histórico remoto.

Estado após a reconciliação: LOCAL = 24, REMOTE = 24, PENDING = 0, DRIFT = 0.

**Migrações de integração de aplicação adicionadas nesta sessão** (autoria: `main`, não o
workstream de modernização):

- `20260812090000_m8m9_trusted_producer_bridge.sql` — RPCs `SECURITY DEFINER` em `public` que
  dão ao produtor confiável acesso a `audit.audit_events` e `bolao.outbox_events`. Os schemas
  seguem NÃO expostos no PostgREST (medido: 406 `Invalid schema` para toda chave, service_role
  inclusive), então a `anon` continua sem alcance às tabelas; a ponte é revogada de
  `anon`/`authenticated` e concedida só a `service_role`.
- `20260812100000_m8m9_canary_purge.sql` — remove eventos de canário da fila. O prefixo
  `canary:` é soldado no corpo, não parâmetro: uma função que apaga notificação com prefixo
  livre seria uma porta para apagar a fila inteira.

### 2026-08-12 (tarde) — M17

`20260812160000_expand_m17_classification_zone_predictions.sql` apareceu como remota-sem-local
pela mesma razão que M15/M16: aplicada a partir do worktree de modernização. Copiada para `main`,
sem tocar em registro remoto. `db push --dry-run` = `upToDate: true`.

Estado: LOCAL = 25, REMOTE = 25, PENDING = 0, DRIFT = 0.

**Isto vai se repetir.** Enquanto migrações forem aplicadas de um worktree e `main` for o lugar
onde se roda `migration list`, cada aplicação nova nasce como drift aparente. Não é erro de quem
aplica — é o custo de um banco só com várias árvores. Quem aplicar de um worktree deve copiar o
arquivo para `main` no mesmo movimento; quem encontrar drift deve procurar o arquivo nos
worktrees ANTES de concluir que a migração é desconhecida.
