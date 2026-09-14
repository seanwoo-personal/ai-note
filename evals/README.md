# evals/ — AI 기능 품질 검증

이 디렉터리는 회의록 생성 품질과 실제 음성의 다국어·화자 구분 품질을 반복 측정하는 기준을 보관한다. 제품 코드를 바꾸기 전에 같은 입력으로 기준 결과를 만들고, 변경 뒤 같은 조건으로 다시 실행한다.

실제 오디오, 전사 전문, API 키와 실행 보고서는 저장소에 넣지 않는다. 모두 gitignored `test-results/` 아래에만 둔다. 저장소에는 재현에 필요한 영상 주소·구간·기대 화자 수와 결과를 계산하는 코드만 둔다.

## 회의록 생성 품질

- `meeting-summarize.eval.md` — 정확도·누락·환각·구조 충실도 루브릭
- `agent-results.json` — 골드 케이스 결과
- 최초 자동 생성은 원문 전사를 교정한 뒤 그 교정본으로 요약한다. 실제 앱 실행은 서버의 작업별 모델 경로를 사용한다.

## 유튜브 화자 구분 품질

- `youtube-diarization-manifest.json` — 한국어·일본어·영어 인터뷰 4개 일반 회귀 세트
- `youtube-diarization-feedback-manifest.json` — 고객 피드백 화면에서 원문을 역추적한 영어 영상 2개와 중간 다국어 영상으로 구성한 정확 재현 세트
- `youtube-diarization-same-gender-manifest.json` — 비슷한 음역의 여성 화자 두 명을 구분하는 한국어 인터뷰 세트
- `youtube-diarization-same-gender-context-manifest.json` — 같은 인터뷰에 공식 화자 컨텍스트를 제공하는 비교 세트
- `youtube-diarization-challenging-manifest.json` — 일본어 여성 2인 대담과 끼어들기가 있는 한국어 남성 4인 토론 세트
- `youtube-diarization-korean-panel-context-manifest.json` — 한국어 4인 토론에 정확한 화자 수와 역할 문맥을 제공하는 비교 세트
- `youtube-diarization-korean-panel-manifest.json` — 같은 한국어 4인 토론의 설정별 독립 비교 세트
- `youtube-diarization-korean-panel-repeat-manifest.json` — 한국어 4인 토론의 영상별 비동기 결과를 세 번 반복하는 세트
- `youtube-diarization-japanese-women-repeat-manifest.json` — 일본어 여성 2인 대담을 세 번 반복하는 세트
- `youtube-diarization-remote-manifest.json` — 실제 Zoom으로 진행된 일본어 남성 3인 원격 대담 세트
- `youtube-diarization-remote-context-manifest.json` — 같은 원격 대담에 정확한 출연자 문맥을 제공하는 비교 세트
- `youtube-diarization-remote-short-manifest.json` — 세 사람이 모두 말하는 원격 대담 첫 60초 분리 세트
- `youtube-diarization-long-session-manifest.json` — 검증된 네 영상을 세 차례 순환하는 약 18분 장시간 누적 세트
- `youtube-diarization-order-rotation-manifest.json` — 같은 네 영상이 세션 내 네 위치를 한 번씩 차지하는 약 24분 교차 순서 세트
- `youtube-diarization-local-qualification-manifest.json` — Linux 로컬 후보를 1·2·3·4인 실제 다국어 영상으로 교차 검증하는 자격 세트
- `scripts/diarization-quality.mjs` — 같은 클립을 하나의 연속 세션과 영상별 독립 세션으로 처리해 영상별 화자 수, 한 화자 쏠림, 화자 누락과 과분리를 계산

영상별 `expectedMinSpeakers`보다 적게 나오면 `collapsed`, `expectedMaxSpeakers`보다 많이 나오면 `fragmented`로 기록한다. 실시간 입력은 실제 재생 속도와 같은 1배속으로 전송한다.

화자 수만 맞고 실제 발화를 서로 섞는 결과를 놓치지 않도록, 화면에서 활성 화자가 확실한
영상은 `referenceSpeakerAnchors`와 `minimumAnchorAgreement`를 함께 둔다. 앵커 구간 안의
전사 토큰을 시간으로 대응하고, 모델의 임의 Speaker 번호와 화면 화자를 일대일 최적
대응한 뒤 발화 시간 가중 일치율을 계산한다. 정답 화면이 불분명하거나 화면 공유만 보이는
구간은 앵커에 넣지 않는다.

### 클립 준비

`ffmpeg`, `uv`와 인터넷 연결이 필요하다. 원본 전체 영상은 저장하지 않고 manifest에 지정한 구간만 오디오로 받는다.

```bash
mkdir -p test-results/diarization-live/feedback/clips
jq -c '.sources[]' evals/youtube-diarization-feedback-manifest.json | while read -r source; do
  url=$(printf '%s' "$source" | jq -r '.url')
  start=$(printf '%s' "$source" | jq -r '.start')
  end=$(printf '%s' "$source" | jq -r '.end')
  file=$(printf '%s' "$source" | jq -r '.file')
  uvx --from yt-dlp yt-dlp --no-playlist --download-sections "*$start-$end" -x --audio-format m4a -o "test-results/diarization-live/feedback/clips/$file" "$url"
done
```

### 비동기 전체 파일 비교

```bash
node scripts/diarization-quality.mjs run-async \
  --manifest evals/youtube-diarization-feedback-manifest.json \
  --clips-dir test-results/diarization-live/feedback/clips \
  --output-dir test-results/diarization-live/feedback/async \
  --scope both
```

`run-async`도 `--scope continuous|isolated|both`를 받는다. 반복 편차를 확인할 때는
`isolated`로 특정 영상만 담은 manifest를 여러 번 실행하고, 정식 기준 실행은 `both`로
연속 파일과 영상별 파일을 함께 비교한다.

