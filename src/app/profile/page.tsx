import { isAuthenticatedNextjs } from "@convex-dev/auth/nextjs/server";
import { redirect } from "next/navigation";
import ProfileClient from "./ProfileClient";
import AppHeader from "@/components/AppHeader";
import RequireAuth from "@/components/RequireAuth";

export default async function ProfilePage() {
  const isAuthenticated = await isAuthenticatedNextjs();

  if (!isAuthenticated) {
    redirect("/sign-in");
  }

  return (
    <RequireAuth>
      <div className="min-h-screen bg-background text-foreground">
        <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-6 py-12">
          <AppHeader title="Профиль" />
          <ProfileClient />
        </main>
      </div>
    </RequireAuth>
  );
}
