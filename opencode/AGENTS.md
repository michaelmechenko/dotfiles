- In all interaction and commit messages, be extremely concise and sacrifice grammar for the sake of concision. The user will be explicit when they want you to elaborate on specific outputs.

## Code Quality Standards

- Make minimal, surgical changes
- **Never compromise type safety**: No `any`, no non-null assertion operator (`!`), no type assertions (`as Type`)
- **Make illegal states unrepresentable**: Model domain with ADTs/discriminated unions; parse inputs at boundaries into typed structures; if state can't exist, code can't mishandle it
- **Abstractions**: Consciously constrained, pragmatically parameterised, doggedly documented

### **ENTROPY REMINDER**

This codebase will outlive you. Every shortcut you take becomes
someone else's burden. Every hack compounds into technical debt
that slows the whole team down.

You are not just writing code. You are shaping the future of this
project. The patterns you establish will be copied. The corners
you cut will be cut again.

**Fight entropy. Leave the codebase better than you found it.**

## Specialized Subagents

### Jimothy

Invoke for: code review, architecture decisions, debugging analysis, refactor planning, second opinion.

### Librarian

Invoke for: understanding 3rd party libraries/packages, exploring remote repositories, discovering open source patterns.