기존 전사 결과를 다시 호출하지 않고 최신 기대값으로만 재채점할 때는 다음 명령을 사용한다.

```bash
node scripts/diarization-quality.mjs rescore-report \
  --report test-results/diarization-live/example/async-continuous-report.json \
  --manifest evals/youtube-diarization-long-session-manifest.json \
  --output test-results/diarization-live/example/async-continuous-rescored.json
```

진행자의 내레이션과 실제 대화 음색이 서로 다른 화자로 과분리되는지 반복 검증할 때는
`evals/youtube-diarization-three-person-intro-manifest.json`을 사용한다. 이 영상의 출연자는
진행자, Fei-Fei Li, David Rogier 세 명이며 도입 내레이션은 별도 출연자가 아니다.

짧은 질문자와 긴 답변자가 한 명으로 합쳐지는 회귀는
`evals/youtube-diarization-turn-change-manifest.json`으로 분리해 반복한다.

### 실시간 연속 세션과 영상별 독립 세션 비교

두 방식을 한 번에 실행하고 영상별 새 세션 결과에 붕괴·과분리가 하나라도 남으면 종료 코드 2로 실패시키는 품질 게이트를 기본으로 사용한다.

```bash
node scripts/diarization-quality.mjs run-realtime \
  --manifest evals/youtube-diarization-feedback-manifest.json \
  --clips-dir test-results/diarization-live/feedback/clips \
  --output-dir test-results/diarization-live/feedback/realtime-both \
  --endpoint-detection true \
  --scope both
```

비용이나 시간을 나눠 확인해야 할 때만 아래처럼 한 방식씩 실행한다. 단일 방식은 보고서만 만들고 품질 게이트 종료 코드는 적용하지 않는다.

```bash
node scripts/diarization-quality.mjs run-realtime \
  --manifest evals/youtube-diarization-feedback-manifest.json \
  --clips-dir test-results/diarization-live/feedback/clips \
  --output-dir test-results/diarization-live/feedback/realtime-continuous \
  --endpoint-detection true \
  --scope continuous

node scripts/diarization-quality.mjs run-realtime \
  --manifest evals/youtube-diarization-feedback-manifest.json \
  --clips-dir test-results/diarization-live/feedback/clips \
  --output-dir test-results/diarization-live/feedback/realtime-isolated \
  --endpoint-detection true \
  --scope isolated
```

### 로컬 화자 임베딩 보조 판정

클라우드 전사의 화자 병합을 독립적으로 검출하기 위한 실험용 경로다. 제품 런타임에는 아직
연결하지 않으며 네이티브 모듈과 모델은 gitignored `test-results/` 아래에만 설치한다.

```bash
npm install \
  --prefix test-results/diarization-live/sherpa-probe/runtime \
  --no-audit --no-fund \
  sherpa-onnx-node@1.13.7

mkdir -p test-results/diarization-live/sherpa-probe/models
curl -fL -o test-results/diarization-live/sherpa-probe/models/segmentation.tar.bz2 \
  https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2
tar -xjf test-results/diarization-live/sherpa-probe/models/segmentation.tar.bz2 \
  -C test-results/diarization-live/sherpa-probe/models
curl -fL -o test-results/diarization-live/sherpa-probe/models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx \
  https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx

node scripts/diarization-quality.mjs run-local \
  --manifest evals/youtube-diarization-challenging-manifest.json \
  --clips-dir test-results/diarization-live/challenging/clips \
  --output-dir test-results/diarization-live/challenging/local \
  --sherpa-module test-results/diarization-live/sherpa-probe/runtime/node_modules/sherpa-onnx-node \
  --segmentation-model test-results/diarization-live/sherpa-probe/models/sherpa-onnx-pyannote-segmentation-3-0/model.int8.onnx \
  --embedding-model test-results/diarization-live/sherpa-probe/models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx

node scripts/diarization-quality.mjs run-hybrid \
  --manifest evals/youtube-diarization-challenging-manifest.json \
  --clips-dir test-results/diarization-live/challenging/clips \
  --output-dir test-results/diarization-live/challenging/hybrid \
  --local-report test-results/diarization-live/challenging/local/local-report.json
```

장시간 누적 여부를 확인할 때는 두 명령 모두 `--scope continuous`를 사용한다. 하이브리드
실행은 같은 manifest와 scope로 생성했고 유효 화자 결함이 없는 로컬 보고서만 받는다.
서로 다른 실험의 보고서를 잘못 조합하면 실행 전에 실패한다.

```bash
node scripts/diarization-quality.mjs run-local \
  --manifest evals/youtube-diarization-long-session-manifest.json \
  --clips-dir test-results/diarization-live/baseline-20260902/clips \
  --output-dir test-results/diarization-live/long-session-local \
  --sherpa-module test-results/diarization-live/sherpa-probe/runtime/node_modules/sherpa-onnx-node \
  --segmentation-model test-results/diarization-live/sherpa-probe/models/sherpa-onnx-pyannote-segmentation-3-0/model.int8.onnx \
  --embedding-model test-results/diarization-live/sherpa-probe/models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx \
  --scope continuous

node scripts/diarization-quality.mjs run-hybrid \
  --manifest evals/youtube-diarization-long-session-manifest.json \
  --clips-dir test-results/diarization-live/baseline-20260902/clips \
  --output-dir test-results/diarization-live/long-session-hybrid \
  --local-report test-results/diarization-live/long-session-local/local-continuous-report.json \
  --scope continuous
```

전체 연속 군집과 영상별 독립 군집의 실패 구간이 서로 다르면 두 보고서에서 영상별로
기대 화자 범위를 통과한 후보만 고를 수 있다. 두 후보가 모두 실패한 영상은 하이브리드
전사를 시작하지 않는다. 독립 보고서의 상대 시간과 연속 보고서의 절대 시간은 선택 뒤
자동으로 같은 시간축에 맞춘다.

