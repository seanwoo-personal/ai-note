import { afterEach, describe, expect, it, vi } from "vitest";

import { SmtpMailError } from "@/services/smtpMail";
import { sendOperatorInvitationEmail } from "@/services/operatorInvitationEmail";

const MESSAGE = {
  to: "operator@example.com",
  name: "이우람",
  invitedBy: "우상범",
  setupUrl: "https://note.example.com/admin/accept?token=abc123",
  expiresAt: "2026-09-26T04:30:00.000Z",
};

describe("operator invitation email", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("requires a complete server-side SMTP configuration", async () => {
    await expect(sendOperatorInvitationEmail(MESSAGE)).rejects.toBeInstanceOf(SmtpMailError);
  });

  it("mails the one-time setup link with the customer brand and no provider names", async () => {
    vi.stubEnv("AI_NOTE_SMTP_HOST", "smtp.example.com");
    vi.stubEnv("AI_NOTE_SMTP_PORT", "587");
    vi.stubEnv("AI_NOTE_SMTP_USER", "smtp-user");
    vi.stubEnv("AI_NOTE_SMTP_PASSWORD", "smtp-secret");
    vi.stubEnv("AI_NOTE_SMTP_FROM", "no-reply@example.com");
    const sendMail = vi.fn<(mail: Record<string, unknown>) => Promise<{ messageId: string }>>(async () => ({ messageId: "mail-1" }));
    const createTransport = vi.fn(() => ({ sendMail }));

    await sendOperatorInvitationEmail(MESSAGE, { createTransport });

    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: "smtp.example.com", port: 587, requireTLS: true, disableUrlAccess: true }));
    const mail = sendMail.mock.calls[0][0] as { from: string; to: string; subject: string; text: string; html: string };
    expect(mail.from).toBe("no-reply@example.com");
    expect(mail.to).toBe("operator@example.com");
    expect(mail.subject).toBe("[Vision AI 미팅 에이전트] 운영자 초대");
    expect(mail.text).toContain(MESSAGE.setupUrl);
    expect(mail.text).toContain("우상범");
    expect(mail.html).toContain(`href="${MESSAGE.setupUrl}"`);
    expect(`${mail.text}${mail.html}`).not.toMatch(/soniox|openrouter|openai/iu);
  });

  it("short-circuits under the fake mail flag", async () => {
    vi.stubEnv("FAKE_PASSWORD_EMAIL", "1");
    await expect(sendOperatorInvitationEmail(MESSAGE)).resolves.toBeUndefined();
  });
});
