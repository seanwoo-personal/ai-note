const AUDIO_SOURCE_FAILURE_MESSAGE =
  "마이크를 시작하지 못했습니다. 통화·녹음 앱을 종료하고 마이크 권한을 확인한 뒤 다시 시도해 주세요.";

function failureShape(caught: unknown): { name?: unknown; message?: unknown } | null {
  return typeof caught === "object" && caught !== null
    ? caught as { name?: unknown; message?: unknown }
    : null;
}

export function isAudioTrackStartFailure(caught: unknown): boolean {
  const failure = failureShape(caught);
  return failure?.name === "NotReadableError"
    || failure?.message === "Could not start audio source"
    || failure?.message === "Failed to access audio capture device";
}

export async function requestMicrophoneStream(
  initialAudio: boolean | MediaTrackConstraints = true,
): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: initialAudio });
  } catch (caught) {
    if (!isAudioTrackStartFailure(caught)) throw caught;
    return navigator.mediaDevices.getUserMedia({ audio: true });
  }
}

export function microphoneCaptureErrorMessage(caught: unknown): string {
  if (isAudioTrackStartFailure(caught)) return AUDIO_SOURCE_FAILURE_MESSAGE;
  const failure = failureShape(caught);
  if (failure?.name === "NotAllowedError" || failure?.name === "SecurityError") {
    return "마이크 권한이 필요합니다. 앱 설정에서 마이크를 허용한 뒤 다시 시도해 주세요.";
  }
  if (failure?.name === "NotFoundError") {
    return "사용할 수 있는 마이크를 찾지 못했습니다. 마이크 연결을 확인해 주세요.";
  }
  return "녹음을 시작하지 못했습니다. 마이크 연결과 권한을 확인한 뒤 다시 시도해 주세요.";
}
