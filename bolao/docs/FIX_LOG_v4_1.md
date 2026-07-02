# Fix Log — v4.1-patch (2026-06-27)

Patch cirúrgico sobre v4.0-clean. Nenhuma função global adicionada fora do IIFE.

---

## js/app.js

### Fix 1 — mergeStates(): paid e results (linhas 189–201)

**Antes:** `Object.assign({}, remote.paid, local.paid)` → local sempre vencia.
**Depois:** loop sobre union de chaves; `mergedPaid[k] = !!(local[k] || remote[k])` → qualquer `true` vence.

**Antes:** `Object.assign({}, remote.results, local.results)` → local sempre vencia.
**Depois:** `Object.assign({}, local.results, remote.results)` → remoto vence (admin é fonte de verdade).

Linhas alteradas: 189–201 (bloco `return { ... }` dentro de `mergeStates`).

---

### Fix 2 — adminLogin(): try/catch em sha256Hex (linhas 1203–1213)

**Antes:** `const hash = await sha256Hex(pwd);` sem proteção.
**Depois:**
```js
let hash;
try {
  hash = await sha256Hex(pwd);
} catch (err) {
  console.warn("SHA-256 unavailable", err);
  alert(t("adminLoginError"));
  return;
}
```
Linhas alteradas: 1203–1213 (substituição da linha `const hash = await sha256Hex(pwd);`).

---

### Fix 3 — updateDynamic(): debounce em saveDraft (linhas 437–447)

**Adicionado antes de `updateDynamic`:**
```js
let _draftTimer = null;
function saveDraftDebounced() {
  clearTimeout(_draftTimer);
  _draftTimer = setTimeout(saveDraft, 400);
}
```

**Dentro de `updateDynamic`:** `saveDraft()` → `saveDraftDebounced()`.

Linhas alteradas: 437–447.

---

### M3 — saveEntry(): verificação de duplicata (linhas 1178–1184)

**Adicionado após `readEntryFromForm()` retornar uma entrada válida:**
```js
const duplicate = s.entries.find(e =>
  e.entryName.trim().toLowerCase() === entry.entryName.trim().toLowerCase()
);
if (duplicate && !confirm(t("duplicateEntryConfirm"))) return;
```
Linhas alteradas: 1178–1184.

---

### M4 — renderRanking(): badge Demo (linhas 841–848)

**Adicionado:**
```js
const demoBadge = e.diagnostics?.demo ? ' <span class="demo-badge">Demo</span>' : "";
```
Inserido no template HTML após `${escapeHtml(e.entryName)}`.

Linhas alteradas: 841, 844.

---

## js/i18n.js

### Novas chaves: adminLoginError, duplicateEntryConfirm

Adicionadas em todos os 3 idiomas logo após `adminExpired`:

| Idioma | Linha |
|---|---|
| pt-BR | 88–89 |
| es | 237–238 |
| en-US | 386–387 |

---

## index.html

### Fix 4 — CSP: ipify removido (linha 11)

**Antes:** `connect-src ... https://api.ipify.org;`
**Depois:** `https://api.ipify.org` removido.

---

### Fix 5 — SRI no Supabase (linhas 21–23)

**Antes:** `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>`

**Depois:**
```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js"
        integrity="sha384-GFr3yTh5lJznCbZfpTtXnwboFsxqtTQoeTZCRHhE0579KrRmlCzen5AA8ohaB5ug"
        crossorigin="anonymous"></script>
```

Hash gerado com: `curl -s <url> | openssl dgst -sha384 -binary | openssl base64 -A`

---

### M2 — canonical (linha 8)

**Adicionado:**
```html
<link rel="canonical" href="https://ferrarilabs.github.io/bolao-teste/">
```

---

## css/styles.css

### M1 — focus-visible (linhas 421–427)

```css
button:focus-visible,
input:focus-visible,
select:focus-visible {
  outline: 2px solid #2fe56e;
  outline-offset: 3px;
}
```

### M4 — .demo-badge (linhas 429–438)

```css
.demo-badge {
  font-size: 10px;
  background: #3d1520;
  color: #ffdbe1;
  border-radius: 999px;
  padding: 2px 8px;
  font-weight: 700;
  text-transform: uppercase;
  vertical-align: middle;
  margin-left: 6px;
}
```

---

## Arquivos deletados

- `bolao-teste/js/i18n-repair.js` — não carregado em nenhum lugar desde v4.0; removido.

---

## Checklist final

- [x] mergeStates: paid usa "any true wins", results usa remote-wins
- [x] adminLogin tem try/catch em torno de sha256Hex
- [x] saveDraftDebounced existe e é chamado em updateDynamic
- [x] ipify removido da CSP
- [x] Supabase CDN tem integrity + crossorigin + versão fixada (@2.45.4)
- [x] i18n-repair.js deletado
- [x] Nenhuma função global nova introduzida (tudo dentro do IIFE)
- [x] Todos os alertas novos usam t("chave")
- [x] Os 3 idiomas têm adminLoginError e duplicateEntryConfirm
- [x] CHANGELOG atualizado com v4.1-patch
