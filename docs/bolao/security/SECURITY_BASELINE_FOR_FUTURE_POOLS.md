# Security Baseline for Future Pools — Plataforma Bolão

2026-08-02, atualizado com a seção "Complemento" (CORS/rate limits/sessões/injection/
enumeração/gates) pedida na Parte 2 da revisão de segurança. Requisitos mínimos obrigatórios
para qualquer novo bolão criado nesta plataforma (padrão: `bolao/<nome>2027/` ou equivalente),
baseados nos achados reais desta auditoria — não genéricos.

## Por que este documento existe

A plataforma já tem 3 apps (Copa, BR2026, CDB2026) construídos incrementalmente, cada um
reaproveitando o padrão do anterior sem uma checklist de segurança formal no momento da criação
(`PLATFORM_GOVERNANCE.md`/`CONSISTENCY_MATRIX.md` só surgiram em 2026-07-12, depois que os 3 apps
já existiam). Esta seção fecha esse gap: qualquer bolão futuro deve passar pelos gates abaixo
**antes** de aceitar a primeira entrada com dinheiro real.

## 1. Dados

- Definir explicitamente, antes de escrever código, quais campos de `entries[]` são
  estritamente necessários. Não copiar o shape de outro app "porque já existe" — o shape atual
  (`diagnostics`, `paymentTo` por entrada) tem campos identificados nesta auditoria como
  exposição desnecessária (`API_RESPONSE_DATA_REVIEW.md`).
- Se o novo bolão não precisa dos mesmos campos de diagnóstico/pagamento por entrada, não os
  incluir — não é obrigatório manter paridade de campo com os 3 apps existentes.
- PII deve ser o mínimo necessário para operar o bolão (nome + e-mail + método de pagamento é o
  piso hoje; qualquer campo adicional exige justificativa).

## 2. Banco / RLS

- Nunca aceitar um documento JSON completo do cliente para escrita sem, no mínimo, um `WITH
  CHECK` que rejeite mudanças em propriedades administrativas (`results`, `paid`, `auditLog`,
  cutoff) vindas de um papel não-admin — **este é o gap mais sério encontrado nos 3 apps
  existentes** (`SECURITY_RISK_REGISTER.md` SR-01) e não deve ser repetido por padrão.
- Documentar toda policy RLS como `.sql` versionado no repositório (migration real), não só como
  bloco de código dentro de um Markdown de setup — os 3 apps existentes têm esse gap
  (`SUPABASE_SECURITY_REVIEW.md`).
- Nunca criar uma policy de `DELETE` para o papel `anon` a menos que estritamente necessário;
  hoje nenhum dos 3 apps precisa dela.
- Rodar `supabase/tests/rls/` (ou equivalente) antes do primeiro deploy com dinheiro real — ver
  proposta desta auditoria.
- `service_role` nunca no cliente, nunca neste repositório — gate obrigatório, já respeitado
  pelos 3 apps existentes (confirmado nesta auditoria).

## 3. APIs

- Toda integração externa nova deve entrar em `docs/bolao/security/API_INVENTORY.md` no mesmo
  patch que a introduz.
- CSP `connect-src` do novo app deve listar só os domínios que ele realmente chama — não copiar
  o CSP mais amplo da Copa "por segurança" (isso amplia a superfície sem necessidade).
- Toda chamada `fetch()` a uma API externa deve ter `AbortController`/timeout desde o primeiro
  commit — não deixar como dívida técnica (gap real hoje em CDB2026, 0/9 chamadas cobertas).
- Se uma Edge Function/API própria for criada, aplicar o padrão de CORS documentado em
  `CORS_AND_ORIGIN_POLICY.md` (allowlist exata, `Vary: Origin`, nunca wildcard com credentials).

## 4. Administração

- Considerar hash de senha admin **distinto** por app, não reaproveitar o hash compartilhado dos
  3 apps existentes (`CONSISTENCY_MATRIX.md` item 2, `SECURITY_RISK_REGISTER.md` SR-04) — reduz o
  blast radius de um comprometimento.
- Manter `guardAdmin()` chamado em toda ação admin (padrão correto já estabelecido).
- Ações administrativas de alto risco (declarar resultado final, marcar pagamento em lote,
  restaurar backup) devem ter confirmação bloqueante (`confirm()`) — padrão já correto.
- Se o volume/valor do bolão crescer significativamente, essa é a linha para reavaliar admin
  auth client-side vs. Supabase Auth real (ver ADR-006) — não esperar um incidente para
  reavaliar.

## 5. Desenvolvimento

- `escapeHtml()`/`esc()` em **todo** caminho dado→DOM, desde o primeiro commit — os 3 apps
  existentes mantêm essa disciplina de forma consistente; não regredir num app novo.
- `csvEscape()` (mitigação de CSV/formula injection) em qualquer exportação desde o início — já
  é padrão de plataforma, replicar sempre.
- Nenhum `eval()`/`new Function()`/`document.write` — CSP já bloqueia scripts inline, manter.
- SRI (`integrity=`) em todo script CDN.
- `csv`/export: aplicar `csvEscape()` desde o primeiro export.

## 6. Produção

- Rodar a checklist completa de `docs/bolao/QA_MASTER_CHECKLIST.md` antes do primeiro deploy.
- Rodar `bolao/scripts/security/*` (ver automação desta auditoria) como gate de CI/pre-commit
  antes do primeiro deploy com dinheiro real.
