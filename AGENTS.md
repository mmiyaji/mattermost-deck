# Agent guidance

## Use cost-efficient models for repeatable validation

When model selection or sub-agent delegation is available, use the lowest-cost model that can reliably execute large, repeatable tests and report their results. Prefer Luna (`gpt-6-luna`) or an equivalent low-cost model for:

- Full unit-test suites, type checks, builds, linting, and release-metadata checks.
- Large E2E suites and repeated browser-based regression runs.
- Performance benchmarks, load tests, soak tests, and monkey tests.
- Routine UI checks such as opening screens, exercising established flows, capturing screenshots, checking responsive layouts, and comparing results against explicit acceptance criteria.
- Setting up and running deterministic fixtures, collecting logs/metrics, and summarizing pass/fail results.

These tasks are usually determined by the code, fixture, and measured output; using a more capable model for every run rarely improves the result. Keep test commands, environment, fixture versions, and output paths explicit so another run can reproduce the evidence. Do not weaken assertions or change expected behavior merely to obtain a passing result.

Use a stronger model only when the work requires substantial judgment—for example, an ambiguous or repeated failure needs root-cause analysis; a test needs architectural redesign; results conflict or need interpretation; a change affects security, privacy, data integrity, or release risk; or a visual/product decision has no clear acceptance criteria. A low-cost model may gather evidence first, then escalate the diagnosis or decision with concise logs and artifacts.

The primary agent remains responsible for reviewing delegated changes, validating claims against test output, and deciding whether the evidence is sufficient. Model choice does not change repository instructions, user authorization, or release requirements.
