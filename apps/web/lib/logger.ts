import "server-only";

import pino from "pino";

/** Structured logs with redaction (ARCHITECTURE.md §8). Never log secrets, tokens or PII. */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "*.password",
      "*.token",
      "*.secret",
      "*.authorization",
      "*.cookie",
      "req.headers.authorization",
      "req.headers.cookie",
      "*.email",
      "*.phone",
    ],
    censor: "[redacted]",
  },
});
