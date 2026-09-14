import { AccessShell } from "@/components/AccessShell";
import { CustomerPasswordChangeForm } from "@/components/CustomerAccessForms";

export default function PasswordChangePage() {
  return (
    <AccessShell eyebrow="PASSWORD CHANGE REQUIRED" title="임시 비밀번호를 새 비밀번호로 교체하세요." description="임시 비밀번호는 한 번만 사용할 수 있으며 새 비밀번호를 설정한 뒤 기존 AI 노트 화면으로 이동합니다.">
      <CustomerPasswordChangeForm />
    </AccessShell>
  );
}
