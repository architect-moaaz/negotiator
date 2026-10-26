# GhostCart mobile (Expo)

One app for both sides:
- **Shoppers:** browse every live GhostCart shop, haggle with the shop's agent, lock the price by UPI, check out and track the order.
- **Sellers:** approve, reject or counter offers the agent can't take on its own. Each offer arrives as a push notification, and tapping it opens the offer.

Expo SDK 58, React Native 0.88, expo-router.

## Run it

```bash
pnpm install
pnpm --filter @ghostcart/web dev
EXPO_PUBLIC_API_URL=http://<your-computer's-LAN-IP>:3000 pnpm --filter @ghostcart/mobile start
```

Scan the QR code with Expo Go, or press `i` / `a` for a simulator.

`pnpm --filter @ghostcart/mobile web` runs the app in a browser. To use it, set `MOBILE_DEV_ORIGIN=http://localhost:8081` on the web dev server. That allows CORS in development only; native apps don't need it.

## How it talks to the API

- **Sign-in:** the same phone-code flow as the website, with `client: "mobile"`. The server returns a session token instead of setting a cookie.
- **Sessions:** tokens are kept in the Keychain or Keystore (`expo-secure-store`) and sent as `x-gc-buyer` / `x-gc-member` headers. The server treats them like its cookies.
- **Push:** the app registers its Expo push token at `POST /api/push` for every role signed in on the phone. The server sends offers to approvers, and decisions and shipping updates to shoppers (only if they still allow contact).

## Before the stores (lead)

1. Create the EAS project (`eas init`) and put its id in `app.json` → `extra.eas.projectId`. Push tokens need it.
2. Set `EXPO_ACCESS_TOKEN` on the server if push security is enabled in the Expo project.
3. Add the Apple push key and Firebase (FCM v1) credentials in EAS, then run `eas build` for iOS and Android.
4. Prepare the store listings: icon, screenshots, privacy labels (phone number, name and address, collected for orders) and the content rating.
5. Device QA with Maestro flows (sign-in, haggle, approve), per the plan's Wave 4 verification.
