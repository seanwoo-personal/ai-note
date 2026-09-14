import Link from "next/link";

import { AccessCard, AccessShell, secondaryButtonClass } from "@/components/AccessShell";

export default function SignupSuccessPage() {
  return (
    <AccessShell eyebrow="APPLICATION RECEIVED" title="회원가입 신청을 접수했습니다." description="운영자가 고객사 정보와 결제 상태를 확인하면 계정을 활성화합니다.">
      <AccessCard>
        <p className="text-[12px] font-semibold text-accent">신청 완료</p>
        <h2 className="mt-2 text-[24px] font-bold">승인 전에는 로그인할 수 없어요</h2>
        <p className="mt-4 text-[14px] leading-7 text-inkSoft">승인과 결제가 모두 확인된 뒤 같은 이메일과 비밀번호로 로그인해 주세요. 승인 상태는 운영자가 관리합니다.</p>
        <Link href="/login" className={`${secondaryButtonClass} mt-6 w-full`}>로그인 화면으로 돌아가기</Link>
      </AccessCard>
    </AccessShell>
  );
}
