// solve.js — a faster drop-in for makefun-diff 1.0.0.
//
// Written from the competition brief (the rules in the kit): run(input) returns
// exactly the answer makefun-diff 1.0.0 returns for { old, new }, two texts, as
// one JSON string (the patch string itself). No dependencies, ES module.
//
// How it works (same rule, faster machinery):
//  - Lines are cut after every "\n" (the only separator; "\r" is part of its
//    line); a last line with no "\n" is a line too. Lines are interned to small
//    integers (a Map from line content to an id; the one bare last line, if any,
//    is keyed with a "\n" prefix no newline-terminated line can carry), so the
//    whole search compares integers instead of strings.
//  - The common prefix of lines is kept, then the common suffix of the lines
//    left, exactly as the reference does.
//  - Between them, Myers's greedy search: for d = 0, 1, 2, ... edits and each
//    diagonal k = x - y from -d to d in steps of 2, the furthest point a path
//    of d edits reaches on k is one old line past the furthest (d-1)-point on
//    diagonal k - 1 (a deletion) or one new line past the furthest (d-1)-point
//    on diagonal k + 1 (an insertion), whichever lies further into the old
//    text, the deletion when both reach the same point; a move past the end of
//    either text is no candidate, no edge diagonal is pruned, and every run of
//    lines equal in both is followed as far as it goes. The first path to reach
//    both ends is the script.
//  - Instead of the reference's linked path objects (one allocation per
//    diagonal per d), the furthest x of every (d, k) is kept in one flat
//    Int32Array (V[d] starts at index d*d, -1 marks an unreachable diagonal),
//    and the script is recovered by walking back down the same rule. Same
//    search, same tie-break, same script — no allocations in the hot loop.
//  - The patch is then built exactly as the reference builds it: header line
//    `makefun-diff/1 old=N new=M hunks=H deleted=D inserted=I`, hunks with
//    `@ os ol ns nl`, `=`/`-`/`+` lines, deletions before insertions per run,
//    up to 3 kept lines before and after each run, runs at most 6 kept lines
//    apart sharing a hunk, a line ending its text with no newline written with
//    one and followed by a `%` line, identical texts the first line alone.

/** The patch's first word. */
const FORMAT = 'makefun-diff/1';

/** The kept lines a hunk shows before and after each change run. */
const CONTEXT = 3;

/** Run kinds: kept, deleted, inserted. */
const KEEP = 0;
const DEL = 1;
const INS = 2;

/** Furthest-x table, reused across calls (calls are sequential; the table is
 *  fully overwritten for d = 0..D on every search). Pre-sized to 2^25 entries
 *  (128 MiB, a nearly free mmap of zero pages): the search needs (D + 1)^2
 *  entries and D stays under ~5,800 for this competition's cases, so the
 *  first case pays no growth copies. It still doubles if D ever runs past. */
let vTable = new Int32Array(1 << 25);

/** The furthest x of every (d, k), and the script, for the middle slices.
 *  `a` and `b` are the middle slices as fresh arrays of length N + 1 and
 *  M + 1, their last slot a sentinel (-1 and -2) no real line id can equal,
 *  so the snake stops at either slice's end with no bounds check. */
