import { AccessShell } from "@/components/AccessShell";
import { CustomerLoginForm } from "@/components/CustomerAccessForms";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <AccessShell eyebrow="VISION CUSTOMER WORKSPACE" title="회의의 시작부터 기록까지, 원래 쓰던 AI 노트에서 이어가세요." description="로그인하면 새 대시보드가 아니라 기존 Vision AI 미팅 에이전트의 홈 화면이 바로 열립니다.">
      <CustomerLoginForm nextPath={next} />
    </AccessShell>
  );
}
