# Migration: Pairing To Desktop Sign-In

This repo is moving from a dashboard-first pairing model to a desktop-first sign-in model.

## What Changed

- The desktop app is now the primary place to start tasks.
- New desktop installs use browser sign-in instead of user-facing pairing codes.
- The website is now secondary:
  - auth
  - billing
  - downloads
  - account info
  - device visibility
  - admin/debug fallback

## What Still Exists

- Pairing endpoints still exist for migration and compatibility.
- Web run creation still exists as a legacy admin/debug fallback.
- Older desktop builds can continue using the compatibility path while migration is in progress.

## Current Web Posture

- `/dashboard` is desktop-first and points users to the desktop app for task execution.
- Legacy web pairing and legacy web run creation live behind `Admin / Legacy Tools`.
- The legacy surface is for debug, fallback, and older desktop builds. It is not the main user flow.

## Multi-Device Policy

- Multiple desktops may be signed in simultaneously.
- Each desktop has its own durable device token.
- Signing out one desktop only affects that desktop.
- Explicit revoke is supported from desktop sign-out and desktop/device management flows.

## Operator Guidance

- Install the desktop app.
- Click `Sign in` in the desktop app.
- Complete auth in the browser.
- Start tasks directly from the desktop app.
- Use the web app only when you need billing, downloads, account visibility, or admin/debug fallback tools.
