import { describe, expect, it, vi } from "vitest";

import {
  analyzeLocalDiarizationSegments,
  analyzeDiarizationWindows,
  analyzeDiarizationCycleStability,
  buildAsyncDiarizationConfig,
  buildDiarizationQualityVerdict,
  buildDiarizationTimeline,
  buildRealtimeDiarizationConfig,
  chooseDiarizationModel,
  compareDiarizationCandidates,
  compareDiarizationRuns,
  buildDiarizationConsensusReport,
  diarizationManifestFingerprint,
  localDiarizationInputFingerprint,
  materializeDiarizationConsensusWindows,
  offsetTranscriptTokens,
  normalizeLocalSpeakerRunsForScope,
  realtimePcmChunkBytes,
  relabelTranscriptTokensFromDiarization,
  rescoreDiarizationAnalysis,
  rescoreDiarizationReport,
  rescoreLocalDiarizationReport,
  resolveDiarizationScope,
  scoreSpeakerAnchorAgreement,
  selectLocalDiarizationSegmentsForWindow,
  summarizeLocalDiarizationWindows,
  selectHybridLocalDiarizationWindows,
  selectDiarizationCandidateByConsensus,
  validateHybridLocalReport,
  waitForPromiseWithTimeout,
} from "../diarization-quality.mjs";

