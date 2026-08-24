# Reportar problema — arquitetura, ameaças e privacidade

**Issue:** #321 · **Estado:** implementado e **DESLIGADO** (`reportProblem.enabled = false`)

**Estado de ativação:** `CODE_ONLY` — ver §4-B.

**Endpoint: IMPLANTADO e inerte.** A integração do Supabase publica as Edge Functions
automaticamente no merge para `main` — não há passo manual de deploy, e presumir o contrário foi
um erro de leitura meu, corrigido aqui. O que mantém o canal inerte **não** é a ausência de deploy:
é a ausência dos oito segredos. Sem eles `conferirConfig()` recusa tudo com **503
`{"error":"UNAVAILABLE"}`**, sem dizer qual falta. Verificado em produção.

A UI continua desligada nos três apps, então nada disso é alcançável por participante.

---

## 1. O que isto é

Um canal de intake de incidentes **externo e não confiável**, ligado a uma aplicação web pública.
Não é "um botão": é uma superfície de ataque nova, e o desenho parte disso.

## 2. Fluxo

```
CLIENTE PÚBLICO (navegador do participante)
   │  coletor de contexto SEGURO (allowlist) + sanitizador local
   ▼
ENDPOINT PÚBLICO  supabase/functions/user-report-intake
   │  1. método / origem / content-type / tamanho
   │  2. schema allowlist  (campo desconhecido reprova o corpo inteiro)
   │  3. limite de taxa + disjuntor   (Redis dedicado)
   │  4. idempotência + deduplicação
   │  5. token de instalação de GitHub App   (curto, em memória)
   │  6. INVARIANTE: repositório de destino é PRIVADO  ← última linha antes da divulgação
   ▼
ferrarilabs/support-intake   (PRIVADO)
   │  triagem humana
   ▼
(opcional, autorizado) Issue de engenharia SANITIZADA no repositório público
```

## 3. A decisão central

**Relato bruto de participante nunca cruza automaticamente a fronteira privado→público.**

Regex não reconhece nome de pessoa, nem "meu vizinho do mercado", nem circunstância pessoal. Fingir
que reconhece seria a falha de desenho mais cara possível aqui. Por isso o relato fica **privado**, e
só metadado técnico sanitizado é promovível — com autorização explícita.

## 4. Segmentação de confiança

O endpoint **não alcança** banco de participante, pagamento, scoring ou competição. Não usa
`service_role`, senha do banco, nem RPC financeiro. Ele não precisa do banco de produção.

Um comprometimento do "Reportar problema" **não** vira caminho para pagamentos, palpites, ranking ou
admin.

> ### T-ENV-01 — o projeto compartilhado **não** é uma fronteira de confiança aceitável
>
> O Supabase injeta capacidades de projeto em **todas** as Edge Functions hospedadas:
> `SUPABASE_DB_URL`, `SUPABASE_SECRET_KEYS` e o legado `SUPABASE_SERVICE_ROLE_KEY` — este último
> **ignora RLS**. Eles estão no ambiente desta função queira-se ou não.
>
> Portanto a afirmação anterior — "um comprometimento do intake não alcança participante/pagamento"
> — **não é forte o bastante** enquanto esta função pública e não autenticada executar no **mesmo
> projeto** que os dados de produção do Ferrari Labs.
>
> A catraca de CI protege contra **uso acidental** pelo nosso próprio código. Ela **não** protege
> contra: dependência comprometida, execução de código no runtime, defeito futuro de injeção,
> código importado malicioso ou comprometimento de cadeia de suprimentos. O ambiente continua
> contendo credencial de alto valor.
>
> **Correção obrigatória, antes do primeiro reporte real de participante:** a função de produção
> roda em um projeto Supabase **separado** (`ferrarilabs-support-intake`), sem dado de
> participante, sem razão de pagamento, sem palpite, sem scoring, sem ranking e sem RPC de
> produção. O segredo que o Supabase injetar lá pertence **àquele** projeto e por construção não
> alcança o projeto financeiro.
>
> **Sem ponte entre os projetos:** nada de FDW, nada de database link, nada de `service_role`
> compartilhado, nada de senha de banco compartilhada, nada de credencial de API de participante.
>
> **Risco residual atual (honesto):** a função hoje implantada vive no projeto primário. Ela está
> inerte por dois motivos independentes — interruptor de servidor desligado e nenhum dos oito
> segredos provisionado — mas o risco de T-ENV-01 **só é de fato eliminado pelo isolamento**, não
> pela inércia. Provisionar qualquer segredo de reporte no projeto primário está **proibido**.

