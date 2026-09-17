import { captureChannel, type CaptureChannel } from "../field/capture-channel";
import { FIELD_OFFLINE_MODE_SEMANTICS, type FieldOfflineMode } from "../field/offline-mode";
import type { CapabilityKey } from "../core/capabilities/catalog";

/**
 * Whether **EIA Studio can operate this project** — and nothing else.
 *
 * This is the sentence the whole module hangs on, and it is worth stating before any rule:
 * readiness says the product has what it needs to run the work. It does **not** say the
 * environmental study is complete, that the corpus is consistent, or that anything complies with
 * anything. Those are a specialist's conclusions and a Quality Gate's findings, and a green
 * readiness report must never be quotable as either (invariant 11, ADR-020).
 *
 * ## Why the rules are pure functions over a snapshot
 *
 * A readiness check that queried the database as it went would be a set of rules nobody could
 * reason about together: each one would see a slightly different instant, and a test would have to
 * build a world to exercise a sentence. Instead the application layer reads **one** snapshot in
 * **one** transaction and hands it here, so the report is a function of a consistent picture and
 * every rule is a two-line thing a reader can check by eye.
 *
 * ## Why a rule can be *not applicable*
 *
 * A project with `field.surveys` disabled has no questionnaire to publish, and reporting that as a
 * gap would teach a reader to ignore the report. Three outcomes, not two: satisfied, blocked, or
 * not applicable — and only a **required** rule that is blocked stops activation.
 */
export const READINESS_RULES = [
  "project.identity",
  "project.coordinator",
  "project.cartography",
  "project.questionnaire",
  "project.capture_channel",
  "project.offline_channel",
  "project.corpus",
  "project.storage",
] as const;
export type ReadinessRuleKey = (typeof READINESS_RULES)[number];

export type ReadinessOutcome = "satisfied" | "blocked" | "not_applicable";

/**
 * `required` blocks activation; `advisory` is a fact a coordinator should know and may accept.
 *
 * The line between them is whether the *product* can run without it. A project with no documents
 * can still send technicians to the field, so the corpus is advisory; a project that requires
 * offline capture and has no offline channel cannot, so that one is required (ADR-018, D-020).
 */
export type ReadinessSeverity = "required" | "advisory";

export interface ReadinessCheck {
  readonly key: ReadinessRuleKey;
  readonly severity: ReadinessSeverity;
  readonly outcome: ReadinessOutcome;
  /**
   * What is missing, as **values** rather than a sentence: the surface puts them into the reader's
   * language (ADR-029). `null` when nothing is missing.
   */
  readonly detail: Readonly<Record<string, string | number>> | null;
}

export interface ReadinessReport {
  readonly checks: ReadonlyArray<ReadinessCheck>;
  /** Every required rule is satisfied or not applicable. Activation asks exactly this. */
  readonly operable: boolean;
  readonly blocking: ReadonlyArray<ReadinessRuleKey>;
  readonly advisory: ReadonlyArray<ReadinessRuleKey>;
}

/** One consistent picture of the project, read once by the application layer. */
export interface ReadinessSnapshot {
  readonly project: {
    readonly name: string;
    readonly officialTitle: string | null;
    readonly locationLabel: string | null;
    readonly lifecycle: string;
  };
  /** Active project memberships, by role. A suspended membership is not a person on the project. */
  readonly roles: ReadonlyArray<string>;
  readonly capabilities: Readonly<Record<CapabilityKey, boolean>>;
  readonly cartography: {
    /** Dataset versions that are active for this project, of any kind. */
    readonly activeDatasets: number;
    readonly parcelsWithGeometry: number;
  };
  readonly questionnaire: {
    readonly publishedVersions: number;
    readonly draftVersions: number;
  };
  readonly campaign: {
    /** The campaign the project would run, when one exists. */
    readonly captureChannel: CaptureChannel | null;
    readonly status: string | null;
  };
  readonly offlineMode: FieldOfflineMode;
  readonly corpus: { readonly documents: number };
  /**
   * Whether this **deployment** can store a file, resolved by `resolveStorageAvailability`.
   *
   * A deployment-wide fact in a project's report, which is unusual and deliberate: the consequence
   * is a project's — nobody can load this study's files — and the person reading the intake is the
   * person who would otherwise spend an afternoon discovering it through a failing upload. The
   * reason travels with it so the report does not simply say *no*.
   */
  readonly storage: { readonly available: boolean; readonly reason: string | null };
}

const RULE_SEVERITY: Readonly<Record<ReadinessRuleKey, ReadinessSeverity>> = {
  "project.identity": "required",
  "project.coordinator": "required",
  "project.cartography": "advisory",
  "project.questionnaire": "required",
  "project.capture_channel": "advisory",
  "project.offline_channel": "required",
  "project.corpus": "advisory",
  "project.storage": "advisory",
};

function check(
  key: ReadinessRuleKey,
  outcome: ReadinessOutcome,
  detail: Readonly<Record<string, string | number>> | null = null,
): ReadinessCheck {
  return { key, severity: RULE_SEVERITY[key], outcome, detail };
}

/**
 * The deterministic report.
 *
 * Deterministic in the strong sense: same snapshot, same report, no clock, no randomness, no I/O.
 * Two people looking at the same project at the same moment see the same sentence, and a test can
 * state a project in ten lines.
 */
