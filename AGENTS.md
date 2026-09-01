# FrilDay repository guidance

This repository is for FrilDay, a timer-first time planning application. Keep
the product and its architecture aligned with the rules below when adding or
changing code.

## Product identity

- FrilDay's core loop is **Plan → Execute → Track → Review → Adjust**.
- The primary comparison is **planned time vs actual time**.
- Completion is a secondary signal. Do not reduce the product or its success
  criteria to a binary done/not-done state.
- Desktop v0.1 is local-first. The active timer and today's executable plan
  have priority over analytics, configuration, and other secondary surfaces.
- Google Search Timer is an interaction and reference source for the timer
  surface only. It is not a FrilDay brand or asset source.

## Product anti-goals

Do not introduce work that turns FrilDay into a generic Todo, habit,
Pomodoro, calendar, or dashboard application. New product behavior should
reinforce the timer-first planning loop and make planned-versus-actual time
more useful.

## Architecture boundaries

- The intended desktop v0.1 runtime is:

  `React → Tauri adapter → frilday-core → SQLite adapter`

- The current codebase is mid-extraction: active desktop domain and SQLite
  integration remain under `apps/desktop` until reusable rules are moved into
  `crates/frilday-core`.
- The future Axum server is a separate delivery adapter. Desktop v0.1 does
  not require a local Axum HTTP server to run.
- Reusable domain rules belong in `crates/frilday-core`.
- UI and transport layers should remain thin and should not become alternate
  homes for core business rules.
- Do not add infrastructure unless it has a concrete release benefit.

## Repository and data safety

- Keep the FrilDay identity in package, product, and user-facing metadata.
- Preserve persisted storage keys, database filenames, and legacy identifiers
  unless an explicit, tested migration is included. Avoid broad renames that
  risk existing user data.
- Keep documentation links repository-relative; never commit local absolute
  filesystem paths.
- Do not add a product feature as part of documentation or identity cleanup.
