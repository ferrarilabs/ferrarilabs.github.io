# Fix Log — v4.2-patch (2026-06-27)

Patch cirúrgico sobre v4.1-patch. Nenhuma função global adicionada fora do IIFE.

---

## js/config.js

### siteVersion bump
`"v4.1-patch"` → `"v4.2-patch"` (linha 2).

### Supabase — sem alteração
Já estava `enabled: true` com credenciais corretas. Confirmado, sem modificação necessária.

---

## js/data.js

### updatedLabel (linha 1)

**Antes:** `"Atualizado até Jun 27. Horários exibidos em ET (Eastern Time)."`
**Depois:** `"Atualizado até Jun 27. Estádios e horários ET adicionados à fase eliminatória."`

---

### knockoutMatches — M74 (linha 110)

**Corrigido:** `timeET:"12:00 (EDT)"` → `timeET:"13:00 (EDT)"`
Fonte: NBC Sports (kickoff 1pm ET, NRG Stadium Houston).

---

### knockoutMatches — M75–M88 (linhas 111–124)

Todos os 14 jogos trocados de `timeET:"",venue:"A confirmar"` para o estádio e horário corretos:

| Match | Data | Horário EDT | Estádio |
|---|---|---|---|
| 75 | Jun 29 | 16:30 | Gillette Stadium, Foxborough / Boston, USA |
| 76 | Jun 29 | 21:00 | Estadio BBVA, Monterrey, Mexico |
| 77 | Jun 30 | 13:00 | AT&T Stadium, Arlington / Dallas, USA |
| 78 | Jun 30 | 17:00 | MetLife Stadium, East Rutherford, USA |
| 79 | Jun 30 | 21:00 | Estadio Azteca, Mexico City, Mexico |
| 80 | Jul 1  | 12:00 | Mercedes-Benz Stadium, Atlanta, USA |
| 81 | Jul 1  | 16:00 | Lumen Field, Seattle, USA |
| 82 | Jul 1  | 20:00 | Levi's Stadium, Santa Clara / San Francisco, USA |
| 83 | Jul 2  | 15:00 | SoFi Stadium, Inglewood / Los Angeles, USA |
| 84 | Jul 2  | 19:00 | BMO Field, Toronto, Canada |
| 85 | Jul 2  | 23:00 | BC Place, Vancouver, Canada |
| 86 | Jul 3  | 14:00 | AT&T Stadium, Arlington / Dallas, USA |
| 87 | Jul 3  | 18:00 | Hard Rock Stadium, Miami Gardens / Miami, USA |
| 88 | Jul 3  | 21:30 | Arrowhead Stadium, Kansas City, USA |

---

### knockoutMatches — M89–M96 (linhas 125–132)

Oitavas de final, todos com `venue:"A confirmar"` → preenchido:

| Match | Data | Horário EDT | Estádio |
|---|---|---|---|
| 89 | Jul 4 | 13:00 | NRG Stadium, Houston, USA |
| 90 | Jul 4 | 17:00 | Lincoln Financial Field, Philadelphia, USA |
| 91 | Jul 5 | 16:00 | MetLife Stadium, East Rutherford, USA |
| 92 | Jul 5 | 20:00 | Estadio Azteca, Mexico City, Mexico |
| 93 | Jul 6 | 15:00 | AT&T Stadium, Arlington / Dallas, USA |
| 94 | Jul 6 | 20:00 | Lumen Field, Seattle, USA |
| 95 | Jul 7 | 12:00 | Mercedes-Benz Stadium, Atlanta, USA |
| 96 | Jul 7 | 16:00 | BC Place, Vancouver, Canada |

---

### knockoutMatches — M97–M100 (linhas 133–136)

Quartas de final:

| Match | Data | Horário EDT | Estádio |
|---|---|---|---|
| 97 | Jul 9  | 16:00 | Gillette Stadium, Foxborough / Boston, USA |
| 98 | Jul 10 | 15:00 | SoFi Stadium, Inglewood / Los Angeles, USA |
| 99 | Jul 11 | 17:00 | Hard Rock Stadium, Miami Gardens / Miami, USA |
| 100 | Jul 11 | 21:00 | Arrowhead Stadium, Kansas City, USA |

