# AGENTS.md — common-organizations-client-utils

`@nexum-io/common-organizations-client-utils` — S2S HTTP client for `core-organizations-ms`. Owner: Engineering.

Workspace rules: [`../../AGENTS.md`](../../AGENTS.md).

## Verify

```bash
npm run ci:check
```

## Agent delivery

- **SDD** is forbidden in this repo (no `.ai-sdd/`, no `.superpowers/sdd/`, no design specs or plans). This product has no docs hub. Ask the user where to file the SDD before writing it. API, ENV, and OpenAPI contracts for this service stay here.
- **Large work** is a Linear epic of tasks. One merge request is one task. Do not start implementation without a Linear issue unless the user explicitly says to proceed without one.
- **MR size** stays within 400–800 changed lines (lockfiles and generated artifacts excluded). Split near 400 lines. Above 800, explain in the handoff why the code is that large and why it was not split. Not a CI gate.
- **Reuse** a solution that already works in this repo or in `common/`. If the same logic appears more than once, ask the user before copying it and extract a shared component.
- **Security and quality** stay in the change (auth, money, signing, secrets, validation). Run this repo’s verify command.
- **Committees:** when the diff touches an important area, recommend the matching review before merge. Do not run it unless the user asks.
  - ownership, contracts, trust, money or chain boundaries → `/nexum-architecture-committee`
  - processors, queues, chain execution, KMS → `/nexum-processing-review`
  - schema, migrations, repositories → `/nexum-data-repository-committee`
  - CI, pipeline secrets, release gates → `/nexum-devsecops-committee`
