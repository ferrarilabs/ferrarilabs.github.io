# Enumeration Review — Plataforma Bolão

2026-08-02. Método: leitura de código (`i18n.js` para mensagens de erro, funções de lookup em
`app.js` dos 3 apps) + o teste passivo já documentado em `SUPABASE_SECURITY_REVIEW.md`. Nenhuma
enumeração ativa foi feita além da leitura pública normal que o próprio app já faz (o teste com
`id=eq.doesnotexist12345` documentado abaixo é o único "probe" desta seção, e é inofensivo — só
confirma que IDs desconhecidos retornam `[]` sem vazar nada).

## Login admin — não há conta para enumerar

Não há campo de usuário/e-mail no login admin, só uma senha única compartilhada pelos 3 apps
(`adminPasswordHash`). Mensagens de erro (`adminWrongPassword`: "Senha incorreta." na Copa;
"Senha incorreta. {n} tentativa(s) restante(s)." em BR2026/CDB2026) **não habilitam enumeração
de contas**, porque não existe conceito de conta/usuário — só uma senha global. O contador de
tentativas restantes exposto em BR2026/CDB2026 (mas não na Copa) não é um vetor de enumeração de
usuário, é só informação operacional para quem já está tentando logar — risco baixo e já coberto
em `RATE_LIMIT_POLICY.md` (o lockout em si é client-side, não uma defesa real).

## IDs de linha do Supabase (`main`/`br2026`/`cdb2026`)

Os 3 valores de `id` já são **públicos por design** — estão no código-fonte de cada app
(`config.database.stateId`), na documentação (`ARCHITECTURE.md`, `PROJECT_MEMORY.md`), e nos
próprios nomes de pasta (`bolao/copa2026/`, `bolao/br2026/`, `bolao/cdb2026/`). Não há segredo
para "enumerar" aqui — testar `id=eq.doesnotexist12345` (feito nesta auditoria) apenas confirma
que a API responde `[]` para IDs inexistentes, sem diferença de status HTTP ou tamanho de
resposta que ajudaria um atacante a distinguir "existe mas vazio" de "não existe" — não que isso
importe, já que os 3 IDs reais já são conhecidos.

**O achado real não é a enumeração de IDs de linha — é o que ela revela** (ver
`API_RESPONSE_DATA_REVIEW.md`/`SUPABASE_SECURITY_REVIEW.md`): nome civil e quem pagou **são
públicos por leitura**, para qualquer um dos 3 bolões, com a mesma chave anon. Isso é aceito como
decisão de produto ("bolão transparente"), mas deve ficar registrado explicitamente aqui como o
achado que de fato importa nesta seção — não a mecânica de enumeração em si.

## IDs de entrada (`entries[].id`) — UUID, não sequencial

Gerados via `crypto.getRandomValues` (`uuid()` em `app.js`) — não sequenciais, não enumeráveis
por adivinhação. Mas, como toda a lista `entries[]` já vem no mesmo documento público (ver acima),
não há necessidade de "adivinhar" um ID de entrada — todos os IDs de todas as entradas de todos
os 3 apps já estão disponíveis para quem lê a linha.

## Código de comprovante (`receiptCode`) — achado específico

`receiptCode(e)` é calculado como `HASH-<FNV32(entryName + createdAt)>-<data>` (FNV-32, não
criptográfico, documentado como "só identificação" em `ARCHITECTURE.md`). Os 3 apps usam esse
código como um controle de acesso implícito para a funcionalidade "editar minha entrada":

- **Copa**: exige só o código do comprovante (`loadEntryByCode`).
- **BR2026/CDB2026**: exigem e-mail **+** código do comprovante juntos
  (`findEntryByEmailAndCode`) — decisão documentada explicitamente no código-fonte: "o e-mail
  sozinho não é um segredo real" (comentário em `bolao/cdb2026/js/app.js` linha 609).

**Achado desta auditoria**: os dois insumos usados para calcular o código (`entryName` e
`createdAt`) **já fazem parte do mesmo documento JSON público** que qualquer um pode ler com a
chave anon (ver `SUPABASE_SECURITY_REVIEW.md`). Ou seja, para qualquer pessoa que já leu o estado
completo via API direta (não pela UI), o "código de comprovante" de qualquer participante é
**trivialmente recalculável offline** — não é preciso adivinhar nada, os dois insumos do hash já
estão no mesmo payload. O controle de acesso via `receiptCode`/email+código é uma barreira real
contra alguém que só usa a UI pública do site (que nunca expõe `createdAt` na tela), mas **não é
uma barreira real contra alguém com acesso de leitura à API** — que, como já demonstrado, é
qualquer pessoa com a chave anon pública, ou seja, qualquer visitante. Isso não é uma
vulnerabilidade nova e isolada — é uma consequência direta do achado já registrado em
`SUPABASE_SECURITY_REVIEW.md`/`API_RESPONSE_DATA_REVIEW.md`, mas vale destacar aqui porque
explica por que a feature "editar minha entrada com código" não deve ser tratada, em nenhuma
comunicação futura com participantes, como uma proteção equivalente a uma senha real.

## Nomes civis e status de pagamento — public-readable, é o achado que importa

Confirmando explicitamente o que o task pediu para verificar: **sim**, nome civil (`entryName`,
`payerName`) e quem pagou (`paid{}`, `paymentMethod`) são publicamente legíveis com a chave anon
já embutida no bundle, para os 3 apps, sem exigir nenhuma técnica além de uma chamada HTTP
simples. Isso é consistente com o texto de transparência do próprio produto
(`CONFIG.transparency.disclaimer`) e com `SECURITY.md` ("The ranking section shows entry names,
payer names, and payment status publicly — this is by design"). Não é tratado aqui como uma
vulnerabilidade nova — é documentado porque a tarefa pediu confirmação explícita.

## Timing

Não avaliado — nenhum teste de timing foi conduzido (exigiria múltiplas requisições cronometradas
contra produção, o que se aproxima de um teste ativo de enumeração; fora do escopo somente-leitura
desta revisão, e de risco/valor duvidoso dado que não há segredo real por trás de nenhum dos
fluxos acima).

## Recomendações

1. Nunca comunicar o `receiptCode` (ou e-mail+código) como equivalente a uma senha — é uma
   conveniência de UI, não um controle de segurança, dado que os insumos já são públicos via API.
2. Se o modelo de dados evoluir para tabelas separadas (ADR-006), considerar um token de edição
   verdadeiramente aleatório e não recalculável a partir de campos já públicos (ex.: UUID gerado
   e armazenado separadamente, nunca derivado de `entryName`/`createdAt`).
3. Manter mensagens de erro genéricas no login admin (já é o caso) se algum dia um sistema de
   contas reais for adotado.
