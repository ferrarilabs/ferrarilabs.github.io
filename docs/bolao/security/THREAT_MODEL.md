# Threat Model — Plataforma Bolão

2026-08-02. Cobre `bolao/copa2026/`, `bolao/br2026/`, `bolao/cdb2026/` (dinheiro real,
US$5/entrada cada) e, com menor profundidade, `bolao/loterias/powerball/` (sem dinheiro
agregado pela plataforma em si — organização informal de compra de bilhetes).

## Ativos

| Ativo | Onde vive | Sensibilidade |
|---|---|---|
| Entradas (nome, pagador, e-mail, método de pagamento) | `bolao_state.state.entries[]` | PII moderada — nome/e-mail/forma de pagamento, sem número de cartão/conta |
| Palpites (`picks`) | `bolao_state.state.entries[].picks` | Baixa isoladamente, mas determina o prêmio |
| Resultados oficiais | `bolao_state.state.results` / `.phases[].ties[].legs[]` | Alta — determina quem ganha dinheiro real |
| Ranking/pontuação | Calculado em runtime a partir de entries+results | Alta — é o produto público-facing que decide o prêmio |
| Pagamentos (status `paid`) | `bolao_state.state.paid` | Alta — decide quem já pagou/quem recebe |
| PII (diagnóstico de dispositivo) | `entries[].diagnostics` (userAgent, timezone, viewport, capturedAt) | Baixa-moderada — fingerprint de navegador, não IP bruto, não CPF/documento |
| Audit log | `bolao_state.state.auditLog` | Moderada — evidência operacional para disputas; mutável no mesmo documento |
| Credenciais admin | SHA-256 hash em `config.js`, compartilhado entre os 3 apps | Alta — compromete os 3 painéis admin ao mesmo tempo |
| Backups (CSV/JSON exportados) | Download local pelo admin, fora do repositório | Alta se vazado (mesmos dados de `entries[]` completos) |
| Chaves públicas (anon Supabase, EmailJS) | `config.js`, `scripts/*.py` | Pública por design — não são segredo, mas são o único portão de acesso ao banco |

## Atores

| Ator | Capacidade real hoje |
|---|---|
| Participante legítimo | Consegue submeter/editar sua própria entrada antes do cutoff via UI; consegue ler todo o ranking/entradas públicas por design |
| Usuário anônimo (não-participante) | Mesmo acesso de leitura que um participante — nada distingue os dois no banco (não há login) |
| Admin (Eduardo) | Senha compartilhada nos 3 apps; ações de resultado/pagamento/exclusão via UI gated por `guardAdmin()` |
| Invasor oportunista | Alguém que encontra a URL pública (Copa/CDB2026 já divulgados) e testa a chave anon já visível no bundle — sem precisar de nenhuma técnica avançada |
| Participante malicioso | Um participante real que usa ferramentas fora do `app.js` (DevTools, curl, Postman) contra o mesmo endpoint que o app usa, com a mesma chave |
| Script automatizado | Qualquer bot rodando contra a API pública (ESPN também é consumida sem autenticação — risco simétrico do lado de fora) |
| Fornecedor externo comprometido | Supabase, EmailJS, jsDelivr (CDN), ESPN (API não oficial), API-Football — qualquer um poderia servir conteúdo malicioso ou vazar dado se comprometido |

## Ameaças

