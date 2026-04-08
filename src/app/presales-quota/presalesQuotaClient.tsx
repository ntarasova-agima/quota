"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import EditableQuotaTable from "@/components/editable-quota-table";
import { api } from "@/lib/convex";

export default function PresalesQuotaClient() {
  const [monthsCount, setMonthsCount] = useState(12);
  const monthKeys = useMemo(() => {
    const now = new Date();
    const keys: string[] = [];
    for (let i = 0; i < monthsCount; i += 1) {
      const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
      keys.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`);
    }
    return keys;
  }, [monthsCount]);

  const rows = useQuery(api.quotas.listByMonthKeys, { monthKeys });
  const updateQuota = useMutation(api.quotas.updateQuota);

  return (
    <EditableQuotaTable
      title="Квоты на пресейлы"
      rows={rows}
      onLoadMore={() => setMonthsCount((prev) => prev + 12)}
      onSave={async (params) => {
        await updateQuota(params as any);
      }}
    />
  );
}