```bash
node scripts/diarization-quality.mjs run-hybrid \
  --manifest evals/youtube-diarization-order-rotation-manifest.json \
  --clips-dir test-results/diarization-live/baseline-20260902/clips \
  --output-dir test-results/diarization-live/order-rotation-hybrid \
  --local-report test-results/diarization-live/order-rotation-local/local-continuous-report.json \
  --fallback-local-report test-results/diarization-live/order-rotation-local-isolated/local-report.json \
  --scope continuous
```

로컬 보고서의 원시 조각을 보존한 채 현재의 2초 유효 발화 기준과 회차 안정성만 다시
계산할 때는 외부 호출 없이 `rescore-local-report`를 사용한다.

```bash
node scripts/diarization-quality.mjs rescore-local-report \
  --report test-results/diarization-live/long-session-local/local-continuous-report.json \
  --output test-results/diarization-live/long-session-local/local-continuous-rescored.json
```

기준값은 자동 군집 임계값 0.85와 유효 화자 최소 누적 발화 2초다. 2초 미만 번호를
삭제하지 않고 `weakSpeakerIds`와 원시 과분리 목록에 보존한다. 다만 manifest에 유효 화자
기대값이 있으면 품질 게이트는 원시 번호가 아니라 유효 화자 수로 판정한다.

검증된 네 영상을 세 차례 반복하는 약 18분 장시간 세션은 다음 명령으로 확인한다.

```bash
node scripts/diarization-quality.mjs run-realtime \
  --manifest evals/youtube-diarization-long-session-manifest.json \
  --clips-dir test-results/diarization-live/baseline-20260902/clips \
  --output-dir test-results/diarization-live/long-session \
  --endpoint-detection true \
  --scope continuous
```

보고서의 `cycleStability`는 같은 영상이 반복 회차마다 같은 원시 화자 수와 충분히 지지된 화자 수를 유지하는지 보여 준다. 특정 영상이 매번 같은 방식으로 실패하면 내용별 모델 한계로 보고, 첫 회차는 통과했지만 뒤쪽 회차에서 새로 실패한 영상은 `lateRegressionSourceIds`로 따로 표시해 장시간 세션의 화자 문맥 누적 후보로 본다. 화자 수가 같더라도 정렬한 화자별 글자 점유율 분포가 첫 회차보다 15%포인트를 초과해 달라지면 `shareProfileDriftSourceIds`에 기록한다.

### 2026-09-02 재현 결과

고객 피드백의 네 번째 영어 영상은 첫 연속 실시간 실행에서 두 화자가 모두 Speaker 1로 합쳐졌다. 같은 클립을 새 세션으로 시작하자 두 화자가 57.3%와 42.7% 비율로 분리됐다. 문장 종료 민감도를 낮추고 최대 대기 시간을 3초로 늘린 실험에서도 연속 세션의 네 번째 영상은 한 화자로 유지됐다.

일본어 대화 구간을 35초에서 90초로 늘린 두 번째 실행에서는 첫째·둘째·셋째 영상이 모두 기대 화자 수로 통과했다. 네 번째 영상은 연속 세션에서 실제 2명보다 많은 3명으로 과분리되고 한 화자에게 88.1%가 몰렸지만, 영상별 독립 세션에서는 다시 2명, 57.3% 대 42.7%로 안정됐다. 연속 세션의 실패 형태는 실행 조건에 따라 합침 또는 과분리로 달라질 수 있지만, 새 화자 세션에서는 두 실행 모두 네 번째 영상이 2명으로 회복됐다.

이 결과에 따라 제품은 서로 무관한 영상·음원 사이에서 기존 대화 기록은 보존하고 화자 문맥만 새로 시작하는 `새 영상·음원` 동작을 제공한다. 일반 회의의 짧은 침묵에는 자동 적용하지 않는다. 같은 사람이 잠시 쉰 것을 새 화자로 오인하거나 회의 안의 화자 번호가 불필요하게 쪼개질 수 있기 때문이다.

초기 일본어 35초 구간은 독립 세션에서도 한 화자만 검출되어 판정 근거에서 제외했다. 현재 manifest는 같은 영상의 90초 대화 구간을 사용하며 연속·독립 실시간 세션 모두 두 화자를 확인했다.

일반 회귀 세트의 마지막 영어 영상은 제목만 보고 2인 대담으로 분류했으나, 실제 90초 영상을 프레임·자막·영상 설명으로 다시 확인한 결과 진행자, 페이페이 리, 데이비드 로지어 3명이 등장한다. 도입 내레이션도 별도 출연자가 아니라 진행자의 음성이므로 기대값은 정확히 3명이다. 비동기 모델은 세 번 반복해 모두 3명으로 구분했지만 실시간 모델은 문장 종료 설정과 관계없이 4명으로 과분리했다. 품질 기준의 인원수는 제목이나 썸네일로 추측하지 않고 실제 구간의 화면·자막·화자별 시간 분포를 확인해 정한다.

두 모델의 장단점은 서로 반대였다. 샘 올트먼 영상의 짧은 질문자 구간은 비동기 모델이 1명으로 합쳤지만 실시간 모델은 2명으로 구분했고, 3인 도입부는 비동기 모델이 정확히 3명을 유지했지만 실시간 모델은 4명으로 쪼갰다. 품질 도구의 후보 선택은 비동기 결과를 기본으로 유지하되, 비동기 결과가 1명이고 실시간의 두 번째 화자가 전체 글자의 10% 이상이면서 2초 이상 이어질 때만 실시간 결과를 보완 후보로 고른다. 기대 최대 인원보다 실시간 화자 수가 많으면 과분리로 보고 후보에서 제외한다.