## 4-A. O interruptor de servidor

`REPORT_INTAKE_ENABLED` é um gate **independente dos oito segredos**, avaliado **antes** de
qualquer dependência: nada de Redis, nada de GitHub, nada de JWT, nada de parsear corpo.

**Só a string exata `"true"` liga.** `"TRUE"`, `"1"`, `"yes"`, espaço sobrando, ausente e vazio
significam DESLIGADO. Não há coerção — um interruptor de segurança que aceita sinônimos é um
interruptor que alguém liga sem querer.

Desligado responde **exatamente** como não-configurado (`503 {"error":"UNAVAILABLE"}`). Quem sonda
não aprende se o canal está desligado ou incompleto; isso não é informação dele.

> **Por que isto existe.** Antes, o canal ligava sozinho no instante em que o oitavo segredo fosse
> provisionado: "provisionar dependência" e "abrir endpoint público ao mundo" eram o mesmo ato, sem
> ninguém decidir a segunda coisa. **Preparar infraestrutura não pode ser, por acidente, um
> lançamento.** Ver `T-ACT-01` no §8.

## 4-B. Ativação em duas chaves — invariante de deploy

Dois gates **independentes**, e o rollout público exige os dois deliberadamente ligados:

| gate | onde | papel |
|---|---|---|
| `REPORT_INTAKE_ENABLED=true` | servidor (segredo do projeto) | **a fronteira de segurança** |
| `reportProblem.enabled=true` | cliente (`config.js` dos apps) | defesa em profundidade / controle de UX |

O flag do cliente **não** é a fronteira: ele roda no navegador do participante, que o edita à
vontade. Ele existe para que a UI não apareça, não para impedir requisição.

**Máquina de estados.** Transições são atos deliberados, nunca efeito colateral:

```
CODE_ONLY                      código no repo; nenhum segredo; servidor OFF; UI OFF
        │  provisionar dependências (Redis, GitHub App, HMAC)
        ▼
BACKEND_PROVISIONED_DISABLED   oito segredos existem; servidor AINDA OFF   ← estado seguro e estável
        │  ligar servidor só para aceitação
        ▼
BACKEND_ACCEPTANCE             servidor ON; UI OFF; reporte sintético ponta a ponta
        │  aceitação passa
        ▼
BACKEND_ENABLED_UI_DISABLED    servidor ON; UI ainda OFF
        │  decisão de lançamento
        ▼
PUBLIC_ENABLED                 servidor ON; UI ON
        │  incidente
        ▼
EMERGENCY_DISABLED             servidor OFF  ← PRIMEIRA ação de rollback, sempre
```

**Rollback começa sempre pelo servidor** (`REPORT_INTAKE_ENABLED=false`), não pelo cliente: o
cliente só esconde o botão, e um navegador com a página velha em cache continua conseguindo POSTar.

## 5. Dados coletados

