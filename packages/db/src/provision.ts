import pg from "pg";

const IDENTIFIER = /^[a-z_][a-z0-9_]{2,62}$/;

/**
 * Create or update the runtime LOGIN role and attach it to the `eia_app` group role created by
 * migration 0000. The login role is NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE and inherits
 * only the grants of `eia_app`. Password never appears in SQL files: it is bound via format(%L).
 */
export async function provisionRuntimeRole(
  migratorUrl: string,
  role: { name: string; password: string },
): Promise<void> {
  if (!IDENTIFIER.test(role.name)) throw new Error("runtime role name must be a simple identifier");
  if (role.password.length < 16) throw new Error("runtime role password too short");
  const client = new pg.Client({
    connectionString: migratorUrl,
    application_name: "eia-studio-provision",
  });
  await client.connect();
  try {
    const exists = await client.query<{ n: number }>(
      "select count(*)::int as n from pg_roles where rolname = $1",
      [role.name],
    );
    const verb = (exists.rows[0]?.n ?? 0) > 0 ? "ALTER" : "CREATE";
    const ddl = await client.query<{ ddl: string }>(
      `select format('%s ROLE %I WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT PASSWORD %L', $1::text, $2::text, $3::text) as ddl`,
      [verb, role.name, role.password],
    );
    await client.query(ddl.rows[0]!.ddl);
    const grant = await client.query<{ ddl: string }>(
      `select format('GRANT eia_app TO %I', $1::text) as ddl`,
      [role.name],
    );
    await client.query(grant.rows[0]!.ddl);
  } finally {
    await client.end();
  }
}