describe("유튜브 연속 재생 화자 구분 품질 채점", () => {
  const windows = [
    { id: "first", startMs: 0, endMs: 10_000, expectedMinSpeakers: 2 },
    { id: "fourth", startMs: 30_000, endMs: 40_000, expectedMinSpeakers: 2 },
  ];

  it("영상별 시간창에서 원문 토큰의 화자 수와 한 화자 쏠림을 계산한다", () => {
    const report = analyzeDiarizationWindows([
      { text: "질문입니다", start_ms: 500, end_ms: 2_000, speaker: "1" },
      { text: "답변입니다", start_ms: 2_100, end_ms: 4_000, speaker: "2" },
      { text: "Question", start_ms: 30_500, end_ms: 32_000, speaker: "1" },
      { text: "Answer", start_ms: 32_100, end_ms: 34_000, speaker: "1" },
      { text: "번역", start_ms: 32_100, end_ms: 34_000, speaker: "9", translation_status: "translation" },
    ], windows);

    expect(report.windows).toEqual([
      expect.objectContaining({
        id: "first",
        speakerIds: ["1", "2"],
        speakerCount: 2,
        collapsed: false,
        dominantSpeakerShare: 0.5,
      }),
      expect.objectContaining({
        id: "fourth",
        speakerIds: ["1"],
        speakerCount: 1,
        collapsed: true,
        dominantSpeakerShare: 1,
      }),
    ]);
    expect(report.collapsedWindowIds).toEqual(["fourth"]);
  });

  it("화자 번호가 달라도 화면 확인 정답 구간과 최적 대응한 배정 정확도를 계산한다", () => {
    expect(scoreSpeakerAnchorAgreement([
      { text: "첫 화자", start_ms: 0, end_ms: 1_000, speaker: "9" },
      { text: "둘 화자", start_ms: 2_000, end_ms: 3_000, speaker: "4" },
    ], [
      { speaker: "화자 갑", startMs: 0, endMs: 1_500 },
      { speaker: "화자 을", startMs: 1_500, endMs: 3_500 },
    ])).toMatchObject({
      totalWeightMs: 2_000,
      matchedWeightMs: 2_000,
      agreement: 1,
      mapping: { "4": "화자 을", "9": "화자 갑" },
      minimumSpeakerAgreement: 1,
      referenceStats: expect.arrayContaining([
        expect.objectContaining({ speaker: "화자 갑", agreement: 1, predictedSpeakerId: "9" }),
        expect.objectContaining({ speaker: "화자 을", agreement: 1, predictedSpeakerId: "4" }),
      ]),
    });
  });

  it("서로 다른 실제 화자를 한 번호로 합치면 화자 수가 우연히 허용돼도 배정 품질에서 실패한다", () => {
    const report = analyzeDiarizationWindows([
      { text: "첫 화자", start_ms: 0, end_ms: 1_000, speaker: "1" },
      { text: "둘 화자", start_ms: 2_000, end_ms: 3_000, speaker: "1" },
    ], [{
      id: "remote-panel",
      startMs: 0,
      endMs: 4_000,
      expectedMinSpeakers: 1,
      expectedMaxSpeakers: 2,
      minimumAnchorAgreement: 0.9,
      referenceSpeakerAnchors: [
        { speaker: "화자 갑", startMs: 0, endMs: 1_500 },
        { speaker: "화자 을", startMs: 1_500, endMs: 3_500 },
      ],
    }]);

    expect(report.windows[0]).toMatchObject({
      collapsed: false,
      fragmented: false,
      anchorMismatch: true,
      anchorAgreement: { agreement: 0.5 },
    });
    expect(report.anchorMismatchWindowIds).toEqual(["remote-panel"]);
    expect(report.issueWindowIds).toEqual(["remote-panel"]);
  });

  it("긴 화자들의 전체 앵커 점수가 높아도 실제 화자 한 명이 누락되면 화자별 기준에서 실패한다", () => {
    const report = analyzeDiarizationWindows([
      { text: "긴 첫 화자", start_ms: 0, end_ms: 8_000, speaker: "1" },
      { text: "짧은 둘 화자", start_ms: 10_000, end_ms: 12_000, speaker: "1" },
    ], [{
      id: "imbalanced-panel",
      startMs: 0,
      endMs: 13_000,
      expectedMinSpeakers: 1,
      expectedMaxSpeakers: 2,
      minimumAnchorAgreement: 0.75,
      minimumSpeakerAnchorAgreement: 0.6,
      referenceSpeakerAnchors: [
        { speaker: "화자 갑", startMs: 0, endMs: 8_500 },
        { speaker: "화자 을", startMs: 9_500, endMs: 12_500 },
      ],
    }]);

    expect(report.windows[0]).toMatchObject({
      anchorMismatch: true,
      anchorAgreement: {
        agreement: 0.8,
        minimumSpeakerAgreement: 0,
        referenceStats: expect.arrayContaining([
          expect.objectContaining({ speaker: "화자 갑", agreement: 1, predictedSpeakerId: "1" }),
          expect.objectContaining({ speaker: "화자 을", agreement: 0, predictedSpeakerId: null }),
        ]),
      },
    });
    expect(report.anchorMismatchWindowIds).toEqual(["imbalanced-panel"]);
    expect(report.issueWindowIds).toEqual(["imbalanced-panel"]);
  });

  it("경계에 걸친 토큰은 중간 시점이 속한 영상에 한 번만 포함한다", () => {
    const report = analyzeDiarizationWindows([
      { text: "앞 영상", start_ms: 9_000, end_ms: 11_000, speaker: 3 },
      { text: "화자 없음", start_ms: 31_000, end_ms: 32_000 },
    ], windows);

    expect(report.windows[0]).toMatchObject({ speakerIds: [], tokenCount: 0 });
    expect(report.windows[1]).toMatchObject({
      speakerIds: [],
      tokenCount: 1,
      speakerlessTextShare: 1,
    });
  });

  it("과분리 원인을 확인할 수 있도록 화자별 점유율과 등장 시간 범위를 남긴다", () => {
    const report = analyzeDiarizationWindows([
      { text: "aaaa", start_ms: 100, end_ms: 200, speaker: "2" },
      { text: "bb", start_ms: 300, end_ms: 400, speaker: "1" },
      { text: "ccc", start_ms: 500, end_ms: 600, speaker: "2" },
      { text: "번역", start_ms: 500, end_ms: 600, speaker: "9", translation_status: "translation" },
    ], [{ id: "clip", startMs: 0, endMs: 1_000, expectedMinSpeakers: 2, expectedMaxSpeakers: 2 }]);

    expect(report.windows[0].speakerStats).toEqual([
      {
        speakerId: "1",
        tokenCount: 1,
        textLength: 2,
        speechDurationMs: 100,
        textShare: 0.2222,
        firstMs: 300,
        lastMs: 400,
      },
      {
        speakerId: "2",
        tokenCount: 2,
        textLength: 7,
        speechDurationMs: 200,
        textShare: 0.7778,
        firstMs: 100,
        lastMs: 600,
      },
    ]);
  });

  it("전사 내용 없이 연속 화자 번호의 시간 순서와 분량을 기록한다", () => {
    const report = analyzeDiarizationWindows([
      { text: "aa", start_ms: 100, end_ms: 200, speaker: "1" },
      { text: "bb", start_ms: 200, end_ms: 300, speaker: "1" },
      { text: "ccc", start_ms: 300, end_ms: 500, speaker: "3" },
      { text: "d", start_ms: 500, end_ms: 600, speaker: "1" },
      { text: "번역", start_ms: 500, end_ms: 600, speaker: "9", translation_status: "translation" },
    ], [{ id: "clip", startMs: 0, endMs: 1_000, expectedMinSpeakers: 1, expectedMaxSpeakers: 2 }]);

    expect(report.windows[0].speakerRuns).toEqual([
      { speakerId: "1", startMs: 100, endMs: 300, tokenCount: 2, textLength: 4 },
      { speakerId: "3", startMs: 300, endMs: 500, tokenCount: 1, textLength: 3 },
      { speakerId: "1", startMs: 500, endMs: 600, tokenCount: 1, textLength: 1 },
    ]);
    expect(JSON.stringify(report.windows[0].speakerRuns)).not.toContain("aa");
  });

  it("같은 영상을 반복한 회차별 화자 수 변화와 결함 회차를 요약한다", () => {
    expect(analyzeDiarizationCycleStability({
      windows: [
        { id: "cycle-1-japanese", speakerCount: 2, supportedSpeakerCount: 2 },
        { id: "cycle-1-english", speakerCount: 3, supportedSpeakerCount: 3 },
        { id: "cycle-2-japanese", speakerCount: 3, supportedSpeakerCount: 2, fragmented: true },
        { id: "cycle-2-english", speakerCount: 3, supportedSpeakerCount: 2, supportedCollapsed: true },
        { id: "cycle-3-japanese", speakerCount: 2, supportedSpeakerCount: 2 },
        { id: "cycle-3-english", speakerCount: 3, supportedSpeakerCount: 3 },
      ],
    })).toEqual({
      sources: [
        {
          sourceId: "japanese",
          cycles: [
            { cycle: 1, speakerCount: 2, supportedSpeakerCount: 2, issue: false },
            { cycle: 2, speakerCount: 3, supportedSpeakerCount: 2, issue: true },
            { cycle: 3, speakerCount: 2, supportedSpeakerCount: 2, issue: false },
          ],
          rawSpeakerCounts: [2, 3, 2],
          supportedSpeakerCounts: [2, 2, 2],
          issueCycles: [2],
          firstIssueCycle: 2,
          lateRegression: true,
          consistentRawCount: false,
          consistentSupportedCount: true,
          passedAll: false,
        },
        {
          sourceId: "english",
          cycles: [
            { cycle: 1, speakerCount: 3, supportedSpeakerCount: 3, issue: false },
            { cycle: 2, speakerCount: 3, supportedSpeakerCount: 2, issue: true },
            { cycle: 3, speakerCount: 3, supportedSpeakerCount: 3, issue: false },
          ],
          rawSpeakerCounts: [3, 3, 3],
          supportedSpeakerCounts: [3, 2, 3],
          issueCycles: [2],
          firstIssueCycle: 2,
          lateRegression: true,
          consistentRawCount: true,
          consistentSupportedCount: false,
          passedAll: false,
        },
      ],
      lateRegressionSourceIds: ["japanese", "english"],
      shareProfileDriftSourceIds: [],
      unparsedWindowIds: [],
    });
  });

  it("첫 회차부터 계속 실패한 영상과 뒤 회차에서 새로 악화된 영상을 구분한다", () => {
    expect(analyzeDiarizationCycleStability({
      windows: [
        { id: "cycle-1-persistent", speakerCount: 4, supportedSpeakerCount: 4, fragmented: true },
        { id: "cycle-2-persistent", speakerCount: 4, supportedSpeakerCount: 4, fragmented: true },
        { id: "cycle-1-late", speakerCount: 3, supportedSpeakerCount: 3 },
        { id: "cycle-2-late", speakerCount: 3, supportedSpeakerCount: 3 },
        { id: "cycle-3-late", speakerCount: 5, supportedSpeakerCount: 4, fragmented: true },
      ],
    })).toMatchObject({
      sources: [
        { sourceId: "persistent", firstIssueCycle: 1, lateRegression: false },
        { sourceId: "late", firstIssueCycle: 3, lateRegression: true },
      ],
      lateRegressionSourceIds: ["late"],
    });
  });

  it("로컬 회차 안정성은 짧은 원시 조각을 경고로 남기고 유효 화자 기준으로 판정한다", () => {
    expect(analyzeDiarizationCycleStability({
      windows: [
        {
          id: "cycle-1-japanese",
          expectedMinSpeakers: 2,
          expectedMaxSpeakers: 2,
          speakerCount: 5,
          supportedSpeakerCount: 2,
          fragmented: true,
          speakerStats: [{ durationShare: 0.9 }, { durationShare: 0.1 }],
        },
        {
          id: "cycle-2-japanese",
          expectedMinSpeakers: 2,
          expectedMaxSpeakers: 2,
          speakerCount: 5,
          supportedSpeakerCount: 2,
          fragmented: true,
          speakerStats: [{ durationShare: 0.9 }, { durationShare: 0.1 }],
        },
      ],
    }, { mode: "local" })).toMatchObject({
      sources: [{
        sourceId: "japanese",
        issueCycles: [],
        lateRegression: false,
        shareProfileDistancesFromFirst: [0, 0],
        shareProfileDrift: false,
        passedAll: true,
      }],
      lateRegressionSourceIds: [],
      shareProfileDriftSourceIds: [],
    });
  });

  it("저장된 로컬 보고서를 재추론 없이 새 유효 화자 규칙으로 다시 채점한다", () => {
    expect(rescoreLocalDiarizationReport({
      model: "local-speaker-embedding",
      scope: "continuous",
      analysis: {
        windows: [
          {
            id: "cycle-1-japanese",
            expectedMinSpeakers: 2,
            expectedMaxSpeakers: 2,
            speakerCount: 5,
            supportedSpeakerCount: 2,
            fragmented: true,
            speakerStats: [{ durationShare: 0.9 }, { durationShare: 0.1 }],
          },
          {
            id: "cycle-2-japanese",
            expectedMinSpeakers: 2,
            expectedMaxSpeakers: 2,
            speakerCount: 5,
            supportedSpeakerCount: 2,
            fragmented: true,
            speakerStats: [{ durationShare: 0.9 }, { durationShare: 0.1 }],
          },
        ],
      },
    })).toMatchObject({
      analysis: {
        rawFragmentedWindowIds: ["cycle-1-japanese", "cycle-2-japanese"],
        issueWindowIds: [],
      },
      cycleStability: {
        lateRegressionSourceIds: [],
        shareProfileDriftSourceIds: [],
        sources: [{ passedAll: true }],
      },
    });
  });

  it("화자 수가 같아도 동일 음원의 회차별 화자 점유율 분포가 크게 흔들리면 표시한다", () => {
    expect(analyzeDiarizationCycleStability({
      windows: [
        {
          id: "cycle-1-stable",
          speakerCount: 2,
          supportedSpeakerCount: 2,
          speakerStats: [{ textShare: 0.8 }, { textShare: 0.2 }],
        },
        {
          id: "cycle-2-stable",
          speakerCount: 2,
          supportedSpeakerCount: 2,
          speakerStats: [{ textShare: 0.78 }, { textShare: 0.22 }],
        },
        {
          id: "cycle-1-drift",
          speakerCount: 2,
          supportedSpeakerCount: 2,
          speakerStats: [{ textShare: 0.9 }, { textShare: 0.1 }],
        },
        {
          id: "cycle-2-drift",
          speakerCount: 2,
          supportedSpeakerCount: 2,
          speakerStats: [{ textShare: 0.55 }, { textShare: 0.45 }],
        },
      ],
    })).toMatchObject({
      sources: [
        {
          sourceId: "stable",
          shareProfileDistancesFromFirst: [0, 0.02],
          maxSpeakerShareDrift: 0.02,
          shareProfileDrift: false,
        },
        {
          sourceId: "drift",
          shareProfileDistancesFromFirst: [0, 0.35],
          maxSpeakerShareDrift: 0.35,
          shareProfileDrift: true,
        },
      ],
      shareProfileDriftSourceIds: ["drift"],
    });
  });

  it("실시간 기준 설정은 고정하고 자동 문장 종료만 비교 변수로 둔다", () => {
    expect(buildRealtimeDiarizationConfig("key", { endpointDetection: true })).toEqual({
      api_key: "key",
      model: "stt-rt-v5",
      audio_format: "pcm_s16le",
      sample_rate: 16_000,
      num_channels: 1,
      language_hints: ["ko", "ja", "en", "zh"],
      enable_language_identification: true,
      enable_speaker_diarization: true,
      enable_endpoint_detection: true,
    });
    expect(buildRealtimeDiarizationConfig("key", { endpointDetection: false }))
      .not.toHaveProperty("enable_endpoint_detection");
    expect(buildRealtimeDiarizationConfig("key", {
      endpointDetection: true,
      endpointSensitivity: -0.8,
      maxEndpointDelayMs: 3_000,
    })).toMatchObject({
      enable_endpoint_detection: true,
      endpoint_sensitivity: -0.8,
      max_endpoint_delay_ms: 3_000,
    });
  });

  it("공식 화자 컨텍스트를 비동기와 실시간 요청에 같은 형태로 전달한다", () => {
    const context = {
      general: [
        { key: "setting", value: "Korean interview" },
        { key: "speakers", value: "2 speakers (2 female interviewees)" },
      ],
    };
    expect(buildRealtimeDiarizationConfig("key", {
      endpointDetection: false,
      context,
    })).toMatchObject({ context });
    expect(buildAsyncDiarizationConfig("file-id", "reference-id", context)).toEqual({
      model: "stt-async-v5",
      file_id: "file-id",
      language_hints: ["ko", "ja", "en", "zh"],
      enable_language_identification: true,
      enable_speaker_diarization: true,
      client_reference_id: "reference-id",
      context,
    });
  });

  it("빈 항목과 과도하게 긴 화자 컨텍스트는 요청에 넣지 않는다", () => {
    expect(buildRealtimeDiarizationConfig("key", {
      context: { general: [{ key: "", value: "2 speakers" }] },
    })).not.toHaveProperty("context");
    expect(buildAsyncDiarizationConfig("file-id", "reference-id", {
      general: [{ key: "speakers", value: "x".repeat(201) }],
    })).not.toHaveProperty("context");
  });

  it("연속 세션과 영상별 독립 세션을 같은 창 순서로 비교한다", () => {
    const compared = compareDiarizationRuns(
      {
        windows: [
          { id: "first", speakerCount: 2, collapsed: false },
          { id: "fourth", speakerCount: 1, collapsed: true },
        ],
      },
      {
        windows: [
          { id: "first", speakerCount: 2, collapsed: false },
          { id: "fourth", speakerCount: 2, collapsed: false },
        ],
      },
    );

    expect(compared).toEqual([
      { id: "first", continuousSpeakers: 2, isolatedSpeakers: 2, recoveredByReset: false },
      { id: "fourth", continuousSpeakers: 1, isolatedSpeakers: 2, recoveredByReset: true },
    ]);
  });

  it("연속 세션에서 과분리된 화자 수도 새 세션에서 정상화되면 복구로 기록한다", () => {
    expect(compareDiarizationRuns(
      { windows: [{ id: "fourth", speakerCount: 3, collapsed: false, fragmented: true }] },
      { windows: [{ id: "fourth", speakerCount: 2, collapsed: false, fragmented: false }] },
    )).toEqual([
      { id: "fourth", continuousSpeakers: 3, isolatedSpeakers: 2, recoveredByReset: true },
    ]);
  });

  it("연속 세션 결함이 영상별 새 세션에서 사라져야 품질 게이트를 통과한다", () => {
    expect(buildDiarizationQualityVerdict(
      {
        windows: [
          { id: "first", speakerCount: 2, collapsed: false, fragmented: false },
          { id: "fourth", speakerCount: 1, collapsed: true, fragmented: false },
        ],
      },
      {
        windows: [
          { id: "first", speakerCount: 2, collapsed: false, fragmented: false },
          { id: "fourth", speakerCount: 2, collapsed: false, fragmented: false },
        ],
      },
    )).toEqual({
      passed: true,
      continuousIssueIds: ["fourth"],
      isolatedIssueIds: [],
      recoveredByResetIds: ["fourth"],
      unresolvedIssueIds: [],
      missingIsolatedWindowIds: [],
    });
  });

  it("영상별 새 세션에도 결함이 남거나 결과 창이 빠지면 품질 게이트를 닫는다", () => {
    expect(buildDiarizationQualityVerdict(
      {
        windows: [
          { id: "first", speakerCount: 2, collapsed: false, fragmented: false },
          { id: "fourth", speakerCount: 3, collapsed: false, fragmented: true },
        ],
      },
      {
        windows: [
          { id: "fourth", speakerCount: 1, collapsed: true, fragmented: false },
        ],
      },
    )).toEqual({
      passed: false,
      continuousIssueIds: ["fourth"],
      isolatedIssueIds: ["fourth"],
      recoveredByResetIds: [],
      unresolvedIssueIds: ["fourth"],
      missingIsolatedWindowIds: ["first"],
    });
  });

  it("원시 화자 수가 맞아도 충분히 지지된 화자가 부족하면 품질 게이트를 닫는다", () => {
    expect(buildDiarizationQualityVerdict(
      {
        windows: [{
          id: "three-voices",
          speakerCount: 3,
          collapsed: false,
          fragmented: false,
          supportedCollapsed: true,
          supportedFragmented: false,
        }],
      },
      {
        windows: [{
          id: "three-voices",
          speakerCount: 3,
          collapsed: false,
          fragmented: false,
          supportedCollapsed: true,
          supportedFragmented: false,
        }],
      },
    )).toEqual({
      passed: false,
      continuousIssueIds: ["three-voices"],
      isolatedIssueIds: ["three-voices"],
      recoveredByResetIds: [],
      unresolvedIssueIds: ["three-voices"],
      missingIsolatedWindowIds: [],
    });
  });

  it("영상 길이와 영상 사이 무음으로 연속 재생 시간창을 만든다", () => {
    expect(buildDiarizationTimeline([
      {
        id: "one",
        durationMs: 90_000,
        expectedMinSpeakers: 2,
        expectedMinSupportedSpeakers: 1,
        expectedMaxSupportedSpeakers: 2,
      },
      { id: "two", durationMs: 45_000, expectedMinSpeakers: 3 },
    ], 2_000)).toEqual({
      durationMs: 137_000,
      windows: [
        {
          id: "one",
          startMs: 0,
          endMs: 90_000,
          expectedMinSpeakers: 2,
          expectedMinSupportedSpeakers: 1,
          expectedMaxSupportedSpeakers: 2,
        },
        { id: "two", startMs: 92_000, endMs: 137_000, expectedMinSpeakers: 3 },
      ],
    });
  });

  it("영상별 독립 전사 토큰을 연속 타임라인 위치로 이동한다", () => {
    expect(offsetTranscriptTokens([
      { text: "hello", start_ms: 100, end_ms: 300, speaker: "1" },
      { text: "untimed", speaker: "2" },
    ], 92_000)).toEqual([
      { text: "hello", start_ms: 92_100, end_ms: 92_300, speaker: "1" },
      { text: "untimed", speaker: "2" },
    ]);
  });

  it("실시간 스트림 청크 크기를 16kHz 모노 16비트 기준으로 계산한다", () => {
    expect(realtimePcmChunkBytes(20)).toBe(640);
    expect(realtimePcmChunkBytes(100)).toBe(3_200);
    expect(realtimePcmChunkBytes(-1)).toBe(0);
  });

  it("품질 실행 범위는 기본값을 유지하고 지원하지 않는 값은 거부한다", () => {
    expect(resolveDiarizationScope(undefined, "both")).toBe("both");
    expect(resolveDiarizationScope("isolated", "both")).toBe("isolated");
    expect(() => resolveDiarizationScope("unknown", "both")).toThrow("invalid_scope");
  });

  it("실시간 완료 신호가 먼저 오면 제한시간 타이머를 즉시 정리한다", async () => {
    vi.useFakeTimers();
    await expect(waitForPromiseWithTimeout(Promise.resolve("완료"), 30_000, "timeout"))
      .resolves.toBe("완료");
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it("최종 전사가 한 명으로 합치고 실시간에 충분한 두 번째 발화가 있으면 실시간 화자를 보완 후보로 고른다", () => {
    expect(chooseDiarizationModel(
      { speakerCount: 1, speakerStats: [{ speakerId: "1", textShare: 1, firstMs: 0, lastMs: 35_000 }] },
      {
        speakerCount: 2,
        speakerStats: [
          { speakerId: "1", textShare: 0.1505, firstMs: 300, lastMs: 4_200 },
          { speakerId: "2", textShare: 0.8495, firstMs: 4_680, lastMs: 34_560 },
        ],
      },
    )).toEqual({ model: "realtime", reason: "supported_turn_after_async_collapse" });
  });

  it("실시간의 작은 잡음 화자나 최종 전사의 다화자 결과보다 실시간 과분리를 우선하지 않는다", () => {
    expect(chooseDiarizationModel(
      { speakerCount: 1, speakerStats: [{ speakerId: "1", textShare: 1, firstMs: 0, lastMs: 35_000 }] },
      {
        speakerCount: 2,
        speakerStats: [
          { speakerId: "1", textShare: 0.98, firstMs: 0, lastMs: 35_000 },
          { speakerId: "2", textShare: 0.02, firstMs: 1_000, lastMs: 1_500 },
        ],
      },
    )).toEqual({ model: "async", reason: "realtime_secondary_speaker_too_weak" });
    expect(chooseDiarizationModel(
      { speakerCount: 3, speakerStats: [] },
      { speakerCount: 4, speakerStats: [] },
    )).toEqual({ model: "async", reason: "async_multi_speaker_preferred" });
  });

  it("실시간 결과가 기대 최대 인원보다 과분리되면 충분한 발화가 있어도 보완 후보로 고르지 않는다", () => {
    expect(chooseDiarizationModel(
      {
        speakerCount: 1,
        expectedMaxSpeakers: 2,
        speakerStats: [{ speakerId: "1", textShare: 1, firstMs: 0, lastMs: 90_000 }],
      },
      {
        speakerCount: 3,
        expectedMaxSpeakers: 2,
        speakerStats: [
          { speakerId: "1", textShare: 0.4, firstMs: 0, lastMs: 40_000 },
          { speakerId: "2", textShare: 0.35, firstMs: 20_000, lastMs: 80_000 },
          { speakerId: "3", textShare: 0.25, firstMs: 50_000, lastMs: 90_000 },
        ],
      },
    )).toEqual({ model: "async", reason: "realtime_overfragmented" });
  });

  it("같은 실제 영상의 최종·실시간 결과를 영상별 후보 선택표로 만든다", () => {
    expect(compareDiarizationCandidates(
      {
        windows: [
          {
            id: "short-question",
            speakerCount: 1,
            expectedMaxSpeakers: 2,
            speakerStats: [{ speakerId: "1", textShare: 1, firstMs: 0, lastMs: 35_000 }],
          },
          {
            id: "three-person-intro",
            speakerCount: 3,
            expectedMaxSpeakers: 3,
            speakerStats: [],
          },
        ],
      },
      {
        windows: [
          {
            id: "short-question",
            speakerCount: 2,
            expectedMaxSpeakers: 2,
            speakerStats: [
              { speakerId: "1", textShare: 0.15, firstMs: 0, lastMs: 3_900 },
              { speakerId: "2", textShare: 0.85, firstMs: 4_500, lastMs: 35_000 },
            ],
          },
          {
            id: "three-person-intro",
            speakerCount: 4,
            expectedMaxSpeakers: 3,
            speakerStats: [],
          },
        ],
      },
    )).toEqual({
      decisions: [
        {
          id: "short-question",
          model: "realtime",
          reason: "supported_turn_after_async_collapse",
          asyncSpeakers: 1,
          realtimeSpeakers: 2,
        },
        {
          id: "three-person-intro",
          model: "async",
          reason: "async_multi_speaker_preferred",
          asyncSpeakers: 3,
          realtimeSpeakers: 4,
        },
      ],
      missingRealtimeWindowIds: [],
      unresolvedWindowIds: [],
    });
  });

  it("한국어 4인 토론에서 최종 결과가 4명이고 실시간이 3명으로 합치면 최종 결과를 고른다", () => {
    expect(compareDiarizationCandidates(
      {
        windows: [{
          id: "korean-four-speakers",
          speakerCount: 4,
          expectedMinSpeakers: 4,
          expectedMaxSpeakers: 4,
          collapsed: false,
          fragmented: false,
          speakerStats: [],
        }],
      },
      {
        windows: [{
          id: "korean-four-speakers",
          speakerCount: 3,
          expectedMinSpeakers: 4,
          expectedMaxSpeakers: 4,
          collapsed: true,
          fragmented: false,
          speakerStats: [],
        }],
      },
    )).toEqual({
      decisions: [{
        id: "korean-four-speakers",
        model: "async",
        reason: "async_multi_speaker_preferred",
        asyncSpeakers: 4,
        realtimeSpeakers: 3,
      }],
      missingRealtimeWindowIds: [],
      unresolvedWindowIds: [],
    });
  });

  it("두 모델 모두 기대 인원 범위를 벗어나면 후보를 고르더라도 미해결로 남긴다", () => {
    expect(compareDiarizationCandidates(
      {
        windows: [{
          id: "two-women",
          speakerCount: 3,
          collapsed: false,
          fragmented: true,
          speakerStats: [],
        }],
      },
      {
        windows: [{
          id: "two-women",
          speakerCount: 4,
          collapsed: false,
          fragmented: true,
          speakerStats: [],
        }],
      },
    )).toEqual({
      decisions: [{
        id: "two-women",
        model: "async",
        reason: "async_multi_speaker_preferred",
        asyncSpeakers: 3,
        realtimeSpeakers: 4,
      }],
      missingRealtimeWindowIds: [],
      unresolvedWindowIds: ["two-women"],
    });
  });

  it("점유율 10% 미만 화자 번호를 약한 라벨로 분리해 실질적인 화자 누락과 과분리를 함께 진단한다", () => {
    const report = analyzeDiarizationWindows([
      { text: "aaaaaaaaaaaaaaaaaa", start_ms: 0, end_ms: 8_000, speaker: "1" },
      { text: "b", start_ms: 1_000, end_ms: 2_000, speaker: "2" },
      { text: "c", start_ms: 3_000, end_ms: 4_000, speaker: "3" },
    ], [{
      id: "two-people",
      startMs: 0,
      endMs: 10_000,
      expectedMinSpeakers: 2,
      expectedMaxSpeakers: 2,
      expectedMinSupportedSpeakers: 2,
      expectedMaxSupportedSpeakers: 2,
    }]);

    expect(report.windows[0]).toMatchObject({
      speakerCount: 3,
      supportedSpeakerIds: ["1"],
      weakSpeakerIds: ["2", "3"],
      supportedSpeakerCount: 1,
      supportedCollapsed: true,
      supportedFragmented: false,
      collapsed: false,
      fragmented: true,
    });
    expect(report.supportedCollapsedWindowIds).toEqual(["two-people"]);
    expect(report.supportedFragmentedWindowIds).toEqual([]);
    expect(report.issueWindowIds).toEqual(["two-people"]);
  });

  it("글자 점유율이 낮아도 누적 발화가 2초 이상이면 실제 짧은 화자로 지지한다", () => {
    const report = analyzeDiarizationWindows([
      { text: "aaaaaaaaaaaaaaaaaaaa", start_ms: 0, end_ms: 8_000, speaker: "1" },
      { text: "b", start_ms: 8_100, end_ms: 10_600, speaker: "2" },
    ], [{
      id: "brief-real-speaker",
      startMs: 0,
      endMs: 11_000,
      expectedMinSpeakers: 2,
      expectedMaxSpeakers: 2,
      expectedMinSupportedSpeakers: 2,
      expectedMaxSupportedSpeakers: 2,
    }]);

    expect(report.windows[0]).toMatchObject({
      speakerCount: 2,
      supportedSpeakerIds: ["1", "2"],
      supportedSpeakerCount: 2,
      weakSpeakerIds: [],
      supportedCollapsed: false,
    });
    expect(report.windows[0].speakerStats[1]).toMatchObject({
      speakerId: "2",
      textShare: 0.0476,
      speechDurationMs: 2_500,
    });
  });

  it("로컬 보조 판정은 2초 미만 조각을 보존하되 유효 화자 수에서 제외한다", () => {
    const report = analyzeLocalDiarizationSegments([
      { start: 0, end: 87.9, speaker: 0 },
      { start: 130.6, end: 223.7, speaker: 1 },
      { start: 33.7, end: 44.4, speaker: 4 },
      { start: 162.5, end: 163.1, speaker: 7 },
      { start: 184.9, end: 185.2, speaker: 8 },
      { start: 235.3, end: 236, speaker: 9 },
    ], {
      id: "remote-call",
      expectedMinSpeakers: 3,
      expectedMaxSpeakers: 3,
      expectedMinSupportedSpeakers: 3,
      expectedMaxSupportedSpeakers: 3,
    }, 2_000);

    expect(report).toMatchObject({
      id: "remote-call",
      speakerIds: ["0", "1", "4", "7", "8", "9"],
      speakerCount: 6,
      supportedSpeakerIds: ["0", "1", "4"],
      weakSpeakerIds: ["7", "8", "9"],
      supportedSpeakerCount: 3,
      collapsed: false,
      fragmented: true,
      supportedCollapsed: false,
      supportedFragmented: false,
    });
    expect(report.speakerStats).toEqual(expect.arrayContaining([
      expect.objectContaining({ speakerId: "4", durationMs: 10_700, durationShare: 0.0554 }),
      expect.objectContaining({ speakerId: "7", durationMs: 600 }),
    ]));
    expect(summarizeLocalDiarizationWindows([report])).toMatchObject({
      rawFragmentedWindowIds: ["remote-call"],
      supportedIssueWindowIds: [],
      issueWindowIds: [],
    });
    expect(summarizeLocalDiarizationWindows([{
      ...report,
      expectedMinSupportedSpeakers: undefined,
      expectedMaxSupportedSpeakers: undefined,
    }])).toMatchObject({
      rawFragmentedWindowIds: ["remote-call"],
      supportedIssueWindowIds: [],
      issueWindowIds: [],
    });
  });

  it("로컬 보조 판정은 한 사람이 길게 말한 구간을 한 화자로 유지한다", () => {
    expect(analyzeLocalDiarizationSegments([
      { start: 0.4, end: 53.7, speaker: 0 },
    ], {
      id: "single-speaker",
      expectedMinSpeakers: 1,
      expectedMaxSpeakers: 1,
      expectedMinSupportedSpeakers: 1,
      expectedMaxSupportedSpeakers: 1,
    }, 2_000)).toMatchObject({
      speakerCount: 1,
      supportedSpeakerCount: 1,
      weakSpeakerIds: [],
      fragmented: false,
      supportedFragmented: false,
    });
  });

  it("연속 로컬 판정 구간을 중간 시점 기준으로 한 영상에만 배정하고 경계에서 자른다", () => {
    expect(selectLocalDiarizationSegmentsForWindow([
      { start: 8, end: 12, speaker: 1 },
      { start: 12, end: 14, speaker: 2 },
      { start: 19, end: 21, speaker: 3 },
      { start: 30, end: 31, speaker: 4 },
      { start: 15, end: 15, speaker: 5 },
    ], { startMs: 10_000, endMs: 20_000 })).toEqual([
      { start: 10, end: 12, speaker: 1 },
      { start: 12, end: 14, speaker: 2 },
    ]);
  });

  it("보조 화자 시간대를 전사 토큰에 겹침 우선으로 입히고 번호를 등장 순서로 정규화한다", () => {
    const result = relabelTranscriptTokensFromDiarization([
      { text: "첫째", start_ms: 1_000, end_ms: 2_000, speaker: "8" },
      { text: "짧은 틈", start_ms: 4_100, end_ms: 4_400, speaker: "8" },
      { text: "둘째", start_ms: 6_000, end_ms: 7_000, speaker: "8" },
      { text: "시간 없음", speaker: "8" },
      { text: "번역", start_ms: 6_000, end_ms: 7_000, speaker: "9", translation_status: "translation" },
    ], [
      { start: 0, end: 4, speaker: 4 },
      { start: 4, end: 4.5, speaker: 7 },
      { start: 5, end: 10, speaker: 1 },
    ], ["4", "1"], 1_000);

    expect(result.tokens).toEqual([
      { text: "첫째", start_ms: 1_000, end_ms: 2_000, speaker: "1" },
      { text: "짧은 틈", start_ms: 4_100, end_ms: 4_400, speaker: "1" },
      { text: "둘째", start_ms: 6_000, end_ms: 7_000, speaker: "2" },
      { text: "시간 없음", speaker: "8" },
      { text: "번역", start_ms: 6_000, end_ms: 7_000, speaker: "9", translation_status: "translation" },
    ]);
    expect(result).toMatchObject({
      localSpeakerMap: { "1": "2", "4": "1" },
      relabeledTokenCount: 3,
      unmatchedTokenCount: 1,
      unmatchedTextShare: 0.3846,
    });
  });

  it("하이브리드 후보는 먼 미연결 토큰을 가장 가까운 유효 화자로 보완하되 진단에 남긴다", () => {
    const result = relabelTranscriptTokensFromDiarization([
      { text: "멀리 떨어진 토큰", start_ms: 20_000, end_ms: 20_500, speaker: "9" },
    ], [
      { start: 0, end: 4, speaker: 4 },
      { start: 5, end: 10, speaker: 1 },
    ], ["4", "1"], 1_000, true);

    expect(result.tokens).toEqual([
      { text: "멀리 떨어진 토큰", start_ms: 20_000, end_ms: 20_500, speaker: "2" },
    ]);
    expect(result).toMatchObject({
      relabeledTokenCount: 1,
      fallbackRelabeledTokenCount: 1,
      unmatchedTokenCount: 1,
      unmatchedTextShare: 1,
    });
  });

  it("하이브리드 실행은 같은 manifest로 만든 결함 없는 로컬 보고서만 받는다", () => {
    const manifest = {
      sources: [
        { id: "first" },
        { id: "second" },
      ],
    };
    const report = {
      manifest: "/tmp/quality/manifest.json",
      scope: "continuous",
      analysis: {
        windows: [
          { id: "first", supportedSpeakerIds: ["1"], speakerRuns: [] },
          { id: "second", supportedSpeakerIds: ["1", "2"], speakerRuns: [] },
        ],
        issueWindowIds: [],
      },
    };

    expect(validateHybridLocalReport(
      "/tmp/quality/manifest.json",
      manifest,
      report,
      "continuous",
    )).toEqual(report.analysis.windows);

    expect(() => validateHybridLocalReport(
      "/tmp/quality/other.json",
      manifest,
      report,
      "continuous",
    )).toThrow("local_report_manifest_mismatch");

    expect(() => validateHybridLocalReport(
      "/tmp/quality/manifest.json",
      manifest,
      { ...report, analysis: { ...report.analysis, issueWindowIds: ["second"] } },
      "continuous",
    )).toThrow("local_report_quality_failed");
  });

  it("컨테이너와 호스트의 manifest 경로가 달라도 내용 지문이 같으면 로컬 보고서를 받는다", () => {
    const manifest = { version: 1, sources: [{ id: "first" }] };
    const report = {
      manifest: "/workspace/evals/manifest.json",
      manifestFingerprint: diarizationManifestFingerprint(manifest),
      scope: "isolated",
      analysis: {
        windows: [{ id: "first", supportedSpeakerIds: ["1"], speakerRuns: [] }],
        issueWindowIds: [],
      },
    };

    expect(validateHybridLocalReport(
      "/Users/example/evals/manifest.json",
      manifest,
      report,
      "isolated",
    )).toEqual(report.analysis.windows);
    expect(() => validateHybridLocalReport(
      "/Users/example/evals/manifest.json",
      { ...manifest, version: 2 },
      report,
      "isolated",
    )).toThrow("local_report_manifest_mismatch");
  });

  it("정답 앵커만 보강된 manifest는 오디오 입력 지문으로 기존 로컬 판정을 재사용한다", () => {
    const original = {
      silenceMs: 2_000,
      sources: [{ id: "first", file: "first.m4a", start: "00:10", end: "00:20" }],
    };
    const annotated = {
      ...original,
      sources: [{
        ...original.sources[0],
        expectedMinSpeakers: 2,
        referenceSpeakerAnchors: [{ speaker: "첫 화자", startMs: 0, endMs: 1_000 }],
      }],
    };
    const report = {
      manifest: "/workspace/evals/manifest.json",
      manifestFingerprint: diarizationManifestFingerprint(original),
      localInputFingerprint: localDiarizationInputFingerprint(original),
      scope: "isolated",
      analysis: {
        windows: [{ id: "first", supportedSpeakerIds: ["1", "2"], speakerRuns: [] }],
        issueWindowIds: [],
      },
    };

    expect(validateHybridLocalReport(
      "/Users/example/evals/manifest.json",
      annotated,
      report,
      "isolated",
    )).toEqual(report.analysis.windows);
    expect(() => validateHybridLocalReport(
      "/Users/example/evals/manifest.json",
      { ...annotated, sources: [{ ...annotated.sources[0], end: "00:21" }] },
      report,
      "isolated",
    )).toThrow("local_report_manifest_mismatch");
  });

  it("하이브리드 실행은 scope나 영상 목록이 다른 로컬 보고서를 거부한다", () => {
    const manifest = { sources: [{ id: "first" }, { id: "second" }] };
    const report = {
      manifest: "/tmp/quality/manifest.json",
      scope: "isolated",
      analysis: {
        windows: [{ id: "first", supportedSpeakerIds: ["1"], speakerRuns: [] }],
        issueWindowIds: [],
      },
    };

    expect(() => validateHybridLocalReport(
      "/tmp/quality/manifest.json",
      manifest,
      report,
      "continuous",
    )).toThrow("local_report_scope_mismatch");

    expect(() => validateHybridLocalReport(
      "/tmp/quality/manifest.json",
      manifest,
      { ...report, scope: "isolated" },
      "isolated",
    )).toThrow("local_report_source_mismatch");
  });

  it("연속·독립 로컬 후보에서 영상별 기대 범위를 통과한 결과를 선택한다", () => {
    const manifest = {
      sources: [
        { id: "japanese", expectedMinSpeakers: 2, expectedMaxSpeakers: 2 },
        { id: "brief-question", expectedMinSpeakers: 2, expectedMaxSpeakers: 3 },
      ],
    };
    const selected = selectHybridLocalDiarizationWindows(manifest, [
      {
        scope: "continuous",
        windows: [
          { id: "japanese", supportedSpeakerCount: 1 },
          { id: "brief-question", supportedSpeakerCount: 2 },
        ],
      },
      {
        scope: "isolated",
        windows: [
          { id: "japanese", supportedSpeakerCount: 2 },
          { id: "brief-question", supportedSpeakerCount: 1 },
        ],
      },
    ]);

    expect(selected.map((candidate) => [candidate.id, candidate.localScope])).toEqual([
      ["japanese", "isolated"],
      ["brief-question", "continuous"],
    ]);
  });

  it("연속·독립 로컬 후보가 모두 기대 범위를 벗어나면 하이브리드를 차단한다", () => {
    expect(() => selectHybridLocalDiarizationWindows({
      sources: [{ id: "panel", expectedMinSpeakers: 3, expectedMaxSpeakers: 3 }],
    }, [
      { scope: "continuous", windows: [{ id: "panel", supportedSpeakerCount: 2 }] },
      { scope: "isolated", windows: [{ id: "panel", supportedSpeakerCount: 4 }] },
    ])).toThrow("local_report_quality_failed");
  });

  it("선택한 로컬 시간대를 대상 전사 scope의 시간축으로 변환한다", () => {
    const runs = [{ speakerId: "7", startMs: 1_000, endMs: 2_000 }];
    expect(normalizeLocalSpeakerRunsForScope(runs, "isolated", "continuous", 10_000)).toEqual([
      { start: 11, end: 12, speaker: "7" },
    ]);
    expect(normalizeLocalSpeakerRunsForScope([
      { speakerId: "7", startMs: 11_000, endMs: 12_000 },
    ], "continuous", "isolated", 10_000)).toEqual([
      { start: 1, end: 2, speaker: "7" },
    ]);
  });

  it("클라우드 원시 화자 수와 로컬 유효 화자 수가 일치하는 후보를 우선한다", () => {
    const selected = selectDiarizationCandidateByConsensus(
      { id: "english", speakerCount: 3 },
      [
        { label: "0.85", window: { supportedSpeakerCount: 4, supportedSpeakerIds: ["1", "2", "3", "4"] } },
        { label: "0.90", window: { supportedSpeakerCount: 4, supportedSpeakerIds: ["1", "2", "3", "4"] } },
        { label: "0.95", window: { supportedSpeakerCount: 3, supportedSpeakerIds: ["1", "2", "3"] } },
      ],
    );

    expect(selected).toMatchObject({
      resolved: true,
      reason: "cloud_local_supported_count_agreement",
      candidateLabel: "0.95",
      selectedSpeakerIds: ["1", "2", "3"],
    });
  });

  it("짧은 실제 화자가 약한 번호일 때 클라우드와 원시 수가 같으면 한 명까지 복원한다", () => {
    const selected = selectDiarizationCandidateByConsensus(
      { id: "brief-interviewer", speakerCount: 3 },
      [{
        label: "0.85",
        window: {
          speakerCount: 3,
          speakerIds: ["1", "2", "3"],
          supportedSpeakerCount: 2,
          supportedSpeakerIds: ["1", "2"],
        },
      }],
    );

    expect(selected).toMatchObject({
      resolved: true,
      reason: "cloud_local_raw_count_agreement",
      selectedSpeakerIds: ["1", "2", "3"],
    });
  });

  it("클라우드가 합쳤어도 여러 로컬 임계값이 같은 유효 화자 수면 로컬 합의를 고른다", () => {
    const selected = selectDiarizationCandidateByConsensus(
      { id: "remote", speakerCount: 2 },
      [
        { label: "0.85", window: { supportedSpeakerCount: 3, supportedSpeakerIds: ["1", "2", "3"] } },
        { label: "0.90", window: { supportedSpeakerCount: 3, supportedSpeakerIds: ["1", "2", "3"] } },
        { label: "0.95", window: { supportedSpeakerCount: 3, supportedSpeakerIds: ["1", "2", "3"] } },
      ],
    );

    expect(selected).toMatchObject({
      resolved: true,
      reason: "local_threshold_consensus",
      candidateLabel: "0.85",
      selectedSpeakerIds: ["1", "2", "3"],
    });
  });

  it("로컬 후보 표가 갈리고 클라우드와도 일치하지 않으면 자동 선택하지 않는다", () => {
    expect(selectDiarizationCandidateByConsensus(
      { id: "unknown", speakerCount: 2 },
      [
        { label: "a", window: { supportedSpeakerCount: 3, supportedSpeakerIds: ["1", "2", "3"] } },
        { label: "b", window: { supportedSpeakerCount: 4, supportedSpeakerIds: ["1", "2", "3", "4"] } },
      ],
    )).toMatchObject({ resolved: false, reason: "no_consensus" });
  });

  it("장시간 클라우드 값이 오염되면 경계별 독립 재확인과 로컬 다수결로 후보를 고른다", () => {
    const selected = selectDiarizationCandidateByConsensus(
      { id: "korean-panel", speakerCount: 3 },
      [
        { label: "0.85", window: { supportedSpeakerCount: 4, supportedSpeakerIds: ["0", "1", "2", "3"] } },
        { label: "0.90", window: { supportedSpeakerCount: 4, supportedSpeakerIds: ["0", "1", "2", "3"] } },
        { label: "0.95", window: { supportedSpeakerCount: 3, supportedSpeakerIds: ["0", "1", "2"] } },
      ],
      { id: "korean-panel", speakerCount: 4 },
    );

    expect(selected).toMatchObject({
      resolved: true,
      reason: "reset_cloud_local_vote",
      candidateLabel: "0.85",
      selectedSpeakerCount: 4,
    });
  });

  it("로컬 임계값 투표가 동률이면 장시간 결과가 아니라 경계별 독립 재확인을 따른다", () => {
    const selected = selectDiarizationCandidateByConsensus(
      { id: "english", speakerCount: 4 },
      [
        { label: "0.85", window: { supportedSpeakerCount: 4, supportedSpeakerIds: ["0", "1", "2", "3"] } },
        { label: "0.90", window: { supportedSpeakerCount: 4, supportedSpeakerIds: ["0", "1", "2", "3"] } },
        { label: "0.95", window: { supportedSpeakerCount: 3, supportedSpeakerIds: ["0", "1", "2"] } },
      ],
      { id: "english", speakerCount: 3 },
    );

    expect(selected).toMatchObject({
      resolved: true,
      reason: "reset_cloud_local_vote_tiebreak",
      candidateLabel: "0.95",
      selectedSpeakerCount: 3,
    });
  });

  it("로컬 과분리가 두 임계값에서 반복돼도 세 후보가 만장일치가 아니면 독립 재확인을 유지한다", () => {
    const selected = selectDiarizationCandidateByConsensus(
      { id: "three-person-panel", speakerCount: 5 },
      [
        { label: "0.85", window: { supportedSpeakerCount: 6, supportedSpeakerIds: ["0", "1", "2", "3", "4", "5"] } },
        { label: "0.90", window: { supportedSpeakerCount: 6, supportedSpeakerIds: ["0", "1", "2", "3", "4", "5"] } },
        { label: "0.95", window: { supportedSpeakerCount: 5, supportedSpeakerIds: ["0", "1", "2", "3", "4"] } },
      ],
      {
        id: "three-person-panel",
        speakerCount: 3,
        speakerIds: ["1", "2", "3"],
        supportedSpeakerCount: 2,
        supportedSpeakerIds: ["1", "2"],
      },
    );

    expect(selected).toMatchObject({
      resolved: true,
      reason: "reset_cloud_over_nonunanimous_local",
      candidateLabel: "reset-cloud",
      selectedSpeakerCount: 3,
      selectedSpeakerIds: ["1", "2", "3"],
    });
  });

  it("인접 임계값에서 충분히 긴 화자 한 명이 반복 복구되면 경계 모델의 한 명 병합을 보완한다", () => {
    const longFourSpeakerWindow = {
      speakerCount: 5,
      speakerIds: ["0", "2", "4", "6", "8"],
      supportedSpeakerCount: 4,
      supportedSpeakerIds: ["0", "2", "4", "8"],
      speakerStats: [
        { speakerId: "0", durationMs: 16_335 },
        { speakerId: "2", durationMs: 65_964 },
        { speakerId: "4", durationMs: 36_857 },
        { speakerId: "6", durationMs: 675 },
        { speakerId: "8", durationMs: 33_091 },
      ],
    };
    const candidates = [0.85, 0.86, 0.87, 0.88, 0.89].map((threshold) => ({
      label: `titanet-${threshold}`,
      threshold,
      embeddingModel: "titanet",
      window: longFourSpeakerWindow,
    }));
    candidates.push(
      {
        label: "titanet-0.90",
        threshold: 0.90,
        embeddingModel: "titanet",
        window: {
          speakerCount: 4,
          speakerIds: ["0", "2", "3", "4"],
          supportedSpeakerCount: 3,
          supportedSpeakerIds: ["0", "2", "3"],
          speakerStats: [
            { speakerId: "0", durationMs: 16_335 },
            { speakerId: "2", durationMs: 65_964 },
            { speakerId: "3", durationMs: 69_948 },
            { speakerId: "4", durationMs: 675 },
          ],
        },
      },
      {
        label: "titanet-0.95",
        threshold: 0.95,
        embeddingModel: "titanet",
        window: {
          speakerCount: 4,
          speakerIds: ["0", "2", "3", "4"],
          supportedSpeakerCount: 3,
          supportedSpeakerIds: ["0", "2", "3"],
          speakerStats: [
            { speakerId: "0", durationMs: 16_335 },
            { speakerId: "2", durationMs: 65_964 },
            { speakerId: "3", durationMs: 69_965 },
            { speakerId: "4", durationMs: 675 },
          ],
        },
      },
    );

    const selected = selectDiarizationCandidateByConsensus(
      { id: "four-person-panel", speakerCount: 3 },
      candidates,
      { id: "four-person-panel", speakerCount: 3, speakerIds: ["1", "2", "3"] },
      {
        label: "realtime-reset",
        window: {
          id: "four-person-panel",
          speakerCount: 3,
          speakerIds: ["1", "2", "3"],
          supportedSpeakerCount: 3,
          supportedSpeakerIds: ["1", "2", "3"],
        },
      },
    );

    expect(selected).toMatchObject({
      resolved: true,
      reason: "local_stable_single_extra_speaker",
      candidateLabel: "titanet-0.85",
      selectedSpeakerCount: 4,
      selectedSpeakerIds: ["0", "2", "4", "8"],
    });
  });

  it("낮은 임계값의 추가 화자가 10초보다 짧으면 안정 구간처럼 반복돼도 과분리를 채택하지 않는다", () => {
    const candidates = [0.85, 0.86, 0.87, 0.88, 0.89].map((threshold) => ({
      label: `titanet-${threshold}`,
      threshold,
      embeddingModel: "titanet",
      window: {
        speakerCount: 4,
        speakerIds: ["0", "1", "2", "3"],
        supportedSpeakerCount: 4,
        supportedSpeakerIds: ["0", "1", "2", "3"],
        speakerStats: [
          { speakerId: "0", durationMs: 47_958 },
          { speakerId: "1", durationMs: 21_651 },
          { speakerId: "2", durationMs: 12_976 },
          { speakerId: "3", durationMs: 2_599 },
        ],
      },
    }));
    candidates.push({
      label: "titanet-0.95",
      threshold: 0.95,
      embeddingModel: "titanet",
      window: {
        speakerCount: 3,
        speakerIds: ["0", "1", "2"],
        supportedSpeakerCount: 3,
        supportedSpeakerIds: ["0", "1", "2"],
        speakerStats: [
          { speakerId: "0", durationMs: 50_000 },
          { speakerId: "1", durationMs: 22_000 },
          { speakerId: "2", durationMs: 13_000 },
        ],
      },
    });

    const selected = selectDiarizationCandidateByConsensus(
      { id: "three-person-intro", speakerCount: 3 },
      candidates,
      { id: "three-person-intro", speakerCount: 3, speakerIds: ["1", "2", "3"] },
      {
        label: "realtime-reset",
        window: {
          id: "three-person-intro",
          speakerCount: 3,
          speakerIds: ["1", "2", "3"],
          supportedSpeakerCount: 3,
          supportedSpeakerIds: ["1", "2", "3"],
        },
      },
    );

    expect(selected).toMatchObject({
      resolved: true,
      reason: "reset_cloud_over_nonunanimous_local",
      selectedSpeakerCount: 3,
    });
  });

  it("세 로컬 임계값이 모두 독립 재확인과 다른 같은 수면 로컬 만장일치를 채택한다", () => {
    const selected = selectDiarizationCandidateByConsensus(
      { id: "remote-panel", speakerCount: 2 },
      [
        { label: "0.85", window: { supportedSpeakerCount: 3, supportedSpeakerIds: ["0", "1", "4"] } },
        { label: "0.90", window: { supportedSpeakerCount: 3, supportedSpeakerIds: ["0", "1", "4"] } },
        { label: "0.95", window: { supportedSpeakerCount: 3, supportedSpeakerIds: ["0", "1", "4"] } },
      ],
      { id: "remote-panel", speakerCount: 2, speakerIds: ["1", "2"] },
    );

    expect(selected).toMatchObject({
      resolved: true,
      reason: "local_unanimous_override_reset_cloud",
      candidateLabel: "0.85",
      selectedSpeakerCount: 3,
    });
  });

  it("독립 재확인이 짧은 실제 질문자를 확인하면 로컬의 약한 한 화자를 복원한다", () => {
    const selected = selectDiarizationCandidateByConsensus(
      { id: "brief-interviewer", speakerCount: 2 },
      [
        {
          label: "0.85",
          window: {
            speakerCount: 3,
            speakerIds: ["0", "2", "4"],
            supportedSpeakerCount: 2,
            supportedSpeakerIds: ["0", "2"],
          },
        },
        {
          label: "0.90",
          window: {
            speakerCount: 3,
            speakerIds: ["0", "2", "4"],
            supportedSpeakerCount: 2,
            supportedSpeakerIds: ["0", "2"],
          },
        },
      ],
      { id: "brief-interviewer", speakerCount: 3 },
    );

    expect(selected).toMatchObject({
      resolved: true,
      reason: "reset_cloud_local_vote",
      selectedSpeakerIds: ["0", "2", "4"],
      selectedSpeakerCount: 3,
    });
  });

  it("독립 재확인이 두 명을 확인하고 짧은 발화가 여러 번호로 쪼개지면 누적 발화 상위 두 명을 고른다", () => {
    const selected = selectDiarizationCandidateByConsensus(
      { id: "brief-japanese-reply", speakerCount: 2 },
      [
        {
          label: "0.90",
          window: {
            speakerCount: 3,
            speakerIds: ["0", "1", "2"],
            supportedSpeakerCount: 1,
            supportedSpeakerIds: ["0"],
            speakerStats: [
              { speakerId: "0", durationMs: 77_275 },
              { speakerId: "1", durationMs: 388 },
              { speakerId: "2", durationMs: 1_604 },
            ],
          },
        },
      ],
      { id: "brief-japanese-reply", speakerCount: 2 },
    );

    expect(selected).toMatchObject({
      resolved: true,
      reason: "reset_cloud_local_vote",
      selectedSpeakerCount: 2,
      selectedSpeakerIds: ["0", "2"],
    });
  });

  it("독립 재확인이 두 명이어도 로컬 시간대가 한 명뿐이면 화자를 만들어내지 않는다", () => {
    const selected = selectDiarizationCandidateByConsensus(
      { id: "fully-collapsed", speakerCount: 1 },
      [{
        label: "0.85",
        window: {
          speakerCount: 1,
          speakerIds: ["0"],
          supportedSpeakerCount: 1,
          supportedSpeakerIds: ["0"],
          speakerStats: [{ speakerId: "0", durationMs: 28_199 }],
        },
      }],
      { id: "fully-collapsed", speakerCount: 2 },
    );

    expect(selected).toMatchObject({
      resolved: true,
      selectedSpeakerCount: 1,
      selectedSpeakerIds: ["0"],
    });
  });

  it("비동기와 로컬이 모두 합쳤지만 실시간의 두 번째 화자가 충분하면 실시간 시간대를 고른다", () => {
    const selected = selectDiarizationCandidateByConsensus(
      { id: "short-question", speakerCount: 1 },
      [{
        label: "local-0.85",
        window: {
          speakerCount: 1,
          speakerIds: ["0"],
          supportedSpeakerCount: 1,
          supportedSpeakerIds: ["0"],
        },
      }],
      { id: "short-question", speakerCount: 1 },
      {
        label: "realtime-reset",
        window: {
          id: "short-question",
          speakerCount: 2,
          speakerIds: ["1", "2"],
          supportedSpeakerCount: 2,
          supportedSpeakerIds: ["1", "2"],
          speakerStats: [
            { speakerId: "1", textShare: 0.1505, firstMs: 300, lastMs: 4_200 },
            { speakerId: "2", textShare: 0.8495, firstMs: 4_680, lastMs: 34_560 },
          ],
        },
      },
    );

    expect(selected).toMatchObject({
      resolved: true,
      reason: "realtime_supported_turn_after_async_collapse",
      candidateLabel: "realtime-reset",
      selectedSpeakerCount: 2,
      selectedSpeakerIds: ["1", "2"],
    });
  });

  it("실시간의 두 번째 번호가 너무 짧으면 비동기 합침을 실시간으로 덮지 않는다", () => {
    const selected = selectDiarizationCandidateByConsensus(
      { id: "noise", speakerCount: 1 },
      [{
        label: "local-0.85",
        window: {
          speakerCount: 1,
          speakerIds: ["0"],
          supportedSpeakerCount: 1,
          supportedSpeakerIds: ["0"],
        },
      }],
      { id: "noise", speakerCount: 1 },
      {
        label: "realtime-reset",
        window: {
          id: "noise",
          speakerCount: 2,
          speakerIds: ["1", "2"],
          supportedSpeakerCount: 1,
          supportedSpeakerIds: ["1"],
          speakerStats: [
            { speakerId: "1", textShare: 0.98, firstMs: 0, lastMs: 30_000 },
            { speakerId: "2", textShare: 0.02, firstMs: 5_000, lastMs: 5_500 },
          ],
        },
      },
    );

    expect(selected).toMatchObject({
      resolved: true,
      candidateLabel: "local-0.85",
      selectedSpeakerCount: 1,
    });
  });

  it("로컬이 약한 번호로만 화자 수를 맞추고 실시간은 같은 수를 충분히 지지하면 실시간 시간대를 쓴다", () => {
    const selected = selectDiarizationCandidateByConsensus(
      { id: "balanced-interview", speakerCount: 1 },
      [{
        label: "local-0.85",
        window: {
          speakerCount: 2,
          speakerIds: ["0", "1"],
          supportedSpeakerCount: 1,
          supportedSpeakerIds: ["0"],
          speakerStats: [
            { speakerId: "0", durationMs: 69_996 },
            { speakerId: "1", durationMs: 1_046 },
          ],
        },
      }],
      { id: "balanced-interview", speakerCount: 2 },
      {
        label: "realtime-reset",
        window: {
          id: "balanced-interview",
          speakerCount: 2,
          speakerIds: ["1", "2"],
          supportedSpeakerCount: 2,
          supportedSpeakerIds: ["1", "2"],
          speakerStats: [
            { speakerId: "1", textShare: 0.427, firstMs: 0, lastMs: 55_000 },
            { speakerId: "2", textShare: 0.573, firstMs: 20_000, lastMs: 74_000 },
          ],
        },
      },
    );

    expect(selected).toMatchObject({
      resolved: true,
      reason: "realtime_supported_count_over_weak_local",
      candidateLabel: "realtime-reset",
      selectedSpeakerCount: 2,
      selectedSpeakerIds: ["1", "2"],
    });
  });

  it("로컬 후보도 선택한 화자 수를 충분히 지지하면 같은 수의 실시간 후보로 바꾸지 않는다", () => {
    const selected = selectDiarizationCandidateByConsensus(
      { id: "stable-local", speakerCount: 2 },
      [{
        label: "local-0.85",
        window: {
          speakerCount: 2,
          speakerIds: ["0", "1"],
          supportedSpeakerCount: 2,
          supportedSpeakerIds: ["0", "1"],
        },
      }],
      { id: "stable-local", speakerCount: 2 },
      {
        label: "realtime-reset",
        window: {
          id: "stable-local",
          speakerCount: 2,
          speakerIds: ["1", "2"],
          supportedSpeakerCount: 2,
          supportedSpeakerIds: ["1", "2"],
          speakerStats: [
            { speakerId: "1", textShare: 0.5, firstMs: 0, lastMs: 10_000 },
            { speakerId: "2", textShare: 0.5, firstMs: 10_000, lastMs: 20_000 },
          ],
        },
      },
    );

    expect(selected).toMatchObject({
      resolved: true,
      reason: "reset_cloud_local_vote",
      candidateLabel: "local-0.85",
    });
  });

  it("클라우드와 여러 로컬 보고서의 영상별 합의 및 미해결 목록을 만든다", () => {
    const report = buildDiarizationConsensusReport({ windows: [
      { id: "first", speakerCount: 2 },
      { id: "second", speakerCount: 2 },
    ] }, [
      { label: "a", windows: [
        { id: "first", supportedSpeakerCount: 2, supportedSpeakerIds: ["1", "2"] },
        { id: "second", supportedSpeakerCount: 3, supportedSpeakerIds: ["1", "2", "3"] },
      ] },
      { label: "b", windows: [
        { id: "first", supportedSpeakerCount: 2, supportedSpeakerIds: ["1", "2"] },
        { id: "second", supportedSpeakerCount: 4, supportedSpeakerIds: ["1", "2", "3", "4"] },
      ] },
    ]);

    expect(report.selections).toHaveLength(2);
    expect(report.resolvedWindowIds).toEqual(["first"]);
    expect(report.unresolvedWindowIds).toEqual(["second"]);
  });

  it("합의 보고서가 영상 경계별 독립 클라우드 분석을 같은 ID로 연결한다", () => {
    const report = buildDiarizationConsensusReport({ windows: [
      { id: "panel", speakerCount: 3 },
    ] }, [
      { label: "low", windows: [{ id: "panel", supportedSpeakerCount: 4, supportedSpeakerIds: ["0", "1", "2", "3"] }] },
      { label: "mid", windows: [{ id: "panel", supportedSpeakerCount: 4, supportedSpeakerIds: ["0", "1", "2", "3"] }] },
      { label: "high", windows: [{ id: "panel", supportedSpeakerCount: 3, supportedSpeakerIds: ["0", "1", "2"] }] },
    ], { windows: [
      { id: "panel", speakerCount: 4 },
    ] });

    expect(report.selections[0]).toMatchObject({
      reason: "reset_cloud_local_vote",
      selectedSpeakerCount: 4,
    });
  });

  it("합의가 고른 보고서의 시간대와 짧은 실제 화자를 재적용 대상으로 만든다", () => {
    const windows = materializeDiarizationConsensusWindows({
      selections: [
        {
          id: "brief-interviewer",
          resolved: true,
          candidateLabel: "titanet@0.85#1",
          selectedSpeakerIds: ["0", "2", "4"],
        },
        {
          id: "english",
          resolved: true,
          candidateLabel: "titanet@0.95#3",
          selectedSpeakerIds: ["0", "1", "2"],
        },
      ],
      unresolvedWindowIds: [],
    }, [
      {
        label: "titanet@0.85#1",
        scope: "isolated",
        windows: [{
          id: "brief-interviewer",
          supportedSpeakerIds: ["0", "2"],
          speakerRuns: [{ speakerId: "4", startMs: 100, endMs: 800 }],
        }],
      },
      {
        label: "titanet@0.95#3",
        scope: "isolated",
        windows: [{
          id: "english",
          supportedSpeakerIds: ["0", "1", "2"],
          speakerRuns: [{ speakerId: "2", startMs: 1_000, endMs: 2_000 }],
        }],
      },
    ]);

    expect(windows).toEqual([
      expect.objectContaining({
        id: "brief-interviewer",
        localScope: "isolated",
        consensusCandidateLabel: "titanet@0.85#1",
        supportedSpeakerIds: ["0", "2", "4"],
      }),
      expect.objectContaining({
        id: "english",
        consensusCandidateLabel: "titanet@0.95#3",
        supportedSpeakerIds: ["0", "1", "2"],
      }),
    ]);
  });

  it("합의하지 못한 영상이 있으면 실제 재적용을 차단한다", () => {
    expect(() => materializeDiarizationConsensusWindows({
      selections: [{ id: "unknown", resolved: false }],
      unresolvedWindowIds: ["unknown"],
    }, [])).toThrow("diarization_consensus_unresolved");
  });

  it("짧은 실제 질문자가 있는 영상은 별도 기대값이 없으면 점유율만으로 실패시키지 않는다", () => {
    const report = analyzeDiarizationWindows([
      { text: "aaaaaaaaaaaaaaaaaa", start_ms: 0, end_ms: 8_000, speaker: "1" },
      { text: "b", start_ms: 8_100, end_ms: 8_500, speaker: "2" },
    ], [{ id: "brief-question", startMs: 0, endMs: 10_000, expectedMinSpeakers: 2, expectedMaxSpeakers: 2 }]);

    expect(report.windows[0]).toMatchObject({
      speakerCount: 2,
      supportedSpeakerCount: 1,
      collapsed: false,
      fragmented: false,
      supportedCollapsed: false,
      supportedFragmented: false,
    });
    expect(report.issueWindowIds).toEqual([]);
  });

  it("저장된 화자 통계를 외부 호출 없이 최신 manifest 기대값으로 다시 채점한다", () => {
    const rescored = rescoreDiarizationAnalysis({
      windows: [
        {
          id: "brief-question",
          speakerCount: 2,
          supportedSpeakerCount: 1,
          collapsed: false,
          fragmented: false,
          supportedCollapsed: true,
          supportedFragmented: false,
        },
        {
          id: "balanced-panel",
          speakerCount: 3,
          supportedSpeakerCount: 1,
          collapsed: false,
          fragmented: false,
          supportedCollapsed: false,
          supportedFragmented: false,
        },
      ],
    }, {
      sources: [
        {
          id: "brief-question",
          expectedMinSpeakers: 2,
          expectedMaxSpeakers: 2,
        },
        {
          id: "balanced-panel",
          expectedMinSpeakers: 3,
          expectedMaxSpeakers: 3,
          expectedMinSupportedSpeakers: 2,
          expectedMaxSupportedSpeakers: 3,
        },
      ],
    });

    expect(rescored.windows).toEqual([
      expect.objectContaining({
        id: "brief-question",
        collapsed: false,
        fragmented: false,
        supportedCollapsed: false,
        supportedFragmented: false,
      }),
      expect.objectContaining({
        id: "balanced-panel",
        collapsed: false,
        fragmented: false,
        supportedCollapsed: true,
        supportedFragmented: false,
      }),
    ]);
    expect(rescored.issueWindowIds).toEqual(["balanced-panel"]);
    expect(rescored.supportedCollapsedWindowIds).toEqual(["balanced-panel"]);
  });

  it("기존 보고서의 분석·회차 안정성·품질 판정을 한 번에 다시 계산한다", () => {
    const report = rescoreDiarizationReport({
      model: "model",
      scope: "both",
      continuous: {
        windows: [{
          id: "cycle-1-interview",
          speakerCount: 2,
          supportedSpeakerCount: 1,
          collapsed: false,
          fragmented: false,
          supportedCollapsed: true,
          supportedFragmented: false,
        }],
      },
      isolated: {
        windows: [{
          id: "cycle-1-interview",
          speakerCount: 2,
          supportedSpeakerCount: 1,
          collapsed: false,
          fragmented: false,
          supportedCollapsed: true,
          supportedFragmented: false,
        }],
      },
    }, {
      sources: [{ id: "cycle-1-interview", expectedMinSpeakers: 2, expectedMaxSpeakers: 2 }],
    });

    expect(report.model).toBe("model");
    expect(report.verdict.passed).toBe(true);
    expect(report.continuous.issueWindowIds).toEqual([]);
    expect(report.isolated.issueWindowIds).toEqual([]);
    expect(report.continuousCycleStability.sources[0]).toMatchObject({
      sourceId: "interview",
      passedAll: true,
    });
  });

  it("실제 인원보다 화자 번호가 과도하게 늘어난 구간도 실패로 표시한다", () => {
    const report = analyzeDiarizationWindows([
      { text: "a", start_ms: 100, end_ms: 200, speaker: "1" },
      { text: "b", start_ms: 200, end_ms: 300, speaker: "2" },
      { text: "c", start_ms: 300, end_ms: 400, speaker: "3" },
    ], [{ id: "two-person", startMs: 0, endMs: 1_000, expectedMinSpeakers: 2, expectedMaxSpeakers: 2 }]);

    expect(report.windows[0]).toMatchObject({ collapsed: false, fragmented: true });
    expect(report.fragmentedWindowIds).toEqual(["two-person"]);
  });
});
