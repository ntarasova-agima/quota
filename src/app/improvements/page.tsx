"use client";

import { FormEvent, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Paperclip, Trash2, Upload, X } from "lucide-react";
import type { Id } from "../../../convex/_generated/dataModel";
import AppHeader from "@/components/AppHeader";
import RequireAuth from "@/components/RequireAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/convex";
import {
  ACCEPTED_REQUEST_ATTACHMENT_EXTENSIONS,
  formatRequestAttachmentSize,
  isAllowedRequestAttachment,
  MAX_REQUEST_ATTACHMENTS,
  MAX_REQUEST_ATTACHMENT_SIZE,
} from "@/lib/requestAttachments";
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
  const generateUploadUrl = useMutation(api.improvements.generateUploadUrl);
  const saveAttachment = useMutation(api.improvements.saveAttachment);
  const deleteAttachment = useMutation(api.improvements.deleteAttachment);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fileActionError, setFileActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingAttachmentId, setDeletingAttachmentId] = useState<string | null>(null);
  const isAdmin = profile?.roles?.includes("ADMIN") ?? false;

  function resetFileInput() {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function addFiles(files: File[]) {
    if (!files.length) {
      return;
    }
    setMessage(null);
    setFileActionError(null);
    if (selectedFiles.length + files.length > MAX_REQUEST_ATTACHMENTS) {
      setFileActionError("Можно прикрепить не более 20 файлов");
      resetFileInput();
      return;
    }
    for (const file of files) {
      if (file.size > MAX_REQUEST_ATTACHMENT_SIZE) {
        setFileActionError(`Файл ${file.name} больше 40 МБ`);
        resetFileInput();
        return;
      }
      if (!isAllowedRequestAttachment(file)) {
        setFileActionError(`Формат файла ${file.name} не поддерживается`);
        resetFileInput();
        return;
      }
    }
    setSelectedFiles((current) => [...current, ...files]);
    resetFileInput();
  }

  async function uploadFiles(suggestionId: Id<"improvementSuggestions">, files: File[]) {
    for (const file of files) {
      const uploadUrl = await generateUploadUrl({ suggestionId });
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
        },
        body: file,
      });
      if (!response.ok) {
        throw new Error(`Не удалось загрузить файл ${file.name}`);
      }
      const { storageId } = await response.json();
      await saveAttachment({
        suggestionId,
        storageId,
        fileName: file.name,
        contentType: file.type || undefined,
        fileSize: file.size,
      });
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setFileActionError(null);
    setSaving(true);
    const filesToUpload = [...selectedFiles];
    try {
      const suggestionId = await createSuggestion({ subject, description });
      if (filesToUpload.length) {
        try {
          await uploadFiles(suggestionId, filesToUpload);
        } catch (err) {
          setSubject("");
          setDescription("");
          setSelectedFiles([]);
          resetFileInput();
          setMessage(
            err instanceof Error
              ? `Предложение создано, но файлы не загрузились: ${err.message}`
              : "Предложение создано, но файлы не загрузились",
          );
          return;
        }
      }
      setSubject("");
      setDescription("");
      setSelectedFiles([]);
      resetFileInput();
      setMessage(
        filesToUpload.length
          ? "Спасибо, записала в список улучшений. Файлы прикреплены."
          : "Спасибо, записала в список улучшений.",
      );
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
                <div className="space-y-2">
                  <Label htmlFor="improvementFiles">Файлы</Label>
                  <input
                    id="improvementFiles"
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    multiple
                    accept={ACCEPTED_REQUEST_ATTACHMENT_EXTENSIONS.join(",")}
                    onChange={(event) => addFiles(Array.from(event.target.files ?? []))}
                  />
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setIsDragOver(true);
                    }}
                    onDragLeave={(event) => {
                      event.preventDefault();
                      setIsDragOver(false);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      setIsDragOver(false);
                      addFiles(Array.from(event.dataTransfer.files ?? []));
                    }}
                    className={`flex min-h-20 w-full cursor-pointer items-center justify-between rounded-xl border px-4 py-3 text-left transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
                      isDragOver
                        ? "border-emerald-500 bg-emerald-50 shadow-[0_0_0_4px_rgba(16,185,129,0.08)]"
                        : "border-border bg-background hover:border-emerald-400 hover:bg-emerald-50/50"
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <span className="rounded-lg bg-emerald-100 p-2 text-emerald-700">
                        <Paperclip className="h-4 w-4" />
                      </span>
                      <span>
                        <span className="block font-medium">
                          {isDragOver
                            ? "Отпустите файлы, чтобы добавить"
                            : selectedFiles.length
                              ? `Выбрано файлов: ${selectedFiles.length}`
                              : "Нажмите или перетащите файлы сюда"}
                        </span>
                        <span className="block text-sm text-muted-foreground">
                          PDF, Office, изображения, архивы · до 40 МБ на файл · до 20 файлов
                        </span>
                      </span>
                    </span>
                    <Upload className="h-4 w-4 text-muted-foreground" />
                  </button>
                </div>
                {selectedFiles.length ? (
                  <div className="space-y-2">
                    {selectedFiles.map((file, index) => (
                      <div
                        key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                        className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-medium">{file.name}</div>
                          <div className="text-muted-foreground">{formatRequestAttachmentSize(file.size)}</div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`Убрать файл ${file.name}`}
                          title="Убрать файл"
                          onClick={() =>
                            setSelectedFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))
                          }
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : null}
                {fileActionError ? <p className="text-sm text-destructive">{fileActionError}</p> : null}
                {message ? (
                  <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
                    {message}
                  </div>
                ) : null}
                <Button type="submit" disabled={saving}>
                  {saving ? "Отправляем..." : "Отправить"}
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
                        {item.attachments?.length ? (
                          <div className="mt-3 space-y-2">
                            {item.attachments.map((attachment) => (
                              <div
                                key={attachment._id}
                                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm"
                              >
                                <div className="min-w-0">
                                  <div className="truncate font-medium">{attachment.fileName}</div>
                                  <div className="text-muted-foreground">
                                    {attachment.uploadedByName ? `${attachment.uploadedByName} · ` : ""}
                                    {attachment.uploadedByEmail}
                                    {attachment.fileSize ? ` · ${formatRequestAttachmentSize(attachment.fileSize)}` : ""}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  {attachment.url ? (
                                    <Button asChild variant="outline" size="sm">
                                      <a href={attachment.url} target="_blank" rel="noreferrer">
                                        Открыть
                                      </a>
                                    </Button>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">Ссылка скоро появится</span>
                                  )}
                                  {attachment.canDelete ? (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="icon-sm"
                                      aria-label={`Удалить файл ${attachment.fileName}`}
                                      title="Удалить файл"
                                      disabled={deletingAttachmentId === attachment._id}
                                      onClick={async () => {
                                        if (!window.confirm(`Удалить файл ${attachment.fileName}?`)) {
                                          return;
                                        }
                                        setDeletingAttachmentId(attachment._id);
                                        try {
                                          await deleteAttachment({ attachmentId: attachment._id });
                                        } catch (err) {
                                          setMessage(err instanceof Error ? err.message : "Не удалось удалить файл");
                                        } finally {
                                          setDeletingAttachmentId(null);
                                        }
                                      }}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  ) : null}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}
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
