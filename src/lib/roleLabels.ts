const ROLE_LABELS: Record<string, string> = {
  AD: "Автор заявки",
  HOD: "Руководитель цеха",
};

export function getRoleLabel(role: string) {
  return ROLE_LABELS[role] ?? role;
}

export function formatRoleList(roles: string[]) {
  return roles.map(getRoleLabel).join(", ");
}
