# Security Assessment Report — Plataforma Bolão

**Data:** 2026-08-02. **Tipo:** revisão de segurança somente leitura (passiva), autorizada
explicitamente pelo Eduardo (dono do repositório) para todos os checks locais e testes passivos
descritos abaixo. **Branch:** `security-review-readonly` (worktree isolado, sem push/merge/deploy).
Documento vivo — combina a Parte 1 (base) e a Parte 2 (Complemento: CORS, rate limits, sessões,
enumeração, injection, matriz de risco) da tarefa original.

## Escopo

`bolao/copa2026/`, `bolao/br2026/`, `bolao/cdb2026/`, `bolao/loterias/powerball/`, `bolao/`
(raiz/redirects), infraestrutura compartilhada (Supabase, EmailJS, GitHub Actions, GitHub Pages).
Site principal (`index.html`/`index.pt.html`/`index.es.html`/`index.jp.html`) incluído
superficialmente onde relevante (CSP, Formspree/Turnstile), mas não é o foco (não movimenta
dinheiro do bolão).

## Métodos utilizados

- Leitura de código-fonte (JS, Python, HTML, YAML) dos 3 apps + scripts + workflows.
- Leitura de toda a documentação de governança já existente (`docs/bolao/*.md`, ADRs).
- Busca de padrões (`grep`) por segredos, sinks de XSS, SQL dinâmico, CORS, subprocess.
- Testes passivos reais (somente `GET`/`OPTIONS`) contra o Supabase REST API de produção, usando
  a chave `anon`/`publishable` já pública no bundle do navegador — nenhuma diferença de
  capacidade em relação ao que qualquer visitante do site já pode fazer.
- Teste passivo real (`GET`, `curl -L`) contra `ferrarilabs.github.io`/`www.ferrarilabs.com` para
  confirmar headers HTTP reais servidos pelo GitHub Pages.
- **Nenhum teste de escrita** (`POST`/`PATCH`/`PUT`/`DELETE`/upsert/RPC de escrita) foi enviado
  contra produção. **Nenhum e-mail real foi enviado.** **Nenhuma senha admin real foi
  testada/adivinhada.** **Nenhuma policy/config foi alterada.**

## Limitações

- Sem acesso ao dashboard do Supabase — Security Advisor, `information_schema.role_table_grants`,
  e confirmação de RLS fora do que é observável via a Data API não puderam ser verificados.
  Instruções para o Eduardo rodar depois estão em `SUPABASE_SECURITY_REVIEW.md`.
- Comportamento de escrita (`INSERT`/`UPDATE`) da RLS não foi executado — só analisado via a
  policy documentada em `bolao/copa2026/docs/DATABASE_SETUP_SUPABASE.md` (único SQL versionado no
  repo; pode ter divergido do banco real sem que este repositório saiba).
- Comportamento real do motor de template do EmailJS (terceiro) para o campo de assunto não pôde
  ser verificado além do que o comentário no código-fonte já documenta.
- Nenhuma carga foi gerada — limites de taxa reais do lado do provedor (Supabase, EmailJS) não
  foram medidos, só inferidos de configuração de plano (não verificável sem dashboard).
- Enumeração por timing não foi testada (baixo valor esperado, ver `ENUMERATION_REVIEW.md`).

## APIs encontradas

Ver `docs/bolao/security/API_INVENTORY.md` — tabela completa. Resumo: Supabase Data API
(persistência), EmailJS (e-mail), ESPN não oficial (placar/standings ao vivo, 3 apps), API-Football
(desabilitada por padrão), Polymarket (interno, só Copa), NY Open Data/Socrata (loterias), CDN
jsDelivr (SDKs, com SRI), Formspree+Turnstile (site principal, fora do bolão), GitHub Actions (4
workflows), GitHub Pages (hosting).

## Chaves encontradas

Busca completa por `service_role`, `sb_secret_`, `PRIVATE_KEY`, `SECRET`, `TOKEN`, `PASSWORD`,
`JWT`, `WEBHOOK`, padrões de token de provedores conhecidos (`eyJhbGci`, `AKIA...`, `ghp_...`,
`xox...`, blocos `BEGIN PRIVATE KEY`) em código, docs, workflows, e `git log --all
--full-history` para arquivos removidos.

