/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as campaigns from "../campaigns.js";
import type * as cloudLoop from "../cloudLoop.js";
import type * as crons from "../crons.js";
import type * as crypto from "../crypto.js";
import type * as debug from "../debug.js";
import type * as dmLog from "../dmLog.js";
import type * as extensionToken from "../extensionToken.js";
import type * as http from "../http.js";
import type * as linkedinSessions from "../linkedinSessions.js";
import type * as waitlist from "../waitlist.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  campaigns: typeof campaigns;
  cloudLoop: typeof cloudLoop;
  crons: typeof crons;
  crypto: typeof crypto;
  debug: typeof debug;
  dmLog: typeof dmLog;
  extensionToken: typeof extensionToken;
  http: typeof http;
  linkedinSessions: typeof linkedinSessions;
  waitlist: typeof waitlist;
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
