import { NextResponse } from "next/server";

import { guardLocalApiRequest, parseBoundedJsonBody, requestBodyErrorResponse } from "@/lib/localRequestGuard";

export function accountJson(data: unknown, status = 200): NextResponse {
  const response = NextResponse.json(data, { status });
  response.headers.set("cache-control", "no-store, max-age=0");
  response.headers.set("pragma", "no-cache");
  response.headers.set("x-content-type-options", "nosniff");
  return response;
}

export async function readAccountJson(request: Request, maxBytes = 16_384): Promise<{ denied?: Response; body?: unknown }> {
  const denied = guardLocalApiRequest(request);
  if (denied) return { denied };
  try {
    return { body: await parseBoundedJsonBody(request, maxBytes) };
  } catch (error) {
    return { denied: requestBodyErrorResponse(error) };
  }
}

export function textField(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : null;
}

export function emailField(value: unknown): string | null {
  const email = textField(value, 254)?.toLowerCase() ?? null;
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ? email : null;
}

export function accountError(code: string, status = 400): NextResponse {
  const messages: Record<string, string> = {
    invalid_credentials: "이메일 또는 비밀번호를 확인해 주세요.",
    invalid_otp: "인증 코드를 확인해 주세요.",
    pending_approval: "회원가입 신청을 검토 중입니다. 승인 완료 후 로그인할 수 있습니다.",
    payment_required: "결제가 확인되지 않아 계정이 비활성화되어 있습니다. 운영자에게 문의해 주세요.",
    blocked: "현재 차단된 계정입니다. 운영자에게 문의해 주세요.",
    email_already_exists: "이미 신청 또는 등록된 이메일입니다.",
    password_policy: "비밀번호는 12자 이상이며 영문, 숫자, 특수문자를 모두 포함해야 합니다.",
    admin_already_exists: "초기 운영자 설정이 이미 완료되었습니다.",
    invitation_invalid: "초대 링크가 만료되었거나 이미 사용되었습니다.",
    access_denied: "이 화면에 접근할 권한이 없습니다.",
    account_not_found: "계정을 찾을 수 없습니다.",
    too_many_attempts: "로그인 시도가 너무 많습니다. 잠시 뒤 다시 시도해 주세요.",
    too_many_password_resets: "임시 비밀번호 요청이 너무 많습니다. 한 시간 뒤 다시 시도해 주세요.",
    password_email_unavailable: "현재 임시 비밀번호 메일을 보낼 수 없습니다. 운영자에게 문의해 주세요.",
    password_confirmation_mismatch: "새 비밀번호와 확인 값이 일치하지 않습니다.",
    password_change_required: "새 비밀번호를 설정해야 계속 사용할 수 있습니다.",
    authentication_required: "로그인이 필요합니다.",
    invalid_request: "입력한 내용을 다시 확인해 주세요.",
    internal_error: "서버에서 요청을 처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.",
  };
  return accountJson({ error: { code, message: messages[code] ?? "요청을 처리하지 못했습니다." } }, status);
}
