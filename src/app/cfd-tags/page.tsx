"use client";

import { FormEvent, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import RequireAuth from "@/components/RequireAuth";
import AppHeader from "@/components/AppHeader";
import { api } from "@/lib/convex";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  HOD_DEPARTMENTS,
  REQUEST_AREAS,
  type RequestArea,
} from "@/lib/constants";
import { ADMINISTRATION_REQUEST_AREA } from "@/lib/requestRules";

export default function CfdTagsPage() {
  const [requestArea, setRequestArea] = useState<RequestArea>("Аккаунтинг");
  const [department, setDepartment] = useState("");
  const tags = useQuery(api.cfdTags.list, {
    requestArea,
    department: requestArea === ADMINISTRATION_REQUEST_AREA ? department || undefined : undefined,
  });
  const createTag = useMutation(api.cfdTags.create);
  const removeTag = useMutation(api.cfdTags.remove);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await createTag({
        name,
        requestArea,
        department: requestArea === ADMINISTRATION_REQUEST_AREA ? department || undefined : undefined,
      });
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось добавить тег");
    } finally {
      setSaving(false);
    }
  }

  return (
    <RequireAuth>
      <div className="min-h-screen bg-background text-foreground">
        <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 px-6 py-12">
          <AppHeader title="Справочник тегов" />

          <Card>
            <CardHeader>
              <CardTitle>Новый тег</CardTitle>
              <CardDescription>Теги используются для фильтрации заявок и квот.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="grid gap-3 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-end" onSubmit={handleCreate}>
                <div className="space-y-2">
                  <Label>Направление</Label>
                  <Select value={requestArea} onValueChange={(value) => {
                    setRequestArea(value as RequestArea);
                    setDepartment("");
                  }}>
                    <SelectTrigger>
                      <SelectValue placeholder="Направление" />
                    </SelectTrigger>
                    <SelectContent>
                      {REQUEST_AREAS.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {requestArea === ADMINISTRATION_REQUEST_AREA ? (
                  <div className="space-y-2">
                    <Label>Цех</Label>
                    <Select value={department || "none"} onValueChange={(value) => setDepartment(value === "none" ? "" : value)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Цех" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Цех не выбран</SelectItem>
                        {HOD_DEPARTMENTS.map((item) => (
                          <SelectItem key={item} value={item}>
                            {item}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                <div className="w-full space-y-2">
                  <Label htmlFor="name">Название тега</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Например: Тендер"
                    required
                  />
                </div>
                <Button type="submit" disabled={saving || (requestArea === ADMINISTRATION_REQUEST_AREA && !department)}>
                  Добавить
                </Button>
              </form>
              {error && (
                <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Список тегов</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {tags?.length ? (
                  tags.map((tag) => (
                    <div
                      key={tag._id}
                      className="flex items-center justify-between rounded-lg border border-border px-4 py-3 text-sm"
                    >
                      <span>
                        {tag.name}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {(tag.requestArea ?? "Аккаунтинг")}
                          {tag.department ? ` · ${tag.department}` : ""}
                        </span>
                      </span>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={async () => {
                          setError(null);
                          try {
                            await removeTag({ id: tag._id });
                          } catch (err) {
                            setError(err instanceof Error ? err.message : "Не удалось удалить тег");
                          }
                        }}
                      >
                        Удалить
                      </Button>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">Тегов пока нет.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    </RequireAuth>
  );
}