export function evaluateReadiness(snapshot: ReadinessSnapshot): ReadinessReport {
  const checks: ReadinessCheck[] = [];

  // 1 · Identity. A project a reader cannot recognise is one nobody can file a deliverable under.
  const missingIdentity = [
    snapshot.project.name.trim() === "" ? "name" : null,
    snapshot.project.officialTitle === null || snapshot.project.officialTitle.trim() === ""
      ? "officialTitle"
      : null,
    snapshot.project.locationLabel === null || snapshot.project.locationLabel.trim() === ""
      ? "locationLabel"
      : null,
  ].filter((field): field is string => field !== null);
  checks.push(
    missingIdentity.length === 0
      ? check("project.identity", "satisfied")
      : check("project.identity", "blocked", { missing: missingIdentity.join(", ") }),
  );

  // 2 · Somebody is answerable for it. Not a formality: a project with no coordinator has nobody
  // who may publish to the client, approve a deliverable or settle who captures what.
  checks.push(
    snapshot.roles.includes("COORDINATOR")
      ? check("project.coordinator", "satisfied")
      : check("project.coordinator", "blocked"),
  );

  // 3 · Cartography. Advisory, because a study can begin before its GIS package arrives — and
  // saying otherwise would block every project for the weeks that usually takes.
  checks.push(
    !snapshot.capabilities["gis.parcels"]
      ? check("project.cartography", "not_applicable")
      : snapshot.cartography.activeDatasets > 0 && snapshot.cartography.parcelsWithGeometry > 0
        ? check("project.cartography", "satisfied", {
            parcels: snapshot.cartography.parcelsWithGeometry,
          })
        : check("project.cartography", "blocked", {
            datasets: snapshot.cartography.activeDatasets,
            parcels: snapshot.cartography.parcelsWithGeometry,
          }),
  );

  // 4 · A published questionnaire. A campaign resolves answers against a *published* version for
  // ever (ADR-006); a draft is not something a technician may be sent out with.
  checks.push(
    !snapshot.capabilities["field.surveys"]
      ? check("project.questionnaire", "not_applicable")
      : snapshot.questionnaire.publishedVersions > 0
        ? check("project.questionnaire", "satisfied", {
            published: snapshot.questionnaire.publishedVersions,
          })
        : check("project.questionnaire", "blocked", {
            drafts: snapshot.questionnaire.draftVersions,
          }),
  );

  // 5 · A capture channel. Advisory on its own: a project may be prepared before its first
  // campaign exists, and the campaign's own activation refuses an impossible channel anyway.
  checks.push(
    !snapshot.capabilities["field.surveys"]
      ? check("project.capture_channel", "not_applicable")
      : snapshot.campaign.captureChannel === null
        ? check("project.capture_channel", "blocked")
        : check("project.capture_channel", "satisfied", {
            channel: snapshot.campaign.captureChannel,
          }),
  );

  // 6 · The D-020 gate, stated here as well as at campaign activation.
  //
  // A project whose policy *requires* offline capture cannot be operated on a channel that posts
  // to a server, and this is the rule that says so before anybody drives to a valley. It is the
  // same predicate `assertCaptureChannelSatisfiesOfflineMode` enforces at activation: this one
  // reports, that one refuses, and neither is the other's substitute (ADR-018).
  const requiresOffline =
    !FIELD_OFFLINE_MODE_SEMANTICS[snapshot.offlineMode].allowsOnlineOnlyChannel;
  checks.push(
    !snapshot.capabilities["field.surveys"] || !requiresOffline
      ? check("project.offline_channel", "not_applicable")
      : snapshot.campaign.captureChannel === null
        ? check("project.offline_channel", "blocked", { offlineMode: snapshot.offlineMode })
        : captureChannel(snapshot.campaign.captureChannel).supportsOffline
          ? check("project.offline_channel", "satisfied", {
              channel: snapshot.campaign.captureChannel,
            })
          : check("project.offline_channel", "blocked", {
              offlineMode: snapshot.offlineMode,
              channel: snapshot.campaign.captureChannel,
            }),
  );

  // 7 · The corpus. Advisory: the documents arrive over the life of a study, and a project with
  // none is a project at its beginning rather than a project that is wrong.
  checks.push(
    !snapshot.capabilities["core.documents"]
      ? check("project.corpus", "not_applicable")
      : snapshot.corpus.documents > 0
        ? check("project.corpus", "satisfied", { documents: snapshot.corpus.documents })
        : check("project.corpus", "blocked"),
  );

  // 8 · Somewhere to put a file (ADR-031, closing TD-089).
  //
  // Advisory, and only advisory: storage being unconfigured is an environment's state rather than
  // a project's, and blocking activation over it would stop field work — which stores nothing —
  // because a document could not be uploaded. Not applicable when neither documents nor field
  // capture is enabled, because then nothing would ever be stored.
  const storageWouldBeUsed =
    snapshot.capabilities["core.documents"] || snapshot.capabilities["field.surveys"];
  checks.push(
    !storageWouldBeUsed
      ? check("project.storage", "not_applicable")
      : snapshot.storage.available
        ? check("project.storage", "satisfied")
        : // The reason is a code the surface has words for, never the operator-facing detail: that
          // text names environment variables and belongs in a log, not on a consultant's screen.
          check("project.storage", "blocked", { reason: snapshot.storage.reason ?? "UNKNOWN" }),
  );

  const blocking = checks
    .filter((c) => c.severity === "required" && c.outcome === "blocked")
    .map((c) => c.key);
  const advisory = checks
    .filter((c) => c.severity === "advisory" && c.outcome === "blocked")
    .map((c) => c.key);

  return { checks, operable: blocking.length === 0, blocking, advisory };
}
