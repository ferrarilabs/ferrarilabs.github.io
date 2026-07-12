# Engineering Standard — Plataforma Bolão

Padrão de processo de engenharia para os três aplicativos (`bolao/`, `bolao/br2026/`,
`bolao/cdb2026/`). Conteúdo manual pode ser adicionado **fora** do bloco
`AUTO:ENGINEERING_STANDARD` abaixo — o bloco em si é substituído inteiramente a cada revisão
formal deste padrão.

Ver também: `docs/bolao/AUDIT_PROTOCOL.md` (o que uma auditoria deve cobrir),
`docs/bolao/PLATFORM_GOVERNANCE.md` (classificação de mudanças e política de auditoria),
`docs/bolao/QA_MASTER_CHECKLIST.md` (checklist executável), `docs/bolao/PROJECT_MEMORY.md`
(decisões arquiteturais e limitações conhecidas), `docs/bolao/LESSONS_LEARNED.md` (bugs
históricos e como evitá-los).

<!-- AUTO:ENGINEERING_STANDARD:START -->
## Audit-first workflow

Toda mudança classificada como exigindo auditoria (ver `PLATFORM_GOVERNANCE.md` →
"Mandatory Audit Policy") segue esta ordem, sem pular etapas:

1. Read — ler a documentação obrigatória listada em `CLAUDE.md`.
2. Classify — classificar a mudança (`PLATFORM_SHARED` / `TOURNAMENT_SPECIFIC` / `DATA_ONLY` /
   `SECURITY` / `EMERGENCY_HOTFIX`).
3. Audit — executar a auditoria (completa ou direcionada ao escopo, conforme o tamanho da
   mudança) usando `docs/bolao/AUDIT_PROTOCOL.md`.
4. Report — apresentar os findings antes de tocar em qualquer código.
5. Obtain authorization — esperar autorização explícita do usuário sobre quais findings
   corrigir.
6. Patch minimally — implementar só os itens autorizados, com o menor patch possível.
7. Test — rodar os testes necessários listados no finding.
8. Regression audit — auditoria direcionada pós-implementação, comparando o resultado com os
   findings e requisitos originais.
9. Cross-app comparison — comparar o resultado nos três apps antes de considerar a tarefa
   concluída.
10. Documentation — atualizar changelog(s), `CONSISTENCY_MATRIX.md` e qualquer outro documento
    afetado, no mesmo patch.
11. Rollback confirmation — confirmar que existe um plano de rollback testável para a mudança
    feita.

**Nenhuma tarefa grande pode ser considerada concluída sem uma auditoria pós-implementação
comparando o resultado com os findings e requisitos iniciais.**

## No blind implementation

O Claude nunca deve:

- interpretar "implemente tudo" como autorização para reescrever;
- corrigir findings Low sem necessidade;
- misturar refactor com correção;
- mudar regras ou scoring durante auditoria;
- aplicar alterações de um app aos outros sem verificar diferenças de torneio.
<!-- AUTO:ENGINEERING_STANDARD:END -->
