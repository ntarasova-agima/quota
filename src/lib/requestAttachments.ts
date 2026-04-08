export const MAX_REQUEST_ATTACHMENTS = 20;
export const MAX_REQUEST_ATTACHMENT_SIZE = 40 * 1024 * 1024;
export const ACCEPTED_REQUEST_ATTACHMENT_EXTENSIONS = [
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".csv",
  ".ppt",
  ".pptx",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
];

export function isAllowedRequestAttachment(file: File) {
  const fileName = file.name.toLowerCase();
  return ACCEPTED_REQUEST_ATTACHMENT_EXTENSIONS.some((ext) => fileName.endsWith(ext));
}

export function formatRequestAttachmentSize(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}
