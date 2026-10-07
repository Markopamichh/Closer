"use client";

import type { LeadDto, MemberDto } from "@closer/shared";
import { LEAD_STATUSES, leadResponseSchema } from "@closer/shared";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiSend } from "@/lib/api-client";

const selectClass =
  "h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60 dark:bg-input/30";

/** Status and assignee pickers for one lead row; each change saves on its own. */
export function LeadControls({
  orgId,
  lead,
  members,
}: {
  orgId: string;
  lead: LeadDto;
  members: MemberDto[];
}) {
  const t = useTranslations("leads");
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  // Only teammates who work leads; an existing assignee stays listed even if their role changed.
  const assignable = members.filter((m) => m.role !== "viewer" || m.id === lead.assignee?.id);

  async function save(patch: Record<string, unknown>) {
    setSaving(true);
    setFailed(false);
    try {
      await apiSend(
        "PATCH",
        `/api/organizations/${encodeURIComponent(orgId)}/leads/${lead.id}`,
        patch,
        leadResponseSchema,
      );
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label={t("columns.status")}
        className={selectClass}
        defaultValue={lead.status}
        disabled={saving}
        onChange={(e) => void save({ status: e.target.value })}
      >
        {LEAD_STATUSES.map((status) => (
          <option key={status} value={status}>
            {t(`statuses.${status}`)}
          </option>
        ))}
      </select>
      <select
        aria-label={t("columns.assignee")}
        className={selectClass}
        defaultValue={lead.assignee?.id ?? ""}
        disabled={saving}
        onChange={(e) => void save({ assignedTo: e.target.value || null })}
      >
        <option value="">{t("unassigned")}</option>
        {assignable.map((member) => (
          <option key={member.id} value={member.id}>
            {member.name}
          </option>
        ))}
      </select>
      {failed && (
        <span role="alert" className="text-xs text-destructive">
          {t("saveFailed")}
        </span>
      )}
    </div>
  );
}
