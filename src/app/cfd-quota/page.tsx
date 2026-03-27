import RequireAuth from "@/components/RequireAuth";
import AppHeader from "@/components/AppHeader";
import CfdQuotaClient from "./cfdQuotaClient";

export default function CfdQuotaPage() {
  return (
    <RequireAuth>
      <div className="min-h-screen bg-background text-foreground">
        <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-6 py-12">
          <AppHeader title="Квоты CFD" />
          <CfdQuotaClient />
        </main>
      </div>
    </RequireAuth>
  );
}
