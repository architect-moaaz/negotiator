# Security controls

What protects GhostCart today, and what's still to do. Update this when you add or change a control.

## In place

| Area | Control | Where |
| --- | --- | --- |
| Browser | CSP (no plugins, no framing, scripts only from us and Meta's SDK, same-origin fetches), HSTS, nosniff, `X-Frame-Options: DENY`, strict referrer, Permissions-Policy | `apps/web/security-headers.ts` |
| Sessions | Server-side, revocable sessions for buyers, sellers, staff and members; OTP-verified phones | `lib/session.ts`, `lib/otp.ts` |
| Staff | Roster with roles (owner / approver / viewer) and per-permission checks; every money or PII action audited | `lib/staff.ts` |
| Abuse | Rate limits on OTP, verification, haggling, complaints, the widget lookup and deal polling | `lib/rate-limit.ts` |
| Secrets | Envelope encryption for platform tokens, webhook secrets and number PINs: a random data key per secret (AES-256-GCM), wrapped by a named key-encryption key from `SECRETS_KEYS`; rotation re-wraps data keys only (`db:rotate-secrets`). API keys stored hashed; identities (PAN, bank) stored as keyed hashes | `lib/crypto.ts`, `lib/secrets-rotation.ts`, `lib/integrations/keys.ts`, `lib/verification/identity-hash.ts` |
| Webhooks | Inbound: Shopify HMAC, Meta `X-Hub-Signature-256`, Pine Labs signature. Outbound to sellers: HMAC-signed with retries | `lib/shopify/*`, `lib/meta/*`, `lib/integrations/webhooks.ts` |
| Money | Code sets every price; the LLM can only pick from moves the code allowed. Double-entry ledger; holds until delivery | `packages/core`, `lib/orders/*` |
| Fraud | Self-dealing blocks, velocity limits, device links, duplicate identity detection, flagged orders | `lib/fraud/*` |
| Privacy | Consent records, data export, account erasure, grievance queue | `lib/privacy/*` |
| Supply chain | Dependabot weekly grouped updates for npm and GitHub Actions; lockfile committed; CI on every PR | `.github/` |

## Why the CSP allows inline scripts

Cache Components serves prerendered static shells. Their inline bootstrapping scripts can't carry a per-request nonce, so `script-src` includes `'unsafe-inline'`. The rest of the policy still holds. Revisit if Next ships hash-based CSP for inline scripts in PPR shells.

## To do (lead)

- Turn on GitHub secret scanning and CodeQL. Both need GitHub Advanced Security on a private repo.
- Publish `/.well-known/security.txt` once there's a security contact address.
- Commission an external penetration test before public launch, covering payments, seller onboarding and the widget.
- Set `IDENTITY_HASH_SECRET`, `SECRETS_KEYS` (plus `SECRETS_KEY_ID`) and `CRON_SECRET` in every Vercel environment, and rotate them if they ever appear in a log or chat. To rotate the secrets key: put a new key in front of `SECRETS_KEYS`, point `SECRETS_KEY_ID` at it, deploy, run `pnpm --filter @ghostcart/web db:rotate-secrets --confirm`, then drop the old key once the dry run shows none left on it. A KMS (AWS KMS or GCP KMS) can replace the env-held key-encryption keys later without changing the stored format.
