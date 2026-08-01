# CDB2026 — Backup and Recovery

**Gerado:** 2026-08, Fase 2, item 16 (§23 do mega-prompt).
**Escopo:** o único dado que importa recuperar é o estado (`bolao_state`, `id='cdb2026'`) —
entradas, palpites, pagamentos, resultados.

## Mecanismos de backup existentes

### 1. `exportJsonBackup()` — backup manual pelo admin (`app.js:3311`)

Baixa o estado completo como um arquivo `.json` local. É o único backup "oficial" do app —
depende de um humano lembrar de rodar e guardar o arquivo em algum lugar seguro. **Sem
agendamento automático.**

### 2. Réplica local-first (cada navegador tem uma cópia)

Todo navegador que já usou o app tem uma cópia completa do estado em `localStorage`. Isso é, na
prática, um backup distribuído acidental — se o Supabase perder dados, qualquer navegador ainda
logado com um estado recente pode, em teoria, "restaurar" o Supabase salvando de novo (mas isso
sobrescreveria com uma versão possivelmente desatualizada — não é um procedimento seguro sem
comparar timestamps primeiro).

### 3. `git log` / GitHub Pages

O CÓDIGO tem backup completo (histórico do Git). Os DADOS (entradas, palpites) não — eles vivem
só no Supabase + nos `localStorage`s dos navegadores, nunca commitados no repositório (e não
deveriam ser — são dados pessoais reais).

## O que NÃO existe (testado e confirmado ausente, não assumido)

- **Backup automático agendado do Supabase.** Não há nenhuma rotina (`cron`, Supabase scheduled
  function, etc.) que exporte a linha `bolao_state` periodicamente. Confirmado por ausência de
  qualquer script de agendamento no repositório e por não haver menção em
  `bolao/cdb2026/docs/DATABASE_SETUP_SUPABASE.md` além do point-in-time recovery padrão do
  Supabase (que é do provedor, não do app).
- **Teste de restauração.** Nenhum procedimento documentado ou script testa "pegar um backup e
  restaurá-lo" de ponta a ponta antes desta modernização.

## Procedimento de backup manual recomendado (documentado aqui, não automatizado)

Antes de qualquer operação de risco (ex. `clearAllData()`, uma migração de dados, uma mudança de
scoring autorizada):

1. Admin roda `exportJsonBackup()` na UI (Admin → Exportar backup).
2. **Ou**, para quem tem acesso à `anon key` (qualquer pessoa, ela é pública) e quer um backup
   read-only via linha de comando:
   ```bash
   curl -s "https://cmhqkkfczotdnssupkni.supabase.co/rest/v1/bolao_state?id=eq.cdb2026&select=state" \
     -H "apikey: <anon key de config.js>" \
     -H "Authorization: Bearer <anon key de config.js>" \
     -o backup_$(date +%Y%m%dT%H%M%S).json
   ```
   Este é exatamente o padrão usado nesta sessão para o backup antes da renomeação das entradas
   do REDACTED_PARTICIPANT (2026-08-01) — leitura pura, sem escrita, sem `service_role`.
3. Guardar o arquivo fora do repositório (nunca commitar — contém e-mails e nomes reais).
4. **Nunca reter o arquivo além do necessário** — se guardado em `/tmp` ou scratchpad de uma
   sessão de agente, ele é efêmero por design; não tratar isso como um backup duradouro (ver
   nota abaixo).

## Restauração (procedimento manual, não automatizado)

1. Confirmar que o arquivo de backup é o estado correto (checar `meta.updatedAt` dentro do JSON).
2. Validar sua integridade ANTES de restaurar:
   ```bash
   python3 bolao/cdb2026/scripts/audit_integrity.py --file backup.json --min-level ERROR
   ```
   Se retornar `CRITICAL`, **não restaurar sem investigar primeiro** — o backup pode já estar
   corrompido.
3. Escrever de volta via o mesmo padrão `POST .../rest/v1/bolao_state` com
   `Prefer: resolution=merge-duplicates` que o app usa (`saveRemoteState()`), com `id: "cdb2026"`
   e o `state` do backup como body.
4. Confirmar com uma leitura de verificação (mesmo padrão do passo de backup) que a escrita
   surtiu efeito.

Este é o mesmo padrão de "ler → validar → escrever → verificar" já usado nesta sessão para a
única escrita de produção real feita durante esta auditoria/modernização (renomeação de duas
entradas, autorizada explicitamente por Eduardo, fora do escopo de scoring/regras).

## Sobre o backup feito durante a sessão de 2026-08-01 (renomeação REDACTED_PARTICIPANT)

Um backup foi salvo no diretório de scratchpad da sessão do agente antes da escrita autorizada.
Por instrução explícita do usuário, este documento **não** lista caminho, tamanho ou conteúdo
desse backup além do que já foi reportado no chat da sessão (data da captura, tamanho, hash
SHA-256, resultado da leitura de verificação) — o diretório de scratchpad é efêmero por design
da plataforma e não deve ser tratado como um local de retenção; se a sessão que o criou não
estiver mais ativa, o arquivo deve ser considerado não mais disponível.

## Recomendação (não implementada)

Um backup automatizado periódico (ex. uma Supabase Edge Function agendada, ou um workflow do
GitHub Actions rodando o `curl` acima e commitando — criptografado — para um local seguro fora
do repositório público) eliminaria a dependência de um humano lembrar de rodar
`exportJsonBackup()`. Fora do escopo desta modernização (nova infraestrutura, não um patch
cirúrgico) — registrado para decisão futura.
