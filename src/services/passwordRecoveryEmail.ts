import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";

export class PasswordRecoveryEmailError extends Error {
  readonly code: "smtp_not_configured" | "smtp_delivery_failed";

  constructor(code: "smtp_not_configured" | "smtp_delivery_failed") {
    super(code);
    this.name = "PasswordRecoveryEmailError";
    this.code = code;
  }
}

interface PasswordRecoveryMessage {
  to: string;
  name: string;
  temporaryPassword: string;
  expiresAt: string;
}

interface MailTransport {
  sendMail(message: Record<string, unknown>): Promise<unknown>;
}

interface MailDependencies {
  createTransport?: (options: SMTPTransport.Options) => MailTransport;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value || /[\r\n]/u.test(value)) throw new PasswordRecoveryEmailError("smtp_not_configured");
  return value;
}

function smtpOptions(): { options: SMTPTransport.Options; from: string } {
  const host = requiredEnvironment("AI_NOTE_SMTP_HOST");
  const user = requiredEnvironment("AI_NOTE_SMTP_USER");
  const pass = requiredEnvironment("AI_NOTE_SMTP_PASSWORD");
  const from = requiredEnvironment("AI_NOTE_SMTP_FROM");
  if (/[:/@\s]/u.test(host) || !from.includes("@")) throw new PasswordRecoveryEmailError("smtp_not_configured");

  const rawPort = process.env.AI_NOTE_SMTP_PORT?.trim() || "587";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new PasswordRecoveryEmailError("smtp_not_configured");
  }
  const rawSecure = process.env.AI_NOTE_SMTP_SECURE?.trim().toLowerCase();
  if (rawSecure && rawSecure !== "true" && rawSecure !== "false") {
    throw new PasswordRecoveryEmailError("smtp_not_configured");
  }
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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function koreanExpiry(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function passwordRecoveryEmailConfigured(): boolean {
  if (process.env.FAKE_PASSWORD_EMAIL === "1") return true;
  try {
    smtpOptions();
    return true;
  } catch {
    return false;
  }
}

export async function sendCustomerTemporaryPasswordEmail(
  message: PasswordRecoveryMessage,
  dependencies: MailDependencies = {},
): Promise<void> {
  if (process.env.FAKE_PASSWORD_EMAIL === "1") return;
  const { options, from } = smtpOptions();
  const createTransport = dependencies.createTransport
    ?? ((transportOptions: SMTPTransport.Options) => nodemailer.createTransport(transportOptions));
  const transport = createTransport(options);
  const expiresAt = koreanExpiry(message.expiresAt);
  const greeting = `${message.name}님`;
  const text = [
    `${greeting},`,
    "",
    "AI 노트 로그인을 위한 임시 비밀번호를 안내드립니다.",
    `임시 비밀번호: ${message.temporaryPassword}`,
    `유효 시간: ${expiresAt}까지`,
    "",
    "이 비밀번호는 한 번만 사용할 수 있습니다. 로그인 후 새 비밀번호로 변경해 주세요.",
    "본인이 요청하지 않았다면 이 메일을 무시하고 기존 비밀번호를 계속 사용해 주세요.",
  ].join("\n");
  const html = `<!doctype html><html lang="ko"><body><p>${escapeHtml(greeting)},</p><p>AI 노트 로그인을 위한 임시 비밀번호를 안내드립니다.</p><p><strong>임시 비밀번호</strong><br><code>${escapeHtml(message.temporaryPassword)}</code></p><p><strong>유효 시간</strong><br>${escapeHtml(expiresAt)}까지</p><p>이 비밀번호는 한 번만 사용할 수 있습니다. 로그인 후 새 비밀번호로 변경해 주세요.</p><p>본인이 요청하지 않았다면 이 메일을 무시하고 기존 비밀번호를 계속 사용해 주세요.</p></body></html>`;

  try {
    await transport.sendMail({
      from,
      to: message.to,
      subject: "[AI 노트] 임시 비밀번호 안내",
      text,
      html,
    });
  } catch {
    throw new PasswordRecoveryEmailError("smtp_delivery_failed");
  }
}
