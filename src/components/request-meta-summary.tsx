"use client";

import { HoverHint } from "@/components/ui/hover-hint";
import { cn } from "@/lib/utils";

type RequestMetaSummaryProps = {
  requestCode?: string;
  clientName: string;
  category: string;
  amount?: number;
  currency?: string;
  className?: string;
};

export default function RequestMetaSummary({
  requestCode,
  clientName,
  category,
  amount,
  currency,
  className,
}: RequestMetaSummaryProps) {
  const ownerLabel = category === "Закупка сервисов" ? "Получатель сервиса" : "Клиент";

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
      <HoverHint label="Категория заявки">
        <span>{category}</span>
      </HoverHint>
      {amount !== undefined && currency ? (
        <>
          <span aria-hidden="true">·</span>
          <HoverHint label="Сумма заявки">
            <span>
              {amount} {currency}
            </span>
          </HoverHint>
        </>
      ) : null}
    </div>
  );
}
