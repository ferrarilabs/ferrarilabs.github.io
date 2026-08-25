# ADR-021 — Mover o intake público de reportes para um Cloudflare Worker isolado

**Estado:** aceito · **Data:** 2026-08-24 · **Issue:** #321
**Supersede:** a parte de runtime do desenho registrado em `SECURE_USER_REPORTING.md` §4 (T-ENV-01),
que previa um **projeto Supabase separado** como isolamento suficiente.

---

## Contexto

O canal "Reportar problema" é um **intake de incidentes externo e não confiável** ligado a uma
aplicação web pública. O desenho original o colocou como Edge Function no projeto Supabase do
Ferrari Labs — o mesmo projeto que guarda participante, pagamento, ledger, palpite, scoring e
ranking.

O runtime hospedado de Edge Function do Supabase recebe **automaticamente** capacidades de projeto:
`SUPABASE_DB_URL`, `SUPABASE_SECRET_KEYS` e o legado `SUPABASE_SERVICE_ROLE_KEY` — este último
**ignora RLS**.

A mitigação existente era uma catraca de CI que reprova se o código do intake referenciar essas
variáveis. Ela protege contra **erro de programação**. Ela não protege contra:

- dependência comprometida;
- execução de código no runtime;
- defeito de injeção futuro;
- código importado malicioso;
- comprometimento de cadeia de suprimentos.

O ambiente continuava contendo credencial de alto valor. A fronteira exigida é mais forte:
**a credencial financeira/de participante não pode existir no runtime de reporte.**

## Decisão

O intake público de produção passa a ser um **Cloudflare Worker dedicado**,
`ferrarilabs-support-intake`, cujo código vive em `workers/user-report-intake/`.

O Worker declara **todos** os seus bindings, e o conjunto é exatamente:

| binding | para quê |
|---|---|
| `ESTADO` (Durable Object, SQLite) | idempotência, deduplicação, limites deslizantes, disjuntor |
| `RAJADA` (Rate Limiting) | pré-filtro de rajada, local ao colo |
| `VERSAO` (`version_metadata`) | identidade da versão publicada (`x-deploy-id`) |
| `vars` / `secrets` | interruptor, dono/repo, credenciais da GitHub App e HMAC |

Não há `d1_databases`, `hyperdrive`, `services`, `r2_buckets`, `queues`, nem qualquer caminho para
o projeto financeiro. Um comprometimento total do Worker alcança exatamente: a API do GitHub, com
escopo de **um** repositório privado e **uma** permissão.

## Alternativas consideradas

### A. Manter no mesmo projeto Supabase — **rejeitada**

Foi o desenho inicial, e não era irracional: reaproveitava o runtime que já servia a
`live-football`, não adicionava fornecedor, e a catraca de código cobria o modo de falha que
parecia dominante (alguém usar a chave por descuido).

Foi superada quando ficou claro que o modo de falha relevante não é o descuido — é o
**comprometimento**, e contra ele a catraca não faz nada. O ambiente é o problema, não o código.

### B. Projeto Supabase separado — **rejeitada, embora melhor que A**

Resolve o raio de alcance: o segredo injetado pertenceria a um projeto vazio. Foi de fato
implementado (PR #327) e o código chegou a ser movido para `support-intake/supabase/`.

Rejeitada por três razões, nesta ordem:

1. **Continua injetando credencial que o intake não usa.** A propriedade "a chave não está lá" ficaria
   sendo "a chave é de um projeto sem valor" — mais fraco que não existir.
2. **Um projeto de banco de dados para uma função que não tem banco.** O intake fala com Redis/estado
   e com o GitHub; provisionar um Postgres gerenciado para hospedar uma função sem tabela é custo e
   superfície sem contrapartida.
3. **Exigia um segundo fornecedor de estado (Upstash).** Ver "Consequências".

### C. Cloudflare Worker — **escolhida**

Bindings são **declarados**, não injetados. O que não está no `wrangler.jsonc` não existe no
ambiente. Isso transforma a fronteira de uma afirmação sobre o nosso código numa propriedade da
plataforma, verificável pela lista de bindings — que é exatamente o que a catraca passa a medir.

## Consequências

### Positivas

- **Um fornecedor a menos.** O Durable Object substitui o Upstash Redis: sem credencial externa, sem
  chamada de rede para contar requisição, sem terceiro no caminho do dado.
- **Idempotência deixa de ser probabilística.** Storage transacional e serializável, um objeto por
  chave. A corrida some por construção. Com KV (eventualmente consistente) dois envios simultâneos
  podiam ambos ler "não existe" e ambos criar Issue.
- **F-09 corrigido de verdade.** O limite longo virou janela deslizante — e, no caminho, o teste
  revelou que a chave de taxa carregava a data e por isso zerava o limite de 24h à meia-noite UTC.
  Não dá para medir 24 horas sobre um identificador que troca a cada 24 horas.
- **F-06 sem manutenção.** `version_metadata` dá a identidade da versão publicada; ninguém mantém um
  SHA sincronizado à mão.

### Negativas / custo

- **Mais uma plataforma na operação.** Cloudflare entra ao lado de GitHub Pages e Supabase. Mitigado
  por o Worker ser pequeno, isolado e sem estado compartilhado com o resto.
- **O binding nativo de Rate Limiting não serve como política.** Período aceita apenas 10 ou 60
  segundos, é local ao colo e a documentação diz explicitamente que **não** é sistema de
  contabilidade. Ele fica como pré-filtro; a política mora no Durable Object.
- **Endereço público ainda indefinido.** A conta Cloudflare não tem zona DNS (`zones = 0`), então um
  subdomínio próprio exigiria mover o DNS de `ferrarilabs.com`. Decisão do dono — ver Human Gate.

## Racional de segurança

O ganho não é "menos código com acesso"; é **ausência de acesso**. A diferença entre B e C é a
diferença entre "a chave é de um projeto sem valor" e "não há chave".

Controles preservados da encarnação anterior, agora exercitados na fronteira real:
interruptor de servidor antes de qualquer dependência, CORS por allowlist exata, destino privado
verificado em runtime, prompt-injection inerte, exceção inesperada sanitizada, sem SSRF (host de
saída literal).

## Racional operacional e de custo

Volume esperado: dezenas de reportes por temporada, não por minuto. Nessa faixa o Worker e o Durable
Object ficam dentro do plano gratuito, e o Upstash deixa de ser uma assinatura a manter. O rollback
é uma variável (`REPORT_INTAKE_ENABLED=false`), não um deploy.

## Reversibilidade

- **Emergência:** `REPORT_INTAKE_ENABLED=false` no Worker. Segundos, sem deploy.
- **Cliente:** `reportProblem.enabled = false` nos três apps (já é o padrão).
- **Total:** reverter o PR. O Worker pode continuar implantado e inerte.

Nenhum passo toca banco, participante, pagamento, scoring ou ranking.

## Riscos residuais

1. **A função legada continua implantada no projeto financeiro.** Verificado: remover o diretório do
   repositório **não** a apagou. Ela está inerte (interruptor desligado, nenhum segredo), e
   deletá-la é ato de produção do dono.
2. **Endereço público indefinido** — ver acima.
3. **O servidor não distingue pico de incidente de botnet.** Registrado com honestidade: a regra de
   diversidade não afirma detecção; ela apenas eleva o teto quando o tráfego vem de muita gente
   diferente, dentro de um limite ainda rígido.
4. **Detecção de nome próprio continua impossível por regex.** Por isso o relato bruto permanece
   privado, e a promoção para público continua sendo ato humano autorizado.
