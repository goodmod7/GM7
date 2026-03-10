# Desktop Sign-In Flow

The desktop app is now the primary product entry point.

## Overview

1. The signed-out desktop app shows `Sign in`.
2. Clicking `Sign in` opens the external system browser.
3. The browser completes normal website auth.
4. The website issues a short-lived handoff token to the desktop loopback callback.
5. The desktop exchanges that handoff token for a durable per-device token.
6. The desktop stores the durable token in keychain storage and reconnects automatically.

## Security Model

- The desktop uses the external system browser, not an embedded login webview.
- The browser callback uses a loopback redirect on `127.0.0.1`.
- The desktop auth handoff token is short-lived and expires within two minutes.
- The handoff token is single-use.
- The exchange validates state/nonce and rejects replay.
- The durable desktop token stays local to the desktop keychain.

## API Flow

- `POST /desktop/auth/start`
  - Registers the auth attempt with `deviceId`, callback URL, state, and nonce.
- Browser auth completes on the website.
- `POST /desktop/auth/complete`
  - Issues the one-time handoff token after browser auth succeeds.
- Browser redirects to the local loopback callback.
- `POST /desktop/auth/exchange`
  - Consumes the handoff token and returns the durable device token.

## Sign Out And Revoke

- Desktop sign out clears the local keychain token.
- Desktop sign out also calls `POST /desktop/auth/logout` to revoke the current desktop session remotely.
- Reconnects with a revoked token fail cleanly.
- Other signed-in desktops are not revoked automatically.

## Multi-Device Behavior

- Multiple desktops can be signed in at the same time.
- Each desktop keeps its own durable device token.
- Signing in again on the same desktop may rotate that desktop token.
- Revoking or signing out one desktop does not revoke sibling desktops by default.
