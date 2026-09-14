import { AccessShell } from "@/components/AccessShell";
import { CustomerForgotPasswordForm } from "@/components/CustomerAccessForms";

export default function ForgotPasswordPage() {
  return (
    <AccessShell eyebrow="PASSWORD RECOVERY" title="가입 이메일로 안전하게 계정을 복구하세요." description="가입 여부는 화면에 표시하지 않으며, 등록된 고객에게만 일회용 임시 비밀번호를 전송합니다.">
      <CustomerForgotPasswordForm />
    </AccessShell>
  );
}
