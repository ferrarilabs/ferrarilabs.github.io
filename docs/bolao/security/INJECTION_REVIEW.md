# Injection Review — Plataforma Bolão

2026-08-02. Método: grep sistemático em `bolao/**/*.py`, `bolao/**/*.js`, `bolao/**/*.html` +
leitura das funções relevantes. Nenhum teste ativo contra produção — casos sintéticos
considerados só por análise estática/leitura de código.

## SQL injection

Não há SQL customizado em nenhum lugar do repositório. Toda persistência passa pela Data API
(PostgREST) do Supabase via filtros de query string (`?id=eq.main`), nunca por SQL montado como
string. Não há `.sql` de aplicação neste repo (só o SQL documentado em Markdown para colar
manualmente no SQL Editor do Supabase — `bolao/copa2026/docs/DATABASE_SETUP_SUPABASE.md`).
Busca por `format(`, `%s` com concatenação de query, `rpc(` (nenhuma RPC customizada existe),
`security definer`: **nenhuma ocorrência** em `.py`/`.js` do repo.

**Conclusão: SQL injection não é uma superfície de ataque real nesta plataforma hoje** — não
porque as entradas sejam sanitizadas, mas porque não existe SQL dinâmico para injetar. Se uma
RPC/Edge Function customizada for adicionada no futuro (ADR-006), essa análise precisará ser
refeita.

## NoSQL injection

Não aplicável — não há banco NoSQL na plataforma (Supabase é Postgres/PostgREST).

## Command injection

Verificado todo uso de `subprocess`/`os.system`/`os.popen` em `bolao/copa2026/scripts/*.py`
(único diretório com scripts que usam `subprocess`; `br2026`/`cdb2026` não usam):

| Arquivo | Chamada | Shell=True? | Entrada não confiável? | Risco |
|---|---|---|---|---|
| `backup.py` | `subprocess.check_output(["git","rev-parse","--short","HEAD"])`, `subprocess.check_call(["git","tag",...])`, `subprocess.check_call(["git","push","origin",tag])` | Não (lista de args) | `label`/`tag` vêm de argumento de linha de comando controlado pelo próprio operador (cron/admin), não de dado de participante/API externa | Baixo |
| `reopen_after_r32.py` | `subprocess.run(cmd, ...)` sobre uma lista fixa de comandos `git` predefinidos | Não | Comandos fixos no código-fonte, não construídos a partir de dado externo | Baixo |
| `backup_watch_m88.py` | `subprocess.call([sys.executable, SCRIPT_DIR, "--label", "post-m88"])` | Não | Argumentos fixos | Baixo |

**Nenhum uso de `shell=True` ou concatenação de string em comando** foi encontrado. Todos os
`subprocess` usam a forma de lista (argv), que não passa por um shell e não é vulnerável a
injeção de metacaracteres mesmo se um argumento fosse dado externo (não é o caso aqui).
Conclusão: **sem risco confirmado de command injection.**

## CSV / formula injection — verificado e já mitigado

Os três apps exportam CSV com dados de participante (`entryName`, `payerName`, etc.) — um campo
começando com `=`, `+`, `-`, `@` (ou tab/CR) pode ser interpretado como fórmula pelo Excel/Sheets
ao abrir o arquivo exportado. **Já mitigado nos 3 apps** via `csvEscape()`:

```js
// bolao/br2026/js/app.js (idêntico em copa2026 e cdb2026, mesmo padrão de plataforma)
const csvEscape = v => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
};
```

Confirmado presente e usado em `bolao/copa2026/js/app.js` (linha 2399, usado nas linhas
2411-2412), `bolao/br2026/js/app.js` (linha 17), e `bolao/cdb2026/js/app.js` (linha 23, usado na
linha 3653). **Nenhum gap encontrado** — os três apps aplicam o mesmo padrão de forma consistente.

## HTML injection / DOM XSS

