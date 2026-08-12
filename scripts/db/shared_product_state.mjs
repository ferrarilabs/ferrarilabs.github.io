#!/usr/bin/env node
/**
 * SHARED PRODUCT STATE — relations that hold rows belonging to more than one product.
 *
 * PRODMIG-2026-08-11-A discovered that `public.bolao_notif_jobs` carries **20 football rows and 4
 * Powerball rows** in one table. Production evidence, not a hypothetical: `pool_id` takes the values
 * `br2026` and `powerball`.
 *
 * That makes every unscoped statement against it a cross-product action. `DELETE FROM bolao_notif_jobs
 * WHERE status = 'sent'` reads like bolão housekeeping and would take Powerball's delivery history with
 * it. The fence, the backfill and any cleanup must therefore be product-scoped by construction rather
 * than by the author remembering.
 *
 * This module makes "product-scoped" a checkable property of a statement instead of a convention.
 */

/** Relations proven to hold more than one product's rows, with the column that separates them. */
export const SHARED_RELATIONS = Object.freeze([
  Object.freeze({
    relation: "bolao_notif_jobs",
    scopeColumn: "pool_id",
    products: Object.freeze({
      FOOTBALL: Object.freeze(["main", "br2026", "cdb2026"]),
      POWERBALL: Object.freeze(["powerball"]),
    }),
    measured: Object.freeze({ br2026: 20, powerball: 4, measuredAt: "2026-08-11" }),
    why: "one durable notification outbox serves both products. Discovered by counting pool_id in production, not by reading a design doc.",
  }),
]);

export const isShared = (relation) => SHARED_RELATIONS.some((r) => r.relation === relation);
export const sharedRelation = (relation) => SHARED_RELATIONS.find((r) => r.relation === relation) ?? null;

/** The scope values a product owns. Unknown product returns null so a caller cannot silently get []. */
export function scopeValues(relation, product) {
  const r = sharedRelation(relation);
  if (!r) return null;
  const v = r.products[product];
  return v ? [...v] : null;
}

/**
 * Is a statement safely product-scoped?
 *
 * Deliberately conservative and syntactic: it looks for the scope column constrained to values belonging
 * to exactly one product. It does NOT try to understand arbitrary SQL — a checker that reasons about SQL
 * it cannot fully parse gives false confidence, and false confidence is what this exists to remove. A
 * statement it cannot prove safe is reported unsafe.
 */
export function scopeViolations(relation, sql, product) {
  const r = sharedRelation(relation);
  if (!r) return [];
  const text = String(sql ?? "");
  const out = [];
  const mutating = /\b(DELETE\s+FROM|UPDATE|TRUNCATE|INSERT\s+INTO)\b/i.test(text);
  const touches = new RegExp(`\\b${r.relation}\\b`).test(text);
  if (!touches) return [];

  if (/\bTRUNCATE\b/i.test(text)) {
    out.push(`TRUNCATE on ${r.relation} cannot be product-scoped at all — it would remove every product's rows`);
    return out;
  }
  if (!mutating) return [];

  const mine = scopeValues(r.relation, product);
  if (!mine) { out.push(`unknown product "${product}" for ${r.relation} — refusing to judge scope for a product the model does not know`); return out; }

  const hasScope = new RegExp(`\\b${r.scopeColumn}\\b\\s*(=|IN)`, "i").test(text);
  if (!hasScope) {
    out.push(`${r.relation} is SHARED_PRODUCT_STATE and this statement does not constrain ${r.scopeColumn} — it would act on every product's rows`);
    return out;
  }
  // Every literal mentioned must belong to the claimed product.
  const literals = [...text.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const allValues = Object.values(r.products).flat();
  const foreign = literals.filter((l) => allValues.includes(l) && !mine.includes(l));
  for (const f of foreign) out.push(`statement scoped as ${product} references ${r.scopeColumn}='${f}', which belongs to another product`);
  return out;
}

/**
 * Fingerprint rows by product scope, so a pre/post comparison proves the OTHER product did not move.
 * Counts and a digest — never row content.
 */
export function scopeFingerprintSql(relation) {
  const r = sharedRelation(relation);
  if (!r) return null;
  return `SELECT ${r.scopeColumn} AS scope, count(*) AS rows,
       md5(string_agg(md5(t::text), '' ORDER BY md5(t::text))) AS digest
  FROM public.${r.relation} t GROUP BY ${r.scopeColumn} ORDER BY ${r.scopeColumn}`;
}

/** Did any scope OTHER than the one being operated on change between two fingerprints? */
export function foreignScopeChanged(before, after, operatingProduct, relation = "bolao_notif_jobs") {
  const r = sharedRelation(relation);
  const mine = new Set(scopeValues(relation, operatingProduct) ?? []);
  const map = (rows) => new Map((rows ?? []).map((x) => [x[0], `${x[1]}|${x[2]}`]));
  const b = map(before), a = map(after);
  const out = [];
  for (const [scope, v] of b) {
    if (mine.has(scope)) continue;
    if (!a.has(scope)) out.push(`scope ${r.scopeColumn}='${scope}' disappeared while operating as ${operatingProduct}`);
    else if (a.get(scope) !== v) out.push(`scope ${r.scopeColumn}='${scope}' changed while operating as ${operatingProduct}`);
  }
  for (const scope of a.keys()) {
    if (!mine.has(scope) && !b.has(scope)) out.push(`scope ${r.scopeColumn}='${scope}' appeared while operating as ${operatingProduct}`);
  }
  return out;
}