**Nenhum segredo privilegiado foi encontrado em nenhum lugar do repositório, incluindo git
history.** Todas as chaves presentes no código são públicas por design:

| Chave | Classificação | Onde |
|---|---|---|
| `sb_publishable_9eJs…5` (Supabase anon/publishable) | **PUBLICÁVEL** | `config.js` dos 3 apps + `scripts/*.py` |
| `GBZFujsJBET6modve` (EmailJS public key) | **PUBLICÁVEL** | `config.js` dos 3 apps + `scripts/*.py` |
| `0x4AAAAAADBOZDvkES97y2fW` (Cloudflare Turnstile site key) | **PUBLICÁVEL** | `index*.html` (site principal) |
| `xvzdwenk` (Formspree endpoint id) | **PUBLICÁVEL** | `index*.html` (site principal) |
| Menções a `service_role` em `SECURITY.md`, `DATABASE_SETUP_SUPABASE.md`, ADRs | **FALSO POSITIVO** (é texto explicando a regra "nunca use service_role", não a chave em si) | Documentação |
| `adminPasswordHash` (hash SHA-256, não a senha) | **SENSÍVEL** (não é segredo forte — é um hash de round único, crackável offline; nunca é a senha em texto puro) | `config.js` dos 3 apps, valor idêntico nos 3 |

Nenhuma ação de rotação foi tomada (não haveria motivo — nenhuma chave privilegiada foi
encontrada para rotacionar).

**Achado separado, não é uma "chave" mas apareceu na mesma varredura**: `bolao/copa2026/scripts/send_bracket_correction_email.py`
(dicionário `ROUTING`, linhas 65-79) tem **nome completo + e-mail pessoal real de 15
participantes** hardcoded em texto puro, committado no repositório **público** desde 2026-06-29
(confirmado: `git log --follow` nesse arquivo; visibilidade pública do repo confirmada via
`GET https://api.github.com/repos/ferrarilabs/ferrarilabs.github.io` → `"private": false`).
Diferente de tudo mais nesta seção, isto não é uma chave/segredo — é PII de terceiros, já
publicamente exposta há semanas, sem precisar de nenhuma técnica de exploração. Ver
`docs/bolao/security/SECURITY_RISK_REGISTER.md` SR-15 (P1) para o detalhamento e a recomendação.
E-mails mascarados neste documento (ex. `ga…@gmail.com`) — nunca reproduzidos por completo.

## Estado da RLS

Ver `docs/bolao/security/RLS_POLICY_MATRIX.md` e `SUPABASE_SECURITY_REVIEW.md` para o detalhe
completo. Resumo: `public.bolao_state` — **RLS CONFIRMADA MAS PERMISSIVA**. SELECT confirmado
empiricamente (teste real, 2026-08-02): retorna as 3 linhas (`main`/`br2026`/`cdb2026`) numa
única chamada sem filtro de `id`. INSERT/UPDATE não testados (só analisados via a policy
documentada) — mesma condição `id in (...)`, sem granularidade de propriedade dentro do JSON.
Nenhuma policy de DELETE documentada. Nenhuma outra tabela `public` é alcançável.

## Permissões anon/authenticated

- **`anon`**: usado por todo navegador **e por todo script Python de automação** (mesma chave,
  sem distinção de privilégio entre "bot legítimo" e "visitante qualquer"). Tem
  select/insert/update nos 3 `id`s conhecidos, sem distinção de propriedade dentro do documento.
- **`authenticated`**: não utilizado — não há Supabase Auth em nenhum dos 3 apps.
- **`service_role`**: não utilizado em lugar nenhum (confirmado).

## Exposição de dados

Ver `API_RESPONSE_DATA_REVIEW.md`. `select=*` devolve `entryName`, `payerName`,
`participantEmail`, `paymentMethod`, `paymentTo`, `diagnostics` (userAgent/timezone/viewport),
`auditLog` completo, `results`/`paid`/`meta` — para qualquer leitor, mesmo os campos nunca
exibidos na UI. **Confirmado nesta auditoria**: uma única chamada sem filtro de `id` expõe os
dados dos **3 apps simultaneamente**, não só do app que o visitante está usando.

