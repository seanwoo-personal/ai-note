import { AccessShell } from "@/components/AccessShell";
import { AdminSetupForm } from "@/components/AdminAccessForms";

export default function AdminSetupPage() {
  return (
    <AccessShell eyebrow="SECURE BOOTSTRAP" title="운영자 계정은 공개 회원가입으로 만들지 않아요." description="최초 최고 운영자만 로컬에서 한 번 만들고, 이후 계정은 최고 운영자가 발급한 일회용 초대로 생성합니다.">
      <AdminSetupForm />
    </AccessShell>
  );
}
