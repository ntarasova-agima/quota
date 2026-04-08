"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convex";
import { Button } from "@/components/ui/button";
import EditableQuotaTable from "@/components/editable-quota-table";
import QuotaRemainingTable from "@/components/quota-remaining-table";

type QuotaTab = "internal" | "presales" | "ai";

export default function CooQuotaClient() {
  const [monthsCount, setMonthsCount] = useState(12);
  const [activeTab, setActiveTab] = useState<QuotaTab>("internal");
  const monthKeys = useMemo(() => {
    const now = new Date();
    return Array.from({ length: monthsCount }).map((_, i) => {
      const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    });
  }, [monthsCount]);

  const internalRows = useQuery(api.quotas.listCooByMonthKeys, { monthKeys });
  const presalesRows = useQuery(
    api.quotas.listByMonthKeys,
    activeTab === "presales" ? { monthKeys } : "skip",
  );
  const aiRows = useQuery(
    api.quotas.listAiToolByMonthKeys,
    activeTab === "ai" ? { monthKeys } : "skip",
  );
  const updateQuota = useMutation(api.quotas.updateCooQuota);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant={activeTab === "internal" ? "default" : "outline"} onClick={() => setActiveTab("internal")}>
          Внутренние затраты
        </Button>
        <Button type="button" variant={activeTab === "presales" ? "default" : "outline"} onClick={() => setActiveTab("presales")}>
          Пресейлы
        </Button>
        <Button type="button" variant={activeTab === "ai" ? "default" : "outline"} onClick={() => setActiveTab("ai")}>
          AI-сервисы
        </Button>
      </div>

      {activeTab === "internal" ? (
        <EditableQuotaTable
          title="Квоты COO"
          rows={internalRows}
          onLoadMore={() => setMonthsCount((prev) => prev + 12)}
          onSave={async (params) => {
            await updateQuota(params as any);
          }}
        />
      ) : null}
      {activeTab === "presales" ? (
        <QuotaRemainingTable
          title="Квота на пресейлы"
          rows={presalesRows}
          onLoadMore={() => setMonthsCount((prev) => prev + 12)}
        />
      ) : null}
      {activeTab === "ai" ? (
        <QuotaRemainingTable
          title="Квоты на AI-инструменты"
          rows={aiRows}
          onLoadMore={() => setMonthsCount((prev) => prev + 12)}
        />
      ) : null}
    </div>
  );
}