## Administração client-side

Ver `SESSION_AND_TOKEN_SECURITY.md`. Classificação honesta pedida pela tarefa:

| Mecanismo | Classificação |
|---|---|
| Hash SHA-256 + comparação no navegador | **CONTROLE DE UX** — impede o clique casual, não impede um atacante com o `config.js` em mãos |
| Lockout 5/15min (`sessionStorage`) | **CONTROLE COMPENSATÓRIO fraco** — só reduz tentativas via UI; resetável fechando a aba; irrelevante contra ataque offline ao hash |
| Sessão 30 min + `guardAdmin()` em toda ação | **CONTROLE DE UX/AUTORIZAÇÃO fraca no client** — real o suficiente para impedir uso acidental por um usuário que esqueceu a aba aberta, mas não é autorização server-side |
| RLS no banco | **NÃO É CONTROLE DE ADMIN** — RLS não sabe o que é "admin"; qualquer papel `anon` (participante ou admin) tem o mesmo acesso ao banco |

**Não há autenticação real, nem autorização real server-side para ações admin.** Isso é
consistente com o que `SECURITY.md`/`PROJECT_MEMORY.md` já documentam como decisão aceita — esta
auditoria confirma e detalha, não descobre algo novo.

## XSS e front-end

`escapeHtml()`/`esc()` confirmado presente e usado de forma consistente em todo caminho
dado→DOM identificado nos 3 apps de dinheiro real (116 usos de `innerHTML` entre os 3, zero
`eval`/`new Function`/`document.write`). Um gap não-runtime foi encontrado em
`bolao/loterias/powerball/js/app.js` (`innerHTML` com `p.name` sem escaping) — mas a fonte é
dado hardcoded em `data.js` pelo próprio Eduardo, sem formulário público de submissão; risco real
baixíssimo, documentado por consistência em `INJECTION_REVIEW.md`.

CSP presente via `<meta>` tag nos 3 apps bolão + `loterias/powerball` (`frame-ancestors 'none'`,
`script-src 'self' https://cdn.jsdelivr.net`, `connect-src` com escopo próprio por app). **O
site principal (`index.html`/variantes de idioma) não tem CSP.** SRI presente nos 2 scripts CDN
(EmailJS, Supabase) dos 3 apps bolão. Nenhum `target="_blank"` sem `rel="noopener"` encontrado.
HSTS presente na resposta do domínio Supabase; **não observado** na resposta do domínio principal
do site (`www.ferrarilabs.com`) no teste real desta auditoria — GitHub Pages/custom domain com
HTTPS forçado, mas o header HSTS explícito não apareceu na resposta capturada.
`Access-Control-Allow-Origin: *` confirmado na resposta do GitHub Pages (comportamento padrão da
hospedagem para conteúdo estático, sem credential exposure associado).

## APIs externas

ESPN (não oficial), API-Football (desabilitada), Polymarket: consumidas sem autenticação, sem
schema validation formal, mas com checks de sanidade específicos antes de persistir resultado
(`check_match_is_real()`/`check_result_shape()` em `audit_scoring.py`; dupla confirmação de 20s
em `send_result_email.py --auto` desde v4.55). Cobertura de timeout (`AbortController`)
incompleta: BR2026 100%, Copa 5/9, CDB2026 0/9 — gap já catalogado em `PROJECT_MEMORY.md`
"Limitações", confirmado ainda presente nesta auditoria.

## Vulnerabilidades confirmadas (por leitura de código + teste passivo real)

1. Leitura cross-app de PII/audit log numa única chamada sem filtro de `id` (confirmado
   empiricamente, 2026-08-02) — ver `SUPABASE_SECURITY_REVIEW.md`.
2. CSV/formula injection — **já mitigado** nos 3 apps (`csvEscape()`), confirmado presente e
   correto (não é uma vulnerabilidade ativa, listado aqui só para registrar que foi verificado).
