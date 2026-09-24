import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";

// Single outbound mail path for account notices (temporary passwords, operator
// invitations). Configuration comes only from server env; nothing is stored in
// app data, and the transport never follows file or URL references.

export type SmtpMailErrorCode = "smtp_not_configured" | "smtp_delivery_failed";

export class SmtpMailError extends Error {
  readonly code: SmtpMailErrorCode;

  constructor(code: SmtpMailErrorCode) {
    super(code);
    this.name = "SmtpMailError";
    this.code = code;
  }
}

export interface MailTransport {
  sendMail(message: Record<string, unknown>): Promise<unknown>;
}

export interface MailDependencies {
  createTransport?: (options: SMTPTransport.Options) => MailTransport;
}

export interface OutboundMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value || /[\r\n]/u.test(value)) throw new SmtpMailError("smtp_not_configured");
  return value;
}

export function smtpOptions(): { options: SMTPTransport.Options; from: string } {
  const host = requiredEnvironment("AI_NOTE_SMTP_HOST");
  const user = requiredEnvironment("AI_NOTE_SMTP_USER");
  const pass = requiredEnvironment("AI_NOTE_SMTP_PASSWORD");
  const from = requiredEnvironment("AI_NOTE_SMTP_FROM");
  if (/[:/@\s]/u.test(host) || !from.includes("@")) throw new SmtpMailError("smtp_not_configured");

  const rawPort = process.env.AI_NOTE_SMTP_PORT?.trim() || "587";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new SmtpMailError("smtp_not_configured");
  const rawSecure = process.env.AI_NOTE_SMTP_SECURE?.trim().toLowerCase();
  if (rawSecure && rawSecure !== "true" && rawSecure !== "false") throw new SmtpMailError("smtp_not_configured");
  const secure = rawSecure ? rawSecure === "true" : port === 465;

  return {
    from,
    options: {
      host,
      port,
      secure,
      requireTLS: !secure,
      auth: { user, pass },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
      disableFileAccess: true,
      disableUrlAccess: true,
      tls: { minVersion: "TLSv1.2", servername: host },
    },
  };
}

/** True when mail can be sent (or the test stub is active). */
export function smtpMailConfigured(): boolean {
  if (process.env.FAKE_PASSWORD_EMAIL === "1") return true;
  try {
    smtpOptions();
    return true;
  } catch {
    return false;
  }
}

export async function sendSmtpMail(mail: OutboundMail, dependencies: MailDependencies = {}): Promise<void> {
  if (process.env.FAKE_PASSWORD_EMAIL === "1") return;
  const { options, from } = smtpOptions();
  const createTransport = dependencies.createTransport
    ?? ((transportOptions: SMTPTransport.Options) => nodemailer.createTransport(transportOptions));
  const transport = createTransport(options);
  try {
    await transport.sendMail({ from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
  } catch {
    throw new SmtpMailError("smtp_delivery_failed");
  }
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[character] ?? character);
}

export function koreanDateTime(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
