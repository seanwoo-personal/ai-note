import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PasswordRecoveryEmailError,
  sendCustomerTemporaryPasswordEmail,
} from "@/services/passwordRecoveryEmail";

describe("password recovery email", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("requires a complete server-side SMTP configuration", async () => {
    await expect(sendCustomerTemporaryPasswordEmail({
      to: "customer@example.jp",
      name: "야마다 타로",
      temporaryPassword: "T9!TemporaryPass",
      expiresAt: "2026-08-19T04:30:00.000Z",
    })).rejects.toBeInstanceOf(PasswordRecoveryEmailError);
  });

  it("uses authenticated TLS SMTP and sends no file or URL-backed content", async () => {
    vi.stubEnv("AI_NOTE_SMTP_HOST", "smtp.example.com");
    vi.stubEnv("AI_NOTE_SMTP_PORT", "587");
    vi.stubEnv("AI_NOTE_SMTP_SECURE", "false");
    vi.stubEnv("AI_NOTE_SMTP_USER", "smtp-user");
    vi.stubEnv("AI_NOTE_SMTP_PASSWORD", "smtp-secret");
    vi.stubEnv("AI_NOTE_SMTP_FROM", "AI 노트 <no-reply@example.com>");
    const sendMail = vi.fn(async () => ({ messageId: "mail-1" }));
    const createTransport = vi.fn(() => ({ sendMail }));

    await sendCustomerTemporaryPasswordEmail({
      to: "customer@example.jp",
      name: "야마다 타로",
      temporaryPassword: "T9!TemporaryPass",
      expiresAt: "2026-08-19T04:30:00.000Z",
    }, { createTransport });

    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: "smtp.example.com",
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: "smtp-user", pass: "smtp-secret" },
      disableFileAccess: true,
      disableUrlAccess: true,
    }));
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: "AI 노트 <no-reply@example.com>",
      to: "customer@example.jp",
      subject: "[AI 노트] 임시 비밀번호 안내",
      text: expect.stringContaining("T9!TemporaryPass"),
      html: expect.stringContaining("T9!TemporaryPass"),
    }));
  });
});
