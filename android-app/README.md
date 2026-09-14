# 헤이홈 AI 노트 안드로이드 앱

기존 AI 노트 고객용 웹앱을 안전한 안드로이드 WebView 셸로 제공한다. 고객 로그인·회의 녹음·다국어 전사·AI 회의록은 기존 서버를 그대로 사용하고, 안드로이드 앱은 마이크 권한·내비게이션·다운로드·오류 복구를 담당한다. 운영자 기능은 웹 브라우저에서만 사용한다.

## 기본 구성

- 앱 이름: `헤이홈 AI 노트`
- application ID: `com.hejhome.ainote`
- 최소 Android: 8.0(API 26)
- 기본 서버: 현재 AWS 테스트 인스턴스의 HTTPS Quick Tunnel
- 로컬 파일 접근과 HTTP 평문 통신은 차단한다.
- WebView 내부 이동은 빌드 시 지정한 서버와 동일한 HTTPS 출처만 허용한다.
- 마이크는 해당 출처가 오디오 캡처를 요청한 경우에만 Android 권한을 거쳐 허용한다.
- 고객 로그인·비밀번호 찾기·새 비밀번호 설정에서는 홍보·가입 신청·운영자 진입 요소를 숨기고 계정 폼을 먼저 표시한다.
- `/admin` 계열 화면은 Android 앱 안에서 열지 않는다.

## 고객 테스트용 설치 파일

현재 검증된 전달본:

```text
dist/hejhome-ai-note-android-1.3-test.apk
```

이 APK는 고객 테스트용 서명으로 설치 가능하며 WebView 원격 디버깅이 꺼져 있다. Google Play 배포 전에는 조직이 관리하는 운영용 서명 키와 고정 도메인으로 다시 빌드해야 한다.

안드로이드 기기에서 APK를 내려받아 열고, 브라우저 또는 파일 앱의 `출처를 알 수 없는 앱 설치` 권한을 한 번 허용하면 설치할 수 있다. 최초 녹음 시 표시되는 마이크 권한도 허용해야 한다.

## 검증과 개발 APK 생성

```bash
cd android-app
./gradlew testDebugUnitTest lintDebug assembleDebug
```

개발용 설치 파일:

```text
app/build/outputs/apk/debug/app-debug.apk
```

연결된 기기나 에뮬레이터에 실행:

```bash
android run --debug --apks=app/build/outputs/apk/debug/app-debug.apk
```

기기 보안 설정 검증:

```bash
./gradlew connectedDebugAndroidTest
```

## 서버 주소 변경

Quick Tunnel 주소가 바뀌면 새 HTTPS 주소를 Gradle 속성으로 전달해 다시 빌드한다.

```bash
./gradlew clean assembleDebug \
  -PAI_NOTE_URL=https://새로운-테스트-주소.trycloudflare.com
```

운영 배포에서는 Quick Tunnel 대신 고정 도메인을 사용하고 같은 방식으로 APK를 다시 생성한다.