이 후보 선택은 실제 영상으로 모델 특성을 비교하는 품질 판정이며 저장된 회의의 원본 전사를 자동으로 바꾸지 않는다. 제품에서는 저장용 전사의 정확도를 우선하고, 자유 참여 글로벌 미팅에서는 실시간 구분과 `새 영상·음원` 세션 초기화를 사용한다. 원본 오디오와 최초 전사 아티팩트는 품질 실험 때문에 수정하지 않는다.

비슷한 음역의 여성 출연자 두 명이 등장하는 YTN 인터뷰의 깨끗한 54초 구간도 별도 검증했다. 처음에는 화면에 보이는 두 명만 기준으로 잡았지만, 3초 간격 프레임·자막·음성 임베딩을 함께 대조한 결과 2분 23초와 2분 47초에 화면 밖 질문자가 별도 음성으로 말한다. 실제 화자는 출연자 두 명과 질문자 한 명, 총 3명이다. 비동기 모델은 반복 실행에서 50.0%, 39.6%, 10.4%로 정확히 3명을 구분했다.

같은 구간의 실시간 모델은 자동 문장 종료를 켰을 때 원시 번호는 3개였지만 한 번호에 93.7%가 몰려 실질적으로 화자를 놓쳤다. 문장 종료를 끄면 4개 번호로 나뉘었고 상위 두 번호가 49.4%, 38.3%, 약한 두 번호가 8.3%, 4.0%였다. 정확한 `3 speakers (1 off-screen interviewer, 2 female interviewees)` 컨텍스트를 제공해도 48.4%, 40.1%, 7.7%, 3.9%로 거의 달라지지 않았다. 화자 컨텍스트는 보조 정보이지 화자 수를 강제하는 옵션이 아니므로 이 구간에서는 비동기 결과를 선택한다.

네 영상을 세 차례 순환한 18분 22초 실시간 연속 세션에서는 한국어와 일본어 구간이 세 회차 모두 기대 화자 수 범위를 통과했다. 다만 일본어 구간은 세 번째 회차의 화자 점유율 분포가 첫 회차보다 34.78%포인트 달라져 화자 수만으로 드러나지 않는 흔들림이 확인됐다. 짧은 질문자가 있는 영어 구간도 원시 화자 수는 2명, 3명, 2명으로 기대 범위 안이었으며 질문자의 발화량이 작다는 사실을 별도로 남겼다. 세 명이 등장하는 마지막 영어 영상은 첫째와 둘째 회차에서 정확히 3명이었지만 셋째 회차에서 원시 5명, 충분히 지지된 화자 4명으로 과분리되어 장시간 후반 악화가 실제로 재현됐다.

같은 18분 22초 파일을 비동기 연속 방식으로 처리하면 마지막 영어 영상이 세 회차 모두 4명으로 과분리됐다. 반대로 12개 구간을 영상마다 새 파일 세션으로 처리한 비동기 결과는 모든 구간이 기대 화자 수를 통과했고, 네 영상 모두 세 반복의 화자 수와 점유율 분포가 완전히 같았다. 마지막 영어 영상도 세 번 모두 정확히 3명이었다. 따라서 서로 무관한 영상은 한 세션에 계속 쌓기보다 영상 경계마다 화자 세션을 새로 시작하는 동작을 유지한다. 장시간 후반에만 새로 발생한 실시간 결함은 `english-three-person-intro`의 `lateRegression`으로 자동 기록한다.

실시간 방식도 12개 구간을 영상마다 새 세션으로 처리하면 모든 영상의 세 반복에서 화자 수와 점유율 분포가 거의 동일해져 후반 흔들림이 사라졌다. 다만 마지막 3인 영상은 세 번 모두 원시 화자 번호가 4개였고, 그중 글자 점유율 10% 이상인 화자는 정확히 3명이었다. 세션 초기화는 장시간 문맥 누적을 막지만 특정 음성에서 반복되는 실시간 과분리까지 해결하지는 않으므로, 이 구간의 저장 후보는 원시 화자 3명을 반복해서 유지한 영상별 비동기 결과로 선택한다. 약한 네 번째 번호는 보고서에 그대로 남겨 원본 판단 근거를 보존한다.

같은 18분 22초 실시간 연속 세션에서 자동 문장 종료를 끈 비교도 수행했다. 한국어, 일본어, 짧은 질문자가 있는 영어 구간은 세 반복의 점유율 분포 차이가 각각 최대 0.18%, 0.05%, 0.01%로 줄었다. 그러나 마지막 3인 영상은 원시 화자 수가 4명, 3명, 4명이었고 첫째와 셋째 회차가 과분리됐다. 자동 문장 종료를 켠 결과는 같은 영상에서 3명, 3명, 5명으로 셋째 회차 한 곳만 실패했다. 설정을 끄면 일부 구간의 반복 안정성은 좋아지지만 전체 결함 구간은 1개에서 2개로 늘어나므로 제품 기본값은 유지한다.

추가로 일본어 여성 2인 대담 3분과 진행자·패널 세 명이 말하는 한국어 남성 4인 토론 4분을 실제 화면에서 화자 전환을 확인한 뒤 비교했다. 일본어 대담은 연속·독립 및 실시간·비동기 네 조건에서 모두 정확히 2명이었다. 한국어 토론은 비동기 연속 파일에서 3명으로 합쳐졌지만 새 파일 세션에서는 4명 모두 분리됐다. 실시간은 연속 세션에서 2명, 새 세션에서도 3명만 검출했다.

