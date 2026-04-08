"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convex";
import { Button } from "@/components/ui/button";
import EditableQuotaTable from "@/components/editable-quota-table";
import QuotaRemainingTable from "@/components/quota-remaining-table";

type QuotaTab = "cfd" | "presales" | "internal" | "ai";

export default function CfdQuotaClient() {
  const [monthsCount, setMonthsCount] = useState(12);
  const [activeTab, setActiveTab] = useState<QuotaTab>("cfd");
  const monthKeys = useMemo(() => {
    const now = new Date();
    const keys: string[] = [];
    for (let i = 0; i < monthsCount; i += 1) {
      const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
      keys.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`);
    }
    return keys;
  }, [monthsCount]);

  const cfdRows = useQuery(api.quotas.listCfdByMonthKeys, { monthKeys });
  const presalesRows = useQuery(
    api.quotas.listByMonthKeys,
    activeTab === "presales" ? { monthKeys } : "skip",
  );
  const internalRows = useQuery(
    api.quotas.listCooByMonthKeys,
    activeTab === "internal" ? { monthKeys } : "skip",
  );
  const aiRows = useQuery(
    api.quotas.listAiToolByMonthKeys,
    activeTab === "ai" ? { monthKeys } : "skip",
  );
  const updateQuota = useMutation(api.quotas.updateCfdQuota);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant={activeTab === "cfd" ? "default" : "outline"} onClick={() => setActiveTab("cfd")}>
          Квоты CFD
        </Button>
        <Button type="button" variant={activeTab === "presales" ? "default" : "outline"} onClick={() => setActiveTab("presales")}>
          Пресейлы
        </Button>
        <Button type="button" variant={activeTab === "internal" ? "default" : "outline"} onClick={() => setActiveTab("internal")}>
          Внутренние затраты
        </Button>
        <Button type="button" variant={activeTab === "ai" ? "default" : "outline"} onClick={() => setActiveTab("ai")}>
          AI-сервисы
        </Button>
      </div>

      {activeTab === "cfd" ? (
        <EditableQuotaTable
          title="Квоты CFD"
          rows={cfdRows}
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
      {activeTab === "internal" ? (
        <QuotaRemainingTable
          title="Квота на внутренние затраты"
          rows={internalRows}
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
