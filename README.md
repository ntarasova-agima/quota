# Aurum

Aurum is an internal AGIMA service for creating, approving, paying, and tracking expense and investment requests.

It supports:
- multi-role approval flows;
- quota-based funding routes;
- HOD validation for contest requests;
- payment workflow for BUH;
- partial payments;
- comments, attachments, timeline, and email logs;
- archival of old requests.

## Stack

Frontend:
- Next.js 16
- React 19
- Tailwind CSS
- shadcn/ui

Backend:
- Convex
- `@convex-dev/auth`

Email:
- Resend

## Main Roles

- `AD` — request author
- `NBD` — presales quota approver
- `COO` — internal quota approver
- `CFD` — finance approver and tag owner
- `BUH` — payment processing
- `HOD` — validates specialist hours and direct costs for contest requests
- `ADMIN` — administration and support actions

## Project Structure

```text
src/app                Next.js pages and flows
src/components         shared UI
src/lib                client helpers and constants
convex                 backend logic, schema, mutations, queries, emails
docs                   product, support, and user documentation
public                 static assets
```

Key backend modules:
- `convex/requests.ts` — request lifecycle and core business logic
- `convex/approvals.ts` — approval queue and decisions
- `convex/roles.ts` — role management
- `convex/quotas.ts` — quota logic
- `convex/emails.ts` — outgoing email workflows
- `convex/timeline.ts` / `convex/timelineHelpers.ts` — audit trail

## Local Development

### Prerequisites

- Node.js 20+
- npm
- a Convex account / deployment
- a Resend API key

### Install

```bash
npm install
```

### Environment

Create `.env.local` with the required values.

Typical variables:

```env
CONVEX_DEPLOYMENT=...
NEXT_PUBLIC_CONVEX_URL=...
NEXT_PUBLIC_CONVEX_SITE_URL=...
SITE_URL=http://localhost:3000
RESEND_API_KEY=...
RESEND_FROM=no-reply@aurum.agima.ru
JWT_PRIVATE_KEY=...
JWKS=...
```

Notes:
- `SITE_URL` is important for auth links.
- `JWT_PRIVATE_KEY` and `JWKS` are required for `convex-auth`.
- Email scenarios depend on valid Resend credentials.

### Start Convex

```bash
npx convex dev --once --tail-logs disable
```

If you want the interactive local backend loop:

```bash
npx convex dev
```

### Start Frontend

```bash
npm run dev
```

Open:
- [http://localhost:3000](http://localhost:3000)

### Useful Commands

```bash
npm run build
npm run lint
npx convex dev --once --tail-logs disable
```

## Development Notes

### Contest Request Flow

For `Конкурсное задание` with specialists:
- author adds specialists instead of entering final amount manually;
- amount is calculated from specialists' direct costs;
- if direct costs are unknown, the request may still be submitted;
- request first goes to `HOD` validation;
- only after all required departments validate their specialists does the request move to normal approvers.

### Payment Flow

`BUH` can:
- move request to planned payment;
- record partial payments;
- mark paid;
- set Finplan IDs;
- set currency rate for non-RUB payments.

### Reopening a Closed Request

A closed request can be reopened from the request card.
It returns to the previous status:
- `approved`
- or `paid`

## Documentation

Supporting docs live in `docs/`:
- `docs/aurum-operating-guide.txt` — combined handover / operating guide
- `docs/aurum-user-guide.txt` — user guide
- `docs/aurum-infrastructure-guide.txt` — infrastructure and support guide
- `docs/aurum-vision.md` — detailed product vision
- `docs/aurum-vision-stakeholders.md` — stakeholder-facing product summary

## Deployment

### Current Deployment Model

Aurum is currently designed as:
- Next.js frontend deployed on a VM or app host;
- Convex as managed backend;
- Resend as email provider.

This means the service is **not fully self-hosted on a single VM** in its current form.

### Recommended Production VM

- Ubuntu Server 22.04 LTS or 24.04 LTS
- 4 vCPU
- 8 GB RAM
- 20 GB SSD
- Node.js 20+
- nginx
- pm2 or systemd

### Required Network / Infra

- inbound `80/tcp`
- inbound `443/tcp`
- SSL certificate for `aurum.agima.ru`
- outbound access to:
  - Convex Cloud
  - Resend API

### Production Environment Variables

```env
CONVEX_DEPLOYMENT=...
NEXT_PUBLIC_CONVEX_URL=...
NEXT_PUBLIC_CONVEX_SITE_URL=...
SITE_URL=https://aurum.agima.ru
RESEND_API_KEY=...
RESEND_FROM=no-reply@aurum.agima.ru
JWT_PRIVATE_KEY=...
JWKS=...
```

### Production Start

Build:

```bash
npm run build
```

Run:

```bash
npm run start
```

Or with a fixed port:

```bash
npm run start -- --port 3000
```

### Recommended Release Checklist

Before deploy:
- `npm run build`
- verify Convex functions with `npx convex dev --once --tail-logs disable`
- verify auth by email code
- verify standard request flow
- verify contest request with HOD validation
- verify payment flow
- verify closing and reopening a request

### What Support Should Check First

If something breaks in production:
1. open the request card;
2. inspect `Изменения` and `Таймлайн`;
3. verify request status and approvals;
4. verify role assignment;
5. verify email log in timeline / Convex;
6. verify env values for Convex and Resend.

## Git

Current working branch for the initial code push:
- `codex/aurum-initial`

## Contact

If something goes wrong in the product flow, current support contact inside the UI is:
- `@Natarom`
