#!/usr/bin/env node
/**
 * Promote ONE generated EXPAND phase into a real, CLI-recognisable migration file.
 *
 * WHY THIS EXISTS AS A SCRIPT
 * The M1–M12 drafts are generated from `model/target_model.json` precisely so they cannot drift from the
 * model. Copying one into `supabase/migrations/` by hand would reintroduce that drift at the last step —
 * the production file would be a snapshot nobody regenerates. This script re-derives the phase body from
 * the generator on every run, so `--check` can prove the promoted file still matches what the model emits.
 *
 * WHAT IT CHANGES, AND WHAT IT REFUSES TO CHANGE
 * It replaces the draft's refusal banner with a production header and NOTHING ELSE. The DDL body is passed
 * through byte-for-byte. If a phase needs different SQL to be production-safe, the fix belongs in the
 * generator or the model, not here — a promotion step that edits SQL is a hand-authoring step wearing a
 * different hat.
 *
 * PROVENANCE. A promoted stage is genuinely EXECUTED against the database, so its header declares
 * MIGRATION_APPLIED_HISTORICALLY and its ledger row carries its statements. That is the opposite of the M0
 * baseline files, which describe objects that already existed and carry NULL statements. Both claims must
 * stay true; `classifyLedgerProvenance()` is what checks them.
 *
 * Usage:
 *   node scripts/db/promote_expand_stage.mjs --phase M1 --version 20260811170000 [--write]
 *   node scripts/db/promote_expand_stage.mjs --check          # every promoted file still matches the generator
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { generateDrafts, BANNER } from "./generate_migration_drafts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
export const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

/** The production header that replaces the draft's refusal banner. */
export function productionHeader(phase, meta, version, filename) {
  return [
    "--",
    "-- PROVENANCE: MIGRATION_APPLIED_HISTORICALLY",
    "--",
    `-- ${filename}`,
    "--",
    `-- EXPAND stage ${phase} — ${meta.title}`,
    "--",
    "-- ADDITIVE ONLY. This stage creates new objects in new schemas. It does not ALTER, DROP or read any",
    "-- legacy object, so legacy remains authoritative and fully available for fast rollback.",
    "--",
    "-- GENERATED. The body below is emitted byte-for-byte by",
    "-- `scripts/db/generate_migration_drafts.mjs` from model/target_model.json + model/access_model.json,",
    "-- and promoted by `scripts/db/promote_expand_stage.mjs`. Do not edit it here: run",
    "-- `node scripts/db/promote_expand_stage.mjs --check` and it will tell you this file has drifted from",
    "-- the model. Fix the model or the generator, then re-promote.",
    "--",
    `-- ROLLBACK (${meta.rollbackClass}). ${meta.rollback}`,
    "--",
  ].join("\n");
}

/** Strip the draft refusal banner; keep everything after it untouched. */
export function stripBanner(body) {
  if (!body.startsWith(BANNER)) throw new Error("draft body does not start with the expected refusal banner");
  return body.slice(BANNER.length).replace(/^\n+/, "");
}

export function promotedName(phase, meta, version) {
  const slug = String(meta.title).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return `${version}_expand_${phase.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${slug}.sql`;
}

export function buildPromotion(phase, version) {
  const { files, errors } = generateDrafts();
  if (errors && errors.length) throw new Error("generator reported errors: " + errors.join("; "));
  const f = files.find((x) => x.phase === phase);
  if (!f) throw new Error(`no generated phase named ${phase}; have: ${files.map((x) => x.phase).join(", ")}`);
  const filename = promotedName(phase, f.meta, version);
  const sql = productionHeader(phase, f.meta, version, filename) + "\n" + stripBanner(f.body);
  return { phase, version, filename, sql, sha256: sha256(sql), meta: f.meta, entities: f.entities };
}

/**
 * Every promoted file in supabase/migrations/ must still match what the generator emits today.
 *
 * DIRECTION MATTERS. This used to recover the phase by PARSING the filename — `([a-z0-9]+)` after
 * `_expand_`, then `.replace(/^DDL/, "DDL-")`. That is the inverse of `promotedName()`, and the inverse
 * is lossy: `promotedName("DDL-M11")` slugifies to `ddl_m11`, the character class stops at the
 * underscore, and the phase came back as `DDL-`. The gate that proves a promoted production file has not
 * drifted from the model could not read one of the files it was guarding.
 *
 * So it goes forward instead. Every phase the generator knows about is asked what it WOULD be called at
 * the version found on disk, and a file is verified when exactly one phase claims it. That is total
 * rather than lossy — no filename can be unparseable — and it is strictly stronger, because a file no
 * phase claims is now a reported finding rather than a name that happened not to match a regex.
 */
/**
 * Mark every line of a migration as inside or outside a dollar-quoted region.
 *
 * WHY THIS IS NOT A ONE-LINE REGEX. A `--` line outside a dollar quote is a comment: PostgreSQL discards
 * it and the database is identical without it. The SAME line INSIDE `$$ … $$` is part of a stored function
 * body — it lands in `prosrc` verbatim, so changing it genuinely changes an object in the database. Any
 * comment-stripper that cannot tell those apart can hide a real change to a stored function behind the
 * word "comment", which is the one mistake this whole checker exists to prevent.
 */
function dollarQuoteDepthByLine(sql) {
  const lines = sql.split("\n");
  const marks = [];
  let open = null; // the tag we are currently inside, e.g. "$fn$"
  for (const line of lines) {
    marks.push(open !== null); // the line's state as it STARTS — an opening line is itself outside
    const tags = line.match(/\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$/g) || [];
    for (const t of tags) {
      if (open === null) open = t;
      else if (t === open) open = null;
    }
  }
  return { lines, inside: marks, unbalanced: open !== null };
}

