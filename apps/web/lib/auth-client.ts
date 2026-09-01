"use client";

import { createAuthClient } from "better-auth/react";

/** Browser client for sign-up / sign-in; talks only to /api/auth. */
export const authClient = createAuthClient();