---

### knockoutMatches — M101–M104 (linhas 137–140)

| Match | Fase | Data | Horário EDT | Estádio |
|---|---|---|---|---|
| 101 | Semifinal | Jul 14 | 15:00 | AT&T Stadium, Arlington / Dallas, USA |
| 102 | Semifinal | Jul 15 | 15:00 | Mercedes-Benz Stadium, Atlanta, USA |
| 103 | 3º Lugar | Jul 18 | 17:00 | Hard Rock Stadium, Miami Gardens / Miami, USA |
| 104 | Final | Jul 19 | 15:00 | MetLife Stadium, East Rutherford, USA |

M104 já tinha venue correto. Apenas `timeET` adicionado.

---

## js/i18n.js

### 12 novas chaves de comprovante — todos os 3 idiomas

Adicionadas após `receiptRuleText` em cada bloco de idioma:

| Chave | pt-BR | es | en-US |
|---|---|---|---|
| receiptLegendTitle | Legenda de pontuação | Leyenda de puntuación | Scoring legend |
| receiptLegendExact | Placar exato: 10 pts | Marcador exacto: 10 pts | Exact score: 10 pts |
| receiptLegendAdvance | Quem avança: 5 pts | Quién avanza: 5 pts | Correct advancement: 5 pts |
| receiptLegendOneTeam | Gols de um time: 1 pt | Goles de un equipo: 1 pt | One team's goals: 1 pt |
| receiptLegendChampion | Bônus campeão: 25 pts | Bono campeón: 25 pts | Bonus champion: 25 pts |
| receiptLegendRunnerUp | Bônus vice: 15 pts | Bono subcampeón: 15 pts | Bonus runner-up: 15 pts |
| receiptLegendThird | Bônus 3º lugar: 10 pts | Bono 3er lugar: 10 pts | Bonus 3rd place: 10 pts |
| receiptLegendFourth | Bônus 4º lugar: 5 pts | Bono 4to lugar: 5 pts | Bonus 4th place: 5 pts |
| receiptCheckTitle | Conferência manual de pontos | Verificación manual de puntos | Manual point verification |
| receiptCheckBy | Conferido por | Verificado por | Verified by |
| receiptCheckDate | Data | Fecha | Date |
| receiptCheckTotal | Total | Total | Total |

Linhas alteradas:
- pt-BR: após linha 148 (receiptRuleText)
- es: após linha 297 (receiptRuleText)
- en-US: após linha 446 (receiptRuleText)

---

## js/app.js

### receiptHtml(): legenda + área de conferência (após linha 726)

**Adicionado após `<div class="notice">...</div>` do receiptRuleText:**

1. `<div class="notice">` inline com legenda de pontuação (todos os 7 itens separados por `·`)
2. `<div>` com borda tracejada contendo:
   - Tabela 3 colunas: categoria / multiplicador / subtotal em branco
   - Linha de total em destaque
   - Linha de assinatura (Conferido por / Data)

Todos os textos usam `t("chave")` + `escapeHtml()`. Sem texto hardcoded. ✓

---

## Checklist final

- [x] Supabase `enabled: true` confirmado
- [x] 32 knockout matches: todos com `venue` real e `timeET` em formato `"HH:MM (EDT)"`
- [x] M74 time corrigido (12:00 → 13:00 EDT)
- [x] Legenda de pontuação adicionada ao comprovante
- [x] Tabela de conferência manual adicionada ao comprovante
- [x] 12 novas chaves i18n nos 3 idiomas
- [x] CHANGELOG atualizado com v4.2-patch
- [x] config.js bumped para `"v4.2-patch"`
- [x] Bracket não alterado (apenas venue/time, nenhuma equipe renomeada)
- [x] Nenhuma função nova fora do IIFE
- [x] node --check: não disponível no ambiente — edits verificados por grep e leitura

### Fontes utilizadas (knockoutMatches)
- NBC Sports World Cup 2026 schedule (primary)
- Wikipedia Copa do Mundo FIFA 2026 (cross-reference)
