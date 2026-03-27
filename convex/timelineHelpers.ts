export async function logTimelineEvent(
  ctx: { db: any },
  args: {
    requestId: any;
    type: string;
    title: string;
    description?: string;
    actorEmail?: string;
    actorName?: string;
    metadata?: Record<string, unknown>;
    createdAt?: number;
  },
) {
  await ctx.db.insert("requestTimelineEvents", {
    requestId: args.requestId,
    type: args.type,
    title: args.title,
    description: args.description,
    actorEmail: args.actorEmail,
    actorName: args.actorName,
    metadata: args.metadata ? JSON.stringify(args.metadata) : undefined,
    createdAt: args.createdAt ?? Date.now(),
  });
}

export async function logEmailEvent(
  ctx: { db: any },
  args: {
    requestId?: any;
    emailType: string;
    recipients: string[];
    subject: string;
    status: "sent" | "failed";
    error?: string;
  },
) {
  await ctx.db.insert("requestEmailLogs", {
    requestId: args.requestId,
    emailType: args.emailType,
    recipients: args.recipients,
    subject: args.subject,
    status: args.status,
    error: args.error,
    createdAt: Date.now(),
  });
}

