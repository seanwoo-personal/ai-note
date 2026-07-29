export type ProductRelease = {
  version: string;
  date: string;
  title: string;
  changes: readonly string[];
};

// Versioning policy: the clean-room AI NOTE OSS baseline is 1.0. Each subsequent
// user-facing product milestone increments the minor number once. Merge, docs,
// test-only, and internal repair commits stay inside their milestone release.
export const PRODUCT_RELEASES: readonly ProductRelease[] = [
  {
    version: "1.13",
    date: "2026-07-29",
    title: "언어별 화자 동시 통역",
    changes: [
      "Translator에서 한국어·영어 참석 인원을 각각 확인하고 화자별 등록 섹션 생성",
      "세션 화자 번호를 한국어·영어 참가자 프로필에 확인 후 연결",
      "양쪽 언어의 완결된 번역을 화자별 순서대로 기본 스피커에서 재생",
      "마이크 에코 제거와 최대 15명 제한, 스피커 울림 대응 안내 추가",
    ],
  },
  {
    version: "1.12",
    date: "2026-07-28",
    title: "개인·다자간 실시간 통역과 사용성 설정",
    changes: [
      "왼쪽 내비게이션과 오른쪽 본문을 독립 스크롤 영역으로 분리",
      "설정에서 앱 전체 글자 크기를 단계별로 조절하고 브라우저에 저장",
      "회의 상세 화면에 명확한 영구 삭제 동선 추가",
      "Translator에 세션 화자 프로필과 등록 확인, 우리 팀 최종 번역 TTS, 상대 팀 번역 자막 추가",
      "설정 하단에 버전 정책과 전체 릴리즈 노트 추가",
    ],
  },
  {
    version: "1.11",
    date: "2026-07-28",
    title: "Hejhome AI 기록도구 완성 및 안정화",
    changes: [
      "헤이홈/Hejhome 브랜딩, SUIT, 다크·라이트·시스템 테마와 4개 언어 적용",
      "홈 빠른 시작, 최근 작업, 상태·복구 동선과 사용자 콘텐츠 번역 경계 복원",
      "긴 TTS, 오류 시 오디오 정리, Voice Typing 초안 복구와 접근성 보강",
    ],
  },
  {
    version: "1.10",
    date: "2026-07-28",
    title: "Soniox 워크스페이스 도구",
    changes: [
      "Smart Scribe, Translator, Voice Typing 도구 추가",
      "워크스페이스·폴더를 통합한 왼쪽 내비게이션과 최근 문서 홈 구성",
      "실시간 STT→번역→TTS 파이프라인과 브라우저 단축키 제공",
    ],
  },
  {
    version: "1.9",
    date: "2026-07-27",
    title: "Soniox 실시간 전사",
    changes: [
      "기존 Whisper 녹음을 유지하면서 Soniox 실시간 전사 모드 추가",
      "브라우저 임시 키와 실시간 WebSocket 연결 경계 적용",
    ],
  },
  {
    version: "1.8",
    date: "2026-07-25",
    title: "설치 및 첫 실행 경험",
    changes: [
      "안전한 초기화, 설치 진단, 앱이 소유하는 실행 프로세스 도입",
      "첫 사용 준비 상태와 모델 선택, 전사 실패 복구 흐름 보강",
      "격리된 Playwright 첫 실행 시나리오와 제품 문서 정비",
    ],
  },
  {
    version: "1.7",
    date: "2026-07-23",
    title: "인라인 회의 내용 편집",
    changes: [
      "전체 스크립트와 자유 형식 회의록을 상세 화면에서 직접 편집",
      "저장 충돌·불확실 상태 확인과 원본 보존 동선 추가",
    ],
  },
  {
    version: "1.6",
    date: "2026-07-15",
    title: "수동 스크립트·요약 편집과 재생성",
    changes: [
      "전사·요약 revision 계약과 안전한 수동 편집 API 추가",
      "스크립트와 요약을 독립적으로 재생성하고 최신 상태를 검증",
      "미저장 편집 이동 보호와 합성 브라우저 검증 추가",
    ],
  },
  {
    version: "1.5",
    date: "2026-07-14",
    title: "검색·도우미 근거와 내비게이션 개선",
    changes: [
      "회의 전사 근거를 활용한 검색·도우미 응답 보강",
      "사이드바 검색 오버레이와 전역 도우미 패널 구성",
      "목록·상세 상태 동기화와 오래된 검색 페이지 정리",
    ],
  },
  {
    version: "1.4",
    date: "2026-07-12",
    title: "회의 검색과 챗봇 기반",
    changes: [
      "사용자 프로필, 지식 인덱스와 재색인 파이프라인 추가",
      "간단 검색 및 회의 도우미 도구 백엔드 구현",
    ],
  },
  {
    version: "1.3",
    date: "2026-07-11",
    title: "워크스페이스 라이브러리와 UI·UX 강화",
    changes: [
      "워크스페이스·폴더 라이브러리 기반과 반응형 홈 구성",
      "공통 다이얼로그, 상세 정보 구조, 탭, 오디오 UI 개선",
      "폼 상태·접근성·회귀 검증 전반 보강",
    ],
  },
  {
    version: "1.2",
    date: "2026-07-10",
    title: "회의 관리와 단어장",
    changes: [
      "회의 제목 수정과 영구 삭제 추가",
      "단어장·교정쌍 관리와 왼쪽 사이드바 추가",
      "수동 재요약, 진행 상태, LLM 상태·격리 안정화",
    ],
  },
  {
    version: "1.1",
    date: "2026-07-08",
    title: "앱 내 요약과 배포 기반",
    changes: [
      "로컬 CLI·Ollama 기반 앱 내 요약과 백그라운드 작업 추가",
      "요약 UI, 내보내기, 설치 진단과 크로스 플랫폼 문서 추가",
      "Whisper 무음·환각 필터와 모델 출력 안전성 보강",
    ],
  },
  {
    version: "1.0",
    date: "2026-07-08",
    title: "AI NOTE 오픈소스 기준판",
    changes: [
      "AI NOTE를 clean-room 방식의 오픈소스 프로젝트로 정리",
      "회의 녹음, Whisper 전사, 기본 회의록 흐름 제공",
    ],
  },
] as const;

export const CURRENT_PRODUCT_VERSION = PRODUCT_RELEASES[0].version;
export const PRODUCT_UPDATE_COUNT = PRODUCT_RELEASES.length - 1;
