# Hexa CoPilot — Finance Intelligence

AI-powered CFO assistant for Hexamatics Group. Powered by OpenAI GPT-4o + Zoho Books.

## Architecture

All credentials live **server-side** in Vercel environment variables. The browser
only shows a login gate, then talks to our own `/api/*` proxies — it never holds
or is asked for an API key or access token.

```
Browser ──► /api/zoho-proxy ──┐
        ──► /api/ai-query  ──┼─► api/_zoho-auth.js ─► refreshes a Zoho access
                              │   (reads ZOHO_* env)   token, caches it in memory
                              └─► OpenAI (OPENAI_API_KEY env)
```

## Environment variables (Vercel → Project → Settings → Environment Variables)

| Variable | Required | Notes |
|---|---|---|
| `OPENAI_API_KEY` | yes | GPT-4o key from platform.openai.com |
| `ZOHO_CLIENT_ID` | yes | Zoho API console → **Server-based Application** client |
| `ZOHO_CLIENT_SECRET` | yes | same client |
| `ZOHO_REFRESH_TOKEN` | yes | minted once via `/api/zoho-setup` (below) |
| `ZOHO_REGION` | no | data centre: `com` (default), `eu`, `in`, `au`, `jp`, `ca` |
| `SETUP_SECRET` | temporary | any random string; gates `/api/zoho-setup`, remove after setup |

Set all of them for the **Production** environment, then redeploy.

## User invitation email

Admin-created users receive invitations through Resend. Add these variables to
the Vercel **Production** environment, then redeploy:

| Variable | Required | Notes |
|---|---|---|
| `RESEND_API_KEY` | yes | Resend API key with permission to send mail |
| `INVITE_FROM_EMAIL` | yes | A sender address from a verified Resend domain, e.g. `Guru Ji <noreply@your-domain.com>` |
| `INVITE_SECRET` | yes | Long random secret used to sign seven-day invitation links |
| `APP_URL` | no | Production URL; defaults to `https://ai.hexamatics.finance` |

The current login system remains browser-local, so recipients activate their
account through the invitation link on their own browser. A shared server-side
identity system is required for centralized account management, password reset,
and immediate account revocation.

## One-time Zoho refresh-token setup

1. In the [Zoho API console](https://api-console.zoho.com), create a **Server-based
   Application** client. Add this exact Authorized Redirect URI:
   `https://<your-domain>/api/zoho-setup`
2. Put `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REGION` and a throwaway
   `SETUP_SECRET` in Vercel, and redeploy.
3. Open `https://<your-domain>/api/zoho-setup?secret=<SETUP_SECRET>` in a browser.
4. Click **Authorize with Zoho**, sign in as the Zoho user whose Books
   organisations you want to expose.
5. The page prints a `refresh_token`. Copy it into `ZOHO_REFRESH_TOKEN` in Vercel
   and redeploy.
6. Delete `SETUP_SECRET` (optional — the route is inert without a fresh Zoho code).

The refresh token is long-lived; access tokens are refreshed automatically on
each request and cached in the function's memory, so users are never prompted.

## File Structure

```
hexa-copilot/
├── index.html          # App shell (login + main UI)
├── css/style.css       # Hexa-branded stylesheet
├── js/
│   ├── orgs.js         # Builds entity list from Zoho org data
│   ├── prompts.js      # System prompts per financial module
│   ├── gemini.js       # Client: talks only to /api/* proxies (no keys)
│   ├── renderer.js     # Response & module view renderer
│   └── app.js          # Login gate + app controller
└── api/
    ├── _zoho-auth.js   # Shared: refresh-token → cached access token
    ├── zoho-proxy.js   # Read-only Zoho Books REST proxy
    ├── ai-query.js     # Server-side Zoho context fetch + OpenAI call
    └── zoho-setup.js   # One-time refresh-token generator (SETUP_SECRET gated)
```

## Login

The app login is still a client-side gate (`js/app.js` → `ADMIN_USER` / `hx_users`
in `localStorage`). It controls UI access only, not credentials. Move it to a
server check if you need real auth.

## Features

- **AI Chat** — natural-language queries answered by GPT-4o with live Zoho Books data
- **Module Views** — Invoices, Payments, Expenses, AP/Bills, Reports, Intercompany, Tax
- **Live Data** — server-side Zoho Books REST integration
- **IFRS-aware** — accounting treatment notes, IAS/IFRS references
- **IPO-ready** — intercompany disclosures, contingent liabilities, Bursa ACE awareness

## Local development

`vercel dev` runs the static site and the `/api/*` functions together. Put the
same variables in a local `.env` (git-ignored) or use `vercel env pull`.
