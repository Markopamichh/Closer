"use client";

import type { InventoryItemDto, InventoryKind } from "@closer/shared";
import { INVENTORY_KINDS, INVENTORY_STATUSES, inventoryItemResponseSchema } from "@closer/shared";
import { Pencil, Plus } from "lucide-react";
import { useMessages, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useState } from "react";
import { FormError } from "@/components/auth/form-error";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, apiSend } from "@/lib/api-client";
import type { AttributeField } from "@/lib/inventory-form";
import {
  ATTRIBUTE_FIELDS,
  buildCreateInput,
  buildUpdateInput,
  formatCents,
  formatGenericAttributes,
} from "@/lib/inventory-form";
import { cn } from "@/lib/utils";

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive dark:bg-input/30";

type Problem = "required" | "invalid" | "duplicate";

function attributeValue(item: InventoryItemDto | undefined, name: string): string {
  const value = item?.attributes[name];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

export function ItemDialog({ orgId, item }: { orgId: string; item?: InventoryItemDto }) {
  const t = useTranslations("inventory");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<InventoryKind>(item?.kind ?? "vehicle");
  const [problems, setProblems] = useState<ReadonlyMap<string, Problem>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Widened on purpose: option labels are looked up by field name at runtime.
  const messages = useMessages();
  const optionLabels: Record<string, Record<string, string> | undefined> =
    messages.inventory.form.options;

  function reset(next: boolean) {
    setOpen(next);
    if (next) {
      setKind(item?.kind ?? "vehicle");
      setProblems(new Map());
      setError(null);
    }
  }

  async function onSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const built = item ? buildUpdateInput(form, item) : buildCreateInput(form, kind);
    if (!built.ok) {
      const filled = (name: string) => {
        const value = form.get(name);
        return typeof value === "string" && value.trim() !== "";
      };
      setProblems(
        new Map([...built.errors].map((name) => [name, filled(name) ? "invalid" : "required"])),
      );
      setError(null);
      return;
    }

    setPending(true);
    setProblems(new Map());
    setError(null);
    const base = `/api/organizations/${encodeURIComponent(orgId)}/inventory`;
    try {
      if (item) {
        await apiSend("PATCH", `${base}/${item.id}`, built.body, inventoryItemResponseSchema);
      } else {
        await apiSend("POST", base, built.body, inventoryItemResponseSchema);
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setProblems(new Map([["externalId", "duplicate"]]));
      } else {
        setError(t("form.failed"));
      }
    } finally {
      setPending(false);
    }
  }

  const problemText = (name: string) => {
    const problem = problems.get(name);
    if (problem === "duplicate") return t("form.duplicateExternalId");
    return problem ? t(`form.${problem}`) : null;
  };

  const field = (name: string, label: string, control: ReactNode, help?: string) => {
    const message = problemText(name);
    return (
      <div className="grid gap-1.5">
        <Label htmlFor={`item-${name}`}>{label}</Label>
        {control}
        {message ? (
          <p id={`item-${name}-error`} className="text-xs text-destructive">
            {message}
          </p>
        ) : (
          help && <p className="text-xs text-muted-foreground">{help}</p>
        )}
      </div>
    );
  };

  const a11y = (name: string) => ({
    id: `item-${name}`,
    name,
    "aria-invalid": problems.has(name) || undefined,
    "aria-describedby": problems.has(name) ? `item-${name}-error` : undefined,
  });

  const attributeControl = (f: AttributeField) => {
    const name = `attr.${f.name}`;
    const defaultValue = attributeValue(item, f.name);
    if (f.type === "enum") {
      return (
        <select {...a11y(name)} defaultValue={defaultValue} className={selectClass}>
          {!f.required && <option value="">{t("form.notSet")}</option>}
          {f.required && !defaultValue && <option value="" disabled hidden />}
          {f.options?.map((option) => (
            <option key={option} value={option}>
              {optionLabels[f.name]?.[option] ?? option}
            </option>
          ))}
        </select>
      );
    }
    return (
      <Input
        {...a11y(name)}
        defaultValue={defaultValue}
        type={f.type === "text" ? "text" : "number"}
        step={f.type === "decimal" ? "any" : "1"}
        min={f.type === "text" ? undefined : 0}
      />
    );
  };

  const fieldLabels: Record<string, string | undefined> = messages.inventory.form.fields;

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        {item ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("form.editItem", { title: item.title })}
          >
            <Pencil className="size-4" aria-hidden />
          </Button>
        ) : (
          <Button>
            <Plus className="size-4" aria-hidden />
            {t("form.newItem")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{item ? t("form.editTitle") : t("form.createTitle")}</DialogTitle>
          <DialogDescription>
            {item ? t("form.kindLocked") : t("form.createDescription")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void onSubmit(e)} className="grid gap-4" noValidate>
          {!item &&
            field(
              "kind",
              t("form.fields.kind"),
              <select
                id="item-kind"
                value={kind}
                onChange={(e) => {
                  const next = INVENTORY_KINDS.find((k) => k === e.target.value);
                  if (next) setKind(next);
                }}
                className={selectClass}
              >
                {INVENTORY_KINDS.map((value) => (
                  <option key={value} value={value}>
                    {t(`kinds.${value}`)}
                  </option>
                ))}
              </select>,
            )}
          {field(
            "title",
            t("form.fields.title"),
            <Input {...a11y("title")} defaultValue={item?.title} maxLength={200} required />,
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {field(
              "externalId",
              t("form.fields.externalId"),
              <Input
                {...a11y("externalId")}
                defaultValue={item?.externalId ?? ""}
                maxLength={100}
              />,
              t("form.fields.externalIdHelp"),
            )}
            {field(
              "status",
              t("form.fields.status"),
              <select
                {...a11y("status")}
                defaultValue={item?.status ?? "available"}
                className={selectClass}
              >
                {INVENTORY_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {t(`statuses.${value}`)}
                  </option>
                ))}
              </select>,
            )}
            {field(
              "price",
              t("form.fields.price"),
              <Input
                {...a11y("price")}
                type="number"
                inputMode="decimal"
                step="0.01"
                min={0}
                defaultValue={item ? formatCents(item.priceCents) : ""}
              />,
            )}
            {field(
              "currency",
              t("form.fields.currency"),
              <Input
                {...a11y("currency")}
                defaultValue={item?.currency ?? "USD"}
                maxLength={3}
                className="uppercase"
              />,
            )}
          </div>

          {kind === "generic" ? (
            field(
              "genericAttributes",
              t("form.fields.genericAttributes"),
              <Textarea
                {...a11y("genericAttributes")}
                defaultValue={item ? formatGenericAttributes(item.attributes) : ""}
                rows={4}
                className="font-mono text-sm"
              />,
              t("form.fields.genericAttributesHelp"),
            )
          ) : (
            <fieldset className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
              <legend className="px-1 text-sm font-medium">{t(`kinds.${kind}`)}</legend>
              {ATTRIBUTE_FIELDS[kind].map((f) => (
                <div key={f.name} className={cn(f.name === "address" && "sm:col-span-2")}>
                  {field(`attr.${f.name}`, fieldLabels[f.name] ?? f.name, attributeControl(f))}
                </div>
              ))}
            </fieldset>
          )}

          {field(
            "description",
            t("form.fields.description"),
            <Textarea
              {...a11y("description")}
              defaultValue={item?.description ?? ""}
              rows={3}
              maxLength={5000}
            />,
          )}

          <FormError message={error} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t("form.cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? t("form.saving") : item ? t("form.save") : t("form.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
