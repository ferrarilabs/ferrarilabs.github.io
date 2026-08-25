# Reportar problema — Requirements Traceability Matrix

**Issue:** #321 · **Atualizado:** 2026-08-25 · **Runtime:** Cloudflare Worker (ver `adr/ADR-021-intake-em-cloudflare-worker.md`)
**Estado de ativação:** `BACKEND_PROVISIONED_DISABLED` · **Prontidão:** `NOT_READY`

Segue a convenção de RTM já usada em `CDB2026_REQUIREMENTS_TRACEABILITY_MATRIX.md`: cada linha
aponta para **código real e teste real**. Onde não há teste, a linha diz isso — uma RTM que inventa
cobertura é pior que uma RTM ausente, porque transforma ausência de verificação em falsa garantia.

**Estados:** `IMPLEMENTADO` (código + teste em CI) · `PARCIAL` (implementado, cobertura ou escopo
incompleto, com o limite escrito) · `PENDENTE_PROVISIONAMENTO` (código pronto; depende de recurso
que só o dono cria) · `NÃO_IMPLEMENTADO` (decisão registrada).

**Evidência de produção** é rastreada separadamente da evidência de teste, porque as duas respondem
perguntas diferentes: teste verde diz que o código faz o que promete; evidência de produção diz que
o que está no ar é esse código. Confundir as duas foi exatamente o erro corrigido em #322 ("a função
não está implantada" — estava). A coluna abaixo diz `—` quando ainda não há nada implantado a
observar, e isso é um estado honesto, não uma lacuna de teste.

