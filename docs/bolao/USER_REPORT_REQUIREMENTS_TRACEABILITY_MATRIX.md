# Reportar problema — Requirements Traceability Matrix

**Issue:** #321 · **Atualizado:** 2026-08-25 · **Runtime:** Cloudflare Worker (ver `adr/ADR-021-intake-em-cloudflare-worker.md`)
**Estado de ativação:** `BACKEND_PROVISIONED_DISABLED` · **Prontidão:** `NOT_READY`
**Aceitação sintética de produção:** ✅ 2026-08-25 (ver "Evidência de produção" no fim)

Segue a convenção de RTM já usada em `CDB2026_REQUIREMENTS_TRACEABILITY_MATRIX.md`: cada linha
aponta para **código real e teste real**. Onde não há teste, a linha diz isso — uma RTM que inventa
cobertura é pior que uma RTM ausente, porque transforma ausência de verificação em falsa garantia.

**Estados:** `IMPLEMENTADO` (código + teste em CI) · `PARCIAL` (implementado, cobertura ou escopo
incompleto, com o limite escrito) · `PENDENTE_PROVISIONAMENTO` (código pronto; depende de recurso
que só o dono cria) · `NÃO_IMPLEMENTADO` (decisão registrada).

O sufixo **`· VERIFICADO EM PRODUÇÃO`** marca a linha cujo comportamento foi observado no runtime
implantado, e não apenas em teste. Ele é sufixo, e não estado novo, de propósito: o gate de deriva
(`scripts/report/test_docs_drift.mjs`) valida a lista fechada de estados por prefixo, então a evidência de produção
enriquece a linha **sem** afrouxar a checagem que impede estado inventado.

