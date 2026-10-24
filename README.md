# Laminar

**Turn the turbulent into structure.**

Laminar is a daily, mobile-first web game for data scientists and analysts. Each round gives you a vague stakeholder ask, and you turn it into a problem statement, an issue tree, and an investigation plan. Scoring is deterministic and the site is fully static: no backend, no LLM. See [`docs/brief.md`](docs/brief.md) for the full brief.

## Play locally

```sh
npm run serve        # http://localhost:8080 (no dependencies to install)
```

The game loads its scenarios with `fetch`, so it has to be served over HTTP. Opening `index.html` directly from disk won't work. Add `?s=<scenario-id>` to the URL to load a specific scenario instead of today's.

## Deploy

The repo root is the site, with no build step. On GitHub Pages, choose **Settings → Pages → Deploy from a branch** and pick the branch and `/ (root)`. The site also works from any subpath (for example `laminarinsight.com/laminar/`), because every asset path is relative.

## Layout

| Path | What it is |
|---|---|
| `index.html`, `css/`, `js/main.js` | The UI: home, brief, the 5 rounds, the debrief, and the shared-result view |
| `js/scoring.js` | Pure, deterministic scoring that runs in both the browser and Node |
| `js/reframe.js` | Keyword feedback on the free-text reframe (v1 fallback, not scored) |
| `js/storage.js` | localStorage: resuming runs, streaks, and daily scenario selection |
| `js/share.js` | Emoji share grid and encoding of the result into the URL hash |
| `scenarios/*.json` | Scenario content, listed in `scenarios/index.json` |
| `scripts/validate.mjs` | Scenario validator |
| `tests/` | `node:test` suite |

## Checks

```sh
npm run validate     # every scenario in scenarios/index.json
npm test
```

The validator checks that every component maps to a valid bucket in every spine (a spine's own buckets, plus `noise` / `ruled_out`). Drivers and evidence must land in a real branch, and non-drivers must land only in `noise` / `ruled_out`. It also checks that `unlocks` and `unlocked_by` agree in both directions, that there is exactly one best reframe, that flaw tags are valid, that question ids exist in the global checks and priority key, and that each spine has 2–4 buckets so the chips fit on a phone.

## Scenario schema notes

The schema follows the brief, with these additions:

- **`buckets`** values can be a single bucket id or an array of acceptable ids. The first id in an array is the canonical answer.
- **`debunked_by`** (on non-drivers) lists the questions whose answers show the card is noise. The noise penalty uses it.
- **`question_budget`**, **`company`**, **`ask.messages[]`**, **`spines[].blurb`**, **`debrief.headline` / `breakdown` / `senior_analyst` / `thursday_line`**, and **`flaw_patterns`** were added. `flaw_patterns` is reserved for embedding-based grading in v1.5.
- **`priority_key`** is independent of any spine: it is an ordered list of component ids. Each spine's expected branch order is derived from it, with a branch ranking by the earliest key entry that falls in it.

## Scoring

Scores range from 0 to 100, as a weighted sum of seven categories:

| Category | Weight | Rule |
|---|---|---|
| Reframe | 10 | Picked the best option |
| Coverage | 25 | Driver weight filed in the right branch for your spine. A wrong real branch earns half credit. Drivers you never surfaced earn nothing |
| MECE | 10 | −10 for each unassigned card, and −10 for each branch left empty even though a card you surfaced belongs in it |
| Noise | 15 | A red herring or ruled-out card filed as a driver costs −12, or −25 if you asked the question that debunks it. An untested assumption filed as a driver costs −15 |
| Efficiency | 10 | Mean value of the questions you asked (high 1, med 0.6, low 0.25, noise 0) |
| Prioritization | 15 | Pairwise agreement between your branch order and the order derived from the priority key |
| Sanity checks | 15 | Share of global checks met: validated the metric, checked seasonality, clarified the decision |

The brief left the noise policy open. This build always penalizes promoting a red herring, but the penalty doubles once you had the evidence against it.

In Scenario 1, the budget of 5 questions forces a real tradeoff. With the senior analyst's five questions you pass every check but miss the smallest driver. To cover every driver, you have to skip the decision question.

## Roadmap

- v1.5: replace the keyword reframe feedback with in-browser sentence embeddings (Transformers.js), compared against `reference_frames` and `flaw_patterns`. The model loads in the background during Round 1, and the keyword check stays as the fallback.
- More scenarios across the four archetypes.
