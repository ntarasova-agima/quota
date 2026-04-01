import nodemailer from "nodemailer";

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined) {
    return fallback;
  }
  return value === "true";
}

export function getSmtpConfig() {
  const host = process.env.SMTP_HOST ?? "188.225.81.88";
  const port = Number(process.env.SMTP_PORT ?? 9025);
  const secure = parseBoolean(process.env.SMTP_SECURE, false);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM ?? "Aurum <no-reply@aurum.agima.ru>";
  const servername = process.env.SMTP_SERVERNAME ?? process.env.SMTP_DOMAIN ?? "agima.ru";

  return {
    host,
    port,
    secure,
    from,
    servername,
    auth:
      user && pass
        ? {
            user,
            pass,
          }
        : undefined,
  };
}

export async function sendSmtpMail(params: {
  to: string | string[];
  subject: string;
  html: string;
}) {
  const config = getSmtpConfig();
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth,
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 8000,
    tls: {
      servername: config.servername,
    },
  });

  await transporter.sendMail({
    from: config.from,
    to: params.to,
    subject: params.subject,
    html: params.html,
  });
}
