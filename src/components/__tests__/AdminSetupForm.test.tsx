import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminSetupForm } from "@/components/AdminAccessForms";

const RESULT = {
  email: "owner@example.com",
  totpSecret: "JBSWY3DPEHPK3PXP",
  totpUri: "otpauth://totp/Vision%20AI%20Meeting%20Agent%3Aowner%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Vision%20AI%20Meeting%20Agent&algorithm=SHA1&digits=6&period=30",
  recoveryCodes: ["aaaa-bbbb", "cccc-dddd"],
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function stubBootstrap(canBootstrap: boolean) {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input) !== "/api/admin/bootstrap") throw new Error(`unexpected URL: ${String(input)}`);
    if (init?.method === "POST") return response(RESULT, 201);
    return response({ canBootstrap });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function submitSetup() {
  fireEvent.change(await screen.findByLabelText("이름"), { target: { value: "Owner" } });
  fireEvent.change(screen.getByLabelText("운영자 이메일"), { target: { value: RESULT.email } });
  fireEvent.change(screen.getByLabelText("비밀번호"), { target: { value: "correct-horse-battery-staple" } });
  fireEvent.click(screen.getByRole("button", { name: "최고 운영자 생성" }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AdminSetupForm security material", () => {
  it("shows the authenticator QR code next to the secret and recovery codes", async () => {
    stubBootstrap(true);
    render(<AdminSetupForm />);
    await submitSetup();

    const qr = await screen.findByRole("img", { name: "인증 앱 QR 코드" });
    expect(qr.getAttribute("src")).toMatch(/^data:image\/svg\+xml/u);
    expect(screen.getByText(RESULT.totpSecret)).toBeInTheDocument();
    for (const code of RESULT.recoveryCodes) expect(screen.getByText(code)).toBeInTheDocument();
    expect(screen.getByText(RESULT.email)).toBeInTheDocument();
    // The raw otpauth URI is carried by the QR code, not spelled out on screen.
    expect(screen.queryByText(RESULT.totpUri)).not.toBeInTheDocument();
  });

  it("explains the loopback-only rule instead of claiming setup is finished when the host is rejected", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ error: { code: "invalid_host", message: "로컬 앱 요청만 허용됩니다" } }, 403)));
    render(<AdminSetupForm />);
    expect(await screen.findByText("이 화면은 서버 로컬에서만 열려요")).toBeInTheDocument();
    expect(screen.queryByText("최초 운영자 설정이 완료되어 있어요")).not.toBeInTheDocument();
  });

  it("still reports completion when an operator already exists", async () => {
    stubBootstrap(false);
    render(<AdminSetupForm />);
    expect(await screen.findByText("최초 운영자 설정이 완료되어 있어요")).toBeInTheDocument();
  });
});
