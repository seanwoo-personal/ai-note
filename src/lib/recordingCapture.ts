import {
  microphoneCaptureErrorMessage,
  requestMicrophoneStream,
} from "@/lib/microphoneCapture";

export type RecorderAudioSource = "microphone" | "microphone-and-system";

export interface RecordingCapture {
  stream: MediaStream;
  release(): void;
}

type CaptureFailureCode = "display_unavailable" | "shared_audio_missing" | "mixing_unavailable";

class RecordingCaptureFailure extends Error {
  constructor(readonly code: CaptureFailureCode) {
    super(code);
    this.name = "RecordingCaptureFailure";
  }
}

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

function audioContextConstructor(): typeof AudioContext | undefined {
  if (typeof window === "undefined") return undefined;
  return window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

function releaseOnce(
  streams: MediaStream[],
  context: AudioContext | null = null,
): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    streams.forEach(stopStream);
    if (context) void context.close();
  };
}

export async function requestRecordingCapture(
  audioSource: RecorderAudioSource,
): Promise<RecordingCapture> {
  if (audioSource === "microphone") {
    const microphone = await requestMicrophoneStream();
    return { stream: microphone, release: releaseOnce([microphone]) };
  }

  const getDisplayMedia = navigator.mediaDevices?.getDisplayMedia;
  if (typeof getDisplayMedia !== "function") {
    throw new RecordingCaptureFailure("display_unavailable");
  }

  let shared: MediaStream | null = null;
  let microphone: MediaStream | null = null;
  let mixed: MediaStream | null = null;
  let context: AudioContext | null = null;
  try {
    shared = await getDisplayMedia.call(navigator.mediaDevices, { audio: true, video: true });
    if (shared.getAudioTracks().length === 0) {
      throw new RecordingCaptureFailure("shared_audio_missing");
    }

    microphone = await requestMicrophoneStream();
    const AudioContextConstructor = audioContextConstructor();
    if (!AudioContextConstructor) throw new RecordingCaptureFailure("mixing_unavailable");

    context = new AudioContextConstructor();
    const destination = context.createMediaStreamDestination();
    context.createMediaStreamSource(microphone).connect(destination);
    context.createMediaStreamSource(shared).connect(destination);
    mixed = destination.stream;
    await context.resume();

    return {
      stream: mixed,
      release: releaseOnce([microphone, shared, mixed], context),
    };
  } catch (caught) {
    stopStream(mixed);
    stopStream(microphone);
    stopStream(shared);
    if (context) void context.close();
    throw caught;
  }
}

export function recordingCaptureErrorMessage(
  audioSource: RecorderAudioSource,
  caught: unknown,
): string {
  if (audioSource === "microphone") return microphoneCaptureErrorMessage(caught);
  if (caught instanceof RecordingCaptureFailure) {
    if (caught.code === "shared_audio_missing") {
      return "공유한 화면의 소리가 포함되지 않았습니다. Chrome에서 회의 탭을 선택하고 오디오 공유를 켜고 다시 시도해 주세요.";
    }
    if (caught.code === "display_unavailable") {
      return "이 환경에서는 회의 소리 공유를 사용할 수 없습니다. 데스크톱 Chrome에서 다시 시도하거나 마이크만 녹음해 주세요.";
    }
    return "이 브라우저에서는 마이크와 회의 소리를 하나로 녹음할 수 없습니다. 최신 데스크톱 Chrome에서 다시 시도해 주세요.";
  }
  if (caught instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(caught.name)) {
    return "마이크와 화면 공유 권한이 필요합니다. 권한을 허용하고 오디오 공유를 켠 뒤 다시 시도해 주세요.";
  }
  return microphoneCaptureErrorMessage(caught);
}