function myersRuns(a, b, N, M) {
  let V = vTable;

  // Grow the table so V[d] (indices d*d .. d*d + 2d) fits. d never exceeds
  // N + M (delete everything, then insert everything).
  const needFor = (d) => (d + 1) * (d + 1);
  const ensure = (d) => {
    const need = needFor(d);
    if (V.length < need) {
      let size = V.length;
      while (size < need) size *= 2;
      const grown = new Int32Array(size);
      grown.set(V);
      V = grown;
      vTable = V;
    }
  };

  // d = 0: the snake from (0, 0).
  let x = 0;
  let y = 0;
  while (a[x] === b[y]) {
    x++;
    y++;
  }
  V[0] = x;
  let D = 0;
  let kEnd = 0;

  if (x !== N || y !== M) {
    let found = false;
    for (let d = 1; d <= N + M && !found; d++) {
      ensure(d);
      const base = d * d;
      const prevBase = (d - 1) * (d - 1);
      // V[d-1]'s diagonal k sits at prevBase + k + d - 1; as k steps by 2 so
      // do the read indices, and V[d]'s write index base + k + d likewise.
      let rd = prevBase - 2; // deletion candidate's index, for k = -d (unused)
      let ri = prevBase; // insertion candidate's index, for k = -d
      let wr = base; // write index, for k = -d
      // k = -d: only the insertion candidate (from diagonal -d + 1).
      {
        const k = -d;
        let xx = -2;
        const xp = V[ri];
        if (xp >= 0 && xp - k <= M) xx = xp;
        if (xx !== -2) {
          let yy = xx - k;
          while (a[xx] === b[yy]) {
            xx++;
            yy++;
          }
          V[wr] = xx;
          if (xx === N && yy === M) {
            D = d;
            kEnd = k;
            found = true;
          }
        } else V[wr] = -1;
      }
      rd += 2;
      ri += 2;
      wr += 2;
      if (!found) {
        // -d + 2 .. d - 2: both candidates.
        for (let k = -d + 2; k <= d - 2; k += 2) {
          const xpDel = V[rd];
          const xpIns = V[ri];
          const delX = xpDel >= 0 && xpDel < N ? xpDel + 1 : -2;
          const insX = xpIns >= 0 && xpIns - k <= M ? xpIns : -2;
          if (delX === -2 && insX === -2) {
            V[wr] = -1;
          } else {
            // Furthest into the old text; the deletion when both reach one point.
            let xx = delX >= insX ? delX : insX;
            let yy = xx - k;
            while (a[xx] === b[yy]) {
              xx++;
              yy++;
            }
            V[wr] = xx;
            if (xx === N && yy === M) {
              D = d;
              kEnd = k;
              found = true;
              break;
            }
          }
          rd += 2;
          ri += 2;
          wr += 2;
        }
      }
      if (!found) {
        // k = d: only the deletion candidate (from diagonal d - 1).
        const k = d;
        let xx = -2;
        const xp = V[rd];
        if (xp >= 0 && xp < N) xx = xp + 1;
        if (xx !== -2) {
          let yy = xx - k;
          while (a[xx] === b[yy]) {
            xx++;
            yy++;
          }
          V[wr] = xx;
          if (xx === N && yy === M) {
            D = d;
            kEnd = k;
            found = true;
          }
        } else V[wr] = -1;
      }
    }
    if (!found) throw new Error('makefun-diff: the search ended without reaching both ends');
  }

  // Walk back down the same rule: at (d, k) the pre-snake point is the same
  // candidate the forward search picked, the snake above it is kept lines,
  // and the d-th edit is the deletion or insertion that got there.
  const rev = []; // [kind, count], last first
  let k = kEnd;
  x = V[D * D + k + D];
  for (let d = D; d >= 1; d--) {
    const prevBase = (d - 1) * (d - 1);
    const prevOff = d - 1;
    let delX = -2;
    let insX = -2;
    if (k >= -d + 2) {
      const xp = V[prevBase + (k - 1) + prevOff];
      if (xp >= 0 && xp < N) delX = xp + 1;
    }
    if (k <= d - 2) {
      const xp = V[prevBase + (k + 1) + prevOff];
      if (xp >= 0 && xp - k <= M) insX = xp;
    }
    let xPre;
    let isDel;
    if (delX >= insX) {
      xPre = delX;
      isDel = true;
    } else {
      xPre = insX;
      isDel = false;
    }
    if (x - xPre > 0) rev.push([KEEP, x - xPre]);
    rev.push([isDel ? DEL : INS, 1]);
    if (isDel) {
      x = xPre - 1;
      k = k - 1;
    } else {
      x = xPre;
      k = k + 1;
    }
  }
  if (x > 0) rev.push([KEEP, x]);

  // Reverse, merging runs of one kind that touch (a zero-length snake leaves
  // two edits of one kind adjacent, as one run).
  const runs = [];
  for (let i = rev.length - 1; i >= 0; i--) {
    const kind = rev[i][0];
    const count = rev[i][1];
    const last = runs.length === 0 ? undefined : runs[runs.length - 1];
    if (last !== undefined && last[0] === kind) last[1] += count;
    else runs.push([kind, count]);
  }
  return runs;
}

/** A text's lines as integer ids, interned in `map` (shared by both texts).
 *  `next` is { value: number }, the next fresh id. Returns the ids and the
 *  split parts (kept so the patch can write the lines back out). */