3. `emailSubjectSafe()` não remove `\r`/`\n`, só `/` — gap parcial confirmado por leitura de
   código (impacto depende do EmailJS, não totalmente verificável).
4. Inconsistência de documentação: `SECURITY.md`/`ARCHITECTURE.md` descrevem o lockout admin como
   `localStorage`; o código real usa `sessionStorage` — já catalogado em `CONSISTENCY_MATRIX.md`
   item 3 antes desta auditoria, confirmado ainda presente.
5. `innerHTML` sem escaping em `loterias/powerball` — confirmado por leitura de código, risco
   real baixo (dado hardcoded, não input).
6. **`bolao/loterias/powerball/js/data.js` contém nome completo e ID de transação real
   (Zelle/Venmo/CashApp) dos 14 participantes reais, hardcoded em texto puro num arquivo JS
   estático servido publicamente** — confirmado por leitura de código. Não há RLS/chave/gate
   algum protegendo esse arquivo (diferente dos 3 apps bolão, que ao menos exigem uma chamada à
   Data API); a única proteção é `robots: noindex,nofollow,noarchive` + aviso textual "página
   privada, não compartilhe" na própria UI — ou seja, obscuridade de URL, não controle de acesso.
   Ver `SECURITY_RISK_REGISTER.md` SR-14. Risco julgado baixo-médio (IDs de transação isolados
   não permitem ação maliciosa direta), mas é o único lugar da plataforma onde dado financeiro
   pessoal real vive diretamente no código-fonte estático em vez de atrás de qualquer API.

## Riscos não confirmados (análise de policy/código, não execução)

1. Escrita de mass assignment em `results`/`paid`/`auditLog` via `UPDATE` direto — **não
   executado contra produção** (proibido pelo escopo desta tarefa); inferido da policy
   documentada, que não distingue propriedade dentro do JSON. Tratado como o achado mais sério
   desta auditoria mesmo sem execução real, porque a policy que permitiria isso está documentada
   e é o único SQL versionado que descreve o comportamento real do banco.
2. Grants diretos além das policies RLS documentadas — desconhecido, sem acesso a
   `information_schema`.
3. Comportamento do Supabase Security Advisor — desconhecido, sem acesso ao dashboard.
4. Header injection real via EmailJS — depende do comportamento interno do provedor, não
   verificável sem uma chamada de escrita real (fora do escopo).

## Recomendações imediatas (não implementadas — decisão do Eduardo)

1. Revisar/aprovar o hardening de curto prazo do ADR-006 (RPC gated ou `WITH CHECK` mais
   restrito para `results`/`paid`/`auditLog`) — maior prioridade estrutural desta auditoria
   (SR-01/RM-015).
2. **Remover ou reescrever `bolao/copa2026/scripts/send_bracket_correction_email.py`** para não
   manter e-mails pessoais de participantes hardcoded — ler do Supabase em runtime, como os
   demais scripts de e-mail já fazem. É o achado com **maior certeza de exposição real** desta
   auditoria (não inferido — confirmado, público, há semanas). Ver SR-15.
3. Rodar a query de verificação de grants sugerida em `RLS_POLICY_MATRIX.md`.
4. Abrir o Supabase Security Advisor uma vez e revisar os achados automáticos.
5. Considerar hash de senha admin distinto por app (reduz blast radius de comprometimento).
6. Estender `emailSubjectSafe()` para remover `\r`/`\n`.

## Melhorias para bolões futuros

Ver `docs/bolao/security/SECURITY_BASELINE_FOR_FUTURE_POOLS.md` — checklist completo.

## Mudanças que exigem backend

Toda correção estrutural dos achados P0/P1 (mass assignment, IDOR de entrada, MFA admin, audit
log imutável, step-up authentication) exige um backend real (RPC/Edge Function/Supabase Auth) —
nenhuma é resolvível só com RLS mais restritiva em um modelo de documento único. Ver ADR-006 para
o plano de arquitetura proposto (não implementado).

## Evidências

- Testes passivos reais documentados em `SUPABASE_SECURITY_REVIEW.md` e
  `CORS_AND_ORIGIN_POLICY.md` (comandos `curl` reproduzíveis, sem dado sensível reproduzido).
