import { AccessShell } from "@/components/AccessShell";
import { CustomerSignupForm } from "@/components/CustomerAccessForms";

export default function SignupPage() {
  return (
    <AccessShell eyebrow="CUSTOMER APPLICATION" title="누구나 신청할 수 있지만, 아무나 바로 들어갈 수는 없어요." description="고객사가 신청서를 보내면 비전 운영자가 계약과 결제를 확인하고 계정을 승인합니다.">
      <CustomerSignupForm />
    </AccessShell>
  );
}
