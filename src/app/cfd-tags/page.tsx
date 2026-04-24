"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
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
  EMPTY_BUSINESS_CATEGORY,
  HOD_DEPARTMENTS,
  type RequestArea,
} from "@/lib/constants";

export default function CfdTagsPage() {
  const [departmentFilter, setDepartmentFilter] = useState<"all" | RequestArea>("all");
  const [newTagDepartment, setNewTagDepartment] = useState<RequestArea>("Аккаунтинг");
  const [tagSearch, setTagSearch] = useState("");
  const myProfile = useQuery(api.roles.myProfile);
  const tags = useQuery(
    api.cfdTags.list,
    departmentFilter === "all" ? {} : { department: departmentFilter },
  );
  const businessCategories = useQuery(api.businessCategories.list, {});
  const createTag = useMutation(api.cfdTags.create);
  const removeTag = useMutation(api.cfdTags.remove);
  const createBusinessCategory = useMutation(api.businessCategories.create);
  const updateBusinessCategory = useMutation(api.businessCategories.update);
  const removeBusinessCategory = useMutation(api.businessCategories.remove);
  const [name, setName] = useState("");
  const [businessCategoryName, setBusinessCategoryName] = useState("");
  const [editingBusinessCategoryId, setEditingBusinessCategoryId] = useState<string | null>(null);
  const [editingBusinessCategoryName, setEditingBusinessCategoryName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const canManageBusinessCategories = useMemo(
    () =>
      Boolean(
        myProfile?.roles?.some((role) => ["CFD", "ADMIN", "BUH"].includes(role)),
      ),
    [myProfile?.roles],
  );
  const availableDepartments = useMemo(() => {
    if (myProfile?.roles?.some((role) => ["CFD", "ADMIN", "BUH", "COO"].includes(role))) {
      return HOD_DEPARTMENTS;
    }
    const hodDepartments = (myProfile?.hodDepartments ?? []).filter((department): department is RequestArea =>
      HOD_DEPARTMENTS.includes(department as RequestArea),
    );
    return hodDepartments.length ? hodDepartments : HOD_DEPARTMENTS;
  }, [myProfile?.hodDepartments, myProfile?.roles]);
  useEffect(() => {
    if (!availableDepartments.includes(newTagDepartment)) {
      setNewTagDepartment(availableDepartments[0] ?? "Аккаунтинг");
    }
    if (departmentFilter !== "all" && !availableDepartments.includes(departmentFilter)) {
      setDepartmentFilter("all");
    }
  }, [availableDepartments, departmentFilter, newTagDepartment]);
  const filteredTags = useMemo(() => {
    const query = tagSearch.trim().toLowerCase();
    if (!query) {
      return tags ?? [];
    }
    return (tags ?? []).filter((tag) =>
      `${tag.name} ${tag.department ?? ""}`.toLowerCase().includes(query),
    );
  }, [tagSearch, tags]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await createTag({
        name,
        department: newTagDepartment,
      });
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось добавить тег");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateBusinessCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await createBusinessCategory({ name: businessCategoryName });
      setBusinessCategoryName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось добавить категорию");
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
              <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_auto] sm:items-end" onSubmit={handleCreate}>
                <div className="space-y-2">
                  <Label>Цех</Label>
                  <Select value={newTagDepartment} onValueChange={(value) => setNewTagDepartment(value as RequestArea)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Цех" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableDepartments.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
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
                <Button type="submit" disabled={saving || !newTagDepartment}>
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
              <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div className="space-y-2">
                  <Label>Цех</Label>
                    <Select
                      value={departmentFilter}
                      onValueChange={(value) => setDepartmentFilter(value as "all" | RequestArea)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Цех" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Все цеха</SelectItem>
                      {availableDepartments.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tagSearch">Поиск тега</Label>
                  <Input
                    id="tagSearch"
                    value={tagSearch}
                    onChange={(event) => setTagSearch(event.target.value)}
                    placeholder="Начните вводить название или цех"
                  />
                </div>
              </div>
              <div className="space-y-3">
                {filteredTags.length ? (
                  filteredTags.map((tag) => (
                    <div
                      key={tag._id}
                      className="flex items-center justify-between rounded-lg border border-border px-4 py-3 text-sm"
                    >
                      <span>
                        {tag.name}
                        <span className="ml-2 text-xs text-muted-foreground">{tag.department}</span>
                      </span>
                      {(tag as any).isSystem ? (
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs text-emerald-700">
                          системный
                        </span>
                      ) : (
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
                      )}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">Тегов пока нет.</p>
                )}
              </div>
            </CardContent>
          </Card>

          {canManageBusinessCategories ? (
            <Card>
              <CardHeader>
                <CardTitle>Категории заявок</CardTitle>
                <CardDescription>Эти категории BUH и CFD присваивают заявкам для сортировки и фильтров.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]" onSubmit={handleCreateBusinessCategory}>
                  <Input
                    value={businessCategoryName}
                    onChange={(event) => setBusinessCategoryName(event.target.value)}
                    placeholder="Например: Обучение"
                  />
                  <Button type="submit" disabled={saving || !businessCategoryName.trim()}>
                    Добавить категорию
                  </Button>
                </form>
                <div className="space-y-3">
                  {(businessCategories ?? []).map((category) => {
                    const isDefault = String(category._id).startsWith("default-business-category");
                    const isEmpty = category.name === EMPTY_BUSINESS_CATEGORY;
                    const isEditing = editingBusinessCategoryId === String(category._id);
                    return (
                      <div
                        key={category._id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-4 py-3 text-sm"
                      >
                        {isEditing ? (
                          <Input
                            className="max-w-sm"
                            value={editingBusinessCategoryName}
                            onChange={(event) => setEditingBusinessCategoryName(event.target.value)}
                          />
                        ) : (
                          <span>{category.name}</span>
                        )}
                        <div className="flex flex-wrap gap-2">
                          {isDefault ? (
                            <span className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs text-zinc-600">
                              базовая
                            </span>
                          ) : isEditing ? (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                onClick={async () => {
                                  setError(null);
                                  try {
                                    await updateBusinessCategory({
                                      id: category._id as any,
                                      name: editingBusinessCategoryName,
                                    });
                                    setEditingBusinessCategoryId(null);
                                    setEditingBusinessCategoryName("");
                                  } catch (err) {
                                    setError(err instanceof Error ? err.message : "Не удалось сохранить категорию");
                                  }
                                }}
                              >
                                Сохранить
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setEditingBusinessCategoryId(null);
                                  setEditingBusinessCategoryName("");
                                }}
                              >
                                Отмена
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setEditingBusinessCategoryId(String(category._id));
                                  setEditingBusinessCategoryName(category.name);
                                }}
                              >
                                Изменить
                              </Button>
                              {!isEmpty ? (
                                <Button
                                  type="button"
                                  variant="destructive"
                                  size="sm"
                                  onClick={async () => {
                                    setError(null);
                                    try {
                                      await removeBusinessCategory({ id: category._id as any });
                                    } catch (err) {
                                      setError(err instanceof Error ? err.message : "Не удалось удалить категорию");
                                    }
                                  }}
                                >
                                  Удалить
                                </Button>
                              ) : null}
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ) : null}
        </main>
      </div>
    </RequireAuth>
  );
}
