"use client";

import { HoverHint } from "@/components/ui/hover-hint";
import { normalizeRequestCategory, usesServiceRecipientLabel } from "@/lib/requestRules";
import { formatAmountWithoutVat } from "@/lib/vat";
import { cn } from "@/lib/utils";

type RequestMetaSummaryProps = {
  requestCode?: string;
  clientName: string;
  category: string;
  amount?: number;
  amountWithVat?: number;
  currency?: string;
  vatRate?: number;
  className?: string;
};

export default function RequestMetaSummary({
  requestCode,
  clientName,
  category,
  amount,
  amountWithVat,
  currency,
  vatRate,
  className,
}: RequestMetaSummaryProps) {
  const normalizedCategory = normalizeRequestCategory(category);
  const ownerLabel = usesServiceRecipientLabel(category) ? "Получатель сервиса" : "Клиент";

  return (
    <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground", className)}>
      {requestCode ? (
        <>
          <HoverHint label="Номер заявки">
            <span>{requestCode}</span>
          </HoverHint>
          <span aria-hidden="true">·</span>
        </>
      ) : null}
      <HoverHint label={ownerLabel}>
        <span>{clientName}</span>
      </HoverHint>
      <span aria-hidden="true">·</span>
      <HoverHint label="Тип заявки">
        <span>{normalizedCategory}</span>
      </HoverHint>
      {amount !== undefined && currency ? (
        <>
          <span aria-hidden="true">·</span>
          <HoverHint label="Сумма заявки">
            <span>
              {formatAmountWithoutVat({
                amountWithoutVat: amount,
                amountWithVat,
                currency,
                vatRate,
              })}
            </span>
          </HoverHint>
        </>
      ) : null}
    </div>
  );
}
