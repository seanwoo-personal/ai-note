import { AccessShell } from "@/components/AccessShell";
import { OperatorAcceptForm } from "@/components/AdminAccessForms";

export default async function OperatorAcceptPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <AccessShell eyebrow="OPERATOR INVITATION" title="초대받은 운영자만 계정을 만들 수 있어요." description="비밀번호를 정한 뒤 인증 앱과 복구 코드를 등록하면 운영자 화면을 사용할 수 있습니다.">
      <OperatorAcceptForm token={token ?? ""} />
    </AccessShell>
  );
}
