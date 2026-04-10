import { normalizeEmail } from "./authRules";

export type ApprovalRoleRecord = {
  active: boolean;
  roles: string[];
  email: string;
  hodDepartments?: string[];
};

export type ApprovalTarget = {
  role: string;
  department?: string;
};

export function dedupeEmails(emails: string[], excludedEmails: string[] = []) {
  const excluded = new Set(excludedEmails.map(normalizeEmail));
  const seen = new Set<string>();
  const result: string[] = [];
  for (const email of emails) {
    const normalized = normalizeEmail(email);
    if (!normalized || excluded.has(normalized) || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(email);
  }
  return result;
}

export function getActiveRoleEmails(roleDocs: ApprovalRoleRecord[], roles: string[]) {
  if (!roles.length) {
    return [];
  }
  return dedupeEmails(
    roleDocs
      .filter((doc) => doc.active && doc.roles.some((role) => roles.includes(role)))
      .map((doc) => doc.email),
  );
}

export function getApprovalRecipients(
  roleDocs: ApprovalRoleRecord[],
  roles: string[],
  excludedEmails: string[] = [],
) {
  return getApprovalRecipientsForTargets(
    roleDocs,
    roles.map((role) => ({ role })),
    excludedEmails,
  );
}

export function getApprovalRecipientsForTargets(
  roleDocs: ApprovalRoleRecord[],
  targets: ApprovalTarget[],
  excludedEmails: string[] = [],
) {
  if (!targets.length) {
    return [];
  }
  const recipients = new Set<string>();
  const adminFallback = dedupeEmails(getActiveRoleEmails(roleDocs, ["ADMIN"]), excludedEmails);
  for (const target of targets) {
    const assignedRecipients = dedupeEmails(
      roleDocs
        .filter((doc) => doc.active && doc.roles.includes(target.role))
        .filter((doc) =>
          target.role === "HOD" && target.department
            ? (doc.hodDepartments ?? []).includes(target.department)
            : true,
        )
        .map((doc) => doc.email),
      excludedEmails,
    );
    if (assignedRecipients.length > 0) {
      assignedRecipients.forEach((email) => recipients.add(email));
      continue;
    }
    adminFallback.forEach((email) => recipients.add(email));
  }
  if (recipients.size === 0) {
    getActiveRoleEmails(roleDocs, ["ADMIN"]).forEach((email) => recipients.add(email));
  }
  return Array.from(recipients);
}

export function getApprovalRecipientsForApprovals(
  roleDocs: ApprovalRoleRecord[],
  approvals: ApprovalTarget[],
  excludedEmails: string[] = [],
) {
  return getApprovalRecipientsForTargets(roleDocs, approvals, excludedEmails);
}
