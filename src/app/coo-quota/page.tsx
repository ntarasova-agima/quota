import RequireAuth from "@/components/RequireAuth";
import AppHeader from "@/components/AppHeader";
import CooQuotaClient from "./cooQuotaClient";

export default function CooQuotaPage() {
  return (
    <RequireAuth>
      <div className="min-h-screen bg-background text-foreground">
        <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-6 py-12">
          <AppHeader title="Квоты COO" />
          <CooQuotaClient />
        </main>
      </div>
    </RequireAuth>
  );
}
