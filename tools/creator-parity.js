#!/usr/bin/env node
/*
 * creator-parity.js — repo ↔ live Creator drift report.
 *
 * The repo holds Deluge sources under deluge/*.deluge. The live app is only
 * observable as a Creator export (.ds). Until every change is manually pasted
 * into Creator, repo and live drift apart silently: functions get committed
 * locally and never reach production.
 *
 * This tool extracts every function from both sides, normalizes away the
 * formatting differences the .ds export introduces, and reports which
 * functions are identical, which differ, and which exist only in the repo.
 *
 * Usage:
 *   node tools/creator-parity.js
 *   node tools/creator-parity.js --json
 *   node tools/creator-parity.js --verbose
 *   node tools/creator-parity.js --dump path/to/other.ds
 *   node tools/creator-parity.js --allow-drift
 *
 * Exit codes:
 *   0 = no drift (or --allow-drift passed)
 *   1 = drift detected (repo ahead of live, or bodies differ)
 *   2 = bad input (missing repo dir or dump file)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const DELUGE_DIR = path.join(REPO_ROOT, 'deluge');
const DEFAULT_DUMP = path.join(
  REPO_ROOT,
  'creatorapp-backup',
  'Logistic_Management_II.ds'
);

// Deluge return types observed in this project: map, list, string, void, number,
// int, float, date, datatime, collection, boolean. NOTE: Creator's exporter
// rewrites `boolean` as `bool` (and `datetime` as `date`), so the same function
// can be declared with a different type token on each side. Accept any
// identifier as the type rather than an allowlist, or a type name added by a
// Zoho update makes whole functions silently invisible.
const KNOWN_TYPES = new Set([
  'map', 'list', 'string', 'void', 'number', 'int', 'float', 'decimal',
  'date', 'datatime', 'datetime', 'collection', 'boolean', 'bool', 'json',
]);

/*
 * Tokens that begin a line, are followed by a name and '(' , and are NOT
 * function declarations. Without this filter a permissive matcher reads
 * `return thisapp.x.y(` as a declaration named "thisapp.x.y" — there are
 * hundreds of those in a Creator export.
 *
 * A keyword match must NOT consume the following block, or the scanner would
 * skip past real functions declared after it.
 */
const NOT_TYPES = new Set([
  'else', 'return', 'page', 'if', 'for', 'while', 'catch', 'insert', 'into',
  'let', 'var', 'new', 'function', 'form', 'report', 'section', 'field',
  'custom', 'displayname', 'record', 'sortorder', 'type', 'values', 'row',
  'column', 'width', 'icon', 'openurl', 'open',
]);

// ── args ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    dump: DEFAULT_DUMP,
    json: false,
    verbose: false,
    allowDrift: false,
    help: false,
    badArg: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--verbose' || a === '-v') opts.verbose = true;
    else if (a === '--allow-drift') opts.allowDrift = true;
    else if (a === '--dump') opts.dump = path.resolve(argv[++i] || '');
    else if (a === '--help' || a === '-h') opts.help = true;
    else {
      console.error(`Unknown argument: ${a}`);
      opts.help = true;
      opts.badArg = true;
    }
  }
  return opts;
}

// ── string / comment aware scanning ─────────────────────────────────────────

/*
 * Deluge bodies embed JSON in string literals ("{\"params\": {}}"), and those
 * braces are indistinguishable from block braces unless the scanner tracks
 * string state. Counting raw braces makes a single function swallow the rest
 * of the file, so every structural scan below skips string literals and both
 * comment styles.
 */

/* Returns the string literal at `i` (inclusive of its quotes), or '' if unterminated. */
function readString(text, i) {
  let j = i + 1;
  while (j < text.length) {
    const ch = text[j];
    if (ch === '\\') {
      j += 2;
      continue;
    }
    if (ch === '"') return text.slice(i, j + 1);
    if (ch === '\n') break; // unterminated on this line
    j++;
  }
  return text.slice(i, j);
}

/* Index of the first structural '{' at or after `from`, or -1. */
function findBrace(text, from) {
  let i = from;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    if (ch === '"') {
      i += readString(text, i).length;
      continue;
    }
    if (ch === '{') return i;
    i++;
  }
  return -1;
}

