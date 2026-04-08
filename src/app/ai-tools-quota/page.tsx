"use client";

import AiToolsQuotaClient from "./aiToolsQuotaClient";
import RequireAuth from "@/components/RequireAuth";
import AppHeader from "@/components/AppHeader";

export default function AiToolsQuotaPage() {
  return (
    <RequireAuth>
      <div className="min-h-screen bg-background text-foreground">
        <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-6 py-12">
          <AppHeader title="Квоты" />
          <AiToolsQuotaClient />
        </main>
      </div>
    </RequireAuth>
  );
}