/**
 * Classify a promoted file against what the generator now emits.
 *
 * Returns "IDENTICAL", "COMMENT_ONLY" or "DRIFTED". COMMENT_ONLY is a real and permanent condition rather
 * than an excuse: a promoted file is FROZEN the moment it is applied — `q8_make_ledger_record.mjs` embeds
 * the body VERBATIM into the production ledger row, comments included — while the generator legitimately
 * keeps improving its commentary as the model gains entries. Rewriting the file to chase a comment would
 * make the repository disagree with what production actually recorded, which is strictly worse than the
 * comment being stale. So the executable content is the thing that must never drift, and it is what this
 * function fails on.
 */
export function classifyDrift(onDisk, built) {
  if (onDisk === built) return { kind: "IDENTICAL", lines: [] };
  const a = dollarQuoteDepthByLine(onDisk), b = dollarQuoteDepthByLine(built);
  // An unbalanced dollar quote means the scanner lost track; refuse to classify rather than guess.
  if (a.unbalanced || b.unbalanced) return { kind: "DRIFTED", lines: ["unbalanced dollar quote — cannot classify safely"] };
  if (a.lines.length !== b.lines.length) return { kind: "DRIFTED", lines: ["line count differs"] };
  const differing = [];
  for (let i = 0; i < a.lines.length; i++) {
    if (a.lines[i] === b.lines[i]) continue;
    const isComment = (s) => /^\s*--/.test(s);
    const commentish = !a.inside[i] && !b.inside[i] && isComment(a.lines[i]) && isComment(b.lines[i]);
    differing.push({ n: i + 1, commentish, was: a.lines[i], now: b.lines[i] });
  }
  return { kind: differing.every((d) => d.commentish) ? "COMMENT_ONLY" : "DRIFTED", lines: differing };
}

export function checkPromoted() {
  const { files: generated } = generateDrafts();
  const out = [];
  for (const name of readdirSync(MIGRATIONS_DIR).filter((n) => /^\d+_expand_/.test(n)).sort()) {
    const version = /^(\d+)_/.exec(name)[1];
    const claimants = generated.filter((g) => promotedName(g.phase, g.meta, version) === name);
    if (claimants.length !== 1) {
      out.push({ name, ok: false, why: claimants.length === 0
        ? "no generated phase produces this filename — it is promoted but unverifiable, which is not the same as correct"
        : `${claimants.length} phases claim this filename (${claimants.map((c) => c.phase).join(", ")})` });
      continue;
    }
    const onDisk = readFileSync(join(MIGRATIONS_DIR, name), "utf8");
    let built;
    try { built = buildPromotion(claimants[0].phase, version); }
    catch (e) { out.push({ name, ok: false, why: e.message }); continue; }
    const d = classifyDrift(onDisk, built.sql);
    out.push({ name, kind: d.kind, ok: d.kind !== "DRIFTED", drift: d.lines,
      why: d.kind === "IDENTICAL" ? `matches the generator (${claimants[0].phase})`
         : d.kind === "COMMENT_ONLY"
           ? `executable content matches the generator (${claimants[0].phase}); ${d.lines.length} COMMENT line(s) differ — ` +
             "the file is frozen because its bytes are embedded in the production ledger row"
           : "DRIFTED from the generator" });
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i === -1 ? null : process.argv[i + 1]; };
  if (process.argv.includes("--check")) {
    const r = checkPromoted();
    if (!r.length) console.log("  (no promoted EXPAND stage in supabase/migrations/ yet)");
    for (const x of r) {
      console.log(`  ${x.ok ? (x.kind === "COMMENT_ONLY" ? "≈" : "✓") : "✗"} ${x.name} — ${x.why}`);
      if (x.kind === "COMMENT_ONLY") for (const l of x.drift) console.log(`      line ${l.n}: generator now says "${l.now.trim()}"`);
    }
    const bad = r.filter((x) => !x.ok).length;
    const soft = r.filter((x) => x.kind === "COMMENT_ONLY").length;
    console.log(bad ? `\n✗ ${bad} promoted file(s) no longer match the generator\n`
      : `\n✓ promoted EXPAND stages match the generator${soft ? ` (${soft} with comment-only divergence, executable content exact)` : ""}\n`);
    process.exit(bad ? 1 : 0);
  }
  const phase = arg("--phase"), version = arg("--version");
  if (!phase || !version) { console.error("usage: --phase M1 --version 20260811170000 [--write] | --check"); process.exit(2); }
  if (!/^\d{14}$/.test(version)) { console.error("version must be a 14-digit timestamp"); process.exit(2); }
  const p = buildPromotion(phase, version);
  const dest = join(MIGRATIONS_DIR, p.filename);
  console.log(`phase    ${p.phase}\nversion  ${p.version}\nfile     ${p.filename}\nsha256   ${p.sha256}\nbytes    ${p.sql.length}`);
  console.log(`entities ${p.entities.length ? p.entities.map((e) => `${e.schema}.${e.name}`).join(", ") : "none (types only)"}`);
  if (process.argv.includes("--write")) {
    if (existsSync(dest)) { console.error(`\n✗ ${p.filename} already exists — refusing to overwrite a promoted migration`); process.exit(1); }
    writeFileSync(dest, p.sql);
    console.log(`\n✓ written to supabase/migrations/${p.filename}`);
  } else {
    console.log("\n(dry run — pass --write to create the file)");
  }
}