/* Given the index of an opening '{', returns the index of its matching '}', or -1. */
function matchBrace(text, open) {
  let depth = 0;
  let i = open;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    if (ch === '"') {
      i += readString(text, i).length;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

// ── normalization ───────────────────────────────────────────────────────────

/* Removes comments while leaving string literal contents intact. */
function stripComments(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
      // keep the newline so statements do not fuse together
      out += '\n';
      continue;
    }
    if (ch === '"') {
      const s = readString(text, i);
      out += s;
      i += s.length;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/*
 * Drops a redundant pair of grouping parentheses: (x) -> x.
 *
 * The hard part is telling grouping parens from call parens. Collapsing
 * `data.put(a, b)` would fuse the callee and its arguments into one token, so
 * a `(` is only collapsed when the character before it is NOT part of an
 * identifier — i.e. it is an operator, a comma, a bracket, or the start of the
 * expression. `endDate.subDay(30)` and `report_scan_truncated(x)` are therefore
 * always preserved, while `full = (a && b)` collapses.
 *
 * String literals are copied through readString verbatim, so their contents are
 * never rewritten and a quote inside them cannot unbalance the scan.
 *
 * Expects whitespace-free input (normalize removes it before calling).
 */
function collapseParens(text) {
  const CALL_TAIL = /[A-Za-z0-9_$.)]/;
  let cur = text;
  let prev = null;
  while (prev !== cur) {
    prev = cur;
    let out = '';
    let i = 0;
    while (i < cur.length) {
      if (cur[i] === '"') {
        const s = readString(cur, i);
        out += s;
        i += s.length;
        continue;
      }
      if (cur[i] === '(' && !(i > 0 && CALL_TAIL.test(cur[i - 1]))) {
        let depth = 1;
        let j = i + 1;
        let inner = '';
        while (j < cur.length && depth > 0) {
          if (cur[j] === '"') {
            const s = readString(cur, j);
            inner += s;
            j += s.length;
            continue;
          }
          if (cur[j] === '(') depth++;
          else if (cur[j] === ')') {
            depth--;
            if (depth === 0) break;
          }
          inner += cur[j];
          j++;
        }
        if (depth === 0 && inner.length > 0) {
          out += inner;
          i = j + 1;
          continue;
        }
        out += '(';
        i++;
        continue;
      }
      out += cur[i];
      i++;
    }
    cur = out;
  }
  return cur;
}

/*
 * Canonical form used for parity comparison: comments dropped, whitespace
 * removed, redundant parens collapsed. Identifiers, literals, string contents
 * and statement order are all preserved, so a genuine logic or text change
 * still registers as a difference.
 */
/*
 * Deluge type aliases: Creator's exporter abbreviates what you wrote, so the
 * same function is exported as `bool` where the repo says `boolean`. These are
 * the same type — without folding them, that function reports drift forever
 * (deploy it, re-export, drift again), which trains people to ignore the tool.
 *
 * Rewritten only outside string literals: a message string containing the word
 * "boolean" is data, not a type.
 */
const TYPE_ALIASES = new Map([['bool', 'boolean']]);

function canonicalizeTypes(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '/' && (src[i + 1] === '/' || src[i + 1] === '*')) {
      // Copy the comment verbatim; types inside comments are not types.
      if (src[i + 1] === '/') {
        const end = src.indexOf('\n', i);
        const stop = end === -1 ? src.length : end;
        out += src.slice(i, stop);
        i = stop;
      } else {
        const end = src.indexOf('*/', i + 2);
        const stop = end === -1 ? src.length : end + 2;
        out += src.slice(i, stop);
        i = stop;
      }
      continue;
    }
    if (ch === '"') {
      const s = readString(src, i);
      out += s;
      i += s.length;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z_0-9]/.test(src[j])) j++;
      const word = src.slice(i, j);
      // After '.' this is a field or member name, not a type: `rec.bool` must
      // stay `rec.bool`, otherwise the reference stops matching its field.
      const prev = out.replace(/\s+$/, '').slice(-1);
      const isMember = prev === '.';
      out += !isMember && TYPE_ALIASES.has(word.toLowerCase())
        ? TYPE_ALIASES.get(word.toLowerCase())
        : word;
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function normalize(src) {
  return collapseParens(
    canonicalizeTypes(stripComments(src)).replace(/\s+/g, '')
  );
}

/* Statement-level split for the segment diff, also string aware. */
function splitSegments(src) {
  const clean = stripComments(src);
  const segs = [];
  let cur = '';
  let i = 0;
  while (i < clean.length) {
    const ch = clean[i];
    if (ch === '"') {
      const s = readString(clean, i);
      cur += s;
      i += s.length;
      continue;
    }
    if (ch === ';') {
      if (cur.trim()) segs.push(cur.trim());
      cur = '';
      i++;
      continue;
    }
    if (ch === '\n') {
      if (cur.trim()) segs.push(cur.trim());
      cur = '';
      i++;
      continue;
    }
    cur += ch;
    i++;
  }
  if (cur.trim()) segs.push(cur.trim());
  return segs.map((s) => s.replace(/\s+/g, ' '));
}

// ── declaration extraction ──────────────────────────────────────────────────

/*
 * Matches the shape of a declaration line: a type token, a name, and '('.
 * Group 1 is the type token, group 2 the qualified function name. Filtering
 * NOT_TYPES is done in code, not in this pattern, so a keyword match can be
 * skipped without consuming the body it appears in.
 *
 * Separators are [ \t], NOT \s: \s matches newlines, which would let a pattern
 * span lines and read `unique Supplier_Label` followed by an unrelated line
 * starting with '(' as a declaration. In a Creator export there are hundreds of
 * such lines (`sort by`, `group by`, `on load`, `unique Label`).
 *
 * The type token allows '-' so hyphenated types such as `date-time` or
 * `time-epoch` are not silently dropped.
 */
const DECL_RE = new RegExp(
  '^[ \\t]*([A-Za-z_][A-Za-z_0-9_-]*)[ \\t]+([A-Za-z_][A-Za-z_0-9_.]*)[ \\t]*\\(',
  'gm'
);

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text[i] === '\n') line++;
  return line;
}

