# Device flows (Maestro)

The app on a real iOS simulator and Android emulator, in Expo Go, against a local GhostCart. Three flows, run in order:

1. **shopper-offers:** a new shopper finds the ZZ kettle, signs up with their phone and offers ₹1,850. That's above the floor but below what the agent may accept alone, so after a couple of counter-offers it goes to the seller.
2. **seller-approves:** the shop's owner signs in on the same phone as the seller, sees the offer with their limits, and approves it.
3. **shopper-agreed:** back as the shopper, the deal shows the seller's approval, "Agreed at ₹1,850", and the payment to lock it (test mode).

## Run them

Once: install [Maestro](https://maestro.mobile.dev) (Java 17+), then boot an iOS simulator or Android emulator.

```bash
pnpm --filter @ghostcart/web db:seed-mobile        # with the web dev server stopped
E2E_LOGIN_CODE=123456 pnpm --filter @ghostcart/web exec next dev --port 3500 --hostname 0.0.0.0
EXPO_PUBLIC_API_URL=http://<your-LAN-IP>:3500 pnpm --filter @ghostcart/mobile exec expo start --ios      # or --android; installs Expo Go
GHOSTCART_HOST=<your-LAN-IP> apps/mobile/.maestro/run.sh ios                                               # or android
```

- **Seed:** `db:seed-mobile` creates a live ZZ shop. Its owner, +91 90000 03101, signs in as the seller, and the shop sells a ₹2,000 kettle with a 10% maximum discount, 5% of it automatic. It's safe to run again.
- **Fixed sign-in code:** `E2E_LOGIN_CODE` fixes phone sign-in codes so the flows can type them. It only works in local development: never in production builds, on Vercel, or when Vobiz (real calls) is configured.
- **A new shopper each run:** each run signs up a new shopper (+91 90000 4xxxx). Restart the web dev server if you hit the sign-in rate limit after many runs; in development the limits are kept in memory.
- **Platform notes:**
  - On iOS, the number pad has no Done key, so the flows close it by tapping text above the field.
  - On Android, they close the keyboard the way its ✓ key does.
  - Expo Go on Android opens its developer menu after its data is cleared; the flows close it.

A JUnit report is written to `report-<platform>.xml`.
