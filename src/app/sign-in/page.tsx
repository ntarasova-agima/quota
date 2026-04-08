"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Script from "next/script";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/convex";

const captureParams = `
(() => {
  try {
    const search = new URLSearchParams(window.location.search);
    const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
    const hashParams = new URLSearchParams(hash);
    const code = search.get("code") || hashParams.get("code");
    const email = search.get("email") || search.get("identifier") || hashParams.get("email") || hashParams.get("identifier");
    if (code) sessionStorage.setItem("auth_code", code);
    if (email) sessionStorage.setItem("auth_email", email);
  } catch {}
})();
`;

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function isAgimaEmail(value: string) {
  return /^[^@\s]+@agima\.ru$/i.test(value.trim());
}

function isAllowedSignInEmail(value: string) {
  return (
    isAgimaEmail(value) ||
    (process.env.NODE_ENV !== "production" && /^[^@\s]+@quota\.local$/i.test(value.trim()))
  );
}

export default function SignInPage() {
  const { signIn } = useAuthActions();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const ensureCurrentUserRole = useMutation(api.roles.ensureCurrentUserRole);
  const router = useRouter();
  const searchParams = useSearchParams();
  const bootstrapStartedRef = useRef(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [autoAttempted, setAutoAttempted] = useState(false);
  const [linkCode, setLinkCode] = useState<string | undefined>(undefined);
  const [linkEmail, setLinkEmail] = useState<string | undefined>(undefined);
  const [linkChecked, setLinkChecked] = useState(false);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const profile = useQuery(api.roles.myProfile, isAuthenticated ? {} : "skip");
  const signInError = searchParams.get("error");

  const linkParams = useMemo(() => {
    const codeParam = searchParams.get("code") ?? linkCode;
    const emailParam =
      searchParams.get("email") ?? searchParams.get("identifier") ?? linkEmail;
    return { codeParam, emailParam };
  }, [searchParams, linkCode, linkEmail]);

  useEffect(() => {
    if (!signInError) {
      return;
    }
    setError(signInError);
  }, [signInError]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(
      window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash,
    );
    const codeParam =
      params.get("code") ?? hashParams.get("code") ?? undefined;
    const emailParam =
      params.get("email") ??
      params.get("identifier") ??
      hashParams.get("email") ??
      hashParams.get("identifier") ??
      undefined;
    if (codeParam) {
      sessionStorage.setItem("auth_code", codeParam);
    }
    if (emailParam) {
      sessionStorage.setItem("auth_email", emailParam);
    }
    setLinkCode(codeParam ?? sessionStorage.getItem("auth_code") ?? undefined);
    setLinkEmail(emailParam ?? sessionStorage.getItem("auth_email") ?? undefined);
    setLinkChecked(true);
  }, [searchParams]);

  useEffect(() => {
    if (isLoading || !isAuthenticated || profile === undefined || profile === null) {
      return;
    }
    if (!profile.hasRoleRecord) {
      if (bootstrapStartedRef.current) {
        return;
      }
      bootstrapStartedRef.current = true;
      setAuthMessage("Создаем профиль...");
      ensureCurrentUserRole({})
        .then(() => {
          setAuthMessage("Подготавливаем ваш профиль...");
        })
        .catch((err) => {
          bootstrapStartedRef.current = false;
          setAuthMessage(null);
          setError(err instanceof Error ? err.message : "Не удалось создать профиль");
        });
      return;
    }

    bootstrapStartedRef.current = false;
    if (profile.needsOnboarding) {
      setAuthMessage("Перенаправляем на заполнение профиля...");
      router.replace("/profile?onboarding=1");
      return;
    }

    setAuthMessage("Входим в сервис...");
    router.replace(
      profile.roles.includes("BUH") || profile.roles.includes("HOD") ? "/approvals" : "/requests",
    );
  }, [ensureCurrentUserRole, isAuthenticated, isLoading, profile, router]);

  useEffect(() => {
    if (autoAttempted || !linkParams.codeParam || !linkChecked) {
      return;
    }
    setAutoAttempted(true);
    setStep("code");
    setCode(linkParams.codeParam);
    if (linkParams.emailParam) {
      const normalizedEmail = normalizeEmail(linkParams.emailParam);
      setEmail(normalizedEmail);
      if (!isAllowedSignInEmail(normalizedEmail)) {
        setCode("");
        setStep("email");
        setError("Войти в Aurum можно только с почтой @agima.ru");
        return;
      }
      setSubmitting(true);
      setError(null);
      signIn("email", {
        email: normalizedEmail,
        code: linkParams.codeParam,
        redirectTo: "/requests",
      })
        .then(() => {
          if (typeof window !== "undefined") {
            sessionStorage.removeItem("auth_code");
            sessionStorage.removeItem("auth_email");
          }
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : "Не удалось войти";
          if (message.includes("Could not verify code")) {
            if (typeof window !== "undefined") {
              sessionStorage.removeItem("auth_code");
              sessionStorage.removeItem("auth_email");
            }
            setCode("");
            setStep("email");
            setError("Код недействителен. Запросите новый.");
          } else {
            setError(message);
          }
        })
        .finally(() => {
          setSubmitting(false);
        });
    }
  }, [autoAttempted, linkParams, signIn, linkChecked]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const normalizedEmail = normalizeEmail(email);
      if (!isAllowedSignInEmail(normalizedEmail)) {
        throw new Error("Войти в Aurum можно только с почтой @agima.ru");
      }
      setEmail(normalizedEmail);
      if (step === "email") {
        await signIn("email", { email: normalizedEmail, redirectTo: "/requests" });
        setStep("code");
      } else {
        await signIn("email", { email: normalizedEmail, code, redirectTo: "/requests" });
        if (typeof window !== "undefined") {
          sessionStorage.removeItem("auth_code");
          sessionStorage.removeItem("auth_email");
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось войти";
      if (message.includes("Could not verify code")) {
        if (typeof window !== "undefined") {
          sessionStorage.removeItem("auth_code");
          sessionStorage.removeItem("auth_email");
        }
        setCode("");
        setStep("email");
        setError("Код недействителен. Запросите новый.");
      } else {
        setError(message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Script id="capture-auth" strategy="beforeInteractive">
        {captureParams}
      </Script>
      <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-6 py-12">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Вход</CardTitle>
            <CardDescription>Код придет на почту.</CardDescription>
          </CardHeader>
          <CardContent>
            {isAuthenticated && authMessage ? (
              <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-muted-foreground">
                {authMessage}
              </div>
            ) : null}
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label htmlFor="email">Почта</Label>
                <Input
                  id="email"
                  type="email"
                  required={step === "email"}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@agima.ru"
                  disabled={step === "code"}
                />
                <p className="text-xs text-muted-foreground">Войти можно только с корпоративной почтой @agima.ru.</p>
              </div>

              {step === "code" && (
                <div className="space-y-2">
                  <Label htmlFor="code">Код</Label>
                  <Input
                    id="code"
                    type="text"
                    required
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    placeholder="Введите код из письма"
                  />
                </div>
              )}

              {error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={submitting || (step === "email" && !email)}
              >
                {step === "email" ? "Отправить код" : "Подтвердить"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