/*
 * Walks a source text and returns every function it declares.
 *
 * `stats.unknownTypes` accumulates any type token outside KNOWN_TYPES so the
 * report can surface it. That is the guard against this class of bug
 * recurring: an unrecognized type is never allowed to fail silently.
 */
function extractFunctions(text, resolvePath, stats) {
  const found = [];
  if (stats) stats.unknownTypes = stats.unknownTypes || new Set();
  DECL_RE.lastIndex = 0;
  let m;
  while ((m = DECL_RE.exec(text)) !== null) {
    const typeToken = m[1];
    const lower = typeToken.toLowerCase();
    if (NOT_TYPES.has(lower)) continue; // not a declaration; keep scanning
    if (stats && !KNOWN_TYPES.has(lower)) stats.unknownTypes.add(lower);

    const declStart = m.index;
    const open = findBrace(text, DECL_RE.lastIndex);
    if (open === -1) break;
    const close = matchBrace(text, open);
    if (close === -1) break;
    const raw = text.slice(declStart, close + 1);
    found.push({
      name: m[2],
      type: lower,
      file: resolvePath(text, declStart),
      line: lineOf(text, declStart),
      raw,
      norm: normalize(raw),
    });
    // Resume after this function so a nested declaration is not counted twice.
    DECL_RE.lastIndex = close + 1;
  }
  return found;
}

function listDelugeFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listDelugeFiles(full));
    else if (entry.name.endsWith('.deluge')) out.push(full);
  }
  return out;
}

// ── comparison ──────────────────────────────────────────────────────────────

/*
 * Segment key used by the explanatory diff.
 *
 * Applies the same canonical form as the strict comparison, then trims leading
 * and trailing braces. Without the trim, the exporter's habit of moving a `{`
 * onto the previous line (`if(x)` / `if(x){`) reports a difference that does
 * not exist. Structural brace differences are still caught by the strict
 * whole-body comparison; this key only has to avoid inventing noise.
 */
function segmentKey(segment) {
  return normalize(segment).replace(/^[{]+/, '').replace(/[}]+$/, '');
}

function segmentDiff(repoRaw, liveRaw) {
  const a = splitSegments(repoRaw);
  const b = splitSegments(liveRaw);
  const keysB = new Set(b.map(segmentKey));
  const keysA = new Set(a.map(segmentKey));
  const repoOnly = a.filter((x) => !keysB.has(segmentKey(x)));
  const liveOnly = b.filter((x) => !keysA.has(segmentKey(x)));
  return {
    onlyRepo: repoOnly.filter((x) => segmentKey(x)),
    onlyLive: liveOnly.filter((x) => segmentKey(x)),
  };
}