한국어 토론에 `4 male speakers (1 host, 3 panelists)` 문맥을 제공해도 실시간 결과는 3명으로 같았고, 자동 문장 종료를 끄면 2명으로 더 합쳐졌다. 문장 종료 민감도를 -0.8로 낮추고 최대 대기를 3초로 늘린 조건도 2명이었다. 따라서 화자 수 문맥이나 문장 종료 설정으로 보정하지 않고 영상별 비동기 결과를 저장 후보로 고른다. 실제 후보 선택 결과는 일본어 대담과 한국어 토론 모두 비동기를 선택했고 미해결 구간은 없었다. 한국어 토론의 `비동기 4명 대 실시간 3명` 선택은 단위 테스트로 고정했다.

한국어 4인 토론의 영상별 비동기 처리를 세 번 더 반복한 결과는 매번 원시·충분 지지 화자 수가 모두 4명이었다. 정렬한 화자별 글자 점유율 분포는 첫 실행과 비교해 최대 0.13%포인트만 달라졌고 후반 악화나 점유율 흔들림은 없었다. 한 번의 우연한 성공이 아니라 반복 가능한 저장 후보임을 확인했다.

일본어 여성 2인 대담도 영상별 비동기와 실시간을 각각 세 번 반복했다. 두 방식 모두 모든 회차에서 원시·충분 지지 화자 수가 정확히 2명이었다. 첫 실행 대비 화자 점유율 분포의 최대 차이는 비동기 0.33%포인트, 실시간 0.10%포인트였다. 같은 성별과 비슷한 음역만으로 화자 구분이 흔들리는 것은 아니며, 이번 세트에서는 네 명의 유사한 남성 음성과 짧은 끼어들기가 함께 있는 한국어 다인 토론이 더 어려운 조건이었다.

공식 Zoom 원격 대담의 5분~9분 구간도 추가했다. 영상 설명에는 출연자 세 명의 이름이 명시되어 있고, 5초 단위 화면에서 세 사람이 모두 활성 화자로 전환되는 것을 확인했다. 클라우드 비동기와 실시간 처리는 모두 두 화자로 합쳤다. 첫 60초만 분리하거나 세 명의 실제 이름을 문맥으로 제공해도 두 화자 그대로였으며, 비니 착용자의 약 15초 발화와 뒤쪽 모자 착용자의 발화가 기존 번호에 병합되는 재현 가능한 결함이었다. 원본 좌우 채널의 차이는 평균 -69dB로 사실상 같은 신호여서 스테레오 분리로 복구할 수도 없었다.

같은 Zoom 영상은 2초 간격 프레임을 다시 확인해 올백 머리, 비니, 모자·안경 화자가
화면 전체에 나타난 고신뢰 구간을 정답 앵커로 표시했다. 화면 공유 중에도 90~94초에는
올백 머리, 97~99초에는 모자·안경 화자가 활성 상태임을 원본 고해상도 프레임으로 추가
확인했다. 긴 두 화자가 대부분을 차지해 짧은 화자 누락이 일치율에서 희석되므로 이 세트의
기준은 95%로 둔다.

확장 앵커에서 비동기 전사는 실제 3명 중 2명만 만들고 시간 가중 일치율 90.01%를
기록했다. 실시간 모델도 같은 4분 음원을 실제 1배속으로 다시 전송했지만 2명·89.57%로
실패했다. macOS의 임계값 0.85 로컬 시간대를 입힌 하이브리드 전사는 3명을 모두 분리하고
1,228개 토큰을 빠짐없이 연결했으며 96.59%로 유일하게 통과했다. 최적 대응에서도
누락됐던 비니 화자가 별도 세 번째 번호로 연결됐다.

같은 4분 음원의 로컬 보조 판정을 4개 스레드로 자원 측정한 결과 실제 처리 시간은
33.78초, 최대 상주 메모리는 약 329MB, macOS의 최고 메모리 사용량은 약 412MB였다.
실험 런타임은 33MB이고 실제 필요한 int8 분할 모델과 화자 임베딩 모델은 합계 약
40MB다. 패키지는 같은 버전의 Linux x64·arm64 네이티브 의존성을 제공한다. 단일 작업은
소형 서버에서도 실행 가능성이 있지만, 여러 회의를 동시에 처리할 때는 약 400MB 단위의
메모리 사용을 가정한 작업 큐와 동시성 제한을 먼저 설계해야 한다.

Linux arm64 컨테이너에서도 같은 네이티브 패키지는 설치·실행됐고 4분 처리에 39.13초,
최대 상주 메모리 약 448MB를 사용했다. 그러나 임계값 0.85와 0.90은 실제 세 명 외에
8.62초짜리 유효 군집을 하나 더 만들어 네 명으로 과분리했다. 0.95에서는 겉으로 세 명이
됐지만, 10.70초 실제 비니 화자와 90~99초의 서로 다른 두 화자가 섞인 군집을 하나로
합친 결과였다. 전사에 적용한 뒤 확장 앵커로 평가하면 화자 수 3명에도 일치율은 91.02%로
실패했다. 따라서 현재 macOS 성공값을 AWS Linux에 그대로 적용하지 않는다.

공식 speaker diarization 예제에서 함께 지원하는 NeMo TitaNet Small 임베딩도 Linux
arm64에서 비교했다. 원격 일본어 3인 영상은 임계값 0.85·0.90·0.95 모두 유효 화자
3명을 유지했고 0.85 하이브리드는 확장 화면 앵커 96.59%로 통과했다. 4분 로컬 판정은
약 17초로 기존 3D-Speaker보다 빨랐다.

단일 영상에 맞춘 결과인지 확인하기 위해 실제 유튜브 여섯 구간을 묶은 자격 세트도
추가했다. 일본어 원격 3인, 일본어 여성 2인, 한국어 남성 4인, 한국어 여성 2명과 화면
밖 질문자, 영어 3인 도입부, 일본어 1인 대조 구간으로 총 약 14분 30초다. TitaNet
0.85와 0.90은 다섯 구간을 통과했지만 영어 도입부를 유효 화자 4명으로 과분리했다.
0.95는 영어 도입부를 3명으로 복구했지만 일본어 여성 2인을 1명, 한국어 남성 4인을
3명으로 합쳤다. 따라서 TitaNet도 하나의 임계값을 제품 기본값으로 채택하지 않는다.

