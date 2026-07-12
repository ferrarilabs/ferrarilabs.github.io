# Audit Protocol — Plataforma Bolão

Protocolo formal de auditoria completa, aplicável aos três aplicativos (`bolao/`,
`bolao/br2026/`, `bolao/cdb2026/`). Conteúdo manual pode ser adicionado **fora** do bloco
`AUTO:AUDIT_PROTOCOL` abaixo — o bloco em si é substituído inteiramente a cada revisão formal
deste protocolo.

Ver também: `CLAUDE.md` (quando este protocolo é obrigatório), `docs/bolao/ENGINEERING_STANDARD.md`
(fluxo audit-first passo a passo), `docs/bolao/QA_MASTER_CHECKLIST.md` (checklist executável),
`docs/bolao/PLATFORM_GOVERNANCE.md` (política de auditoria obrigatória),
`docs/bolao/CONSISTENCY_MATRIX.md` (registro vivo de divergências entre apps),
`docs/bolao/DESIGN_SYSTEM.md` (especificação de componentes usada na auditoria de UX).

<!-- AUTO:AUDIT_PROTOCOL:START -->
## Equipe virtual

Toda auditoria completa deve ser conduzida como se fosse realizada por esta equipe, cobrindo
todos os papéis abaixo — não apenas o ponto de vista de engenharia de código:

- Principal Software Engineer
- Senior Frontend Engineer
- Senior Backend Engineer
- QA Lead
- Security Engineer (foco OWASP Top 10)
- UX/UI Designer
- Product Manager
- DevOps Engineer
- Accessibility Specialist
- Mobile Web Specialist

## Objetivo

O objetivo de uma auditoria **não é adicionar funcionalidades**. O objetivo é:

- encontrar problemas;
- identificar regressões;
- avaliar impacto;
- testar consistência entre os aplicativos;
- recomendar patches pequenos;
- impedir que problemas históricos retornem.

## Campos obrigatórios por finding

Todo problema encontrado deve ser reportado com estes 12 campos, nesta ordem:

1. Problema
2. Evidência objetiva
3. Arquivo e linha aproximada
4. Impacto
5. Como reproduzir
6. Severidade
7. Causa raiz provável
8. Correção recomendada
9. Aplicativos afetados
10. Risco de regressão
11. Testes necessários
12. Se a correção deve ser propagada aos demais apps

## Áreas obrigatórias da auditoria

### A. Arquitetura

Verificar: organização; duplicação; funções grandes; código morto; código repetido;
acoplamento; nomes inadequados; divergência entre os três apps; cópias independentes que já
não estão sincronizadas.

### B. Bugs funcionais

Verificar: race conditions; variáveis globais; memory leaks; listeners duplicados;
renderização incorreta; traduções quebradas; estado local e remoto inconsistentes; IDs
duplicados; refresh; troca de idioma; navegação; exclusão; importação; exportação; duas abas;
múltiplos dispositivos; cache antigo; concorrência entre Supabase e localStorage; atualizações
esportivas; polling; resultados; ranking; scoring; bônus; critérios de desempate.

### C. UX e design system

Auditar: alinhamento de botões; alturas; larguras; padding; margin; gaps; border radius;
fontes; peso; contraste; hierarquia; densidade; agrupamento; feedback; mensagens; estados
loading; empty states; disabled; hover; focus; erro; sucesso; posicionamento; overflow;
tabelas; cards; cabeçalhos; navegação; admin; comprovantes; ranking; pagamentos.

Comparar os componentes equivalentes nos três aplicativos contra `docs/bolao/DESIGN_SYSTEM.md`.
Se componentes equivalentes tiverem estilos diferentes sem justificativa, registrar divergência.

### D. QA destrutivo

Tentar mentalmente e, quando possível, automaticamente: clicar rapidamente; duplo clique;
múltiplos submits; trocar idioma durante envio; recarregar; voltar e avançar; abrir duas abas;
apagar localStorage; Supabase indisponível; EmailJS indisponível; API esportiva indisponível;
arquivo CSV inválido; JSON inválido; e-mail inválido; campos vazios; nomes enormes; emojis;
acentos; japonês; HTML injection; script injection; texto enorme; conexão lenta; timeout;
offline; resposta incompleta de API; resposta com campos inesperados.

