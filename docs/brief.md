# Laminar — Project Brief

**Tagline:** Turn the turbulent into structure.

## What it is
A mobile-first web game where data scientists and analysts practice turning vague business asks into structured problem statements, hypotheses, and investigation plans.

## Audience
Data scientists and analysts. Scenarios are written in realistic stakeholder voice (Slack messages, email forwards) with vague language, imperfect data, plausible red herrings, and real constraints (deadlines, no eng support).

## Hard constraints (v1)
- **No backend server.** Static site (GitHub Pages or a subpath of laminarinsight.com).
- **No LLM dependency** for core gameplay or scoring.
- **Mobile-first.** Must play well on a phone; desktop just shows more at once.
- **Realistic scenarios**, with **multiple valid structures** per scenario.

## Round structure (one scenario, ~5–7 min)
1. **Reframe** — player first writes a one-sentence problem statement (free text, short), then picks the best of 4–5 options. Wrong options carry flaw tags: `assumes_cause`, `jumps_to_solution`, `unmeasurable`, `too_narrow`.
2. **Ask** — spend a budget of ~5 questions from a menu of ~12. Each reveals a fact. Some reveals unlock new components.
3. **Structure** — choose a spine (e.g., metric math, lifecycle, internal vs external), then tap-to-assign component cards one at a time to bucket chips (plus `noise` and `ruled_out`).
4. **Prioritize** — tap branches in the order you'd investigate.
5. **Debrief** — show the player's structure against the other valid spines, the answer-key narrative, and what a senior analyst would do. This is the core learning moment.

## Scoring (deterministic)
- **Coverage:** key drivers included, per chosen spine.
- **MECE:** no component in two buckets, nothing orphaned.
- **Noise:** penalty for treating red herrings as drivers (decide: always, or only after the revealing question was asked).
- **Efficiency:** coverage per question spent.
- **Prioritization:** rank vs. driver contribution weights.
- **Spine-independent checks:** validated metric definition, checked seasonality, clarified the decision.

## Free-text grading (v1.5)
- Small in-browser sentence-embedding model (~20–30 MB, quantized, Transformers.js) compares the player's reframe to authored references and flaw patterns.
- Load it in the background during Round 1.
- Fallback to keyword + multiple choice if it fails to load.
- Later, optional "deeper feedback" via a free API with the player's own key. Give any model narrow jobs (classify, match), never open-ended grading.

## Mobile UX rules
- No drag-and-drop; use tap-to-assign and tap-order ranking.
- 3–4 bucket chips per screen max.
- Collapsed tree review, expanding one bucket at a time.
- One-sentence text inputs with a soft character limit.
- Save after each round to localStorage so dropped sessions resume.
- Portrait share card (Wordle-style emoji grid) + result encoded in URL hash.

## Platform features (no server)
- Daily scenario chosen by date index.
- Progress and streaks in localStorage.
- Scenarios as JSON in the repo, with a validator script that checks every component maps to a valid bucket in every listed spine.

## Scenario schema (JSON, per scenario)
- `id`, `archetype`, `domain`, `title`
- `ask` — stakeholder message text, sender, constraints
- `reframe_options[]` — text, `is_best`, `flaw_tags[]`, `explanation`
- `reference_frames[]` — for embedding comparison
- `questions[]` — text, reveal, value (`high|med|low|noise`), `unlocks[]` component ids
- `components[]` — id, text, type (`driver|evidence|ruled_out|red_herring|assumption`), `weight` (drivers), `unlocked_by` (optional), `buckets` map: `{spine_id: bucket_id}`
- `spines[]` — id, name, `buckets[]`
- `global_checks[]` — which question ids satisfy each check
- `priority_key[]` — ordered component/bucket ids with rationale
- `debrief` — answer-key narrative

Limits: 2–3 spines and ~15–20 components per scenario.

## Archetypes (for reskinning across domains)
1. Metric moved and nobody knows why
2. Ambiguous strategic ask
3. Conflicting dashboards
4. "Build us a model" with no defined decision

## Scenario 1 (draft): "The member base feels softer"
Fictional warehouse club. VP of Membership Slack: leadership asks why membership feels softer; renewals deck looked off; need something by Thursday's staff meeting; don't boil the ocean.

**Answer key:** renewal rate 78% → 74%.
- ~2 pts mix shift: last fall's $20 promo cohort hitting first renewal, renews ~55% vs ~80% full price, 13% of renewal base vs usual 5%.
- ~1 pt measurement: grace window extended 30 → 60 days in May; recent months still filling in.
- ~0.5 pt auto-renew moved to opt-in in app signup in July.
- ~0.5 pt normal Q3 seasonality.

**Reframe options:**
- A ✓ Determine whether and why the renewal rate declined this quarter, and which drivers are actionable before Thursday.
- B Find out why members are unhappy. (assumes_cause)
- C Build a churn prediction model. (jumps_to_solution)
- D Explain why the member base feels softer. (unmeasurable)
- E Determine whether the competitor opening caused the drop. (too_narrow)

**Questions (budget 5):**
| Question | Reveal | Value |
|---|---|---|
| What metric does "softer" mean? | Renewal rate 78%→74%; total members flat | high |
| Did the metric definition change? | Grace window 30→60 days in May | high |
| Renewal by acquisition cohort? | Promo cohort renews 55%; share jumped (unlocks promo cohort) | high |
| What decision is leadership making? | Unclear; maybe whether to rerun the promo | high |
| Recent product/checkout changes? | Auto-renew became opt-in in July | med |
| Same period last year? | Q3 usually dips ~1 pt | med |
| Any fee change? | None in 2 years | med |
| Member-level data by Thursday? | Yes, but cohort tags only go back a year | med |
| All markets or some? | Broad-based; 2 markets slightly worse | low |
| What did the competitor do? | Opened in 2 markets in August | low |
| What does NPS say? | Down 4 pts, but survey vendor changed | noise |
| Any app outages? | 2-day crash in August | noise |

**Spines:**
1. Metric math: measurement artifact / mix shift / within-segment rate change
2. Member lifecycle: acquisition / onboarding & auto-renew / engagement / renewal moment
3. Internal vs external: measurement / internal changes / external factors

**Components:** drivers (promo cohort renewal, grace-window change, auto-renew opt-in, seasonality, low shopping frequency among promo members); evidence (full-price renewal stable, total members flat); ruled out (fee increase); red herrings (competitor openings, NPS drop, app outage); assumptions (unhappy with assortment, economic pressure).

**Priority key:** measurement artifact → cohort mix → auto-renew → rest.

## Suggested first build
1. Scenario JSON for Scenario 1 + validator script.
2. Mobile prototype of Reframe + Ask + Structure (tap-to-assign) + Debrief with deterministic scoring.
3. Then embedding-based reframe grading.
