import { escapeHtml, koreanDateTime, sendSmtpMail, type MailDependencies } from "@/services/smtpMail";

// Operator invitations are internal (Korean-speaking operations staff), so the
// mail is Korean-only. It carries the one-time setup link and nothing else.

export interface OperatorInvitationMessage {
  to: string;
  name: string;
  invitedBy: string;
  setupUrl: string;
  expiresAt: string;
}

const BRAND = "Vision AI 미팅 에이전트";

export async function sendOperatorInvitationEmail(
  message: OperatorInvitationMessage,
  dependencies: MailDependencies = {},
): Promise<void> {
  const expiresAt = koreanDateTime(message.expiresAt);
  const greeting = `${message.name}님`;
  const text = [
    `${greeting},`,
    "",
    `${message.invitedBy}님이 ${BRAND} 운영자로 초대했습니다.`,
    "아래 링크를 열어 비밀번호를 정하고 인증 앱을 등록하면 운영자 화면을 사용할 수 있습니다.",
    "",
    message.setupUrl,
    "",
    `이 링크는 한 번만 사용할 수 있고 ${expiresAt}까지 유효합니다.`,
    "초대를 예상하지 못했다면 이 메일을 무시해 주세요. 링크를 열지 않으면 아무 일도 일어나지 않습니다.",
  ].join("\n");
  const html = `<!doctype html><html lang="ko"><body><p>${escapeHtml(greeting)},</p><p>${escapeHtml(message.invitedBy)}님이 ${escapeHtml(BRAND)} 운영자로 초대했습니다.</p><p>아래 링크를 열어 비밀번호를 정하고 인증 앱을 등록하면 운영자 화면을 사용할 수 있습니다.</p><p><a href="${escapeHtml(message.setupUrl)}">운영자 계정 설정하기</a></p><p style="word-break:break-all"><code>${escapeHtml(message.setupUrl)}</code></p><p>이 링크는 한 번만 사용할 수 있고 ${escapeHtml(expiresAt)}까지 유효합니다.</p><p>초대를 예상하지 못했다면 이 메일을 무시해 주세요. 링크를 열지 않으면 아무 일도 일어나지 않습니다.</p></body></html>`;
  await sendSmtpMail({ to: message.to, subject: `[${BRAND}] 운영자 초대`, text, html }, dependencies);
}
