# AGENTS.md

## Purpose

This repository is maintained with Codex assistance.
Work carefully, preserve existing behavior, and prefer small, verifiable changes over broad rewrites.

## Before You Change Anything

1. Inspect the repository structure before editing files.
2. Read the relevant README, package/config files, schemas, and nearby source files.
3. Understand the existing architecture, naming conventions, and coding style.
4. Check `git status` before making changes.
5. Do not assume a framework, database, package manager, or runtime; detect it from the repository.
6. For a non-trivial change, briefly state the implementation plan before editing.

## General Engineering Rules

- Preserve working behavior unless the task explicitly requests a behavior change.
- Prefer the smallest maintainable change that fully solves the problem.
- Do not rewrite unrelated code.
- Reuse existing components, utilities, patterns, and abstractions where reasonable.
- Avoid unnecessary dependencies.
- Keep functions and modules focused.
- Use clear names; avoid vague names such as `data`, `temp`, or `thing` when a specific name is possible.
- Remove dead code introduced by your changes.
- Do not silently swallow errors.
- Handle relevant edge cases.
- Keep comments focused on why something is done, not obvious line-by-line narration.
- Do not leave placeholder implementations unless explicitly requested.

## Debugging Workflow

When fixing a bug:

1. Reproduce or identify the failure first.
2. Read the complete error message, logs, stack trace, and relevant code path.
3. Find the root cause rather than patching only the visible symptom.
4. Make the smallest safe fix.
5. Add or update a regression test when practical.
6. Re-run the relevant checks after the fix.

Do not repeatedly make speculative changes without verifying the result.

## Frontend / UI

When working on frontend code:

- Follow the existing design language before introducing a new one.
- Maintain clear visual hierarchy, consistent spacing, typography, and component states.
- Avoid generic AI-looking layouts, excessive gradients, excessive cards, and unnecessary decorative effects.
- Prefer reusable components over duplicated markup.
- Support responsive layouts for mobile, tablet, and desktop when the project is responsive.
- Check for overflow, clipping, broken navigation, and overlapping elements.
- Preserve accessibility:
  - semantic HTML
  - keyboard usability
  - meaningful labels
  - alt text where appropriate
  - sufficient contrast
  - visible focus states
- Include loading, empty, error, disabled, and success states when relevant.

## Backend / API

When working on backend or API code:

- Validate external input.
- Return clear and consistent errors.
- Do not expose stack traces, secrets, or internal implementation details to clients.
- Keep business logic separate from transport/controller code when the project architecture supports it.
- Preserve existing API contracts unless the task explicitly changes them.
- Consider authentication, authorization, idempotency, and concurrency when relevant.

## Database

When changing database-related code:

- Inspect the existing schema and relationships first.
- Preserve data integrity.
- Use appropriate primary keys, foreign keys, unique constraints, and checks.
- Avoid redundant data unless denormalization is intentional and justified.
- Consider NULL behavior and referential actions.
- Do not delete or rename columns/tables in a destructive way without clearly identifying the impact.
- If migrations are used, create a migration instead of manually assuming the schema state.
- For SQL, verify joins and aggregation logic against the requested result.

## C / Systems Programming

When working with C or POSIX code:

- Compile with warnings enabled when the project permits, e.g. `-Wall -Wextra`.
- Check return values from system calls and library functions where failure matters.
- Avoid buffer overflows, use-after-free, double-free, and uninitialized memory.
- Clean up resources on all relevant paths:
  - allocated memory
  - file descriptors
  - message queues
  - mutexes/semaphores
  - sockets
- Keep shared structs/protocol definitions synchronized between communicating processes.
- Pay attention to race conditions and blocking behavior.

## Security

- Never hardcode passwords, API keys, tokens, private keys, or credentials.
- Never commit `.env` files containing secrets.
- Treat user-controlled input as untrusted.
- Avoid command injection, SQL injection, XSS, path traversal, insecure deserialization, and unsafe shell construction.
- Do not weaken authentication, authorization, validation, sandboxing, or security checks just to make a test pass.
- For cybersecurity/CTF repositories, keep actions scoped to the provided challenge/lab environment.

## Testing and Verification

After making changes, run the most relevant checks available in the repository, such as:

- unit tests
- integration tests
- type checking
- linting
- formatter checks
- build
- targeted runtime/manual verification

Do not claim that something works unless it was verified, or clearly state what could not be verified and why.

If a command fails:

1. Read the failure.
2. Determine whether it is caused by your change or the environment.
3. Fix issues caused by your change.
4. Re-run the relevant command.

## Git Hygiene

- Inspect the current diff before finishing.
- Do not modify unrelated files.
- Do not revert user changes unless explicitly asked.
- Do not create or switch branches unless requested.
- Do not commit, push, force-push, merge, rebase, or open a pull request unless requested.
- Never commit secrets or generated junk files.
- Keep changes logically scoped.

## Large Tasks

For complex features, architectural changes, or significant refactors:

1. Inspect the relevant code first.
2. Break the task into small implementation steps.
3. Identify files/modules that will change.
4. Identify schema/API compatibility risks.
5. Implement incrementally.
6. Verify after each meaningful stage.

If the repository provides a dedicated planning document such as `PLANS.md`, follow it.

## Definition of Done

Before declaring the task complete, confirm that:

- the requested behavior is implemented
- existing behavior was not unintentionally broken
- relevant errors and edge cases are handled
- the diff contains no unrelated changes
- relevant tests/checks were run
- build/lint/type checks pass when available
- no secrets or debug artifacts were introduced
- documentation was updated if behavior or setup changed

Finish with a concise summary containing:

1. what changed
2. important files changed
3. verification performed
4. any remaining limitation or follow-up, if applicable
