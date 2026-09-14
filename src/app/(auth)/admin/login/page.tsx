import { AccessShell } from "@/components/AccessShell";
import { AdminLoginForm } from "@/components/AdminAccessForms";

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <AccessShell eyebrow="VISION OPERATIONS" title="승인, 결제, 사용량을 한곳에서 관리하세요." description="운영자 계정은 공개 가입을 받지 않으며 비밀번호와 2단계 인증을 모두 통과해야 합니다.">
      <AdminLoginForm nextPath={next} />
    </AccessShell>
  );
}
