"use server";

import {
  assignParcel,
  createSocializationEvent,
  generateInvitations,
  reassignAssignment,
  reassignInvitation,
  transitionSocializationEvent,
  updateSocializationEvent,
} from "@eia/application";
import { DomainError } from "@eia/domain";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getDb } from "@/lib/db";
import { getTranslator } from "@/lib/locale";
import { resolveSurfaceAccess } from "@/lib/surface-access";

/**
 * Deciding who goes where, and convening the people a road runs past.
 *
 * Thin by design (ARCHITECTURE §3): validate, resolve the context, call the use-case. No
 * authorization decision is taken here — `resolveSurfaceAccess` answers 404 for a project the
 * caller cannot see, and each use-case requires its own permission underneath.
 */
const scope = z.object({ tenant: z.string().min(1), project: z.string().min(1) });

export type FieldWorkResult = { ok: true; message: string } | { ok: false; error: string };

/** A refusal a person should read, as opposed to one that is this product's own fault. */
function toResult(error: unknown): FieldWorkResult | null {
  if (error instanceof DomainError) return { ok: false, error: error.message };
  return null;
}

function revalidateField(tenant: string, project: string): void {
  revalidatePath(`/t/${tenant}/p/${project}/field`, "layout");
}

export async function assignParcelAction(raw: unknown): Promise<FieldWorkResult> {
  const input = scope
    .extend({
      campaignId: z.uuid(),
      parcelId: z.uuid(),
      assigneeMembershipId: z.uuid(),
    })
    .strict()
    .parse(raw);
  const t = await getTranslator();
  const access = await resolveSurfaceAccess(input.tenant, input.project, "field");
  if (access.kind !== "ok") return { ok: false, error: t("actions.noSurfaceAccess") };
  try {
    await assignParcel(getDb(), access.ctx, {
      campaignId: input.campaignId,
      parcelId: input.parcelId,
      assigneeMembershipId: input.assigneeMembershipId,
      note: null,
    });
    revalidateField(input.tenant, input.project);
    return { ok: true, message: t("field.assignments.saved") };
  } catch (error) {
    return toResult(error) ?? throwIt(error);
  }
}

export async function reassignAssignmentAction(raw: unknown): Promise<FieldWorkResult> {
  const input = scope
    .extend({ assignmentId: z.uuid(), assigneeMembershipId: z.uuid() })
    .strict()
    .parse(raw);
  const t = await getTranslator();
  const access = await resolveSurfaceAccess(input.tenant, input.project, "field");
  if (access.kind !== "ok") return { ok: false, error: t("actions.noSurfaceAccess") };
  try {
    await reassignAssignment(getDb(), access.ctx, {
      assignmentId: input.assignmentId,
      assigneeMembershipId: input.assigneeMembershipId,
    });
    revalidateField(input.tenant, input.project);
    return { ok: true, message: t("field.assignments.saved") };
  } catch (error) {
    return toResult(error) ?? throwIt(error);
  }
}

const eventFields = {
  title: z.string().min(3).max(200),
  purpose: z.string().max(1000).nullable(),
  startsAt: z.string().min(1).max(40),
  timezone: z.string().min(3).max(60),
  locationLabel: z.string().min(3).max(300),
};

export async function createEventAction(raw: unknown): Promise<FieldWorkResult> {
  const input = scope.extend(eventFields).strict().parse(raw);
  const t = await getTranslator();
  const access = await resolveSurfaceAccess(input.tenant, input.project, "field");
  if (access.kind !== "ok") return { ok: false, error: t("actions.noSurfaceAccess") };
  try {
    await createSocializationEvent(getDb(), access.ctx, {
      title: input.title,
      purpose: input.purpose === null || input.purpose.trim() === "" ? null : input.purpose,
      startsAt: new Date(input.startsAt),
      timezone: input.timezone,
      locationLabel: input.locationLabel,
    });
    revalidateField(input.tenant, input.project);
    return { ok: true, message: t("field.socializations.created") };
  } catch (error) {
    return toResult(error) ?? throwIt(error);
  }
}

