import { AccessShell } from "@/components/AccessShell";
import { AdminMfaResetForm } from "@/components/AdminAccessForms";

export default function AdminMfaResetPage() {
  return (
    <AccessShell eyebrow="LOCAL MFA RECOVERY" title="운영자 인증 앱을 안전하게 다시 등록하세요." description="이 복구 화면은 AWS 서버로 연결된 로컬 SSH 통로에서만 동작하며 공개 인터넷에서는 재설정 요청을 거부합니다.">
      <AdminMfaResetForm />
    </AccessShell>
  );
}