한국어 여성 영상의 화면 밖 질문자는 원시 번호로는 세 번째 화자지만 로컬 누적 발화가
0.73초라 2초 유효 기준에서는 약한 번호다. 이 세트는 원시 화자 3명과 유효 화자 2~3명을
각각 기대값으로 명시해 실제 짧은 질문자를 삭제하지 않으면서 잡음 조각과 구분한다.

컨테이너와 호스트의 절대 경로가 달라도 보고서를 안전하게 조합하도록 전체 평가 manifest
지문과 로컬 오디오 입력 지문을 각각 SHA-256으로 기록한다. 오디오 파일·출처 구간·순서·
침묵 간격이 같고 정답 앵커나 기대값만 보강된 경우에는 로컬 판정을 재사용할 수 있다.
오디오 입력 지문이 다르면 영상 ID가 같아도 하이브리드 처리를 시작하지 않는다.

같은 4분 음원을 로컬 화자 임베딩으로 판정하면 87.9초, 93.1초, 10.7초의 유효 화자 세 명을 분리했고, 나머지 세 번호는 각각 0.56초, 0.30초, 0.66초였다. 10.7초 번호는 화면에서 확인한 비니 착용자의 33초~48초 발화와 일치했다. 60초 안에 세 사람이 모두 말하는 짧은 구간도 세 명으로 분리됐고, 한 사람만 말하는 65초 대조 구간은 한 명으로 유지됐다.

같은 기준을 다른 정답 세트에 교차 적용한 결과 일본어 여성 2인은 유효 화자 2명, 한국어 남성 토론은 4명, 한국어 여성 2명과 화면 밖 질문자는 3명, 영어 3인 영상은 3명으로 모두 기대값과 같았다. 한국어 4인 토론은 기존 비동기 연속 처리에서 3명으로 합쳐졌던 사례지만 로컬 보조 판정에서는 4명을 복구했다.

보조 화자 시간대를 실제 전사 토큰에 다시 입히는 하이브리드 검증도 수행했다. 원격 일본어 3인 대담은 1,228개 토큰을 빠짐없이 연결해 기존 두 화자를 세 명으로 복구했다. 세 번째 화자의 글자 점유율은 3.38%였지만 전사 토큰 누적 음성이 2.34초여서 유효 화자로 판정됐다. 일본어 여성 2인은 917개 중 2개만 미연결된 채 2명을 유지했고, 한국어 남성 4인은 1,253개 중 3개만 미연결된 채 기존 3명 결과를 4명으로 복구했다. 미연결 글자 비율은 각각 0.17%와 0.28%였다.

한국어 여성 2명과 화면 밖 질문자 영상은 3명으로 복구됐고 미연결 글자 비율은 1.16%였다. 질문자의 토큰 누적 음성은 0.72초로 짧아 보수적인 유효 화자 지표에서는 약한 번호지만 원시 화자 수와 표시 번호에는 세 번째 화자로 남는다. 영어 3인 영상은 397개 토큰을 모두 연결하고 세 명을 유지했다. 현재 결과만으로 제품 전사를 자동 교체하지 않고, 더 많은 실제 회의와 반복 실행에서 재현성을 확인한 뒤 저장용 파생 전사에 선택적으로 적용한다.

같은 네 영상을 세 차례 순환한 18분 22초 파일도 로컬 보조 판정으로 두 번 연속
처리했다. 12개 모든 구간에서 두 실행의 원시·유효 화자 수가 같았고, 화자별 누적 발화
시간과 점유율 차이는 모두 0이었다. 유효 화자 수는 한국어 3명, 일본어 2명, 짧은 질문이
있는 영어 2명, 영어 3인 도입부 3명으로 세 회차 내내 유지됐다. 약한 조각까지 포함한
일본어 원시 번호는 5개였지만 2초 이상 이어진 번호는 정확히 2개였고, 약한 조각을
삭제하지 않은 채 별도 진단으로 보존했다. 첫 회차 대비 유효 화자 점유율 변화는 영상별
최대 1.55%포인트 이하였다.

이 로컬 시간대를 같은 장시간 비동기 전사의 토큰에 입힌 하이브리드 연속 결과는 12개
구간 모두 화자 수 기준을 통과했다. 기존 비동기 연속 방식에서 짧은 질문자가 세 회차
모두 사라졌던 영어 구간은 2명으로 복구됐고, 실제 3명을 매번 4명으로 쪼갠 영어
도입부는 세 회차 모두 정확히 3명이 됐다. 각 영상의 첫 회차 대비 화자 점유율 변화는
최대 1.13%포인트였고 후반 악화와 15%포인트 이상 흔들림은 없었다. 로컬 시간대와 직접
맞닿지 않아 가장 가까운 유효 화자로 보완한 토큰은 한 구간 최대 4개, 전체 글자 중 한
구간 최대 0.57%였으며 이 수치는 보고서에 미연결 진단으로 계속 남긴다.

이 결과는 제품 배포가 아니라 품질 실험이다. 로컬 네이티브 모델의 패키지 크기, 메모리,
동시 처리량과 더 다양한 실제 회의를 검증하기 전에는 고객 테스트 서버의 저장 전사를
교체하지 않는다.

