import { boolean, index, pgSchema, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * Identity provider persistence (Better Auth), logically isolated in the `auth` schema
 * (ADR-010). Property keys follow Better Auth's model field names; column names are snake_case.
 * The domain never joins these tables: `app.user.id` equals `auth.user.id` by construction.
 * Not tenant-scoped, therefore no RLS policies; the runtime role has CRUD only here.
 */
export const auth = pgSchema("auth");

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" }).notNull();

export const user = auth.table("user", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: ts("created_at").defaultNow(),
  updatedAt: ts("updated_at").defaultNow(),
});

export const session = auth.table(
  "session",
  {
    id: uuid("id").primaryKey(),
    expiresAt: ts("expires_at"),
    token: text("token").notNull().unique(),
    createdAt: ts("created_at").defaultNow(),
    updatedAt: ts("updated_at").defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = auth.table(
  "account",
  {
    id: uuid("id").primaryKey(),
    /** Better Auth ≥ 1.7: issuer of the account (e.g. "credential" for password accounts). */
    issuer: text("issuer").notNull(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: ts("created_at").defaultNow(),
    updatedAt: ts("updated_at").defaultNow(),
  },
  (t) => [
    index("account_user_idx").on(t.userId),
    uniqueIndex("account_issuer_account_id_key").on(t.issuer, t.accountId),
  ],
);

export const verification = auth.table(
  "verification",
  {
    id: uuid("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: ts("expires_at"),
    createdAt: ts("created_at").defaultNow(),
    updatedAt: ts("updated_at").defaultNow(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);
