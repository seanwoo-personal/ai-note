# AWS 고객 테스트 배포 안내

이 구성은 별도 도메인 없이도 고객 테스트를 시작할 수 있습니다. 앱은 AWS Lightsail의 Docker에서 실행되고, Cloudflare Quick Tunnel이 매번 임의의 `https://...trycloudflare.com` 주소를 만듭니다. 브라우저 마이크는 보안 컨텍스트가 필요하므로 공개 IP의 단순 HTTP 주소가 아니라 이 HTTPS 주소를 사용합니다.

> 현재 회의·라이브러리·단어장·개인 설정·검색 인덱스는 승인된 고객 계정 ID를 해시한 서버 전용 테넌트 저장소(`data/tenants/{sha256}`)로 분리됩니다. 계정은 로그인 세션에서만 결정하며 다른 계정의 저장소를 전역 목록이나 회의 ID로 읽지 못하도록 모든 데이터 API와 데이터 페이지에서 같은 계정 경계를 적용합니다. 요약 모델 설정과 계정 파일은 서버 전역입니다. 다만 파일 기반 단일 서버 구성은 고객 테스트용입니다. 상용 다중 조직 운영에서는 데이터베이스·객체 저장소·조직 권한·감사 로그까지 포함한 별도 운영 구조가 필요합니다.

## 1. AWS 계정 만들기