| # | Requisito | Controle de desenho | Implementação | Teste / evidência | Estado |
|---|---|---|---|---|---|
| R-REPORT-001 | Relato bruto fica PRIVADO; nunca cruza para público automaticamente | Destino privado verificado em **runtime**, antes de criar | `workers/user-report-intake/src/github.ts` (`verificarDestinoPrivado`) | `scripts/report/test_worker_intake.mjs` — "destino PUBLICO aborta antes de criar" | IMPLEMENTADO |
| R-REPORT-002 | Nenhuma dependência de banco financeiro/participante | Ausência de binding, não disciplina de código | `workers/user-report-intake/wrangler.jsonc` | `scripts/report/test_worker_isolation.mjs` — "nenhum binding de banco de dados de qualquer tipo" | IMPLEMENTADO |
| R-REPORT-003 | GitHub App de menor privilégio (Issues: write + Metadata: read) | App, não PAT; instalação em **um** repositório | `workers/user-report-intake/src/github.ts` (`PERMISSOES`) | Teste: `scripts/report/test_worker_intake.mjs`. **Produção 2026-08-25:** App `4714457`, instalação `156482151`, seleção `selected`, um repo (`support-intake`), `issues=write`, `metadata=read`, demais permissões ausentes; webhook/OAuth desligados | IMPLEMENTADO |
| R-REPORT-003a | Repositório de destino privado, Issues on, Pages off, sem colaborador externo | Verificado por API, não por memória | `ferrarilabs/support-intake` (`README.md`, `SECURITY.md`) | `scripts/report/readiness.mjs --live` → `private_repo_verified`. **Evidência de produção 2026-08-25:** `private: true` · `has_issues: true` · `has_pages: false` · `has_wiki: false` · `is_template: false` · colaboradores: só `ferrarilabs` | IMPLEMENTADO |
| R-REPORT-004 | Interruptor de servidor, padrão DESLIGADO | Avaliado **antes** de qualquer dependência; só a string exata liga | `workers/user-report-intake/src/index.ts` (`intakeHabilitado`), `workers/user-report-intake/wrangler.jsonc` (`vars`) | `scripts/report/test_worker_intake.mjs` — "so a string exata liga"; "desligado com TODOS os segredos => 503, e nada e tocado" | IMPLEMENTADO |
| R-REPORT-005 | Flag de cliente, padrão desligado | Defesa em profundidade / UX — **não** é a fronteira | `bolao/*/js/config.js` (`reportProblem.enabled`) | `scripts/report/test_report_ui.mjs` — 6 casos de "botao morto" | IMPLEMENTADO |
| R-REPORT-006 | CORS por allowlist exata | Eco só de origem já na lista; nunca `*` | `workers/user-report-intake/src/index.ts` (`ORIGENS_PERMITIDAS`, `cabecalhosCors`) | `scripts/report/test_worker_intake.mjs` — "nunca existe Access-Control-Allow-Origin: *" | IMPLEMENTADO |
| R-REPORT-007 | Payload e schema limitados | Allowlist de campos; tamanho conferido **antes** de parsear | `workers/user-report-intake/src/policy.ts` (`CAMPOS_ACEITOS`, `LIMITES`) | `scripts/report/test_report_intake.mjs` (77 casos) | IMPLEMENTADO |
| R-REPORT-008 | Sanitização dupla (cliente + servidor) | Cliente é conveniência; servidor é obrigatório | `bolao/shared/js/report_safe_context.js` + `workers/user-report-intake/src/policy.ts` (`tornarInerte`) | `scripts/report/test_report_intake.mjs` (corpus adversarial) | IMPLEMENTADO |
| R-REPORT-009 | Nenhum IP cru persistido | HMAC sobre IP da plataforma, com `/64` em IPv6 | `workers/user-report-intake/src/identidade.ts` (`chaveDeRede`, `normalizarRede`) | `scripts/report/test_worker_intake.mjs` — "a chave nao contem o IP…"; "dois enderecos do MESMO /64" | IMPLEMENTADO |
| R-REPORT-010 | Controles de abuso mensuráveis | Pré-filtro de rajada + limites deslizantes + teto global + disjuntor | `workers/user-report-intake/src/state.ts` (`POLITICA`, `avaliar`) | `scripts/report/test_worker_intake.mjs` — limite curto, F-09, F-03, pré-filtro | IMPLEMENTADO |
| R-REPORT-011 | Idempotência sem corrida | Durable Object serializável; chave amarrada ao remetente | `workers/user-report-intake/src/state.ts`, `workers/user-report-intake/src/identidade.ts` (`chaveIdempotencia`) | `scripts/report/test_worker_intake.mjs` — "dois envios SIMULTANEOS => uma Issue" | IMPLEMENTADO |
| R-REPORT-012 | Supressão de duplicata | Impressão HMAC do conteúdo, com janela | `workers/user-report-intake/src/state.ts` (`duplicatas`), `workers/user-report-intake/src/identidade.ts` (`impressao`) | `scripts/report/test_worker_intake.mjs` (fluxo de confirmação) | PARCIAL — a contagem é registrada; ainda não há ação de triagem derivada dela |
| R-REPORT-013 | Injeção de prompt inerte | Marcador `UNTRUSTED_EXTERNAL_INPUT`; menções/refs/keywords neutralizadas | `workers/user-report-intake/src/policy.ts` (`tornarInerte`, `montarCorpo`) | `scripts/report/test_report_intake.mjs` (corpus de injeção) | IMPLEMENTADO |
| R-REPORT-014 | Exceção inesperada sanitizada | Casca **total** no `fetch` exportado | `workers/user-report-intake/src/index.ts` (`export default`) | `scripts/report/test_worker_intake.mjs` — "excecao arbitraria vira 503 generico, sem vazar" (4 venenos) | IMPLEMENTADO |
| R-REPORT-015 | Evidência de versão implantada | `version_metadata` → `x-deploy-id` em toda resposta | `workers/user-report-intake/wrangler.jsonc`, `workers/user-report-intake/src/index.ts` (`responder`) | `scripts/report/test_worker_intake.mjs` — "toda resposta carrega x-deploy-id" | IMPLEMENTADO |
| R-REPORT-016 | Observabilidade sem conteúdo | Eventos agregados; classe de redação, nunca valor | `workers/user-report-intake/src/index.ts` (`metrica`) | `scripts/report/test_worker_intake.mjs` — "nenhum log carrega relato…"; "…registra a CLASSE, nunca o valor" | IMPLEMENTADO |
| R-REPORT-017 | Versão do aviso de privacidade viaja com o relato | Campo de formato fechado, validado no servidor | `bolao/shared/js/report_safe_context.js` (`NOTICE_VERSION`), `workers/user-report-intake/src/policy.ts` | `scripts/report/test_report_intake.mjs` — 4 casos F-12 | IMPLEMENTADO |
| R-REPORT-018 | Governança de retenção | Política escrita; deleção destrutiva separadamente autorizada | `docs/bolao/SECURE_USER_REPORTING.md` §10 | App existe, mas nenhuma automação destrutiva foi autorizada ou criada | NÃO_IMPLEMENTADO — política de 90 dias continua proposta |
| R-REPORT-025 | Endereço público decidido e registrado, com CSP de origem exata | `workers.dev` porque a conta tem `zones = 0`; curinga proibido | `workers/user-report-intake/wrangler.jsonc` (`workers_dev`), `bolao/{br2026,cdb2026,loterias/powerball}/index.html` (`connect-src`) | `scripts/report/test_worker_isolation.mjs` — "endereco publico exige interruptor versionado DESLIGADO" e "a CSP dos apps nomeia a origem EXATA do Worker, sem curinga" (ambas provadas por mutação) | IMPLEMENTADO |
| R-REPORT-026 | Deploy recusa enquanto faltar segredo exigido | `secrets.required` no manifesto; "implantado" implica "configurado" | `workers/user-report-intake/wrangler.jsonc` (`secrets.required`) | O deploy primeiro recusou três segredos ausentes; após provisionamento via stdin, a versão ativa lista exatamente os quatro `secret_text` exigidos, sem expor valores | IMPLEMENTADO |
| R-REPORT-027 | Manifesto de prontidão mede o runtime que existe | Caminhos lidos do próprio manifesto, nunca repetidos no gate | `scripts/report/readiness.mjs` | `scripts/report/test_docs_drift.mjs` §6 — "todo caminho de repositório citado pelo manifesto existe" (mutação em `SRC` e em `WORKER` reprova) | IMPLEMENTADO |
| R-REPORT-019 | Nenhum segredo no navegador | Segredos só server-side; catraca sobre o bundle servido | `scripts/report/test_report_security_ratchets.mjs` §1 | idem | IMPLEMENTADO |
| R-REPORT-020 | Runtime isolado do Supabase primário | Worker dedicado; `supabase/functions/` vira allowlist; legado removido após gate | `workers/user-report-intake/`, `supabase/config.toml` | Teste: `scripts/report/test_worker_isolation.mjs`. **Produção:** bindings live sem Supabase/D1/Hyperdrive; leitura pós-delete mostra somente `live-football` no projeto primário | IMPLEMENTADO |
| R-REPORT-021 | Rollback / desligamento de emergência | `REPORT_INTAKE_ENABLED=false` é a primeira ação | `workers/user-report-intake/wrangler.jsonc`, `workers/user-report-intake/src/index.ts` | `scripts/report/test_worker_isolation.mjs` — "o interruptor esta versionado como DESLIGADO" | IMPLEMENTADO |
| R-REPORT-022 | UI acessível e responsiva (≥320px) | Modal com foco preso, `Escape`, foco devolvido; tela cheia em 320px | `bolao/shared/js/report_ui.js`, `bolao/shared/css/report.css` | `scripts/report/test_report_ui.mjs` (20 casos) | PARCIAL — matriz visual completa só é exercitável com a UI ligada |
| R-REPORT-023 | UI multilíngue (pt-BR, en, es, ja) | Strings no componente, para o aviso não divergir entre idiomas | `bolao/shared/js/report_ui.js` (`T`) | `scripts/report/test_report_ui.mjs` — paridade de chaves nos 4 idiomas | IMPLEMENTADO |
| R-REPORT-024 | Sem capacidade de mutar pagamento/scoring/ranking | Não há binding, RPC nem credencial que permita | `workers/user-report-intake/wrangler.jsonc` | `scripts/report/test_worker_isolation.mjs`; `bolao/cdb2026/scripts/audit_scoring.py` (copa/br/cdb) | IMPLEMENTADO |

