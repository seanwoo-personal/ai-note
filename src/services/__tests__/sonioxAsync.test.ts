// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cleanupSonioxResources,
  createSonioxTranscription,
  fetchSonioxTranscript,
  getSonioxTranscriptionStatus,
  sonioxTranscriptToArtifacts,
} from "@/services/sonioxAsync";

const KEY = "soniox-test-key";

describe("Soniox 비동기 전사", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv("SONIOX_API_KEY", KEY);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("오디오를 업로드한 뒤 현재 비동기 모델과 다국어·화자 분리 설정으로 작업을 만든다", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "file-1" }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "transcription-1" }), { status: 201 }));

    await expect(createSonioxTranscription({
      audio: new Uint8Array([1, 2, 3]),
      filename: "audio.webm",
      meetingId: "meeting-1",
    })).resolves.toEqual({ fileId: "file-1", transcriptionId: "transcription-1" });

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.soniox.com/v1/files");
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({
      method: "POST",
      headers: { authorization: `Bearer ${KEY}` },
      body: expect.any(FormData),
    }));
    const createBody = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(createBody).toEqual({
      model: "stt-async-v5",
      file_id: "file-1",
      language_hints: ["ko", "ja", "en", "zh"],
      enable_language_identification: true,
      enable_speaker_diarization: true,
      client_reference_id: "meeting-1",
    });
  });

  it("작업 상태와 최종 토큰을 읽고 공급자 상세는 오류에 노출하지 않는다", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "completed" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ tokens: [{ text: "안녕하세요" }] }), { status: 200 }));

    await expect(getSonioxTranscriptionStatus("transcription-1")).resolves.toBe("completed");
    await expect(fetchSonioxTranscript("transcription-1")).resolves.toEqual({
      tokens: [{ text: "안녕하세요" }],
    });

    fetchMock.mockResolvedValueOnce(new Response("private provider message", { status: 500 }));
    await expect(getSonioxTranscriptionStatus("transcription-1"))
      .rejects.toThrow("soniox_status_500");
  });

  it("화자별 토큰을 세그먼트와 읽기 쉬운 원문으로 변환하고 번역 토큰은 제외한다", () => {
    const artifacts = sonioxTranscriptToArtifacts({ tokens: [
      { text: "안녕", start_ms: 0, end_ms: 250, speaker: "1" },
      { text: "하세요.", start_ms: 250, end_ms: 600, speaker: "1" },
      { text: "Hello.", start_ms: 0, end_ms: 600, speaker: "1", translation_status: "translation" },
      { text: "반갑습니다.", start_ms: 700, end_ms: 1_000, speaker: "2" },
    ] });

    expect(artifacts.segments).toEqual([
      { start: 0, end: 0.6, text: "안녕하세요.", speaker: "1" },
      { start: 0.7, end: 1, text: "반갑습니다.", speaker: "2" },
    ]);
    expect(artifacts.raw).toBe("화자 1: 안녕하세요.\n\n화자 2: 반갑습니다.\n");
  });

  it("전사 작업과 업로드 파일을 모두 정리하며 한쪽 실패가 다른 삭제를 막지 않는다", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("network detail"))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(cleanupSonioxResources({
      transcriptionId: "transcription-1",
      fileId: "file-1",
    })).resolves.toBeUndefined();
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://api.soniox.com/v1/transcriptions/transcription-1",
      "https://api.soniox.com/v1/files/file-1",
    ]);
  });
});