### E. Segurança

Auditar: XSS; DOM injection; `innerHTML`; `eval`; localStorage; Supabase; RLS; EmailJS;
exposição de password/hash; admin login; admin logout; session timeout; brute force;
enumeration; spoofing; tampering; rate limiting; DoS; console leaks; dados pessoais; CSP;
scripts externos; SRI; URLs; segredos; `service_role`; chaves públicas usadas incorretamente.

### F. Mobile

Testar ou revisar em: iPhone Safari; Android Chrome; Samsung Internet; portrait; landscape;
zoom; teclado aberto; tela de 320px; 375px; 390px; 414px; 768px; sticky buttons; thumb reach;
tabelas; scroll horizontal; safe-area; viewport; autofill.

### G. Desktop

Revisar em: Safari; Chrome; Firefox; 900px; 1200px; 1440px; 1600px; alinhamento; uso da largura
disponível; densidade; legibilidade; navegação; toolbars administrativas.

### H. Performance

Verificar: loops desnecessários; renderizações desnecessárias; listeners repetidos; consultas
DOM repetidas; objetos grandes; funções pesadas; imagens grandes; polling excessivo; cache;
chamadas duplicadas; downloads; reflow; layout shift.

### I. Acessibilidade

Verificar: navegação por Tab; ordem de foco; screen readers; `aria-label`; `aria-live`;
contraste; teclado; focus visible; labels; mensagens de erro; semântica; alt text; tamanho de
alvo de toque; reduced motion.

### J. Consistência cross-app

Comparar `bolao/`, `bolao/br2026/` e `bolao/cdb2026/`. Toda alteração visual, de componente,
acessibilidade, segurança, banco, email, comprovante, PDF, admin, API ou infraestrutura deve
ser auditada nos demais apps. Classificar cada divergência encontrada como:

- `CONSISTENT`
- `INTENTIONALLY_DIFFERENT`
- `MISSING`
- `OUTDATED`
- `NEEDS_REVIEW`
- `CRITICAL_DIVERGENCE`

### K. Produto

Avaliar como usuário leigo: Está claro o próximo passo? Minha mãe conseguiria usar? O que
parece clicável? O que parece quebrado? O que gera dúvida? Há texto técnico demais? Existe
alguma promessa que o sistema não entrega? Existe risco de contestação de resultado ou
pontuação?

## Severidades

- 🔴 **Critical** — perda ou corrupção de dados; scoring/ranking incorreto; segurança
  explorável; entrada não salva; comprovante incorreto; indisponibilidade; alteração indevida
  em produção.
- 🟠 **High** — fluxo principal prejudicado; grave inconsistência cross-app; mobile
  praticamente inutilizável; admin falhando; email/PDF/backup quebrado.
- 🟡 **Medium** — UX confusa; layout inconsistente; falta de feedback; performance
  perceptível; acessibilidade incompleta.
- 🟢 **Low** — cosmética; melhoria de texto; dívida técnica; refinamento não bloqueador.

## Formato do relatório

Todo relatório de auditoria completa deve conter, nesta ordem:

- Executive summary
- Escopo
- Aplicativos auditados
- Versões auditadas
- Evidências e limitações
- Bugs encontrados
- Segurança
- UX
- Consistência visual
- Mobile
- Desktop
- Performance
- Acessibilidade
- Cross-app consistency
- Quick wins
- Melhorias que podem esperar
- Riscos aceitos
- Recomendação de go-live
- Nota geral de 0 a 10
- Resposta explícita: "Você colocaria em produção hoje?"

Cada finding deve usar a tabela:

| ID | Severidade | Área | Problema | Evidência | Impacto | Reprodução | Correção | Apps afetados |
|---|---|---|---|---|---|---|---|---|

## Auditoria não é autorização para implementar

Uma auditoria não deve modificar código automaticamente. Ela deve produzir relatório primeiro.
A implementação só deve acontecer quando:

- o usuário autorizar explicitamente;
- os findings selecionados forem informados;
- houver plano de patch;
- houver rollback;
- houver testes definidos.
<!-- AUTO:AUDIT_PROTOCOL:END -->