1. [AWS 계정 생성](https://signin.aws.amazon.com/signup)에서 본인이 관리할 이메일과 계정 이름을 입력합니다.
2. 연락처, 결제 카드, 전화번호 본인 인증을 완료합니다. 새 계정도 유효한 결제 수단이 필요합니다.
3. 지원 플랜은 무료인 `Basic Support`를 선택합니다.
4. 루트 계정에 패스키 또는 보안 키 기반 MFA를 바로 등록합니다.
5. 루트 계정은 결제·계정 복구에만 쓰고, 일상 작업용 관리자는 IAM Identity Center에서 별도로 만듭니다. 루트 액세스 키는 만들지 않습니다.
6. Billing의 Budgets에서 월 예산 알림을 설정합니다. 예: 10달러와 20달러 두 단계 알림.

AWS의 공식 절차는 [계정 생성 안내](https://docs.aws.amazon.com/hands-on/latest/setup-environment/module-one.html), 보안 원칙은 [루트 사용자 모범 사례](https://docs.aws.amazon.com/IAM/latest/UserGuide/root-user-best-practices.html)와 [루트 MFA 설정](https://docs.aws.amazon.com/IAM/latest/UserGuide/enable-mfa-for-root.html)을 기준으로 합니다.

## 2. Lightsail 서버 만들기

1. AWS 콘솔에서 `Lightsail`을 열고 리전을 고객과 가까운 `Tokyo`로 선택합니다.
2. `Create instance` → `Linux/Unix` → `OS Only` → 최신 Ubuntu LTS를 선택합니다.
3. 빌드 안정성을 위해 메모리 2GB 플랜을 권장합니다. 테스트가 매우 작으면 더 낮은 플랜도 가능하지만 빌드 중 메모리가 부족할 수 있습니다.
4. 인스턴스 이름을 정하고 생성합니다.
5. Networking에서 정적 IP를 만들어 인스턴스에 연결합니다. Quick Tunnel 자체에는 필수가 아니지만 서버 재접속과 향후 도메인 연결이 쉬워집니다.
6. Lightsail의 브라우저 SSH로 접속합니다.

서버 생성 방식은 [Lightsail 인스턴스 시작](https://docs.aws.amazon.com/lightsail/latest/userguide/getting-started-with-amazon-lightsail.html), 고정 주소는 [정적 IP 연결](https://docs.aws.amazon.com/lightsail/latest/userguide/lightsail-create-static-ip.html)을 따릅니다.

## 3. Docker와 프로젝트 설치

SSH 터미널에서 다음 순서로 진행합니다.

```sh
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
```

SSH를 종료하고 다시 접속한 뒤 프로젝트를 내려받습니다. 비공개 저장소라면 GitHub의 배포 키나 임시 업로드 방식을 사용합니다.

```sh
git clone <프로젝트-저장소-주소> ai-note
cd ai-note
cp .env.production.example .env.production
nano .env.production
```

`SONIOX_API_KEY`와 `OPENROUTER_API_KEY`에 실제 키를 입력하고 저장합니다. 키 파일은 Git에 커밋하지 않습니다.

## 4. 도메인 없이 실행하고 URL 확인하기

```sh
docker compose up -d --build
docker compose ps
docker compose logs tunnel
```

터널 로그의 `https://...trycloudflare.com` 주소를 고객사에 전달합니다. 이 주소는 도메인이나 Cloudflare 계정 없이 만들 수 있지만 테스트 전용이며, 터널을 다시 만들면 주소가 바뀔 수 있습니다. Cloudflare도 Quick Tunnel을 개발·테스트 용도로만 안내합니다.

앱이 정상인지 서버에서 확인하려면 다음을 실행합니다.

```sh
curl -I http://127.0.0.1:3000/login
docker compose logs app --tail=100
```

Quick Tunnel 제한과 사용법은 [Cloudflare 공식 안내](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)를 확인합니다.

## 5. 최초 운영자와 고객 계정

1. 임시 HTTPS 주소의 `/admin/setup`에서 최초 운영자를 만듭니다.
2. 운영자 계정은 긴 고유 비밀번호와 TOTP MFA를 사용합니다.
3. 고객은 `/signup`에서 가입을 신청합니다.
4. `/admin`에서 해당 고객의 결제 상태와 승인 상태를 확인한 뒤 활성화합니다.
5. 테스트에 참여하기로 확인된 고객 계정만 승인합니다. 승인된 각 계정의 회의 데이터는 서로 다른 테넌트 저장소에 기록됩니다.

## 6. 비밀번호 복구 메일 설정

고객의 `비밀번호 찾기`를 실제로 사용하려면 TLS SMTP 발신 계정이 필요합니다. AWS를 사용하는 경우 Lightsail과 같은 리전의 Amazon SES에서 발신 이메일 또는 도메인을 먼저 인증하고, `SMTP settings`에서 전용 SMTP 자격증명을 생성합니다. AWS 액세스 키가 아니라 SES가 발급한 SMTP 사용자 이름과 SMTP 비밀번호를 사용합니다.

SES 계정이 sandbox 상태이면 받는 고객 이메일도 각각 인증해야 하므로, 실제 고객에게 보내기 전 SES production access를 신청합니다. 발신 주소 인증은 [AWS SES verified identities](https://docs.aws.amazon.com/ses/latest/dg/verify-addresses-and-domains.html), SMTP 자격증명 발급은 [AWS SES SMTP credentials](https://docs.aws.amazon.com/ses/latest/dg/smtp-credentials.html)을 따릅니다.

Tokyo 리전 SES의 정확한 SMTP endpoint를 콘솔에서 확인한 뒤 `.env.production`에 입력합니다. 포트 587은 STARTTLS를 강제하고, 포트 465를 사용할 때만 `AI_NOTE_SMTP_SECURE=true`로 설정합니다.

```sh
AI_NOTE_SMTP_HOST=email-smtp.ap-northeast-1.amazonaws.com
AI_NOTE_SMTP_PORT=587
AI_NOTE_SMTP_SECURE=false
AI_NOTE_SMTP_USER=<SES SMTP 사용자 이름>
AI_NOTE_SMTP_PASSWORD=<SES SMTP 비밀번호>
AI_NOTE_SMTP_FROM="AI 노트 <인증한-발신주소@example.com>"
```

환경 파일을 저장한 뒤 앱 컨테이너만 다시 빌드·시작합니다. 비밀번호 찾기 API는 SMTP 설정이 빠져 있으면 `503`으로 정직하게 실패하며, 계정 존재 여부는 성공 응답에서 구분하지 않습니다.

## 7. 운영 명령

```sh
# 새 코드 반영
git pull --ff-only
docker compose up -d --build

# 상태와 로그
docker compose ps
docker compose logs -f app

# 중지
docker compose down
```

`docker compose down`은 데이터 볼륨을 삭제하지 않습니다. `docker compose down -v`는 회의·계정 데이터를 삭제하므로 사용하지 마세요.

## 8. 고정 도메인 · 이름 있는 Cloudflare Tunnel

Quick Tunnel 주소는 터널이 다시 만들어질 때마다 바뀝니다. 도메인이 Cloudflare DNS에 있으면(Cloudflare Registrar 구매 또는 네임서버 이전) 아래 한 번의 설정으로 고정 주소를 붙입니다. 터널 인증서·자격증명·ingress 설정은 서버의 Docker 볼륨 `ai-note-cloudflared`에만 있고 저장소에는 넣지 않습니다.

```sh
cd ~/ai-note
docker volume create ai-note-cloudflared
docker run --rm -v ai-note-cloudflared:/home/nonroot/.cloudflared alpine chown -R 65532:65532 /home/nonroot/.cloudflared
CF="docker run --rm -v ai-note-cloudflared:/home/nonroot/.cloudflared cloudflare/cloudflared:latest"
$CF tunnel login                     # 출력된 URL을 브라우저에서 열어 zone을 승인
$CF tunnel create ai-note-tokyo      # 터널 ID가 출력됨
$CF tunnel route dns ai-note-tokyo note.example.dev
```

`config.yml`을 볼륨 안에 만듭니다(`<id>`는 위 터널 ID).

```yaml
tunnel: <id>
credentials-file: /home/nonroot/.cloudflared/<id>.json
ingress:
  - hostname: note.example.dev
    service: http://app:3000
  - service: http_status:404
```

그다음 프로젝트 폴더의 `.env`(compose 변수 파일, gitignore 대상)에 `CLOUDFLARE_TUNNEL_ARGS="run ai-note-tokyo"`를, `.env.production`에 `APP_ORIGIN=https://note.example.dev`를 넣고 `docker compose up -d`로 재시작합니다. 앱은 `APP_ORIGIN`과 정확히 같은 origin만 신뢰하므로 오타가 있으면 로그인·저장 요청이 403으로 막힙니다. `.dev` 같은 HSTS 사전 등록 TLD는 HTTPS로만 열립니다.

확인: `curl -I https://note.example.dev/login`이 200이면 됩니다. 이후 Android 앱은 같은 주소로 다시 빌드합니다(`android-app/README.md`).