- Contagens de linha/estrutura de resposta (não os dados em si) em
  `API_RESPONSE_DATA_REVIEW.md`/`SUPABASE_SECURITY_REVIEW.md`.
- Código-fonte referenciado por caminho+linha ao longo de todos os documentos desta pasta.

## Risco residual

**Não trivial, mas majoritariamente consistente com decisões de produto já aceitas.** O maior
risco residual real (não aceito explicitamente em nenhum lugar da documentação existente antes
desta auditoria) é o mass assignment de propriedades administrativas dentro do documento JSON
único — isso afeta diretamente CDB2026, que está em produção com dinheiro real. Os demais riscos
(exposição de PII, ausência de MFA, sessão client-side) são consistentes com o modelo "bolão
informal entre amigos" já documentado e aceito por Eduardo.

---

# Parte 2 — Complemento

## CORS e Origin Validation

**NÃO APLICÁVEL À IMPLEMENTAÇÃO ATUAL** — sem API/Edge Function própria neste repo. Comportamento
do provedor (Supabase) documentado e testado: reflete qualquer `Origin`, sem `Vary: Origin`,
equivalente a wildcard sem credentials. Ver `CORS_AND_ORIGIN_POLICY.md`. Classificação:
**NÃO APLICÁVEL** (não é um controle deste repositório) / **EXIGE CONFIGURAÇÃO DO PROVIDER** (se
algum dia se quiser restringir, seria do lado do Supabase, não deste código) / **OBRIGATÓRIO PARA
FUTURAS APIS** (padrão de allowlist documentado para reuso).

## Rate Limits

**AUSENTE** (server-side) / **CLIENT_SIDE ONLY** (aplicação) em praticamente todos os fluxos —
ver matriz completa em `RATE_LIMIT_POLICY.md`. Única exceção real: Cloudflare
Turnstile+Formspree no formulário de contato do site principal (**PROVIDER ENFORCED**), e o
agendamento fixo dos GitHub Actions crons (limite operacional, não defesa).

## Resource Limits

**PARCIAL.** Limite de tamanho de linha (1 MB) e de `id` (50 chars) via `check` constraint —
**IMPLEMENTADO, NÃO TESTADO** nesta auditoria (não foi enviado um payload de 1MB+ contra
produção, seria uma escrita). Paginação: **NÃO APLICÁVEL** ao modelo de 1 linha por app. Limite
de payload em EmailJS/ESPN: **DESCONHECIDO** (depende do provedor).

## Excessive Data Exposure

**PARCIAL/AUSENTE** — ver `API_RESPONSE_DATA_REVIEW.md`. Confirmado (teste real): `select=*`
devolve todos os campos, incluindo PII e audit log, para qualquer leitor, cruzando a fronteira
entre os 3 apps numa chamada sem filtro. Classificação: **IMPLEMENTADO NÃO TESTADO** seria
incorreto aqui — é **AUSENTE** (nenhuma projeção/view existe) e o comportamento **foi testado e
confirmado**, não é uma suposição.

## Session Lifecycle

**PARCIAL.** Sessão admin client-side (`sessionStorage`, 30 min, `guardAdmin()` em toda ação) —
**IMPLEMENTADO E TESTADO** como mecanismo de UX (confirmado por leitura de código, consistente
com o comportamento documentado); **NÃO É** um ciclo de vida de sessão server-side real. Sem
Supabase Auth em uso.

## JWT Validation / Token Revocation / Refresh Token Rotation

**NÃO APLICÁVEL** aos três — não há JWT de usuário/aplicação em uso em lugar nenhum da
plataforma (confirmado por busca de código, `supabase.auth.*` ausente nos 3 apps). Ver
`SESSION_AND_TOKEN_SECURITY.md` para o que seria obrigatório numa futura arquitetura com
Supabase Auth.

## User Enumeration

**NÃO APLICÁVEL** ao login admin (sem conceito de conta/usuário, só senha global). **AUSENTE
COMO RISCO REAL** para os IDs de linha do Supabase (já públicos por design). **CONFIRMADO** como
achado real e não-óbvio: o "código de comprovante" (`receiptCode`) é recalculável offline a
partir de campos (`entryName`, `createdAt`) já expostos pela mesma API pública — ver
`ENUMERATION_REVIEW.md`.

