/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as approvals from "../approvals.js";
import type * as attachments from "../attachments.js";
import type * as auth from "../auth.js";
import type * as authHelpers from "../authHelpers.js";
import type * as cfdTags from "../cfdTags.js";
import type * as comments from "../comments.js";
import type * as emails from "../emails.js";
import type * as http from "../http.js";
import type * as quotaUsage from "../quotaUsage.js";
import type * as quotas from "../quotas.js";
import type * as requests from "../requests.js";
import type * as roles from "../roles.js";
import type * as timeline from "../timeline.js";
import type * as timelineHelpers from "../timelineHelpers.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  approvals: typeof approvals;
  attachments: typeof attachments;
  auth: typeof auth;
  authHelpers: typeof authHelpers;
  cfdTags: typeof cfdTags;
  comments: typeof comments;
  emails: typeof emails;
  http: typeof http;
  quotaUsage: typeof quotaUsage;
  quotas: typeof quotas;
  requests: typeof requests;
  roles: typeof roles;
  timeline: typeof timeline;
  timelineHelpers: typeof timelineHelpers;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
