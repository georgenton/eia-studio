/**
 * The local database, which is a **capture journal**, not a copy of PostgreSQL.
 *
 * Two rules shaped every table here.
 *
 * **It holds one technician's current work and nothing else.** No project, no other technician, no
 * respondents, no findings, no geometry. A phone is lost, stolen and resold; the blast radius of
 * that event is exactly what this schema chooses to hold.
 *
 * **Server ids and local ids are different columns.** A row has a local `id` from the moment the
 * technician creates it, offline, with no server in sight; it gains a `server_id` when a command
 * is acknowledged. Collapsing the two would mean either inventing server ids on the device or
 * having nothing to key local rows by until the network returns — the first is how a client gets
 * to choose primary keys, the second is how a restart loses a draft.
 */
export interface LocalMigration {
  readonly version: number;
  readonly name: string;
  readonly statements: ReadonlyArray<string>;
}

export const LOCAL_MIGRATIONS: ReadonlyArray<LocalMigration> = [
  {
    version: 1,
    name: "field_capture_journal",
    statements: [
      `create table if not exists mobile_meta (
         key text primary key,
         value text not null
       )`,
      /* The downloaded pack: one row, replaced wholesale. A pack is a snapshot, not a mutation. */
      `create table if not exists field_pack (
         id integer primary key check (id = 1),
         tenant_slug text not null,
         project_slug text not null,
         project_name text not null,
         locality text,
         campaign_id text not null,
         campaign_name text not null,
         survey_version_id text not null,
         survey_version_label text not null,
         technician_user_id text not null,
         technician_email text not null,
         issued_at text not null,
         expires_at text not null,
         validity_basis text not null,
         cursor text not null,
         payload text not null
       )`,
      `create table if not exists local_assignment (
         id text primary key,
         parcel_code text not null,
         sector_label text,
         chainage_label text,
         side text,
         server_status text not null,
         open_visit_id text,
         instance_id text,
         instance_status text,
         revision integer not null,
         /* Set when the server says this assignment is no longer ours. Never deletes local work. */
         revoked_at text,
         conflict_reason text,
         updated_at text not null
       )`,
      `create table if not exists local_question (
         survey_version_id text not null,
         code text not null,
         ordinal integer not null,
         type text not null,
         prompt text not null,
         help_text text,
         required integer not null,
         sensitivity text not null,
         primary key (survey_version_id, code)
       )`,
      `create table if not exists local_option (
         survey_version_id text not null,
         question_code text not null,
         code text not null,
         label text not null,
         ordinal integer not null,
         primary key (survey_version_id, question_code, code)
       )`,
      `create table if not exists local_visit (
         id text primary key,
         assignment_id text not null references local_assignment(id) on delete cascade,
         server_id text,
         status text not null,
         started_at text not null,
         completed_at text,
         latitude real,
         longitude real,
         accuracy_m real,
         location_captured_at text,
         location_outcome text not null
       )`,
      `create table if not exists local_survey (
         id text primary key,
         assignment_id text not null references local_assignment(id) on delete cascade,
         visit_id text references local_visit(id),
         server_id text,
         survey_version_id text not null,
         state text not null,
         device_revision integer not null default 0,
         conflict_reason text,
         submitted_locally_at text,
         synced_at text,
         updated_at text not null
       )`,
      `create table if not exists local_answer (
         survey_id text not null references local_survey(id) on delete cascade,
         question_code text not null,
         /* The wire answer, verbatim. One column, because the domain owns its shape. */
         answer_json text not null,
         updated_at text not null,
         primary key (survey_id, question_code)
       )`,
      /*
       * The outbox. `command_json` is the exact envelope that will be sent, `command_id` inside it
       * generated once and never regenerated — the zero-duplicate invariant rests on that.
       */
      `create table if not exists sync_outbox (
         seq integer primary key autoincrement,
         command_id text not null unique,
         command_type text not null,
         entity_kind text not null,
         entity_local_id text not null,
         command_json text not null,
         created_at text not null,
         attempts integer not null default 0,
         next_attempt_at text,
         last_error text,
         state text not null default 'PENDING'
       )`,
      `create index if not exists sync_outbox_state_idx on sync_outbox (state, seq)`,
      `create table if not exists sync_error (
         id integer primary key autoincrement,
         at text not null,
         scope text not null,
         detail text not null
       )`,
      `create table if not exists sync_cursor (
         id integer primary key check (id = 1),
         cursor text not null,
         last_sync_at text not null
       )`,
    ],
  },
  {
    /*
     * Field media (ADR-032), added as migration 2 rather than by editing migration 1: a device
     * already in the field has run 1, and forward-only is the same rule the server's migrations
     * follow. A handset that has been in a valley for a week upgrades by running this and nothing
     * else.
     */
    version: 2,
    name: "field_media",
    statements: [
      /*
       * A photograph, and the file it is. `file_uri` points at the application's own documents
       * directory — not the camera roll, which the operating system and the technician both manage
       * and which a backup would copy off the device.
       *
       * `local_id` is minted at the shutter and is what the server keys on, so a retry after a
       * reinstalled outbox is still one photograph. `server_media_id` is what releases the file:
       * until it is set, `mayDeleteLocalFile` refuses, and the sweep never touches the row.
       */
      `create table if not exists local_media (
         local_id text primary key,
         assignment_local_id text not null,
         visit_server_id text,
         file_uri text not null,
         mime_type text not null,
         size_bytes integer not null,
         kind text not null,
         note text,
         captured_at text not null,
         latitude real,
         longitude real,
         accuracy_m real,
         state text not null default 'PENDING_UPLOAD',
         stored_object_id text,
         server_media_id text,
         attempts integer not null default 0,
         last_error text
       )`,
      `create index if not exists local_media_assignment_idx
         on local_media (assignment_local_id, captured_at)`,
      `create index if not exists local_media_pending_idx on local_media (state, captured_at)`,
    ],
  },
  {
    version: 3,
    name: "correction_revisits",
    statements: [
      /*
       * Why this assignment exists, when it exists to correct another (ADR-038).
       *
       * Three columns and no answers: a technician needs to know they are re-asking rather than
       * meeting a second household, and the reason a coordinator wrote. The previous response
       * stays on the server — a device that would otherwise never hold another visit's answers
       * does not start holding them because a figure was wrong.
       */
      `alter table local_assignment add column corrects_assignment_id text`,
      `alter table local_assignment add column correction_reason text`,
      `alter table local_assignment add column correction_requested_at text`,
    ],
  },
];

export const LOCAL_SCHEMA_VERSION = LOCAL_MIGRATIONS[LOCAL_MIGRATIONS.length - 1]!.version;

/** Statements to run, given the version already on the device. Forward-only, like the server's. */
export function pendingMigrations(currentVersion: number): ReadonlyArray<LocalMigration> {
  return LOCAL_MIGRATIONS.filter((migration) => migration.version > currentVersion);
}
