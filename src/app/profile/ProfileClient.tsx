"use client";

import Link from "next/link";
import { useAuthActions } from "@convex-dev/auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/convex";

export default function ProfileClient() {
  const { signOut } = useAuthActions();
  const router = useRouter();
  const searchParams = useSearchParams();
  const profile = useQuery(api.roles.myProfile);
  const updateProfile = useMutation(api.roles.updateMyProfile);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [creatorTitle, setCreatorTitle] = useState("");
  const [email, setEmail] = useState("");
  const isAdmin = profile?.roles?.includes("ADMIN") ?? false;
  const isOnboarding = searchParams.get("onboarding") === "1" || profile?.needsOnboarding;
  const nextPath = searchParams.get("next")?.startsWith("/") ? searchParams.get("next")! : "/requests";

  useEffect(() => {
    if (!profile) {
      return;
    }
    setFullName(profile.fullName ?? "");
    setCreatorTitle(profile.creatorTitle ?? "");
    setEmail(profile.email ?? "");
  }, [profile]);

  async function handleSignOut() {
    setLoading(true);
    setError(null);
    try {
      await signOut();
      if (typeof window !== "undefined") {
        sessionStorage.removeItem("auth_code");
        sessionStorage.removeItem("auth_email");
      }
      router.replace("/sign-in");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось выйти");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await updateProfile({
        fullName: fullName.trim() || undefined,
        creatorTitle: creatorTitle.trim() || undefined,
        email: isAdmin ? email.trim() || undefined : undefined,
      });
      if (isOnboarding) {
        router.replace(nextPath);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось обновить профиль";
      setError(
        message.includes("Only admin can change email")
          ? "Менять почту может только администратор"
          : message.includes("Email already exists")
            ? "Такая почта уже используется"
            : message.includes("Full name required")
              ? "Укажите имя и фамилию"
              : message.includes("Creator title required")
                ? "Укажите должность"
                : message.includes("Corporate email required")
                  ? "Используйте корпоративную почту @agima.ru"
                  : message,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="w-full max-w-xl">
      <CardHeader>
        <CardTitle>{isOnboarding ? "Заполните профиль" : "Профиль"}</CardTitle>
        <CardDescription>
          {isOnboarding
            ? "Это нужно только один раз: укажите имя, фамилию и должность, чтобы продолжить работу."
            : "Вы вошли в систему."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <form className="space-y-4" onSubmit={handleSave}>
          <div className="space-y-2">
            <Label htmlFor="fullName">Имя и фамилия</Label>
            <Input
              id="fullName"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              placeholder="Например, Наталья Тарасова"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="creatorTitle">Должность</Label>
            <Input
              id="creatorTitle"
              value={creatorTitle}
              onChange={(event) => setCreatorTitle(event.target.value)}
              placeholder="Например, Аккаунт-менеджер"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Почта</Label>
            <Input
              id="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={!isAdmin}
            />
            {!isAdmin && (
              <p className="text-xs text-muted-foreground">Изменять почту может только администратор.</p>
            )}
          </div>
          <Button type="submit" disabled={saving} className="w-full">
            {isOnboarding ? "Сохранить и продолжить" : "Сохранить"}
          </Button>
        </form>

        {!isOnboarding && (
          <Button asChild className="w-full">
            <Link href="/requests">Перейти к заявкам</Link>
          </Button>
        )}
        <Button
          type="button"
          onClick={handleSignOut}
          disabled={loading}
          variant="outline"
          className="w-full"
        >
          Выйти
        </Button>
      </CardContent>
    </Card>
  );
}
