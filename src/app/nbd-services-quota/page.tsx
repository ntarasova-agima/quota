"use client";

import NbdServicesQuotaClient from "./servicesQuotaClient";
import RequireAuth from "@/components/RequireAuth";
import AppHeader from "@/components/AppHeader";

export default function NbdServicesQuotaPage() {
  return (
    <RequireAuth>
      <div className="min-h-screen bg-background text-foreground">
        <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-6 py-12">
          <AppHeader title="Квоты NBD на AI-подписки" />
          <NbdServicesQuotaClient />
        </main>
      </div>
    </RequireAuth>
  );
}
