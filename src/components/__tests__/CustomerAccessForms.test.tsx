// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppPreferencesProvider } from "@/components/AppPreferences";
import {
  CustomerForgotPasswordForm,
  CustomerLoginForm,
  CustomerPasswordChangeForm,
} from "@/components/CustomerAccessForms";

describe("customer password access forms", () => {
  it("offers password recovery from the customer login form", () => {
    render(<CustomerLoginForm />);
    expect(screen.getByRole("link", { name: "비밀번호를 잊으셨나요?" })).toHaveAttribute("href", "/forgot-password");
  });

  it("opens the customer guide beside the operator entry point", () => {
    render(<CustomerLoginForm />);

    const operatorLink = screen.getByRole("link", { name: "운영자 화면으로 이동" });
    const guideLink = screen.getByRole("link", { name: "사용방법 보기" });
    expect(operatorLink.parentElement).toBe(guideLink.parentElement);
    expect(guideLink).toHaveAttribute("href", "/customer-guide.html");
    expect(guideLink).toHaveAttribute("target", "_blank");
    expect(guideLink).toHaveAttribute("rel", "noreferrer");
  });

  it("switches the customer login screen between Korean, English, and Japanese", async () => {
    window.localStorage.setItem("ai-note-locale", "ko");
    render(<AppPreferencesProvider><CustomerLoginForm /></AppPreferencesProvider>);

    expect(screen.getByRole("group", { name: "로그인 화면 언어" })).toBeVisible();
    expect(screen.getAllByRole("button", { name: /한국어|English|日本語/u }).map((button) => button.textContent)).toEqual([
      "日本語", "English", "한국어",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "English" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Start using AI Note" })).toBeVisible());
    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
    expect(screen.getByRole("link", { name: "View user guide" })).toHaveAttribute("href", "/customer-guide-en.html");
    expect(window.localStorage.getItem("ai-note-locale")).toBe("en");

    fireEvent.click(screen.getByRole("button", { name: "日本語" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "AIノートを始めましょう" })).toBeVisible());
    expect(screen.getByLabelText("メールアドレス")).toHaveAttribute("type", "email");
    expect(screen.getByRole("link", { name: "使い方を見る" })).toHaveAttribute("href", "/customer-guide.html");
    expect(window.localStorage.getItem("ai-note-locale")).toBe("ja");
  });

  it("opens in Japanese for a first-time customer", async () => {
    window.localStorage.removeItem("ai-note-locale");
    render(<AppPreferencesProvider><CustomerLoginForm /></AppPreferencesProvider>);

    await waitFor(() => expect(screen.getByRole("heading", { name: "AIノートを始めましょう" })).toBeVisible());
    expect(screen.getAllByRole("button", { name: /日本語|English|한국어/u }).map((button) => button.textContent)).toEqual([
      "日本語", "English", "한국어",
    ]);
    expect(screen.getByRole("link", { name: "使い方を見る" })).toHaveAttribute("href", "/customer-guide.html");
  });

  it("renders an email-only temporary password request", () => {
    render(<CustomerForgotPasswordForm />);
    expect(screen.getByLabelText("가입 이메일")).toHaveAttribute("type", "email");
    expect(screen.getByRole("button", { name: "임시 비밀번호 받기" })).toBeVisible();
  });

  it("requires the new password twice before leaving recovery mode", () => {
    render(<CustomerPasswordChangeForm />);
    expect(screen.getByLabelText("새 비밀번호")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("새 비밀번호 확인")).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "새 비밀번호로 변경" })).toBeVisible();
  });
});