| Ameaça | Probabilidade | Impacto | Controle atual | Gap | Mitigação recomendada | Risco residual |
|---|---|---|---|---|---|---|
| Alterar resultado oficial via API direta (bypass do `app.js`) | Média (requer saber o endpoint, mas é o mesmo usado pelo app + chave já pública) | Crítico (dinheiro real) | Nenhum a nível de banco — só UI gate client-side | RLS não distingue propriedade `results` de `entries` (ver `SUPABASE_SECURITY_REVIEW.md`) | RPC dedicada para escrita de resultado, ADR-006 | Alto até implementação |
| Alterar status de pagamento (`paid`) de forma não autorizada | Média | Alto (decide quem recebe prêmio) | Mesmo gap acima | Mesmo gap acima | Mesma recomendação | Alto até implementação |
| Apagar entrada de terceiro | Baixa-média (exige montar payload manualmente, sem UI para isso) | Alto (perde participação paga) | Tombstones (`deletedIds`) mitigam "ressurreição" acidental via merge, mas não impedem uma remoção maliciosa direta | RLS não valida que uma entrada removida do array corresponde a uma exclusão legítima | RPC dedicada / soft-delete server-side | Médio |
| Ler PII de participantes (nome/e-mail/pagamento/diagnóstico) de qualquer um dos 3 apps | **Alta — já confirmado, é o comportamento documentado e testado nesta auditoria** | Médio (é um "bolão transparente" por decisão de produto, mas o alcance cross-app pode exceder a expectativa de um participante do BR2026 que não sabia que seu e-mail também está acessível via a mesma chave que expõe a Copa) | Nenhum — design intencional | Ver `API_RESPONSE_DATA_REVIEW.md` | Views públicas com projeção de colunas, se o produto crescer | Aceito para o modelo atual — reavaliar se a base de participantes crescer |
| Inserir entrada após o cutoff | Média (client-side clock pode ser manipulado) | Baixo-médio (o admin pode excluir manualmente) | Enforcement client-side apenas | Sem timestamp de servidor validando o cutoff | Cutoff validado por função server-side/RPC com `now()` do Postgres | Baixo (aceito, documentado como limitação em `SECURITY.md`) |
| Modificar ranking (indiretamente, via resultado/palpite) | Média | Alto | `scoreEntry()` única implementação, sem múltiplas fontes divergentes no site | Depende dos mesmos gaps de resultado/pagamento acima | Mesma recomendação | Alto até implementação |
| Adulterar audit log | Média (mesmo vetor de escrita arbitrária) | Médio (evidência operacional, não o próprio dinheiro) | Nenhum — `auditLog` é só mais uma chave do mesmo JSON mutável | Não é append-only ao nível de banco | `audit_events` como tabela separada, insert-only (ADR-006) | Médio |
| XSS via dado de participante/API externa | Baixa (escapeHtml/esc cobre os 3 apps de forma consistente; um gap não-runtime encontrado em `loterias/powerball`, ver `INJECTION_REVIEW.md`) | Alto se explorado (sequestro de sessão admin, já que a sessão admin é `sessionStorage` na mesma origem) | `escapeHtml()`/`esc()` em todo caminho dado→DOM identificado nos 3 apps bolão | Nenhum gap runtime confirmado nos 3 apps de dinheiro real | Manter disciplina de escaping; propagar `esc()` também para dados hardcoded se `loterias/powerball` algum dia aceitar input real | Baixo |
| Abusar EmailJS (spam, esgotar quota) | Média (throttle de 30s é só client-side, por sessão de navegador — múltiplas abas/navegadores contornam) | Médio (quota EmailJS, não financeiro) | `limitRateMs: 30000` no SDK, client-side | Nenhum rate limit server-side possível sem backend | CAPTCHA/backend gate se abuso real for observado | Médio — aceito hoje, sem evidência de abuso ativo |
| Comprometer chave (anon/EmailJS) | Baixa relevância — já são públicas por design | Baixo incremental (não adicionam privilégio além do que já é público) | N/A | N/A | N/A | Nenhum — não há "comprometimento" possível de uma chave já pública |
| Sobrescrever estado inteiro (upsert malicioso substituindo o documento todo) | Baixa-média | Crítico (poderia apagar todas as entradas de um app) | `merge-before-save` no client reduz colisões acidentais entre dispositivos legítimos, mas não impede um upsert malicioso direto | RLS permite upsert completo por `id`, sem validação de shape/tamanho relativo | RPC com validação de shape + WITH CHECK mais restritivo | Alto até implementação; mitigado operacionalmente por `backup.py`/`backup_daily.py` (permitem restaurar) |
| Consumir API maliciosa (ESPN/API-Football/Polymarket comprometidos ou retornando dado malformado) | Baixa-média | Médio | `check_match_is_real()`/`check_result_shape()` em `audit_scoring.py`; dupla confirmação de 20s em `send_result_email.py --auto` (v4.55) antes de aplicar resultado auto-sincronizado | Cobertura de `AbortController`/timeout é parcial (Copa 5/9, CDB2026 0/9 — ver `PROJECT_MEMORY.md` "Limitações") | Completar timeout em todas as chamadas fetch, especialmente CDB2026 | Baixo-médio |

## Fora do escopo deste modelo de ameaça (herdado de `SECURITY.md`)

- Ataques server-side clássicos (não há servidor próprio).
- DDoS contra GitHub Pages/Supabase (fora do controle deste repositório).
- MITM (GitHub Pages força HTTPS; Supabase/EmailJS também).
- Responsabilidade legal — o app é explicitamente informal, entre amigos/família.