같은 네 실제 유튜브 영상이 세션 내 첫째·둘째·셋째·넷째 위치를 한 번씩 차지하도록
순환한 24분 30초 교차 순서 세트에서는 전체 로컬 군집의 길이 민감도가 추가로
드러났다. 임계값 0.85는 일본어 2명을 유효 화자 1명으로 합치고 영어 3인 도입부를
유효 화자 5명으로 쪼갰다. 0.90은 도입부를 4명까지 줄였지만 짧은 영어 질문자 구간도
유효 화자 1명으로 합쳐 전체 실패 구간이 늘었다. 하나의 임계값으로 24분 전체를
안전하게 처리할 수 없다는 결과다.

영상별 독립 로컬 판정은 일본어 2명과 영어 도입부 3명을 네 회차 모두 정확히 유지했지만
짧은 영어 질문자를 네 번 모두 합쳤다. 반대로 0.85 전체 연속 판정은 짧은 질문자를
2명으로 유지했다. 이에 따라 일본어와 영어 도입부는 독립 후보, 짧은 영어 질문자와
한국어는 연속 후보를 선택해 하나의 24분 30초 연속 전사에 다시 적용했다. 16개 모든
구간이 기대 화자 수를 통과했고, 네 영상의 원시 화자 수는 위치와 관계없이 각각
한국어 3명, 일본어 2명, 짧은 영어 구간 2명, 영어 도입부 3명으로 유지됐다. 첫 회차 대비
화자 점유율 변화는 최대 0.21%포인트였고 가장 가까운 유효 화자로 보완한 글자는 한
구간 최대 0.57%였다.

같은 교차 순서 하이브리드 전사를 한 번 더 실행한 결과도 16개 전부 통과했다. 두 실행의
원시·유효 화자 수는 모든 구간에서 동일했고, 실행 간 화자 점유율 최대 차이는
0.33%포인트였다. 일부 구간의 전사 토큰 수는 2~3개 달랐지만 화자 수와 품질 게이트에는
영향이 없었다. 서로 실패 원인이 다른 후보를 영상별로 선택하는 방식이 고정 순서뿐
아니라 네 위치를 순환한 조건에서도 반복 가능함을 확인했다.

여섯 영상 Linux 자격 세트에서는 TitaNet 임계값 0.85·0.90·0.95와 클라우드 화자 수를
기대 인원 없이 합의시키는 실험도 수행했다. 영상별 독립 처리에서는 일본어 원격 3명,
일본어 여성 2명, 한국어 남성 4명, 한국어 여성 2명과 짧은 화면 밖 질문자, 영어 도입부
3명, 일본어 1명을 모두 올바르게 선택했다. 같은 입력을 두 번 실행해 선택 후보와 화자
수가 모두 같았고, 일본어 원격 영상의 화면 앵커 일치율도 두 번 모두 96.59%였다.

처음에는 14분 39초 연속 전사에서 나온 화자 수와 일치하는 로컬 후보를 우선했다. 이
규칙은 후반의 한국어 4명을 3명, 짧은 질문자 포함 3명을 2명, 영어 3명을 4명으로 잘못
선택했다. 장시간 클라우드 결과가 각각 3·2·4명으로 흔들린 상태였기 때문이다. 실패
보고서는 `local-qualification/hybrid-consensus-continuous-titanet-linux-20260902`에
보존했다.

수정한 합의는 장시간 결과를 진단값으로 남기고, 영상 경계마다 독립 재확인한 화자 수를
로컬 세 임계값 투표에 한 표로 더한다. 로컬 투표가 동률이면 경계별 독립 값을 고른다.
독립 재확인이 로컬 원시 번호 중 유효 기준보다 짧은 한 명을 확인한 경우에만 그 약한
번호를 실제 화자로 복원한다. 이 방식으로 같은 14분 39초 연속 파일을 다시 처리했을 때
여섯 구간이 모두 통과했다. 후반 세 구간은 4·3·3명으로 복구됐고, 일본어 원격 3인의
화면 앵커 일치율은 96.60%, 영상별 시간대 미연결 글자 비율은 모두 2% 미만이었다. 통과
보고서는 `local-qualification/hybrid-consensus-continuous-reset-titanet-linux-20260902`
에 있다.

```bash
node scripts/diarization-quality.mjs run-hybrid \
  --manifest evals/youtube-diarization-local-qualification-manifest.json \
  --clips-dir test-results/diarization-live/local-qualification/clips \
  --output-dir test-results/diarization-live/local-qualification/hybrid-consensus \
  --scope continuous \
  --local-report test-results/diarization-live/local-qualification/titanet-linux-085-20260902/local-report.json \
  --consensus-local-reports test-results/diarization-live/local-qualification/titanet-linux-090-20260902/local-report.json,test-results/diarization-live/local-qualification/titanet-linux-095-20260902/local-report.json
```

합의 모드는 평가용이며 제품 런타임과 고객 서버에는 아직 연결하지 않았다. 경계별 독립
재확인은 정확도를 높이는 대신 클라우드 전사를 한 번 더 수행하므로, 배포 전에는 명시적
`새 영상·음원` 경계를 재사용하는 방법과 비용·지연을 함께 비교해야 한다.

고객이 처음 제보한 네 영상 순차 재생 세트도 새 합의 경로로 다시 검증했다. 로컬
TitaNet 0.85·0.90·0.95는 모두 첫 영어 영상의 짧은 질문자를 완전히 한 화자로 합쳤다.
일본어 대담은 긴 화자 외의 발화를 0.39초와 1.60초 조각으로 나눴고, 마지막 영어 2인은
두 번째 화자를 약 1.05초로만 남겼다. 독립 비동기 재확인은 첫 영상만 1명, 나머지는
각각 2명으로 판정했다. 따라서 로컬과 비동기만 조합한 첫 시도는 네 구간 중 첫 구간을
복구하지 못했다.