Ver `docs/bolao/security/SECURITY_ASSESSMENT_REPORT.md` seção "XSS e front-end" para o
detalhamento completo. Resumo: `escapeHtml()`/`esc()` cobre todo caminho dado→DOM identificado
nos 3 apps de dinheiro real (Copa, BR2026, CDB2026); nenhum `eval()`/`new Function()`/
`document.write` em lugar nenhum. Um gap **não-runtime** foi encontrado em
`bolao/loterias/powerball/js/app.js` (linhas 91-101: `p.name` interpolado em `innerHTML` sem
escaping) — mas `p.name` vem de `bolao/loterias/powerball/js/data.js`, uma lista de participantes
**hardcoded no código-fonte pelo próprio Eduardo**, sem nenhum formulário público de submissão
(`grep` por `<form>`/`<input type="text">` em `index.html` desse app não encontrou nenhum). Risco
real: baixíssimo (só quem já tem acesso de escrita ao repositório poderia injetar algo ali, e
essa pessoa já tem controle total do site de qualquer forma) — mas é uma inconsistência de padrão
em relação aos outros três apps, que vale corrigir por disciplina/consistência, não por urgência.

## Header injection (e-mail)

`emailSubjectSafe(s)` (idêntica nos 3 apps) só substitui `/` por `-`
(`s.replace(/\//g, "-")`) — motivada por um bug real de encoding observado por Eduardo
(2026-07-24), não por header injection. **Não remove `\r`/`\n`** de `entryName` antes de compor o
assunto do e-mail. O corpo do e-mail (`html_message`) é interpolado no template EmailJS com
`{{{}}}` (raw, mas já passou por `escapeHtml()`/`esc()` no `receiptHtml()`); o **assunto**
(`entry_name`) é interpolado com `{{}}` (o próprio EmailJS aplica HTML-escaping nesse campo,
conforme o comentário do código-fonte confirma: "/" vira "&#x2F;" e nunca decodifica de volta).

**Avaliação honesta**: não foi possível confirmar, por análise estática deste repositório, se o
motor de template do EmailJS (serviço de terceiro, fora deste código) também neutraliza `\r`/`\n`
dentro do campo de assunto antes de montar o header SMTP real — isso depende do comportamento
interno do provedor EmailJS, que não é código deste repositório e não pode ser verificado sem uma
chamada de escrita real (fora do escopo desta auditoria). Classificação: **risco baixo, não
totalmente descartável por análise estática** — recomenda-se, como hardening barato, estender
`emailSubjectSafe()` para também remover `\r`/`\n` (`replace(/[\r\n\/]/g, m => m === "/" ? "-" :
" ")`), já que `entryName` é texto livre controlado por quem submete o formulário.

## Log injection

Não há sistema de log centralizado (é um site estático + GitHub Actions cron rodando scripts
Python que imprimem em `stdout`, capturado pelos logs do próprio GitHub Actions). `print(f"...")`
com dado de participante interpolado (ex. em `send_result_email.py`) poderia, em teoria, incluir
caracteres de controle no log de execução do Actions — impacto muito baixo (logs do Actions não
são renderizados como HTML/terminal interativo compartilhado, e não há SIEM/parser downstream
neste repo). Não classificado como risco relevante.

## Path traversal

Não há endpoint que aceite um caminho de arquivo como entrada de usuário. Todos os `open(...)` em
`scripts/*.py` usam caminhos fixos relativos ao próprio script (verificado por grep — nenhuma
concatenação de caminho a partir de argumento externo/API). Não aplicável.

## Template injection

Não há motor de template server-side neste repo (EmailJS faz sua própria renderização de
template do lado do provedor, fora deste código). O único "template" gerado localmente é
`receiptHtml()`, que monta uma string HTML manualmente com `escapeHtml()` aplicado a todo dado de
usuário antes da interpolação — não é um motor de template genérico (tipo Jinja2/Handlebars) que
avaliaria expressões, então SSTI clássico não se aplica.

## Resumo

| Categoria | Aplicável? | Achado |
|---|---|---|
| SQL injection | Não (sem SQL dinâmico) | Nenhum |
| NoSQL injection | Não | N/A |
| Command injection | Sim, verificado | Nenhum — todo `subprocess` usa forma de lista, sem `shell=True` |
| CSV/formula injection | Sim, verificado | **Já mitigado** nos 3 apps (`csvEscape()`) |
| DOM XSS / HTML injection | Sim, verificado | Nenhum gap runtime nos 3 apps de dinheiro real; 1 gap não-runtime em `loterias/powerball` (dado hardcoded, não input real) |
| Header injection (e-mail) | Parcial | Mitigação incompleta (`/` mas não `\r\n`) para o campo de assunto; depende também do EmailJS (terceiro, não verificável) |
| Log injection | Sim, revisado | Impacto irrelevante (sem log estruturado/downstream) |
| Path traversal | Não (sem input de caminho) | N/A |
| Template injection | Não (sem motor de template server-side) | N/A |