## SQL Injection

**NÃO APLICÁVEL** — sem SQL dinâmico neste repositório (toda persistência via PostgREST com
filtros de query string, não SQL montado como string). Ver `INJECTION_REVIEW.md`.

## Other Injection Risks

- Command injection: **AUSENTE** (confirmado — todo `subprocess` usa forma de lista, sem
  `shell=True`).
- CSV/formula injection: **IMPLEMENTADO E TESTADO** (mitigação confirmada presente e correta nos
  3 apps).
- DOM XSS: **IMPLEMENTADO E TESTADO** nos 3 apps de dinheiro real; **PARCIAL** em
  `loterias/powerball` (gap de baixo risco, dado hardcoded).
- Header injection (e-mail): **PARCIAL** — mitigação incompleta, dependência de terceiro não
  verificável.
- Path traversal / template injection: **NÃO APLICÁVEL** (sem input de caminho, sem motor de
  template server-side).

## Error Disclosure

**AUSENTE de política formal**, mas **impacto baixo confirmado por leitura de código** — não há
stack trace de servidor (não há servidor), erros do Supabase/EmailJS podem aparecer no console
do navegador (visível a um usuário curioso, não a um atacante remoto sem acesso ao dispositivo).
Nenhum log central/correlation ID existe — não há backend para tê-lo.

## Risk Matrix

Ver `docs/bolao/security/SECURITY_RISK_MATRIX.md` — 30 linhas (RM-001 a RM-030), escala formal
Probabilidade×Impacto, cobrindo todos os temas pedidos pela tarefa, incluindo os marcados N/A
explicitamente (JWT/refresh token/etc.) em vez de omitidos.

## Applicability to Current Architecture

A maioria dos controles "faltantes" nesta Parte 2 (CORS restritivo, rate limit server-side, JWT
lifecycle, MFA) **exige um backend que não existe hoje por decisão arquitetural deliberada**
(`PROJECT_MEMORY.md` "Decisões arquiteturais": site 100% estático, sem servidor, "desproporcional
ao risco" para um bolão informal). Nenhum destes é uma omissão acidental — são consequências
diretas e conhecidas da arquitetura escolhida. A exceção é o mass assignment de propriedade
administrativa (SR-01), que é endereçável parcialmente **sem** um backend novo (`WITH CHECK` mais
restrito na policy RLS existente).

## Mandatory Controls for Future Pools

Ver `docs/bolao/security/SECURITY_BASELINE_FOR_FUTURE_POOLS.md` seção "Gates obrigatórios antes
de produção" (adicionada nesta Parte 2).

---

## Veredito final

**BASELINE PARCIAL.**

Não é possível declarar **BASELINE ADEQUADA** porque o achado mais sério desta auditoria (mass
assignment de propriedades administrativas dentro do documento JSON único, permitindo em teoria
que qualquer cliente com a chave anon pública altere resultado/pagamento/audit log de um bolão
com dinheiro real em produção — CDB2026) não tem nenhuma mitigação além de gate de UI client-side.

Não é **BASELINE INADEQUADA** porque: (a) não há segredo privilegiado exposto; (b) XSS está
disciplinadamente mitigado nos 3 apps de dinheiro real; (c) CSV/formula injection já está
corrigido; (d) a maior parte dos demais gaps (rate limit, MFA, JWT lifecycle) são consequências
conhecidas e aceitas de uma decisão arquitetural deliberada (site estático, sem backend), não
omissões acidentais; (e) a exposição de PII/leitura cross-app, embora mais ampla do que
provavelmente esperado, é consistente com a decisão de produto documentada de "bolão
transparente".

**Não afirmamos que o sistema está seguro ou certificado.** O risco residual real e mais
acionável é o SR-01/RM-015 (mass assignment) — recomendação: tratar como prioridade de
engenharia na próxima janela de manutenção da plataforma, com aprovação explícita do Eduardo
antes de qualquer mudança em RLS de produção, seguindo `PLATFORM_GOVERNANCE.md`.