- Registrar a decisão de "publicar sem X" explicitamente (ex.: "publicado sem `audit_scoring.py`
  equivalente, aceito por Eduardo em <data>") em vez de deixar a lacuna implícita.

## 7. CORS (Complemento)

- Hoje: **não aplicável** — site 100% estático, sem API própria. Se um bolão futuro introduzir
  uma Edge Function/API própria, aplicar o padrão de `CORS_AND_ORIGIN_POLICY.md`: allowlist
  exata de origem, nunca regex/`.endsWith()`/`.includes()`, `Vary: Origin` sempre que refletir
  origem dinamicamente, `Access-Control-Allow-Credentials: false` (esta plataforma não usa
  cookies de sessão).
- CORS nunca deve ser tratado como controle de autorização — a autorização real é RLS/RPC/claims,
  sempre.

## 8. Rate limits (Complemento)

- Nenhum controle client-side (debounce, throttle, botão desabilitado) deve ser comunicado ou
  documentado como proteção contra um atacante — só reduz abuso acidental.
- Se o novo bolão introduzir qualquer backend/RPC/Edge Function, definir rate limiting real
  (`SERVER_SIDE ENFORCED` ou `PROVIDER ENFORCED`) para: login admin, criação de entrada, envio de
  e-mail, exportação de dados.
- Documentar em `docs/bolao/security/RATE_LIMIT_POLICY.md` (mesmo arquivo, adicionar linhas) —
  não criar um documento paralelo por app.

## 9. Sessões (Complemento)

- Se o novo bolão continuar usando o modelo atual (senha client-side + `sessionStorage`), usar o
  mesmo padrão de nomeação prefixado por app (`sessionStorage["<app>_adminUntil"]`) já
  estabelecido em BR2026/CDB2026 — não reintroduzir a inconsistência de nomenclatura da Copa.
- Se o novo bolão adotar Supabase Auth (recomendado a partir de um certo volume/valor — ver
  ADR-006), seguir as práticas documentadas em `SESSION_AND_TOKEN_SECURITY.md` seção "caso
  Supabase Auth seja utilizado": TTL curto, refresh com rotação, revogação real em logout,
  step-up auth para ações de alto risco.

## 10. Dados (exposição — Complemento)

- Nunca expor `select=*` do documento completo para um consumo que só precisa de ranking/status
  público — usar projeção de colunas ou uma view/RPC minimalista desde o design inicial, em vez
  de herdar o padrão "buscar tudo" dos 3 apps existentes.
- Se múltiplos bolões compartilharem a mesma tabela/projeto Supabase (como hoje), decidir
  explicitamente se a leitura deve atravessar a fronteira entre apps (como acontece hoje, ver
  `SUPABASE_SECURITY_REVIEW.md`) ou se cada app deve ter sua própria policy que impeça isso — não
  herdar a policy compartilhada por padrão sem essa decisão consciente.

## 11. Injection (Complemento)

- CSV export: `csvEscape()` desde o primeiro commit (não depois de um incidente).
- E-mail: sanitizar `\r`/`\n` em qualquer campo livre interpolado em cabeçalho de e-mail (assunto),
  não só `/` — gap identificado nos 3 apps existentes (SR-09), corrigir no próximo app novo mesmo
  que os 3 existentes ainda não tenham sido corrigidos.
- Nenhum SQL dinâmico/RPC sem revisão explícita de injection antes do merge.

## 12. Enumeração (Complemento)

- Se o novo bolão introduzir contas de usuário reais (não só uma senha admin compartilhada),
  usar mensagens de erro de login genéricas desde o início.
- Não derivar tokens de acesso/edição de campos que já são públicos via a mesma API (gap
  encontrado no `receiptCode`, SR-07) — gerar tokens aleatórios armazenados separadamente.

## 13. Gates obrigatórios antes de produção (Complemento)

Nenhum bolão novo deve aceitar a primeira entrada com dinheiro real sem que os itens abaixo
existam (mesmo que "existir" signifique, para alguns, "documentado explicitamente como
`NÃO APLICÁVEL` com justificativa"):

- [ ] `docs/bolao/security/API_INVENTORY.md` atualizado com as integrações do novo app.
- [ ] `docs/bolao/security/RLS_POLICY_MATRIX.md` atualizado com as policies do novo app (ou uma
      nova linha explicando por que reusa a policy existente).
- [ ] `docs/bolao/security/CORS_AND_ORIGIN_POLICY.md` — marcado N/A ou atualizado, se uma API
      própria for introduzida.
- [ ] `docs/bolao/security/RATE_LIMIT_POLICY.md` — matriz atualizada para os fluxos do novo app.
- [ ] `docs/bolao/security/SESSION_AND_TOKEN_SECURITY.md` — atualizado se o modelo de sessão
      mudar.
- [ ] `docs/bolao/security/INJECTION_REVIEW.md` — checklist de export/e-mail/DOM revisado para o
      novo app.
- [ ] `docs/bolao/security/ENUMERATION_REVIEW.md` — revisado se o novo app introduzir contas
      reais.
- [ ] `docs/bolao/security/SECURITY_RISK_MATRIX.md` — novas linhas RM para riscos específicos do
      novo app, se houver.
- [ ] `docs/bolao/security/THREAT_MODEL.md` — ativos/ameaças do novo app adicionados.
- [ ] Testes automáticos equivalentes a `audit_scoring.py` para a lógica de pontuação do novo
      app (gap conhecido: BR2026/CDB2026 ainda não têm isso — não repetir num quarto app).
- [ ] Aprovação registrada do Eduardo (changelog do app + `CONSISTENCY_MATRIX.md` se for uma
      decisão de plataforma) antes do primeiro deploy com dinheiro real.
