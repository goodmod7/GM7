# Vercel Frontend Deployment

This repository is prepared for Vercel deployment of `apps/web` using dashboard configuration.

## Recommended Vercel Settings

- Import the full GitHub monorepo into Vercel
- Project Root Directory: `apps/web`
- Framework Preset: `Next.js`
- Keep the backend on Render

No `vercel.json` is required for the current deployment shape.

## Required Environment Variable

- `NEXT_PUBLIC_API_BASE=https://api.<your-domain>`

Example:

```bash
NEXT_PUBLIC_API_BASE=https://api.example.com
```

## Monorepo Notes

Use the Vercel dashboard monorepo flow:

1. Import the repository
2. Choose the web project
3. Set Root Directory to `apps/web`
4. Add `NEXT_PUBLIC_API_BASE`
5. Deploy

The backend remains a separate Render service.

## Recommended Domain Topology

Final production topology:

- `app.<domain>` -> Vercel
- `api.<domain>` -> Render

Initial bring-up/testing can use:

- `*.vercel.app`
- `*.onrender.com`

That is acceptable for early testing, but it is not the preferred final auth topology.

## Auth and Cookie Notes

This app expects cookie-based auth against the API.

For the smoothest production behavior:

- keep frontend and API on sibling subdomains under the same parent domain
- prefer `app.<domain>` and `api.<domain>`
- keep `NEXT_PUBLIC_API_BASE` pointed at the API origin

The current auth model stays unchanged:

- access cookie + refresh cookie
- CSRF cookie + `x-csrf-token`
- secure cookies in production

If you rely on a split provider-default topology such as `*.vercel.app` + `*.onrender.com`, initial testing can still work, but cookie and CSRF debugging tends to be more awkward than with a shared parent domain.

## Build and Deployment Notes

- `apps/web` is the only Vercel project in this setup
- Do not deploy the API from Vercel
- Do not add `vercel.json` unless a real dashboard limitation appears later
