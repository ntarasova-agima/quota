"use client";

import { useConvexAuth } from "convex/react";
import { useRouter, useSearchParams } from "next/navigation";
import { ReactNode, useEffect, useMemo, useState } from "react";

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [autoAttempted, setAutoAttempted] = useState(false);
  const [autoError, setAutoError] = useState<string | null>(null);
  const [linkCode, setLinkCode] = useState<string | undefined>(undefined);
  const [linkEmail, setLinkEmail] = useState<string | undefined>(undefined);
  const [linkChecked, setLinkChecked] = useState(false);

  const linkParams = useMemo(() => {
    const codeParam = searchParams.get("code") ?? linkCode;
    const emailParam =
      searchParams.get("email") ??
      searchParams.get("identifier") ??
      linkEmail;
    return { codeParam, emailParam };
  }, [searchParams, linkCode, linkEmail]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    setLinkCode(params.get("code") ?? undefined);
    setLinkEmail(params.get("email") ?? params.get("identifier") ?? undefined);
    setLinkChecked(true);
  }, [searchParams]);

  useEffect(() => {
    if (isLoading || isAuthenticated || !linkChecked || autoAttempted) {
      return;
    }
    setAutoAttempted(true);
    if (linkParams.codeParam) {
      const params = new URLSearchParams();
      params.set("code", linkParams.codeParam);
      if (linkParams.emailParam) {
        params.set("email", linkParams.emailParam);
      }
      window.location.href = `/sign-in?${params.toString()}`;
      return;
    }
    router.replace("/sign-in");
  }, [isAuthenticated, isLoading, router, linkParams, linkChecked, autoAttempted]);

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <main className="mx-auto flex min-h-screen w-full max-w-3xl items-center px-6 py-12">
          <p className="text-sm text-muted-foreground">
            {linkParams.codeParam ? "Переходим к авторизации..." : "Проверяем сессию..."}
          </p>
          {autoError && (
            <p className="mt-2 text-sm text-destructive">
              {autoError} — попробуйте войти через экран входа.
            </p>
          )}
        </main>
      </div>
    );
  }

  return <>{children}</>;
}
