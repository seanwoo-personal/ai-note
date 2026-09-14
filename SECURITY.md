# Security Policy

AI NOTE can run on loopback for development or behind an HTTPS reverse proxy for
a single-customer test deployment. It processes meeting audio through Soniox and
text through the configured OpenRouter models.

## Threat model

- **Two explicit ingress modes.** Development accepts exact loopback hosts.
  Cloud mode requires an HTTPS forwarded protocol and safe host; unsafe methods
  require an exact same-origin `Origin`, and `APP_ORIGIN` can pin a stable host.
- **Account gate.** Customers cannot log in until an operator approves them and
  marks payment complete. Operators use separate sessions; invited operators
  must enroll TOTP two-factor authentication.
- **Server-only credentials.** `SONIOX_API_KEY` and `OPENROUTER_API_KEY` are read
  only by server code. They must remain in ignored environment files or the
  deployment secret store and are never returned by public DTOs.
- **External processing.** Recorded audio is uploaded to Soniox for
  transcription. Transcript text and prompts are sent to OpenRouter for enabled
  correction, translation, summary, or chat work. Provider terms and retention
  controls therefore apply.
- **Glossary is local PII.** The domain glossary (`glossary.json`) may contain
  personal names; it is gitignored and never committed. Exported hand-off docs
  (`.md` / `.json`) are written verbatim — AI NOTE does **not** currently scrub
  tokens/emails/PII from them. This is a deliberate local-only trade-off (see
  [ADR 0015](docs/decisions/0015-durable-meeting-tombstone.md)); on a single-user
  machine the export is already as trusted as the rest of `data/`.

The current filesystem repository is not tenant-partitioned. A remote test
instance must approve only one customer organization. Multi-customer production
hosting is out of scope until account-scoped storage and a transactional shared
store are implemented; see [ADR 0026](docs/decisions/0026-local-account-gate-before-hosted-multitenancy.md).

### In scope

- Unintended network exposure (binding beyond `127.0.0.1`, SSRF, open ports).
- Leakage of audio, transcripts, tokens, or PII into logs or exported artifacts.
- Path traversal or arbitrary file read/write via the API routes.
- Dependency vulnerabilities with a realistic local-exploitation path.

### Out of scope

- Social-engineering or physical-access scenarios.
- Issues in Soniox, OpenRouter, or routed models themselves (report those upstream).

## Local service and data controls

- Soniox requests use fixed HTTPS API paths, validate remote IDs before reuse,
  reject redirects, and expose only stable error codes. The app commits a
  dispatch before upload, persists remote file/transcription IDs, and can resume
  status monitoring after restart.
- Soniox publishes validated segments before the raw completion marker. Remote
  transcription and uploaded file resources are deleted on completion or error
  as a best-effort cleanup.
- OpenRouter receives an ordered model fallback list. Provider routing requests
  price ordering, zero-data-retention providers, and denial of provider data
  collection. Failure responses do not expose provider bodies.
- Recording finalize validates the MIME allowlist, IDs, timestamps, tombstone,
  and request metadata before reading the unbounded streaming body. It durably
  pins metadata/location in a hidden intent, fsyncs the streamed audio, and only
  exposes a meeting by renaming a complete audio+status+receipt directory.
  Published retries never consume replacement bodies. Hidden intent/receipt
  metadata and audio remain local PII. There is intentionally no application
  byte/duration cap, so local disk exhaustion by the trusted local user remains
  a documented residual risk.
- Permanent deletion first commits a minimal `{id, deletedAt}` tombstone under
  `data/meeting-tombstones/`. That marker permanently fences the ID even if a
  late local producer recreates files. Tombstone and deterministic trash scans
  reject symlinks and malformed state; they never follow or repair an ambiguous
  path. Physical meeting/trash cleanup is retryable and does not remove the
  tombstone.
- Corrupt-library recovery metadata never stores a caller-selected path. A
  strict versioned intent accepts only a canonical lowercase UUID recovery ID,
  old/new SHA-256 identities, the intended new library ID, and an explicit
  publish/restore phase; unknown, duplicate, missing, control, separator,
  absolute, `..`, and non-canonical Unicode fields fail closed. Temp/archive/
  restore basenames are recomputed from the validated ID. Typed path observation
  must prove exact root containment and every-component no-follow safety before
  the pure planner can return any mutation action. Invalid/multiple intent,
  symlink/unsafe path, hash/ID mismatch, or canonical-missing ambiguity returns
  `recovery_conflict`, never cleanup or empty bootstrap.
- Recovery mutation is exposed only for the exact `corrupt` mode and the latest
  opaque fingerprint. The executor archives the original before publishing a
  new registry, atomically replaces every intent phase, and requires directory
  durability for archive/canonical namespace changes. Unsupported durability,
  I/O, or ambiguous restart state fails closed. `data/library-recovery/` and its
  files use private permissions where supported; archives can contain local PII,
  never appear in API/UI paths, and are retained indefinitely until the local
  user removes them.
- API responses use explicit DTOs and static errors. Local absolute paths,
  job/dispatch IDs, provider stdout/stderr, and raw filesystem errors are not
  returned or logged. Export files remain the intentional local hand-off exception
  described above.

## Supported versions

This is an early public project. Only the latest release / `main` receives fixes.

| Version | Supported |
|---|---|
| latest (`main`) | ✅ |
| older | ❌ |

## Reporting a vulnerability

For most issues, please **open a GitHub issue** with steps to reproduce, the
affected version/commit, and your platform.

If the issue is **sensitive** (for example, it could leak private data or
compromise a user before a fix ships), please practice responsible disclosure:
open a minimal issue asking for a private channel — or use GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
if enabled on the repository — rather than posting full exploit details
publicly. We will acknowledge your report, work on a fix, and credit you unless
you prefer to remain anonymous.

Thank you for helping keep AI NOTE safe.
