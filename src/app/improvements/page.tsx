"use client";

import { FormEvent, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import AppHeader from "@/components/AppHeader";
import RequireAuth from "@/components/RequireAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/convex";
import { formatRoleList } from "@/lib/roleLabels";

const STATUS_LABELS = {
  todo: "Туду",
  in_progress: "В прогрессе",
  validation: "На валидации",
  done: "Готово",
} as const;
type ImprovementStatus = keyof typeof STATUS_LABELS;

export default function ImprovementsPage() {
  const profile = useQuery(api.roles.myProfile);
  const suggestions = useQuery(api.improvements.list);
  const createSuggestion = useMutation(api.improvements.create);
  const updateStatus = useMutation(api.improvements.updateStatus);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const isAdmin = profile?.roles?.includes("ADMIN") ?? false;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setSaving(true);
    try {
      await createSuggestion({ subject, description });
      setSubject("");
      setDescription("");
      setMessage("Спасибо, записала в список улучшений.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Не удалось отправить улучшение");
    } finally {
      setSaving(false);
    }
  }

  return (
    <RequireAuth>
      <div className="min-h-screen bg-background text-foreground">
        <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 px-6 py-12">
          <AppHeader title="Предложить улучшения" />

          <Card>
            <CardHeader>
              <CardTitle>Предложить улучшение</CardTitle>
              <CardDescription>
                Авторство подставится автоматически: имя, почта, роль и цех.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={handleSubmit}>
                <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
                  <div>{profile?.fullName ?? profile?.email}</div>
                  <div>{profile?.email}</div>
                  <div>{formatRoleList(profile?.roles ?? []) || "Без роли"} · {profile?.department ?? "Аккаунтинг"}</div>
                </div>
                <div className="space-y-2">
                  <Label>Тема</Label>
                  <Input value={subject} onChange={(event) => setSubject(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Короткое описание</Label>
                  <Textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    rows={4}
                  />
                </div>
                {message ? (
                  <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
                    {message}
                  </div>
                ) : null}
                <Button type="submit" disabled={saving}>
                  Отправить
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{isAdmin ? "Задачи по улучшениям" : "Мои предложения"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {suggestions?.length ? (
                suggestions.map((item) => (
                  <div key={item._id} className="rounded-xl border border-border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-lg font-semibold">{item.subject}</div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          {item.authorName ?? item.authorEmail} · {item.authorEmail} · {item.authorDepartment ?? "Аккаунтинг"}
                        </div>
                        <p className="mt-3 whitespace-pre-wrap text-sm">{item.description}</p>
                      </div>
                      {isAdmin ? (
                        <Select
                          value={item.status}
                          onValueChange={(status) =>
                            updateStatus({ id: item._id, status: status as ImprovementStatus })
                          }
                        >
                          <SelectTrigger className="w-44">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(STATUS_LABELS).map(([value, label]) => (
                              <SelectItem key={value} value={value}>
                                {label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <div className="rounded-full border border-border px-3 py-1 text-sm">
                          {STATUS_LABELS[item.status] ?? item.status}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">Пока предложений нет.</p>
              )}
            </CardContent>
          </Card>
        </main>
      </div>
    </RequireAuth>
  );
}