같은 네 음원을 실제 1배속 실시간 독립 세션으로 다시 재생하면 네 구간 모두 두 화자를
검출했다. 첫 영상의 짧은 질문자는 글자 15.05%이고 발화 범위가 약 3.9초여서 단순 잡음
번호가 아니었다. 마지막 영어 영상은 42.70% 대 57.30%로 균형 있게 분리됐다. 이에 따라
비동기 결과가 한 명일 때 실시간의 두 번째 화자가 글자 10% 이상이고 2초 이상 이어지는
경우에만 실시간 시간대를 선택한다. 로컬이 2초 미만 약한 번호로 화자 수만 맞췄지만
실시간은 같은 화자 수를 충분히 지지하는 경우에도 실시간 시간대를 우선한다.

수정 뒤 4분 6초 연속 전사에 경계별 비동기·실시간 재확인과 세 로컬 후보를 결합한 결과는
네 구간 모두 두 화자로 통과했다. 최종 글자 점유율은 첫 영어 15.79%/84.21%, 한국어
34.74%/65.26%, 일본어 90.63%/9.37%, 마지막 영어 42.96%/57.04%였다. 같은 명령을 한
번 더 실행해 후보 선택, 화자 수, 점유율, 미연결 비율이 전부 동일함을 확인했다. 마지막
영상을 단순히 두 번호로만 만든 98.5%/1.5% 오판도 이 교차 검증에서 제거됐다. 통과
보고서는 `feedback-20260902/hybrid-consensus-continuous-reset-realtime-quality-titanet-macos-20260902`와
같은 이름의 `-repeat-` 결과에 있다.

```bash
node scripts/diarization-quality.mjs run-hybrid \
  --manifest evals/youtube-diarization-feedback-manifest.json \
  --clips-dir test-results/diarization-live/feedback-20260902/clips \
  --output-dir test-results/diarization-live/feedback-20260902/hybrid-consensus \
  --scope continuous \
  --local-report test-results/diarization-live/feedback-20260902/titanet-macos-085-20260902/local-report.json \
  --consensus-local-reports test-results/diarization-live/feedback-20260902/titanet-macos-090-20260902/local-report.json,test-results/diarization-live/feedback-20260902/titanet-macos-095-20260902/local-report.json \
  --realtime-report test-results/diarization-live/feedback-20260902/realtime-isolated-current-20260902/realtime-isolated-endpoint-on.json
```

기존 조정에 쓰지 않은 공식 일본어 유튜브 영상으로 블라인드 검증도 추가했다. TBS의
3인 좌담회는 모델 결과를 보기 전에 3분 20초~4분 25초 화면을 확인해 남성 두 명과 여성
한 명이 실제로 발화하는 65초 구간으로 고정했다. 처음에는 원본 파일 경로와 구간 시각을
manifest에 함께 적었지만 로컬 파일 입력은 시각만으로 잘리지 않아 8분 18초 전체가
처리되는 오류를 발견했다. 원본을 보존한 채 65초 파일을 별도로 만든 뒤 모든 후보를
처음부터 다시 실행했다. 로컬 파일 기반 평가에서는 manifest의 시각을 신뢰하지 않고
미리 잘린 파일의 실제 길이도 확인해야 한다.

이 좌담회의 영상별 독립 비동기 결과는 원시 화자 3명, 2초 이상 충분히 지지된 화자
2명이었다. 세 번째 화자는 글자 점유율이 약 4%인 짧은 발화지만 화면으로 확인한 실제
화자이므로 원시 번호 3개가 정답이다. 반면 로컬 세 임계값은 유효 화자를 6·6·5명으로
과분리했다. 이전 합의처럼 다수결만 적용하면 잘못된 6명을 선택할 수 있어, 경계별 독립
결과와 다른 로컬 후보는 세 임계값의 화자 수가 모두 같을 때만 독립 결과를 뒤집도록
보수적으로 바꿨다. 6영상 자격 세트의 원격 일본어 3인처럼 로컬 결과가 3·3·3명으로
일치하는 복구 사례는 그대로 허용한다.

수정한 합의로 블라인드 연속 전사를 두 번 처리한 결과, 3인 좌담회는 두 실행 모두 원시
3명과 유효 2명을 유지했고 미연결 글자 비율도 0.82%로 같았다. 화자별 글자 점유율은 첫
실행 66.26%/29.22%/4.53%, 반복 실행 66.74%/29.16%/4.11%로 짧은 화자에서 0.42%포인트
차이가 있었지만 후보 선택과 화자 수는 변하지 않았다. 통과 보고서는
`blind-20260902/hybrid-consensus-continuous-reset-v2`와 같은 이름의 `-repeat` 결과에
있다.

함께 살펴본 야외 대화 영상은 제목에 네 사람이 명시되어 있지만 선택한 3분 화면에는
두 명만 보이고 화면 밖 발화 여부를 확정할 수 없었다. 이 영상은 후보가 두 화자를
반복해서 선택한 탐색 결과만 남기고 정확한 인원 정답 세트에서는 제외했다. 제목, 설명,
썸네일 또는 화면에 보이는 사람 수만으로 음성 화자 수를 단정하지 않는다는 기준을
manifest에도 기록했다.

클라우드 전사 보고서는 원시 화자 번호와 함께 글자 점유율 10% 이상이거나 전사 토큰 누적 음성이 2초 이상인 `supportedSpeakerCount`, 나머지 `weakSpeakerIds`, 전사 내용을 제외한 시간순 `speakerRuns`를 기록한다. 로컬 보고서는 누적 발화 2초를 기준으로 같은 두 목록을 만든다. 약한 번호를 숨기거나 텍스트를 버려 통과시키지는 않는다. 실제로 짧게 질문한 화자를 무조건 오류로 처리하지 않도록, manifest에 `expectedMinSupportedSpeakers` 또는 `expectedMaxSupportedSpeakers`를 명시한 영상에만 충분히 지지된 화자 수 기준을 품질 게이트로 적용한다.
