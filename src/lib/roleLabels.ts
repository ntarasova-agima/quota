const ROLE_LABELS: Record<string, string> = {
  AD: "Автор заявки",
  CFD: "Руководитель финансового отдела",
  "BUH Payment": "Бухгалтерия: оплата",
  "BUH Transit": "Бухгалтерия: транзит",
  "BUH Inside": "Бухгалтерия: штатные специалисты",
  "BUH Outsource": "Бухгалтерия: подрядчики",
  HOD: "Руководитель цеха",
};

export function getRoleLabel(role: string) {
  return ROLE_LABELS[role] ?? role;
}

export function formatRoleList(roles: string[]) {
  return roles.map(getRoleLabel).join(", ");
}
