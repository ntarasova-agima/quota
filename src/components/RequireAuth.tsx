"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useMutation } from "convex/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/convex";

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signOut } = useAuthActions();
  const ensureCurrentUserRole = useMutation(api.roles.ensureCurrentUserRole);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [autoAttempted, setAutoAttempted] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [linkCode, setLinkCode] = useState<string | undefined>(undefined);
  const [linkEmail, setLinkEmail] = useState<string | undefined>(undefined);
  const [linkChecked, setLinkChecked] = useState(false);
  const [bootstrapReady, setBootstrapReady] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [redirectingToProfile, setRedirectingToProfile] = useState(false);

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
    if (!isAuthenticated) {
      setBootstrapReady(false);
      setBootstrapping(false);
      setRedirectingToProfile(false);
      return;
    }
    if (bootstrapReady || bootstrapping || redirectingToProfile) {
      return;
    }

    let cancelled = false;
    setAccessError(null);
    setBootstrapping(true);
    ensureCurrentUserRole({})
      .then((result) => {
        if (cancelled) {
          return;
        }
        if (result.needsOnboarding && pathname !== "/profile") {
          setRedirectingToProfile(true);
          const params = new URLSearchParams();
          params.set("onboarding", "1");
          if (typeof window !== "undefined") {
            const nextPath = `${window.location.pathname}${window.location.search}`;
            if (nextPath && nextPath !== "/profile") {
              params.set("next", nextPath);
            }
          }
          router.replace(`/profile?${params.toString()}`);
          return;
        }
        setBootstrapReady(true);
      })
      .catch(async (err) => {
        if (cancelled) {
          return;
        }
        const message = err instanceof Error ? err.message : "Не удалось проверить доступ";
        setAccessError(message);
        if (typeof window !== "undefined") {
          sessionStorage.removeItem("auth_code");
          sessionStorage.removeItem("auth_email");
        }
        try {
          await signOut();
        } catch {
          // Ignore sign-out failures and still send the user to the sign-in page.
        }
        router.replace(`/sign-in?error=${encodeURIComponent(message)}`);
      })
      .finally(() => {
        if (!cancelled) {
          setBootstrapping(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    bootstrapping,
    bootstrapReady,
    ensureCurrentUserRole,
    isAuthenticated,
    pathname,
    redirectingToProfile,
    router,
    signOut,
  ]);

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

  if (!isAuthenticated || (isAuthenticated && (!bootstrapReady || redirectingToProfile))) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <main className="mx-auto flex min-h-screen w-full max-w-3xl items-center px-6 py-12">
          <p className="text-sm text-muted-foreground">
            {!isAuthenticated
              ? linkParams.codeParam
                ? "Переходим к авторизации..."
                : "Проверяем сессию..."
              : redirectingToProfile
                ? "Перенаправляем на заполнение профиля..."
                : "Проверяем доступ..."}
          </p>
          {accessError && (
            <p className="mt-2 text-sm text-destructive">
              {accessError} — попробуйте войти через экран входа.
            </p>
          )}
        </main>
      </div>
    );
  }

  return <>{children}</>;
}
