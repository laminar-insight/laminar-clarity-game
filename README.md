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
| `js/semantic.js` | Embedding grader for the written reframe: pure cosine-similarity math, unit-tested without a model |
| `js/embedder.js`, `js/embed-worker.js` | Load the sentence-embedding model in a Web Worker in the background and embed text |
| `js/reframe.js` | Keyword feedback on the written reframe, plus the keyword fallback score |
| `js/storage.js` | localStorage: resuming runs, streaks, and daily scenario selection |
| `js/share.js` | Emoji share grid and encoding of the result into the URL hash |
| `scenarios/*.json` | Scenario content, listed in `scenarios/index.json` |
| `scripts/validate.mjs` | Scenario validator |
| `scripts/calibrate.mjs` | Prints embedding scores for sample sentences, for tuning the thresholds |
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
| Reframe | 10 | 60% for picking the best option, 40% for the written sentence (see below) |
| Coverage | 25 | Driver weight filed in the right branch for your spine. A wrong real branch earns half credit. Drivers you never surfaced earn nothing |
| MECE | 10 | −10 for each unassigned card, and −10 for each branch left empty even though a card you surfaced belongs in it |
| Noise | 15 | A red herring or ruled-out card filed as a driver costs −12, or −25 if you asked the question that debunks it. An untested assumption filed as a driver costs −15 |
| Efficiency | 10 | Mean value of the questions you asked (high 1, med 0.6, low 0.25, noise 0) |
| Prioritization | 15 | Pairwise agreement between your branch order and the order derived from the priority key |
| Sanity checks | 15 | Share of global checks met: validated the metric, checked seasonality, clarified the decision |

The brief left the noise policy open. This build always penalizes promoting a red herring, but the penalty doubles once you had the evidence against it.

In Scenario 1, the budget of 5 questions forces a real tradeoff. With the senior analyst's five questions you pass every check but miss the smallest driver. To cover every driver, you have to skip the decision question.

## Written reframe grading (v1.5)

Round 1 grades the player's one-sentence problem statement with a small sentence-embedding model that runs in the browser. There is no server and no LLM.

- **Model:** [`Xenova/all-MiniLM-L6-v2`](https://huggingface.co/Xenova/all-MiniLM-L6-v2), 8-bit quantized (about 23 MB), run with [Transformers.js](https://github.com/huggingface/transformers.js) 3.8.1 in a Web Worker. The library comes from jsDelivr and the model files come from the Hugging Face hub. The browser caches both after the first load.
- **When it loads:** in the background as soon as Round 1 starts. A status pill shows its progress. Grading happens when the player confirms their multiple-choice pick, which gives the download as much time as possible.
- **How it scores:** the sentence is embedded and compared by cosine similarity with the scenario's `reference_frames` plus the best option, and with `flaw_patterns` plus the wrong options, each filed under its flaw tag. The best reference similarity is mapped linearly from `floor` (0) to `ceiling` (100). If a flaw pattern is at least `flawMin` similar and beats the best reference by `flawMargin`, the score is halved and the debrief names that flaw. The defaults are in `js/semantic.js`, and a scenario can override them with a top-level `grading` object.
- **Fallback:** if the model fails to load, or isn't ready within 4 seconds of confirming, the sentence is scored with the keyword check: start at 40, +20 for each good signal, −25 for each flaw. Add `?grader=keyword` to the URL to force the fallback.
- **Determinism:** the written grade and the method used are saved with the run when the player confirms Round 1. Scoring reads the saved grade, so a debrief or a shared result never changes because a model did or didn't load later.

**The default thresholds are not calibrated against real model output yet.** To collect data in the browser, add `?debug=1` to the URL. After grading, Round 1 lists the similarity to every reference and flaw, with a button that copies them. Or run this somewhere that can reach huggingface.co:

```sh
npm i --no-save @huggingface/transformers@3.8.1
node scripts/calibrate.mjs membership-softer "any extra sentence to try"
```

It prints the score, the similarity to the closest reference, and any flagged flaw for every multiple-choice option and for a set of typical player sentences.

## Roadmap

- Calibrate the embedding thresholds (see above).
- Optional "deeper feedback" using a free API and the player's own key, limited to narrow classify/match jobs.
- More scenarios across the four archetypes.
