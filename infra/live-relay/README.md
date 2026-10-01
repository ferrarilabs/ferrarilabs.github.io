# live-relay (conteúdo para um repositório PÚBLICO separado)

Esta pasta NÃO é publicada pelo site (fora da allowlist) e NÃO roda a partir deste repositório. Ela é o conteúdo
completo do repositório público mínimo (sugestão: `ferrarilabs/live-relay`) que substitui o runner do
`live_cache_producer.yml`. Passos de criação e cutover: `docs/private-repo-migration/actions/CUTOVER_RUNBOOK.md`.

Repositório novo = só estes 3 arquivos (`relay.mjs`, `.github/workflows/relay.yml`, este README). Variável de repositório
`INGEST_URL`; segredo `LIVE_INGEST_TOKEN`. Nenhuma chave de banco, nenhum código do bolão, nenhum dado de participante.
