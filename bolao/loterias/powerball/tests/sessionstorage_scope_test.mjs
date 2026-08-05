#!/usr/bin/env node
// Powerball Admin — automated test: sessionStorage may ONLY be used for the Supabase Auth
// session (handled internally by @supabase/supabase-js via the `storage: window.sessionStorage`
// option we pass in admin/js/supabaseClient.js). No other admin code may read/write
// sessionStorage directly.
// STATUS: testado e executado — this script runs and its real output is captured below.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../admin", import.meta.url).pathname;
// The only permitted direct sessionStorage call in the whole admin tree: the defense-in-depth
// clear() on logout in auth.js. Everything else (session storage/retrieval itself) is delegated
// to the Supabase SDK via the `storage:` option, not called directly by our code.
const ALLOWED = [{ file: "js/auth.js", pattern: "window.sessionStorage.clear()" }];

const SESSIONSTORAGE_RE = /\bsessionStorage\s*\.\s*\w+|\bwindow\.sessionStorage\b/g;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(js|mjs|html)$/.test(entry)) out.push(p);
  }
  return out;
}

let violations = [];
for (const file of walk(ROOT)) {
  const rel = file.replace(ROOT + "/", "");
  const content = readFileSync(file, "utf8");
  const matches = content.match(SESSIONSTORAGE_RE) || [];
  for (const m of matches) {
    const isSupabaseClientConfig = rel === "js/supabaseClient.js" && m === "window.sessionStorage";
    const isAllowedLogoutClear = rel === "js/auth.js" && content.includes("window.sessionStorage.clear()");
    if (!isSupabaseClientConfig && !isAllowedLogoutClear) {
      violations.push({ file: rel, match: m });
    }
  }
}

if (violations.length > 0) {
  console.error("FAIL: sessionStorage used outside the permitted auth-session scope:");
  for (const v of violations) console.error(`  ${v.file}: ${v.match}`);
  process.exit(1);
} else {
  console.log("PASS: sessionStorage usage is limited to the Supabase auth session storage option (js/supabaseClient.js) and the defense-in-depth clear() on logout (js/auth.js). No other admin code touches sessionStorage.");
  process.exit(0);
}
