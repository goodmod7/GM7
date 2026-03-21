# Desktop Fresh Sign-In Device Registration Design

## Goal

Allow a brand-new desktop install to complete browser sign-in successfully even when no persisted `Device` row exists yet.

## Problem

The desktop-first auth flow assumes the backend already has a persisted `Device` row for the current `deviceId`. In practice, a fresh desktop install starts signed out and does not open the WebSocket, so the backend never receives `device.hello` and never creates the row. Later, `/desktop/auth/exchange` consumes the browser handoff successfully but rejects the sign-in with `Device not found`.

## Approved Approach

Use a belt-and-suspenders fix:

1. The desktop should open its WebSocket on startup even when it does not yet have a device token. That allows the existing `device.hello` path to pre-register the device row before browser sign-in.
2. The backend should still tolerate a missing persisted row during `/desktop/auth/exchange` by making `claimDevice` upsert the device record instead of assuming it already exists.

## Desktop Changes

- Remove the signed-out startup gate that only connects the WebSocket when a device token exists.
- After browser sign-in succeeds, force a WebSocket reconnect so the new token is sent on `device.hello`. A plain `connect()` call is not enough once an unsigned socket is already open.
- Keep the rest of the auth UX unchanged.

## API Changes

- Make `devicesRepo.claimDevice()` use `prisma.device.upsert(...)`.
- For the create path, use safe defaults for a missing row:
  - `platform: 'unknown'`
  - `deviceName: null`
  - `appVersion: null`
  - `lastSeenAt: now`
- Remove the `/desktop/auth/exchange` hard failure on a missing persisted device row.

The next authenticated `device.hello` will overwrite placeholder metadata with the real platform and app version.

## Risk Controls

- Do not widen browser auth or token validation rules.
- Keep the existing state/nonce/handoff validation unchanged.
- Do not clear ownership on unsigned startup hello.
- Avoid leaking additional privileged behavior from the unsigned socket. Startup registration should rely on the existing hello path only.

## Testing

- Add a regression test proving the desktop connects on startup without a stored token and reconnects after token exchange.
- Add a regression test proving `claimDevice` upserts missing device rows.
- Run the focused auth/sign-in tests plus desktop typecheck.
