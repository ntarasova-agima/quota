# Finplan Integration Handoff

Updated: 2026-08-17

## Goal

Aurum should read Finplan cost rows, inspect the `COMMENT` field, find the first Aurum request code in the comment, and mark matching Finplan cost IDs on the corresponding Aurum request.

## Implemented

- Added request-code copy UI on request detail pages.
- Added clickable Finplan cost IDs on request detail pages.
- Added verified/unverified Finplan cost ID state:
  - verified IDs are shown green;
  - manual/unverified IDs are shown red with a "номер не проверен в финплане" hint.
- Added parser for request codes in Finplan comments:
  - extracts only the first code;
  - normalizes to uppercase;
  - avoids partial embedded matches.
- Added sync window calculation:
  - whole months from 2 months before request creation month through 2 months after.
- Added Convex backend sync code:
  - `convex/finplanSync.ts`
  - `convex/crons.ts`
  - `convex/requests.ts` sync mutations/queries.
- Added manual button in the "Затраты в финплане" block:
  - `Обновить из Финплана`
  - returns friendly in-block errors instead of throwing a Next dev overlay.
- Hid manual Finplan ID textarea behind `Изменить вручную`.
- Disabled daily stage sync with Convex env:
  - `FINPLAN_DAILY_SYNC_ENABLED=false`.

## Stage Deployment

Convex functions were deployed to stage:

- `https://cloud.stage.aurum.agima.ru`

Prod was not touched.

## Current Blocker

Stage Aurum backend does not yet have server-to-server access to Finplan/Gateway.

Current stage Convex env has:

- `FINPLAN_DAILY_SYNC_ENABLED`

Missing:

- `FINPLAN_COSTS_LIST_URL` or `FINPLAN_GATEWAY_COSTS_LIST_URL`
- optional auth token/header env if the endpoint requires it

Supported auth envs:

- `FINPLAN_COSTS_LIST_API_KEY` or `FINPLAN_GATEWAY_API_KEY`
- `FINPLAN_COSTS_LIST_AUTH_HEADER` defaults to `Authorization`
- `FINPLAN_COSTS_LIST_AUTH_SCHEME` defaults to `Bearer`; set to an empty value if the endpoint expects the raw token

Temporary direct Finplan mode from the installed Finplan API skill:

- `FINPLAN_COSTS_LIST_AUTH_MODE=legacy_query`
- optional `FINPLAN_COSTS_LIST_URL=https://finplan.agimagroup.ru/finance/api-costs/`
- `FINPLAN_LOGIN` or `FINPLAN_COSTS_LIST_LOGIN`
- `FINPLAN_TOKEN` or `FINPLAN_COSTS_LIST_API_KEY`

This mode calls Finplan with GET query params `login`, `token`, `type=json`,
`fields=ID,COMMENT,COST_DATE`, `limit`, `offset`, and `arFilter[...]`.

MCP Gateway URL alone is not enough:

- `https://mcp-gateway.agima.tech/mcp` returns `401`
- error says requester assertion header is required

Personal Finplan credentials should not be placed in Aurum env. Use a service account / service requester / read-only Gateway credential.

## What To Ask Gateway/Finplan Team

Need read-only server-to-server access for stage Aurum to `finplan_costs_list`.

Required fields:

- `ID`
- `COMMENT`
- `COST_DATE`

Required filters:

- `arFilter[>=COST_DATE]=DD.MM.YYYY`
- `arFilter[<=COST_DATE]=DD.MM.YYYY`

Need one of:

- HTTP endpoint + auth header/token for backend use;
- service requester / service account in Gateway/Vault.
- temporary direct Finplan API access using service `login` and `token`.

Temporary environment decision:

- stage Aurum may read prod Finplan for now;
- daily auto-sync on stage remains disabled;
- manual button is used for tests.

## Verification Already Done

- `npx convex codegen` passed.
- `npx vitest run src/lib/finplanCommentMatch.test.ts` passed: 7 tests.
- `npx tsc --noEmit` still fails only on pre-existing unrelated test error:
  - `tests/requestWorkflow.test.ts(191,13)`
  - extra `name` property in `SpecialistEntryLike`.

## Next Steps

1. Get service endpoint/credential from Gateway/Finplan.
2. Set stage Convex env:
   - `FINPLAN_COSTS_LIST_URL=<provided endpoint>`
   - auth env if provided.
3. Deploy stage Convex functions if code changes are needed.
4. Test manually:
   - write Aurum request code into one Finplan cost `COMMENT`;
   - click `Обновить из Финплана`;
   - check that the cost ID appears or turns green.
5. After manual test is stable, decide whether to enable daily sync on stage.