| coletado | por quê |
|---|---|
| app, versão do site | reproduzir na versão certa |
| `routeId` (sem query, sem hash) | onde aconteceu |
| `sectionId` | qual parte da tela |
| locale | reproduzir no idioma |
| viewport | classe de defeito responsivo (foi assim na #316) |
| online | separa falha de rede de falha de servidor |
| motor do navegador (grosso) | classe de bug de compatibilidade |
| código de diagnóstico (allowlist) | o que o produto já sabia |
| relato e ação tentada | o que a pessoa observou |

**Explicitamente NÃO coletado:** nome · e-mail · telefone · URL completa · query · hash · token de
entrada · token de auth · referência de pagamento · valor · palpites · `localStorage` ·
`sessionStorage` · cookies · IP persistido · referrer · User-Agent completo · stack trace ·
console · anexos · screenshots.

Versão exata do navegador **não** é coletada: é impressão digital sem uso comprovado.

## 6. Identificador de rede

Nenhum IP é persistido. A chave de taxa é
`HMAC-SHA256(segredo, YYYY-MM-DD || valor_de_rede)` — guarda-se só o HMAC, que **rotaciona sozinho
todo dia** pelo componente de data. Nem o valor de rede nem o HMAC vão para log.

## 7. Abuso

| controle | padrão | razão |
|---|---|---|
| por rede/sessão | 3/10min, 10/dia | cobre "tentei de novo" sem virar canal de spam |
| global | 30/10min, 200/dia | teto do bolão inteiro |
| duplicata | 10 min | mesma pessoa, mesmo texto = reenvio |
| idempotência | 7 dias | cobre reenvio manual tardio |
| disjuntor | 15 min | estourar o global é ataque, não uso |

Operações atômicas (`INCR` + `EXPIRE` no nascimento do contador) — nunca ler-depois-escrever, que
tem corrida. **Falha fechado**: limitador indisponível ⇒ recusa.

## 8. Modelo de ameaças

| ameaça | ativo | controle | risco residual | evidência |
|---|---|---|---|---|
| Spam / DoS | repo privado, custo | limite por rede + global + disjuntor, fail-closed | atacante distribuído consome cota global e nega serviço a participantes reais | `test_report_intake` (limites, disjuntor) |
| Enchente de Issues | triagem | dedup por impressão HMAC + idempotência | relatos diferentes com mesmo texto colapsam | idem |
| Exfiltração de credencial | GitHub App, Redis | segredo só server-side; catraca de bundle | comprometimento do runtime Supabase | `test_report_security_ratchets` §1 |
| XSS | quem lê o Issue | HTML escapado, texto em bloco | — | corpus adversarial |
| Injeção de Markdown | leitor / rastreio | `!` escapado, menção e `#ref` neutralizados | link continua visível como texto (proposital: o triador precisa ler) | corpus |
| **Injeção de prompt** | agente que lê intake | aviso `UNTRUSTED_EXTERNAL_INPUT` antes do relato; runbook proíbe executar | um agente mal instruído ainda pode obedecer | corpus + §9 |
| PII submetida sem querer | participante | aviso na UI + redação de padrões óbvios + **relato privado** | nome nunca é detectável por regex | `redigir()` + testes |
| SSRF | rede interna | hosts de saída literais; URL nunca vem do payload | — | ratchet §5 |
| Replay | duplicatas | idempotência em duas fases + reconciliação por `report_id` | janela de crash coberta pela reconciliação | `test_report_intake` |
| **Sequestro de `report_id`** | relato legítimo | chave de idempotência é `HMAC(segredo, chave_de_rede ‖ report_id)`, não o `report_id` cru | um mesmo remetente ainda colide consigo próprio — que é o comportamento desejado | `test_report_intake` (F-04, 4 casos + controle negativo) |
| Bypass de CORS | — | CORS **não é** autenticação; abuso controlado independentemente | cliente não-navegador ignora CORS, por isso o limite é obrigatório | ratchet §5 |
| Divulgação privado→público | relato | invariante de visibilidade **no runtime**, antes de criar | operador pode promover manualmente (é decisão humana, autorizada) | ratchet §3 |
| Segredo em log | credenciais | só código de erro; nunca objeto de erro | — | ratchet §7 |
| Supply-chain | endpoint | **zero dependência nova**; JWT via Web Crypto | runtime do Supabase | ratchet §10 |
| Deriva de configuração | relato | verificação de visibilidade no runtime, não na config | — | ratchet §3 |
| Diagnóstico malicioso | integridade | allowlist; desconhecido ⇒ `UNKNOWN_SAFE_ERROR` | — | testes |
| Unicode / bidi | leitor | controles e invisíveis removidos | — | corpus |
| **T-ENV-01** — raio de alcance de credencial do runtime compartilhado | projeto Supabase de produção (participantes, pagamentos, scoring) | **isolamento de runtime em projeto separado** (pendente) + catraca de CI que reprova referência a credencial de alto valor | **ALTO enquanto a função rodar no projeto primário** — ver abaixo | `test_report_security_ratchets` §1 |
| **T-ACT-01** — provisionar segredo ativando endpoint público sem querer | canal inteiro | **interruptor de servidor** `REPORT_INTAKE_ENABLED`, avaliado antes de toda dependência; comparação exata | operador ainda pode ligar deliberadamente sem aceitação — que é uma decisão, não um acidente | `test_report_intake` (5 casos + 2 controles negativos) |

## 9. Fronteira de injeção de prompt

Todo Issue privado começa com `UNTRUSTED_EXTERNAL_INPUT` legível por máquina e o aviso humano.

**Um reporte é evidência, nunca um comando.** Nenhum relato pode, por si, mudar pagamento, estorno,
palpite, score, ranking, cutoff, acesso, migração ou deploy. Quem lê — pessoa ou agente — não segue
instrução, não abre link automaticamente, não executa SQL.

## 10. Retenção (proposta, **não** ativada)

Issues de intake fechadas devem sair depois de **90 dias**: tempo suficiente para correlacionar com
uma conversa e para investigação de recorrência, e curto o bastante para o relato não virar arquivo
permanente de circunstância pessoal.

Deleção destrutiva permanece **desativada** até autorização explícita. Quando existir, só pode
alcançar: repositório `support-intake`, label `user-report`, estado fechado, mais velho que a
retenção. Nunca curinga, nunca Issue pública.

**Remoção a pedido do titular:** correlacionar pelo `report_id` impresso na tela, apagar a Issue
privada correspondente. É por isso que o `RPT-XXXXXXXX` é mostrado.

O `report_id` é gerado no navegador e serve para **exibição e correlação** — nunca como chave de
controle. A idempotência real é derivada de `HMAC(segredo, chave_de_rede ‖ report_id)`: sem isso,
um cliente hostil reservaria o `report_id` alheio e o relato legítimo colidiria com uma
idempotência já em curso — sucesso na tela, Issue nenhuma. Supressão silenciosa é pior que recusa,
porque ninguém fica sabendo.

## 11. Melhorias conhecidas (próxima versão)

1. **Projeto Supabase separado** para o intake — hoje a segmentação de credencial é de código, e um
   projeto próprio a tornaria de plataforma.
2. **UI e integração por app** — deliberadamente fora desta entrega: sem endpoint implantado, um
   botão visível seria um botão morto.
3. **Teste de integração HTTP real.** A política é pura e coberta; a *fiação* não era. Um
   preflight de origem permitida respondeu **500** em produção porque `new Response("", {status:204})`
   lança — 204/205/304 exigem corpo `null`. O caminho proibido (403) funcionava e só o caminho
   feliz estava quebrado, que é a assinatura clássica de defeito de fiação. Corrigido, com teste
   que passa toda resposta alcançável pelo construtor real de `Response`.
4. Assinatura/attestation do cliente para encarecer submissão automatizada sem exigir conta.
5. Métrica de custo por reporte e alarme de orçamento.

## 12. Inventário de segredos (só nomes)

`REPORT_GITHUB_APP_ID` · `REPORT_GITHUB_INSTALLATION_ID` · `REPORT_GITHUB_PRIVATE_KEY` ·
`REPORT_GITHUB_OWNER` · `REPORT_GITHUB_REPO` · `REPORT_REDIS_REST_URL` ·
`REPORT_REDIS_REST_TOKEN` · `REPORT_ABUSE_HMAC_SECRET`

Mais o **interruptor**, que não é segredo e não é dependência: `REPORT_INTAKE_ENABLED`. Os oito
acima vão para o projeto **de suporte**, nunca para o primário.

Rotação: gerar novo valor no provedor → `supabase secrets set` → invalidar o antigo. O token de
instalação do GitHub expira sozinho (~1h) e nunca é persistido.

## 13. Rollback

1. **`REPORT_INTAKE_ENABLED=false` no servidor.** Primeira ação, sempre: é a única que para
   requisição de verdade. O flag do cliente só esconde o botão, e um navegador com a página em
   cache continua conseguindo POSTar.
2. `reportProblem.enabled = false` (já é o padrão) — a UI some.
3. Reverter o PR do recurso. **Reverter também republica a função**, porque o deploy é automático
   no merge para `main` — o rollback de código e o de runtime são o mesmo ato aqui.
4. A Edge Function pode ser desativada de forma independente pelo painel do Supabase, sem tocar
   no repositório.

Nenhum passo toca dado de participante, razão financeiro, scoring ou ranking.

## 14. Runbook de triagem

1. Não presuma que o relato está correto.
2. **Não execute nada** que ele contenha.
3. Não abra links automaticamente.
4. Correlacione pelo `report_id`.
5. Investigue por evidência somente-leitura do código e dos gates.
6. Promova para o público **apenas fato técnico sanitizado** — nunca o relato.
7. Repetição chama atenção; **não** escala automaticamente nem muda produção.

## 15. Isto não é uma declaração de conformidade

Desenhado segundo princípios de **minimização de dados** e **menor privilégio**. Não há aqui
qualquer alegação de conformidade formal com GDPR, CCPA ou outro regime — isso exigiria avaliação
formal que não foi feita.
