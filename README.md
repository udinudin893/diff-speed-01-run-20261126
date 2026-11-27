# diff-speed-01-run-20261126

[![make.fun · diff-speed-01-run-20261126](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/udinudin893/diff-speed-01-run-20261126/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/udinudin893/diff-speed-01-run-20261126/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)

Built for the make.fun bounty — [Diff two texts faster, 27 November 2026](https://make.fun/bounty/diff-speed-01-run-20261126) ($100 in USDC).

A faster drop-in for make.fun's own `makefun-diff` 1.0.0, for the make.fun
bounty ["Diff two texts faster, 27 November 2026"](https://make.fun/bounty/diff-speed-01-run-20261126)
($100, 1st–10th place $10 each).

`run(input)` returns, for every case's `{ old, new }`, exactly the answer
`makefun-diff` 1.0.0 returns: make.fun's own patch of the two texts, as one
JSON string. Same rule, faster machinery:

- Lines are cut after every `\n` (the only separator; `\r` is part of its
  line); a last line with no `\n` is a line too. Lines are interned to small
  integers, so the whole search compares integers instead of strings.
- The common prefix of lines is kept, then the common suffix of the lines
  left — exactly as the reference does.
- Between them, Myers's greedy search with make.fun's tie-break (the
  deletion when a deletion and an insertion reach the same point, no edge
  diagonal pruned, every run of equal lines followed as far as it goes).
  Instead of the reference's linked path objects (one allocation per diagonal
  per d), the furthest x of every (d, k) is kept in one flat `Int32Array`
  and the script is recovered by walking back down the same rule. Same
  search, same tie-break, same script — no allocations in the hot loop.
- The patch is built exactly as the reference builds it (header line, hunks
  with up to 3 kept lines of context, `%` after a line with no newline,
  identical texts the first line alone).

## Layout

- `solve.js` — the entry: dependency-free ES module, `run(input)`.
- `main.ts` — the harness driver (the house baseline's driver, kept as-is):
  reads every case from `/input/cases.json`, answers each with `run`, writes
  `/output/answers.json`.

## Verification

On the kit's practice set (4 cases, 21k–32k lines each) the answers match
the reference byte for byte, and on 12 freshly generated case sets plus
3,000 small and 60 medium fuzz cases (empty texts, bare last lines, `\r`,
identical texts, unrelated texts) every answer is identical to
`makefun-diff` 1.0.0's.

Speed (steady-state CPU per case, same machine): ~55–65 ms vs the house
baseline's ~300–370 ms — about 5.5× faster.

## Licence

MIT. See `LICENSE`.