export async function updateEventAction(raw: unknown): Promise<FieldWorkResult> {
  const input = scope
    .extend({ eventId: z.uuid(), ...eventFields })
    .strict()
    .parse(raw);
  const t = await getTranslator();
  const access = await resolveSurfaceAccess(input.tenant, input.project, "field");
  if (access.kind !== "ok") return { ok: false, error: t("actions.noSurfaceAccess") };
  try {
    await updateSocializationEvent(getDb(), access.ctx, {
      eventId: input.eventId,
      title: input.title,
      purpose: input.purpose === null || input.purpose.trim() === "" ? null : input.purpose,
      startsAt: new Date(input.startsAt),
      timezone: input.timezone,
      locationLabel: input.locationLabel,
    });
    revalidateField(input.tenant, input.project);
    return { ok: true, message: t("field.socializations.saved") };
  } catch (error) {
    return toResult(error) ?? throwIt(error);
  }
}

export async function transitionEventAction(raw: unknown): Promise<FieldWorkResult> {
  const input = scope
    .extend({
      eventId: z.uuid(),
      to: z.enum(["SCHEDULED", "CANCELLED", "COMPLETED"]),
      reason: z.string().max(400).nullable(),
    })
    .strict()
    .parse(raw);
  const t = await getTranslator();
  const access = await resolveSurfaceAccess(input.tenant, input.project, "field");
  if (access.kind !== "ok") return { ok: false, error: t("actions.noSurfaceAccess") };
  try {
    await transitionSocializationEvent(getDb(), access.ctx, {
      eventId: input.eventId,
      to: input.to,
      reason: input.reason === null || input.reason.trim() === "" ? null : input.reason,
    });
    revalidateField(input.tenant, input.project);
    return {
      ok: true,
      message:
        input.to === "CANCELLED"
          ? t("field.socializations.cancelled")
          : t("field.socializations.saved"),
    };
  } catch (error) {
    return toResult(error) ?? throwIt(error);
  }
}

export async function generateInvitationsAction(raw: unknown): Promise<FieldWorkResult> {
  const input = scope
    .extend({
      eventId: z.uuid(),
      parcels: z
        .array(
          z
            .object({
              parcelId: z.uuid(),
              assigneeMembershipId: z.uuid(),
              recipientLabel: z.string().max(160).nullable(),
            })
            .strict(),
        )
        .min(1)
        .max(500),
    })
    .strict()
    .parse(raw);
  const t = await getTranslator();
  const access = await resolveSurfaceAccess(input.tenant, input.project, "field");
  if (access.kind !== "ok") return { ok: false, error: t("actions.noSurfaceAccess") };
  try {
    const result = await generateInvitations(getDb(), access.ctx, {
      eventId: input.eventId,
      parcels: input.parcels.map((p) => ({
        parcelId: p.parcelId,
        assigneeMembershipId: p.assigneeMembershipId,
        recipientLabel:
          p.recipientLabel === null || p.recipientLabel.trim() === "" ? null : p.recipientLabel,
      })),
    });
    revalidateField(input.tenant, input.project);
    return {
      ok: true,
      message: t("field.socializations.generated", {
        created: String(result.created),
        skipped: String(result.skipped),
      }),
    };
  } catch (error) {
    return toResult(error) ?? throwIt(error);
  }
}

export async function reassignInvitationAction(raw: unknown): Promise<FieldWorkResult> {
  const input = scope
    .extend({ invitationId: z.uuid(), assigneeMembershipId: z.uuid() })
    .strict()
    .parse(raw);
  const t = await getTranslator();
  const access = await resolveSurfaceAccess(input.tenant, input.project, "field");
  if (access.kind !== "ok") return { ok: false, error: t("actions.noSurfaceAccess") };
  try {
    await reassignInvitation(getDb(), access.ctx, {
      invitationId: input.invitationId,
      assigneeMembershipId: input.assigneeMembershipId,
    });
    revalidateField(input.tenant, input.project);
    return { ok: true, message: t("field.socializations.saved") };
  } catch (error) {
    return toResult(error) ?? throwIt(error);
  }
}

/** Anything that is not a refusal a person can act on is this product's bug, and is thrown. */
function throwIt(error: unknown): never {
  throw error;
}
