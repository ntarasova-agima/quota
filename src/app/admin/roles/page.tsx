"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/lib/convex";
import { ALL_ROLES_WITH_HOD, HOD_DEPARTMENTS } from "@/lib/constants";
import { formatRoleList, getRoleLabel } from "@/lib/roleLabels";
import RequireAuth from "@/components/RequireAuth";
import AppHeader from "@/components/AppHeader";

export default function RolesPage() {
  const { isAuthenticated } = useConvexAuth();
  const roles = useQuery(api.roles.listRoles, isAuthenticated ? {} : "skip");
  const upsertRole = useMutation(api.roles.upsertRole);
  const deleteRole = useMutation(api.roles.deleteRole);
  const archiveRole = useMutation(api.roles.archiveRole);
  const seedTestRoles = useMutation(api.roles.seedTestRoles);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [creatorTitle, setCreatorTitle] = useState("");
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [active, setActive] = useState(true);
  const [isTest, setIsTest] = useState(false);
  const [hodDepartments, setHodDepartments] = useState<string[]>([]);
  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function toggleRole(role: string) {
    setSelectedRoles((current) =>
      current.includes(role)
        ? current.filter((item) => item !== role)
        : [...current, role],
    );
  }

  function resetForm() {
    setEmail("");
    setFullName("");
    setSelectedRoles([]);
    setActive(true);
    setIsTest(false);
    setCreatorTitle("");
    setHodDepartments([]);
    setEditingEmail(null);
  }

  function beginEdit(record: {
    email: string;
    roles: string[];
    active: boolean;
    isTest: boolean;
    fullName?: string;
    creatorTitle?: string;
    hodDepartments?: string[];
  }) {
    setEmail(record.email);
    setFullName(record.fullName ?? "");
    setCreatorTitle(record.creatorTitle ?? "");
    setSelectedRoles(record.roles);
    setActive(record.active);
    setIsTest(record.isTest);
    setHodDepartments(record.hodDepartments ?? []);
    setEditingEmail(record.email);
  }

  function toggleDepartment(dep: string) {
    setHodDepartments((current) =>
      current.includes(dep)
        ? current.filter((item) => item !== dep)
        : [...current, dep],
    );
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      await upsertRole({
        email,
        roles: selectedRoles as any,
        active,
        isTest,
        fullName,
        creatorTitle,
        hodDepartments: selectedRoles.includes("HOD") ? hodDepartments : [],
      });
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить роль");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(targetEmail: string) {
    setError(null);
    setSaving(true);
    try {
      await deleteRole({ email: targetEmail });
      if (editingEmail === targetEmail) {
        resetForm();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить роль");
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive(targetEmail: string) {
    setError(null);
    setSaving(true);
    try {
      await archiveRole({ email: targetEmail });
      if (editingEmail === targetEmail) {
        resetForm();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось архивировать сотрудника");
    } finally {
      setSaving(false);
    }
  }

  async function handleSeed() {
    setError(null);
    try {
      await seedTestRoles({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось добавить тестовые роли");
    }
  }

  useEffect(() => {
    if (!roles || roles.length === 0) {
      return;
    }
    if (editingEmail && !roles.find((item) => item.email === editingEmail)) {
      resetForm();
    }
  }, [roles, editingEmail]);

  return (
    <RequireAuth>
      <div className="min-h-screen bg-background text-foreground">
        <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 px-6 py-12">
          <AppHeader title="Роли" />

          <Card>
            <CardHeader>
              <CardTitle>Доступы</CardTitle>
              <CardDescription>Управление доступом по email.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Имя и фамилия</Label>
                  <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Должность</Label>
                  <Input
                    value={creatorTitle}
                    onChange={(e) => setCreatorTitle(e.target.value)}
                    placeholder="Например, Аккаунт-менеджер"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Роли</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {ALL_ROLES_WITH_HOD.map((role) => (
                      <label key={role} className="flex items-center gap-2 text-sm">
                        <Checkbox checked={selectedRoles.includes(role)} onCheckedChange={() => toggleRole(role)} />
                        {getRoleLabel(role)}
                      </label>
                    ))}
                  </div>
                </div>
                {selectedRoles.includes("HOD") && (
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Подцехи HoD</Label>
                    <div className="grid grid-cols-2 gap-2">
                      {HOD_DEPARTMENTS.map((dep) => (
                        <label key={dep} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={hodDepartments.includes(dep)}
                            onCheckedChange={() => toggleDepartment(dep)}
                          />
                          {dep}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={active} onCheckedChange={() => setActive((v) => !v)} />
                  Активен
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={isTest} onCheckedChange={() => setIsTest((v) => !v)} />
                  Тестовый
                </label>
              </div>
              {error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}
              <div className="flex flex-wrap gap-3">
                <Button type="button" onClick={handleSave} disabled={saving || !email}>
                  {editingEmail ? "Обновить" : "Сохранить"}
                </Button>
                <Button type="button" variant="outline" onClick={resetForm}>
                  Очистить
                </Button>
                <Button type="button" variant="outline" onClick={handleSeed}>
                  Добавить тестовые роли
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Текущие назначения</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {roles?.length ? (
                  roles.map((item) => (
                    <div key={item._id} className="rounded-lg border border-border px-4 py-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="font-medium">{item.email}</div>
                          {item.fullName && (
                            <div className="text-muted-foreground">{item.fullName}</div>
                          )}
                          {item.creatorTitle ? (
                            <div className="text-xs text-muted-foreground">
                              Должность: {item.creatorTitle}
                            </div>
                          ) : null}
                          <div className="text-muted-foreground">
                            {item.roles.length ? formatRoleList(item.roles) : "Нет ролей"}
                          </div>
                          {item.hodDepartments?.length ? (
                            <div className="text-xs text-muted-foreground">
                              HoD подцехи: {item.hodDepartments.join(", ")}
                            </div>
                          ) : null}
                          <div className="text-xs text-muted-foreground">
                            {item.active ? "Активен" : "Неактивен"}{item.isTest ? " · Тест" : ""}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button type="button" variant="outline" size="sm" onClick={() => beginEdit(item)}>
                            Редактировать
                          </Button>
                          {item.active ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => handleArchive(item.email)}
                              disabled={saving}
                            >
                              Архивировать
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            onClick={() => handleDelete(item.email)}
                            disabled={saving}
                          >
                            Удалить
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">Роли не настроены.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    </RequireAuth>
  );
}