> **Sobre `VERIFICADO POR TESTE` em R-REPORT-016 (#339).** A garantia do caminho de exceção é
> deliberadamente verificada por teste, e não por produção: provar em produção exigiria **provocar
> uma exceção de propósito no runtime implantado**, o que seria gerar um incidente real para
> colher evidência. A aceitação sintética de 2026-08-25 registrou **0 exceções** — ausência de
> exceção é ausência de evidência sobre esse caminho, e dizer o contrário seria exagerar o que
> foi observado.

**Evidência de produção** é rastreada separadamente da evidência de teste, porque as duas respondem
perguntas diferentes: teste verde diz que o código faz o que promete; evidência de produção diz que
o que está no ar é esse código. Confundir as duas foi exatamente o erro corrigido em #322 ("a função
não está implantada" — estava). A coluna abaixo diz `—` quando ainda não há nada implantado a
observar, e isso é um estado honesto, não uma lacuna de teste.

| # | Requisito | Controle de desenho | Implementação | Teste / evidência | Estado |
|---|---|---|---|---|---|
| R-REPORT-001 | Relato bruto fica PRIVADO; nunca cruza para público automaticamente | Destino privado verificado em **runtime**, antes de criar | `workers/user-report-intake/src/github.ts` (`verificarDestinoPrivado`) | `scripts/report/test_worker_intake.mjs` — "destino PUBLICO aborta antes de criar". **Aceitação sintética 2026-08-25:** aceitação sintética criou a Issue em repositório privado, confirmado privado por API antes e depois | IMPLEMENTADO · VERIFICADO EM PRODUÇÃO |
| R-REPORT-002 | Nenhuma dependência de banco financeiro/participante | Ausência de binding, não disciplina de código | `workers/user-report-intake/wrangler.jsonc` | `scripts/report/test_worker_isolation.mjs` — "nenhum binding de banco de dados de qualquer tipo" | IMPLEMENTADO |
| R-REPORT-003 | GitHub App de menor privilégio (Issues: write + Metadata: read) | App, não PAT; instalação em **um** repositório | `workers/user-report-intake/src/github.ts` (`PERMISSOES`) | Teste: `scripts/report/test_worker_intake.mjs`. **Produção 2026-08-25:** App `4714457`, instalação `156482151`, seleção `selected`, um repo (`support-intake`), `issues=write`, `metadata=read`, demais permissões ausentes; webhook/OAuth desligados | IMPLEMENTADO |
| R-REPORT-003a | Repositório de destino privado, Issues on, Pages off, sem colaborador externo | Verificado por API, não por memória | `ferrarilabs/support-intake` (`README.md`, `SECURITY.md`) | `scripts/report/readiness.mjs --live` → `private_repo_verified`. **Evidência de produção 2026-08-25:** `private: true` · `has_issues: true` · `has_pages: false` · `has_wiki: false` · `is_template: false` · colaboradores: só `ferrarilabs` | IMPLEMENTADO |
| R-REPORT-004 | Interruptor de servidor, padrão DESLIGADO | Avaliado **antes** de qualquer dependência; só a string exata liga | `workers/user-report-intake/src/index.ts` (`intakeHabilitado`), `workers/user-report-intake/wrangler.jsonc` (`vars`) | `scripts/report/test_worker_intake.mjs` — "so a string exata liga"; "desligado com TODOS os segredos => 503, e nada e tocado". **Aceitação sintética 2026-08-25:** ligado e desligado no runtime; com o interruptor desligado até o `415` vira `503` | IMPLEMENTADO · VERIFICADO EM PRODUÇÃO |
| R-REPORT-005 | Flag de cliente, padrão desligado | Defesa em profundidade / UX — **não** é a fronteira | `bolao/*/js/config.js` (`reportProblem.enabled`) | `scripts/report/test_report_ui.mjs` — 6 casos de "botao morto" | IMPLEMENTADO |
| R-REPORT-006 | CORS por allowlist exata | Eco só de origem já na lista; nunca `*` | `workers/user-report-intake/src/index.ts` (`ORIGENS_PERMITIDAS`, `cabecalhosCors`) | `scripts/report/test_worker_intake.mjs` — "nunca existe Access-Control-Allow-Origin: *" | IMPLEMENTADO |
| R-REPORT-007 | Payload e schema limitados | Allowlist de campos; tamanho conferido **antes** de parsear | `workers/user-report-intake/src/policy.ts` (`CAMPOS_ACEITOS`, `LIMITES`) | `scripts/report/test_report_intake.mjs` (77 casos) | IMPLEMENTADO |
| R-REPORT-008 | Sanitização dupla (cliente + servidor) | Cliente é conveniência; servidor é obrigatório | `bolao/shared/js/report_safe_context.js` + `workers/user-report-intake/src/policy.ts` (`tornarInerte`) | `scripts/report/test_report_intake.mjs` (corpus adversarial) | IMPLEMENTADO |
| R-REPORT-009 | Nenhum IP cru persistido | HMAC sobre IP da plataforma, com `/64` em IPv6 | `workers/user-report-intake/src/identidade.ts` (`chaveDeRede`, `normalizarRede`) | `scripts/report/test_worker_intake.mjs` — "a chave nao contem o IP…"; "dois enderecos do MESMO /64" | IMPLEMENTADO |
| R-REPORT-010 | Controles de abuso mensuráveis | Pré-filtro de rajada + limites deslizantes + teto global + disjuntor | `workers/user-report-intake/src/state.ts` (`POLITICA`, `avaliar`) | `scripts/report/test_worker_intake.mjs` — limite curto, F-09, F-03, pré-filtro | IMPLEMENTADO |
| R-REPORT-011 | Idempotência sem corrida | Durable Object serializável; chave amarrada ao remetente | `workers/user-report-intake/src/state.ts`, `workers/user-report-intake/src/identidade.ts` (`chaveIdempotencia`) | `scripts/report/test_worker_intake.mjs` — "dois envios SIMULTANEOS => uma Issue". **Aceitação sintética 2026-08-25:** reenvio idêntico devolveu `200` e **nenhuma** segunda Issue (contagem 1 → 1) | IMPLEMENTADO · VERIFICADO EM PRODUÇÃO |
| R-REPORT-012 | Supressão de duplicata | Impressão HMAC do conteúdo, com janela | `workers/user-report-intake/src/state.ts` (`duplicatas`), `workers/user-report-intake/src/identidade.ts` (`impressao`) | `scripts/report/test_worker_intake.mjs` (fluxo de confirmação) | PARCIAL — a contagem é registrada; ainda não há ação de triagem derivada dela |
| R-REPORT-013 | Injeção de prompt inerte | Marcador `UNTRUSTED_EXTERNAL_INPUT`; menções/refs/keywords neutralizadas | `workers/user-report-intake/src/policy.ts` (`tornarInerte`, `montarCorpo`) | `scripts/report/test_report_intake.mjs` (corpus de injeção). **Aceitação sintética 2026-08-25:** corpo da Issue real trouxe `UNTRUSTED_EXTERNAL_INPUT`; menções e refs neutralizadas | IMPLEMENTADO · VERIFICADO EM PRODUÇÃO |
| R-REPORT-014 | Exceção inesperada sanitizada | Casca **total** no `fetch` exportado | `workers/user-report-intake/src/index.ts` (`export default`) | `scripts/report/test_worker_intake.mjs` — "excecao arbitraria vira 503 generico, sem vazar" (4 venenos) | IMPLEMENTADO |
| R-REPORT-015 | Evidência de versão implantada | `version_metadata` → `x-deploy-id` em toda resposta | `workers/user-report-intake/wrangler.jsonc`, `workers/user-report-intake/src/index.ts` (`responder`) | `scripts/report/test_worker_intake.mjs` — "toda resposta carrega x-deploy-id". **Aceitação sintética 2026-08-25:** `x-deploy-id` em todas as respostas observadas, igual à versão ativa em cada momento | IMPLEMENTADO · VERIFICADO EM PRODUÇÃO |
| R-REPORT-016 | Observabilidade sem conteúdo — **métricas E log de exceção** | Métricas: eventos agregados, classe de redação, nunca valor. Exceção: `codigo` vem de **allowlist fechada**, nunca de `e.message` | `workers/user-report-intake/src/index.ts` (`metrica`, e as duas fronteiras de exceção), `workers/user-report-intake/src/falhas.ts` (`CODIGOS_DE_FALHA`, `classificar`) | `scripts/report/test_worker_intake.mjs` — §7-B "nenhum log carrega relato…"; "…registra a CLASSE, nunca o valor"; "fronteira EXTERNA/INTERNA: nenhum veneno chega ao log" (10 fixtures sintéticos × 2 fronteiras), 7 códigos estáveis, `classificar()` sob objeto hostil. `scripts/report/test_worker_isolation.mjs` — nenhuma fronteira lê `.message`/`.stack`. **Aceitação sintética 2026-08-25:** logs reais só `report_metrica:aceito` e `:idempotente`; sem conteúdo, sem chave, 0 exceções | IMPLEMENTADO · VERIFICADO EM PRODUÇÃO (métricas) · VERIFICADO POR TESTE (exceção) |
| R-REPORT-028 | Controle negativo prova que a asserção de log morde | Regressão reintroduzida numa **cópia** do fonte em diretório temporário do sistema — nunca na árvore do repositório (lição da #334) | `scripts/report/test_worker_intake.mjs` §7-C | `scripts/report/test_worker_intake.mjs` — "classificador regredido para e.message => a asserção de log REPROVA": o mutante grava fragmento de token no log e a asserção acusa | IMPLEMENTADO |
| R-REPORT-017 | Versão do aviso de privacidade viaja com o relato | Campo de formato fechado, validado no servidor | `bolao/shared/js/report_safe_context.js` (`NOTICE_VERSION`), `workers/user-report-intake/src/policy.ts` | `scripts/report/test_report_intake.mjs` — 4 casos F-12. **Aceitação sintética 2026-08-25:** `notice_version | v1` presente no corpo da Issue criada | IMPLEMENTADO · VERIFICADO EM PRODUÇÃO |
| R-REPORT-018 | Governança de retenção | Política escrita; deleção destrutiva separadamente autorizada | `docs/bolao/SECURE_USER_REPORTING.md` §10 | App existe, mas nenhuma automação destrutiva foi autorizada ou criada | NÃO_IMPLEMENTADO — política de 90 dias continua proposta |
| R-REPORT-025 | Endereço público decidido e registrado, com CSP de origem exata | `workers.dev` porque a conta tem `zones = 0`; curinga proibido | `workers/user-report-intake/wrangler.jsonc` (`workers_dev`), `bolao/{br2026,cdb2026,loterias/powerball}/index.html` (`connect-src`) | `scripts/report/test_worker_isolation.mjs` — "endereco publico exige interruptor versionado DESLIGADO" e "a CSP dos apps nomeia a origem EXATA do Worker, sem curinga" (ambas provadas por mutação) | IMPLEMENTADO |
| R-REPORT-026 | Deploy recusa enquanto faltar segredo exigido | `secrets.required` no manifesto; "implantado" implica "configurado" | `workers/user-report-intake/wrangler.jsonc` (`secrets.required`) | O deploy primeiro recusou três segredos ausentes; após provisionamento via stdin, a versão ativa lista exatamente os quatro `secret_text` exigidos, sem expor valores | IMPLEMENTADO |
| R-REPORT-027 | Manifesto de prontidão mede o runtime que existe | Caminhos lidos do próprio manifesto, nunca repetidos no gate | `scripts/report/readiness.mjs` | `scripts/report/test_docs_drift.mjs` §6 — "todo caminho de repositório citado pelo manifesto existe" (mutação em `SRC` e em `WORKER` reprova) | IMPLEMENTADO |
| R-REPORT-019 | Nenhum segredo no navegador | Segredos só server-side; catraca sobre o bundle servido | `scripts/report/test_report_security_ratchets.mjs` §1 | idem | IMPLEMENTADO |
| R-REPORT-020 | Runtime isolado do Supabase primário | Worker dedicado; `supabase/functions/` vira allowlist; legado removido após gate | `workers/user-report-intake/`, `supabase/config.toml` | Teste: `scripts/report/test_worker_isolation.mjs`. **Produção:** bindings live sem Supabase/D1/Hyperdrive; leitura pós-delete mostra somente `live-football` no projeto primário | IMPLEMENTADO |
| R-REPORT-021 | Rollback / desligamento de emergência | `REPORT_INTAKE_ENABLED=false` é a primeira ação | `workers/user-report-intake/wrangler.jsonc`, `workers/user-report-intake/src/index.ts` | `scripts/report/test_worker_isolation.mjs` — "o interruptor esta versionado como DESLIGADO". **Aceitação sintética 2026-08-25:** rollback executado e provado com `reportId` inédito; versão e bindings voltaram idênticos | IMPLEMENTADO · VERIFICADO EM PRODUÇÃO |
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
- Ativação pública não foi autorizada; por isso `NOT_READY` e #321 aberta.

## Evidência de produção — aceitação sintética, 2026-08-25

Execução única, autorizada e limitada. Nenhum participante real, nenhuma identidade real, nenhuma
mutação de pagamento, scoring, ranking ou banco.

| Etapa | Evidência |
|---|---|
| Baseline | `main` `df623e58`; Worker `b50704ad-f61d-44e9-adeb-530973faf244`; `REPORT_INTAKE_ENABLED="false"`; Issues em `support-intake`: **0**; flags de cliente `false` nos três apps ativos |
| Isolamento | bindings: `ESTADO` (DO), `RAJADA` (6/60s), `VERSAO`, 3 vars — **zero** Supabase/D1/Hyperdrive/service binding; conta inteira com `D1 = 0` e `Hyperdrive = 0` |
| Paridade código↔runtime | bundle publicado lido da Cloudflare e conferido contra a fonte de `origin/main`: mesma política, mesmo destino único (`api.github.com`), nenhuma referência a Supabase |
| Ligar | só a variável de servidor, versão `4713ff1a-63f6-4e82-8520-7b65b0d48f54`, mesmo código; bindings idênticos em tipo e número; flags de cliente **intocadas** |
| Envio | `POST` → `201` `{"ok":true,"id":"RPT-D15C5A86"}`; sem número de Issue, sem stack, sem detalhe de provedor |
| Issue privada | **exatamente 1** (`#1`), autor `app/ferrarilabs-support-intake`; título só app/diagnóstico/ID; repo reconfirmado privado |
| Privacidade do corpo | 10 asserções de conteúdo exigido + 15 de conteúdo proibido (IP, token, JWT, Bearer, chave/identificador Supabase, PEM, stack, e-mail, referência de pagamento, nomes de segredo) → **0 violações** |
| Idempotência (F-04) | reenvio idêntico → `200`, corpo byte a byte igual, contagem de Issues **1 → 1** |
| Controle de abuso | `RAJADA` ativo no runtime; a política real (DO `avaliar`) executou em todas as chamadas. **Sem teste de carga em produção**, por decisão |
| Logs | só `report_metrica:aceito` (com `app`, `diagnostico`, `latencia_ms`) e `report_metrica:idempotente`; 6 invocações, **0 exceções** |
| Rollback | `wrangler rollback` para `b50704ad…`; `POST` com `reportId` **inédito** → `503`; contagem de Issues inalterada; bindings e `REPORT_INTAKE_ENABLED="false"` idênticos ao baseline |
| Retenção | Issue sintética **retida** como evidência, rotulada `synthetic-test`, fechada — nenhuma deleção |

**Limites honestos desta evidência:**

- **F-04 com remetente diferente não foi exercitado em produção.** A chave de idempotência é
  `HMAC(segredo, chave_de_rede ‖ reportId)`, então simular outro remetente exigiria forjar
  `cf-connecting-ip` — um cabeçalho afirmado pela plataforma. Forjá-lo significaria enfraquecer a
  própria fronteira sob teste, então o caso permanece coberto por `scripts/report/test_worker_intake.mjs`.
- **O escopo da GitHub App não foi reverificado nesta execução.** Ele foi verificado no
  provisionamento (que **aborta** se a App alcançar mais de um repositório) e está registrado em
  R-REPORT-003. Reconfirmá-lo por API exigiria a chave privada da App, que existe só como segredo do
  Worker — o que é o desenho correto. A evidência ao vivo obtida aqui é mais fraca e ainda assim
  real: a Issue foi criada pelo bot da App esperada, no repositório esperado.
- **Metadado de invocação da Cloudflare não é log da aplicação.** O envelope de `wrangler tail`
  (e a observabilidade da plataforma) carrega `cf-connecting-ip` e geolocalização do cliente. Isso é
  comportamento da plataforma, não emissão do Worker: os logs do Worker seguem sem IP. A afirmação
  "nenhum IP cru" (R-REPORT-009) vale para o que o Worker **persiste e emite**, não para a telemetria
  de requisição da Cloudflare — e essa distinção precisa ficar escrita, não subentendida.

## Nota de escopo

Esta RTM cobre **apenas** o canal de reporte. Uma auditoria de completude de documentação de
arquitetura/SDD/TDD/RTM do repositório inteiro permanece **pendente como workstream separado** —
ver `PROJECT_MEMORY.md` ("Melhorias futuras").