function tokenize(text, map, next) {
  const parts = text.split('\n');
  const last = parts.length - 1;
  const bare = parts[last] !== '';
  const count = bare ? parts.length : last;
  const ids = new Int32Array(count);
  for (let i = 0; i < last; i++) {
    const key = parts[i];
    let id = map.get(key);
    if (id === undefined) {
      id = next.value;
      next.value++;
      map.set(key, id);
    }
    ids[i] = id;
  }
  if (bare) {
    // The one line with no "\n": key it with a "\n" prefix, which no
    // newline-terminated line's content can carry (it holds no "\n").
    const key = `\n${parts[last]}`;
    let id = map.get(key);
    if (id === undefined) {
      id = next.value;
      next.value++;
      map.set(key, id);
    }
    ids[last] = id;
  }
  return { ids, parts, count };
}

/** A line as the patch writes it: its op, the line, a newline, and "%" on a
 *  line of its own when it had none. `parts` is the text's split, `i` its
 *  line index; the last split part is the bare line, if the text has one. */
function written(op, parts, i) {
  const line = parts[i];
  if (i === parts.length - 1) return `${op}${line}\n%\n`;
  return `${op}${line}\n`;
}

/** The number of lines of a text (for the identical-texts fast path). */
function lineCount(text) {
  if (text.length === 0) return 0;
  let c = 0;
  let i = -1;
  while ((i = text.indexOf('\n', i + 1)) !== -1) c++;
  if (!text.endsWith('\n')) c++;
  return c;
}

/** makefun-diff 1.0.0's answer for one case's input: its patch, as a string. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }
  const oldText = input.old;
  const newText = input.new;

  // Identical texts: the first line alone.
  if (oldText === newText) {
    const n = lineCount(oldText);
    return `${FORMAT} old=${n} new=${n} hunks=0 deleted=0 inserted=0\n`;
  }

  const map = new Map();
  const next = { value: 0 };
  const oldTok = tokenize(oldText, map, next);
  const newTok = tokenize(newText, map, next);
  const a = oldTok.ids;
  const b = newTok.ids;
  const n = oldTok.count;
  const m = newTok.count;

  // The common prefix, then the common suffix of what is left.
  let prefix = 0;
  while (prefix < n && prefix < m && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && a[n - 1 - suffix] === b[m - 1 - suffix]) suffix++;

  const runs = [];
  if (prefix > 0) runs.push([KEEP, prefix]);
  // The middle slices, copied with a sentinel past each end (a real line id
  // is never negative, and the two sentinels differ), so the search's snake
  // stops at either end with no bounds check.
  const N = n - suffix - prefix;
  const M = m - suffix - prefix;
  const aMid = new Int32Array(N + 1);
  aMid.set(a.subarray(prefix, n - suffix));
  aMid[N] = -1;
  const bMid = new Int32Array(M + 1);
  bMid.set(b.subarray(prefix, m - suffix));
  bMid[M] = -2;
  runs.push(...myersRuns(aMid, bMid, N, M));
  if (suffix > 0) runs.push([KEEP, suffix]);

  // The change runs: each a stretch of deletions and insertions between two
  // kept lines, at old line o and new line p.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (let r = 0; r < runs.length; r++) {
    const kind = runs[r][0];
    const count = runs[r][1];
    if (kind === KEEP) {
      o += count;
      p += count;
      continue;
    }
    let c = changes.length === 0 ? undefined : changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (kind === DEL) {
      c.dels += count;
      o += count;
      deleted += count;
    } else {
      c.ins += count;
      p += count;
      inserted += count;
    }
  }

  // The hunks: change runs at most 2 * CONTEXT kept lines apart share one.
  const hunks = [];
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    const h = hunks.length === 0 ? undefined : hunks[hunks.length - 1];
    const prev = h === undefined ? undefined : h[h.length - 1];
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }

  const out = [`${FORMAT} old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  const oldParts = oldTok.parts;
  const newParts = newTok.parts;
  for (let hi = 0; hi < hunks.length; hi++) {
    const h = hunks[hi];
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (let ci = 0; ci < h.length; ci++) {
      const c = h[ci];
      for (; at < c.o; at++) out.push(written('=', oldParts, at));
      for (let i = 0; i < c.dels; i++) out.push(written('-', oldParts, c.o + i));
      for (let i = 0; i < c.ins; i++) out.push(written('+', newParts, c.p + i));
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push(written('=', oldParts, at));
  }
  return out.join('');
}