/*
 * Resolves a repo function name to its live counterpart.
 *
 * Exact name always wins. The fallbacks exist because Creator wraps some
 * standalone functions in a module named after them: the repo declares
 * `chat_list()` while the export stores `chat_list.chat_list()`. The alias
 * lookup is deterministic and unambiguous, and any fallback match is reported
 * back to the caller so the naming discrepancy stays visible instead of being
 * silently accepted as parity.
 */
function resolveLive(liveByName, name) {
  const direct = liveByName.get(name);
  if (direct) return { variants: direct, matchedName: name };
  const bare = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : name;
  const alias = bare + '.' + bare;
  if (liveByName.has(alias)) {
    return { variants: liveByName.get(alias), matchedName: alias };
  }
  if (liveByName.has(bare)) {
    return { variants: liveByName.get(bare), matchedName: bare };
  }
  return { variants: null, matchedName: null };
}

function compare(repoFns, liveByName) {
  const same = [];
  const different = [];
  const missing = [];
  const renamed = [];
  const sorted = [...repoFns].sort((x, y) => x.name.localeCompare(y.name));

  for (const fn of sorted) {
    const { variants, matchedName } = resolveLive(liveByName, fn.name);
    if (!variants) {
      missing.push(fn);
      continue;
    }
    const aliasUsed = matchedName !== fn.name;
    // A function can appear in several app variants (desktop, tablet); parity
    // holds if any one of them matches.
    if (variants.some((v) => v.norm === fn.norm)) {
      if (aliasUsed) renamed.push({ ...fn, matchedName });
      else same.push(fn);
      continue;
    }
    let best = null;
    for (const v of variants) {
      const d = segmentDiff(fn.raw, v.raw);
      const cost = d.onlyRepo.length + d.onlyLive.length;
      if (!best || cost < best.cost) best = { v, d, cost };
    }
    different.push({ ...fn, dumpLine: best.v.line, matchedName, ...best.d });
  }
  return { same, different, missing, renamed };
}

// ── reporting ───────────────────────────────────────────────────────────────

const isTest = (name) => /\btests_[a-z_0-9]+\./.test(name);