## Lacunas conhecidas

- **R-REPORT-012:** a duplicata é contada, mas nenhuma ação de triagem deriva disso ainda.
- **R-REPORT-018:** o job destrutivo de retenção continua não autorizado e não implementado; a App
  existir não transforma uma política proposta em autorização de apagar Issues.
- **R-REPORT-022:** a matriz responsiva completa (320/375/390/414/768/1024/1440/1728) exige a UI
  montada; hoje ela não monta por desenho. O CSS declara o comportamento e o componente é testado
  em unidade.

## Evidência de produção — 2026-08-25

- Worker ativo: versão `b50704ad-f61d-44e9-adeb-530973faf244` (número 6), endpoint canônico no
  documento de arquitetura; `REPORT_INTAKE_ENABLED="false"`.
- POST permitido: `503 {"error":"UNAVAILABLE"}`; CORS permitido: `204`; origem proibida: `403`;
  `x-deploy-id` igual à versão ativa; Issues antes/depois: `0/0`.
- App/repo: um único repositório privado, Issues on, Pages off, nenhum colaborador externo.
- Supabase: integração limitada ao conteúdo de `supabase/`/`config.toml`; função legada removida;
  read-back preservou `live-football` versão 16.
- Ativação pública e reporte sintético não foram autorizados; por isso `NOT_READY` e #321 aberta.

## Nota de escopo

Esta RTM cobre **apenas** o canal de reporte. Uma auditoria de completude de documentação de
arquitetura/SDD/TDD/RTM do repositório inteiro permanece **pendente como workstream separado** —
ver `PROJECT_MEMORY.md` ("Melhorias futuras").
