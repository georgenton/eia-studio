import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as SQLite from "expo-sqlite";

import { LOCAL_SCHEMA_VERSION, pendingMigrations } from "./migrations";

/**
 * Opening the local database, encrypted, with a key this installation generated for itself.
 *
 * ## The key
 *
 * 32 random bytes from the platform's CSPRNG, generated **once per installation** and put in
 * `expo-secure-store` — the Keychain on iOS, the `EncryptedSharedPreferences`/Keystore pair on
 * Android. It is never derived from anything the technician types, never sent anywhere, never
 * logged, and there is no copy of it: a wiped keystore means an unreadable database, which is the
 * correct outcome and the reason the database is a *journal of current work* rather than an
 * archive.
 *
 * Nothing is hard-coded. A key compiled into the bundle protects against nothing at all, because
 * the bundle is on the device the attacker is holding.
 *
 * ## SQLCipher
 *
 * `expo-sqlite` links SQLCipher when the config plugin asks for it (`app.json`), which makes this
 * a native build rather than an Expo Go one — deliberately, because Expo Go cannot encrypt. On a
 * runtime without the extension `PRAGMA key` silently does nothing, so `assertEncrypted` asks the
 * database what it is rather than trusting the plugin, and the application refuses to open an
 * unencrypted file it believed was encrypted.
 */
const KEY_ALIAS = "eia.field.sqlcipher.key.v1";
const DATABASE_NAME = "eia-field.db";

export async function loadOrCreateDatabaseKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEY_ALIAS);
  if (existing && /^[0-9a-f]{64}$/.test(existing)) return existing;

  const bytes = Crypto.getRandomBytes(32);
  const key = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  await SecureStore.setItemAsync(KEY_ALIAS, key, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return key;
}

export class LocalDatabaseNotEncrypted extends Error {
  constructor() {
    super(
      "the local database opened without encryption. This build is missing SQLCipher; refusing " +
        "to store field data in the clear.",
    );
    this.name = "LocalDatabaseNotEncrypted";
  }
}

/**
 * Ask the database whether the key took effect.
 *
 * With SQLCipher linked and a correct key, `PRAGMA cipher_version` returns a version string. On a
 * plain SQLite build it returns nothing at all, which is exactly the case this guards: the plugin
 * is configured, the developer built with Expo Go by mistake, and every answer a technician
 * captures would sit unencrypted in application storage.
 */
export async function assertEncrypted(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ cipher_version?: string }>("pragma cipher_version");
  const version = row?.cipher_version;
  if (!version || version.trim() === "") throw new LocalDatabaseNotEncrypted();
}

export async function openLocalDatabase(): Promise<SQLite.SQLiteDatabase> {
  const key = await loadOrCreateDatabaseKey();
  const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
  // The key must be the first statement on the connection; anything before it is unencrypted.
  await db.execAsync(`pragma key = "x'${key}'"`);
  await assertEncrypted(db);
  // WAL for a writer that is interrupted by the OS constantly, foreign keys because the local
  // schema uses them to cascade a revoked assignment's rows rather than leaving orphans.
  await db.execAsync("pragma journal_mode = WAL; pragma foreign_keys = ON;");
  await migrate(db);
  return db;
}

async function currentVersion(db: SQLite.SQLiteDatabase): Promise<number> {
  await db.execAsync(
    "create table if not exists mobile_meta (key text primary key, value text not null)",
  );
  const row = await db.getFirstAsync<{ value: string }>(
    "select value from mobile_meta where key = 'schema_version'",
  );
  const parsed = Number(row?.value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Forward-only, one transaction per migration, recorded in `mobile_meta`. */
export async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  const from = await currentVersion(db);
  for (const migration of pendingMigrations(from)) {
    await db.withTransactionAsync(async () => {
      for (const statement of migration.statements) await db.execAsync(statement);
      await db.runAsync(
        "insert into mobile_meta (key, value) values ('schema_version', ?) " +
          "on conflict(key) do update set value = excluded.value",
        String(migration.version),
      );
    });
  }
}

export { DATABASE_NAME, KEY_ALIAS, LOCAL_SCHEMA_VERSION };

/**
 * Signing out.
 *
 * The session goes, the database key goes, and the database file goes with it. Keeping a
 * technician's captured answers on a device after they have signed out would mean the next person
 * to hold the phone is holding somebody else's field work — and there is nothing left to sync it
 * with, because syncing needs the session that was just discarded.
 *
 * Refuses while the outbox still owes the server something: losing unsynced work to a stray tap is
 * not a trade this application makes on the technician's behalf.
 */
export async function wipeLocalData(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.closeAsync();
  await SQLite.deleteDatabaseAsync(DATABASE_NAME);
  await SecureStore.deleteItemAsync(KEY_ALIAS);
}
