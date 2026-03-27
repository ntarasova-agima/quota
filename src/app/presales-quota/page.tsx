import { isAuthenticatedNextjs } from "@convex-dev/auth/nextjs/server";
import { redirect } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import PresalesQuotaClient from "./presalesQuotaClient";

export default async function PresalesQuotaPage() {
  const isAuthenticated = await isAuthenticatedNextjs();
  if (!isAuthenticated) {
    redirect("/sign-in");
  }
  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-6 py-12">
        <AppHeader title="Квота на пресейлы" />
        <PresalesQuotaClient />
      </main>
    </div>
  );
}
