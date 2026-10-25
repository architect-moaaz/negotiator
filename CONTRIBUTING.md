# Contributing to GhostCart

## Workflow: pull requests into `main`

1. Update: `git checkout main && git pull`
2. Branch: `git checkout -b <type>/<short-name>`. Types: `feat`, `fix`, `docs`, `chore`.
3. Commit small, focused changes with messages that say why.
4. Before pushing, all four must pass:
   ```bash
   pnpm exec tsc --noEmit && pnpm lint && pnpm test && pnpm build
   ```
5. Open a PR into `main`. Fill in what changed, how you tested it, and any new environment variables.
6. One teammate reviews and approves. Claude's PRs need a human approval too.
7. Merge (squash). `main` is what's live on Vercel.

Agents (Claude included) follow the same steps and never push to `main` directly.

## Local setup

```bash
pnpm install
cp .env.example .env.local   # fill in what you need; most features degrade gracefully
pnpm dev
```

Without keys: no Firecrawl means plain fetch; no Anthropic means template replies; no Pine Labs means the mock gateway or static UPI QR; no Vobiz means login codes print to the dev console.

## Environment variables

- Document every new variable in `.env.example` with a comment.
- Add production values with `vercel env add NAME production` from this folder, then redeploy.
- Never paste secrets into PRs, issues or chat.

## Testing on production

- Use test numbers `9000000xxx` and names starting with `ZZ` so the data can be cleaned up.
- Be careful: production places real Vobiz calls and spends real Firecrawl and Anthropic credits.

## Code style

Match the surrounding code: TypeScript, small modules in `src/lib`, pure functions for rules (with tests), short comments that explain why. Read [CLAUDE.md](CLAUDE.md) for the architecture map and the non-negotiable rules.
