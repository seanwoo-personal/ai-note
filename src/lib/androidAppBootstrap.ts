export const ANDROID_APP_BOOTSTRAP_SCRIPT = `
(function () {
  try {
    if (String(navigator.userAgent || "").indexOf("hejhome-ai-note-android/") !== -1) {
      document.documentElement.setAttribute("data-ai-note-android-app", "true");
    }
  } catch (_) {}
})();
`;
