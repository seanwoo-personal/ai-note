import {
  escapeHtml,
  koreanDateTime,
  sendSmtpMail,
  SmtpMailError,
  smtpMailConfigured,
  type MailDependencies,
} from "@/services/smtpMail";

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

export function passwordRecoveryEmailConfigured(): boolean {
  return smtpMailConfigured();
}

export async function sendCustomerTemporaryPasswordEmail(
  message: PasswordRecoveryMessage,
  dependencies: MailDependencies = {},
): Promise<void> {
  const expiresAt = koreanDateTime(message.expiresAt);
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
    await sendSmtpMail({ to: message.to, subject: "[AI 노트] 임시 비밀번호 안내", text, html }, dependencies);
  } catch (error) {
    if (error instanceof SmtpMailError) throw new PasswordRecoveryEmailError(error.code);
    throw new PasswordRecoveryEmailError("smtp_delivery_failed");
  }
}