function report(opts, repoFns, liveByName, cmp, dumpPath, stats) {
  const prodDifferent = cmp.different.filter((d) => !isTest(d.name));
  const prodMissing = cmp.missing.filter((d) => !isTest(d.name));
  const testDifferent = cmp.different.filter((d) => isTest(d.name));
  const testMissing = cmp.missing.filter((d) => !isTest(d.name));
  const drift = prodDifferent.length + prodMissing.length;
  const unknown = Array.from(stats.unknownTypes).sort();

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          dump: path.relative(REPO_ROOT, dumpPath),
          repoFunctions: repoFns.length,
          liveFunctions: liveByName.size,
          parity: cmp.same.length,
          drift: drift > 0,
          unknownReturnTypes: unknown,
          nameMismatches: cmp.renamed.map((r) => ({ name: r.name, matchedName: r.matchedName, file: r.file, line: r.line })),
          missingInLive: cmp.missing.map((f) => ({
            name: f.name,
            file: f.file,
            line: f.line,
            isTest: isTest(f.name),
          })),
          differentInLive: cmp.different.map((d) => ({
            name: d.name,
            file: d.file,
            line: d.line,
            dumpLine: d.dumpLine,
            matchedName: d.matchedName,
            isTest: isTest(d.name),
            onlyInRepo: d.onlyRepo,
            onlyInLive: d.onlyDump,
          })),
        },
        null,
        2
      )
    );
    return drift;
  }

  const line = (s = '') => console.log(s);
  const bar = '─'.repeat(64);

  line(bar);
  line('Creator parity — repo (deluge/) vs live (' + path.basename(dumpPath) + ')');
  line(bar);
  line(`repo functions : ${repoFns.length}`);
  line(`live functions : ${liveByName.size}`);
  line(`parity         : ${cmp.same.length}`);
  line(`drift          : ${drift === 0 ? 'none' : drift + ' production function(s)'}`);
  line();

  if (unknown.length) {
    line('WARNING: unrecognized return type(s) — functions may be invisible:');
    for (const t of unknown) line(`  ${t}`);
    line('  Add them to KNOWN_TYPES / NOT_TYPES in tools/creator-parity.js.');
    line();
  }

  if (cmp.renamed.length) {
    line('NAME MISMATCH — matched through an alias, not an exact name');
    line(bar);
    for (const r of cmp.renamed) {
      line(`  repo ${r.name}`);
      line(`  live ${r.matchedName}`);
      line(`      ${r.file}:${r.line}`);
    }
    line();
  }

  if (prodMissing.length) {
    line('IN REPO, NOT IN LIVE — committed locally but never deployed');
    line(bar);
    for (const f of prodMissing) {
      line(`  ${f.name}`);
      line(`      ${f.file}:${f.line}`);
    }
    line();
  }

  if (prodDifferent.length) {
    line('DIFFERENT BODIES — repo has changes live does not');
    line(bar);
    for (const d of prodDifferent) {
      line(`  ${d.name}${d.matchedName && d.matchedName !== d.name ? `  (live name: ${d.matchedName})` : ''}`);
      line(`      repo ${d.file}:${d.line}   live .ds:${d.dumpLine}`);
      if (opts.verbose) {
        for (const s of d.onlyRepo) line(`      - repo: ${s}`);
        for (const s of d.onlyLive) line(`      + live: ${s}`);
      } else {
        line(
          `      ${d.onlyRepo.length} segment(s) only in repo, ${d.onlyLive.length} only in live (--verbose to show)`
        );
      }
      line();
    }
  }

  if (testMissing.length || testDifferent.length) {
    line(
      `Tests also drifting: ${testMissing.length} missing, ${testDifferent.length} different (informational)`
    );
    if (opts.verbose) {
      for (const f of testMissing) line(`    missing: ${f.name} (${f.file}:${f.line})`);
      for (const d of testDifferent) line(`    differs: ${d.name} (${d.file}:${d.line})`);
    }
    line();
  }

  if (drift === 0) {
    line('Repo and live agree on all production functions.');
  } else {
    line('Deploy the drifted functions to Creator, or re-export the .ds if');
    line('the dump predates the live state.');
  }
  line();
  return drift;
}

// ── main ────────────────────────────────────────────────────────────────────

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    console.log(
      [
        'creator-parity — repo vs live Creator drift report',
        '',
        'Usage:',
        '  node tools/creator-parity.js [--json] [--verbose] [--allow-drift]',
        '                         [--dump <path-to.ds>]',
        '',
        'Exit codes: 0 no drift, 1 drift found, 2 bad input',
      ].join('\n')
    );
    // An unknown flag is a usage error, not a successful help request: exiting 0
    // there would let a typo'd flag pass for a clean run in a CI script.
    process.exit(opts.badArg ? 2 : 0);
  }

  if (!fs.existsSync(DELUGE_DIR) || !fs.statSync(DELUGE_DIR).isDirectory()) {
    console.error(`error: deluge directory not found at ${DELUGE_DIR}`);
    process.exit(2);
  }
  if (!fs.existsSync(opts.dump)) {
    console.error(`error: Creator dump not found at ${opts.dump}`);
    console.error('Export the app from Creator (.app > Download as backup) and retry.');
    process.exit(2);
  }

  const stats = { unknownTypes: new Set() };
  const repoFns = [];
  for (const file of listDelugeFiles(DELUGE_DIR)) {
    const text = fs.readFileSync(file, 'utf8');
    const rel = path.relative(REPO_ROOT, file);
    repoFns.push(...extractFunctions(text, () => rel, stats));
  }

  const dumpText = fs.readFileSync(opts.dump, 'utf8');
  const liveList = extractFunctions(dumpText, () => path.basename(opts.dump), stats);
  const liveByName = new Map();
  for (const fn of liveList) {
    if (!liveByName.has(fn.name)) liveByName.set(fn.name, []);
    liveByName.get(fn.name).push(fn);
  }

  const cmp = compare(repoFns, liveByName);
  const drift = report(opts, repoFns, liveByName, cmp, opts.dump, stats);
  process.exit(drift > 0 && !opts.allowDrift ? 1 : 0);
}

main();