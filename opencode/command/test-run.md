---
description: Run tests and analyze failures
---

Run the project's test suite and analyze results.

<instructions>
1. Detect test framework (npm/pnpm/yarn scripts, pytest, cargo test, etc.)
2. Run appropriate test command
3. If failures occur:
   - Identify root cause from error messages
   - Locate failing test files
   - Suggest minimal fix
   - Verify fix won't break other tests
4. If tests pass, report success with coverage info if available
</instructions>

<test_command_detection>
Check package.json for:
- `npm test` or `npm run test`
- `pnpm test`
- `yarn test`

For Python:
- `pytest`
- `python -m pytest`

For Rust:
- `cargo test`

For Go:
- `go test ./...`
</test_command_detection>

<context>
$ARGUMENTS
</context>

<output>
- Test command executed
- Pass/fail summary
- If failures: Root cause + suggested fix
- If success: Coverage stats (if available)
</output>
