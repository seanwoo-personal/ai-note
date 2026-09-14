#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const SONIOX_API = "https://api.soniox.com/v1";
const PCM_SAMPLE_RATE = 16_000;
const PCM_BYTES_PER_MS = (PCM_SAMPLE_RATE * 2) / 1_000;
const POLL_INTERVAL_MS = 1_500;
const MAX_POLL_MS = 15 * 60_000;
const SUPPORTED_SPEAKER_MIN_DURATION_MS = 2_000;

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function diarizationManifestFingerprint(manifest) {
  return createHash("sha256").update(stableJson(manifest)).digest("hex");
}

export function localDiarizationInputFingerprint(manifest) {
  const input = {
    silenceMs: Math.max(0, Number(manifest?.silenceMs) || 0),
    sources: (Array.isArray(manifest?.sources) ? manifest.sources : []).map((source) => ({
      id: source?.id,
      file: source?.file,
      url: source?.url,
      start: source?.start,
      end: source?.end,
    })),
  };
  return createHash("sha256").update(stableJson(input)).digest("hex");
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function tokenMidpoint(token) {
  const start = finiteNumber(token.start_ms);
  const end = finiteNumber(token.end_ms);
  if (start !== null && end !== null) return start + ((end - start) / 2);
  return start ?? end;
}

function originalToken(token) {
  return token?.translation_status !== "translation" && typeof token?.text === "string" && token.text.length > 0;
}

function roundedShare(value) {
  return Math.round(value * 10_000) / 10_000;
}

function summarizeDiarizationWindows(reports) {
  return {
    windows: reports,
    collapsedWindowIds: reports.filter((window) => window.collapsed).map((window) => window.id),
    fragmentedWindowIds: reports.filter((window) => window.fragmented).map((window) => window.id),
    supportedCollapsedWindowIds: reports.filter((window) => window.supportedCollapsed).map((window) => window.id),
    supportedFragmentedWindowIds: reports.filter((window) => window.supportedFragmented).map((window) => window.id),
    anchorMismatchWindowIds: reports.filter((window) => window.anchorMismatch).map((window) => window.id),
    issueWindowIds: reports.filter(diarizationIssue).map((window) => window.id),
  };
}

function localDiarizationIssue(window) {
  const supportedCount = Math.max(0, Number(window?.supportedSpeakerCount) || 0);
  const expectedMin = Math.max(
    0,
    Number(window?.expectedMinSupportedSpeakers) || Number(window?.expectedMinSpeakers) || 0,
  );
  const expectedMax = Math.max(
    0,
    Number(window?.expectedMaxSupportedSpeakers) || Number(window?.expectedMaxSpeakers) || 0,
  );
  return (expectedMin > 0 && supportedCount < expectedMin)
    || (expectedMax > 0 && supportedCount > expectedMax);
}

export function summarizeLocalDiarizationWindows(windows) {
  const reports = Array.isArray(windows) ? windows : [];
  return {
    windows: reports,
    rawCollapsedWindowIds: reports.filter((window) => window.collapsed).map((window) => window.id),
    rawFragmentedWindowIds: reports.filter((window) => window.fragmented).map((window) => window.id),
    supportedIssueWindowIds: reports.filter(localDiarizationIssue).map((window) => window.id),
    issueWindowIds: reports.filter(localDiarizationIssue).map((window) => window.id),
  };
}

export function scoreSpeakerAnchorAgreement(tokens, anchors, offsetMs = 0) {
  const offset = Number(offsetMs) || 0;
  const referenceAnchors = (Array.isArray(anchors) ? anchors : []).flatMap((anchor) => {
    const startMs = finiteNumber(anchor?.startMs);
    const endMs = finiteNumber(anchor?.endMs);
    const speaker = typeof anchor?.speaker === "string" ? anchor.speaker.trim() : "";
    if (startMs === null || endMs === null || endMs <= startMs || !speaker) return [];
    return [{ speaker, startMs: startMs + offset, endMs: endMs + offset }];
  });
  const confusion = new Map();
  const referenceWeight = new Map();
  const predicted = new Set();
  const references = new Set(referenceAnchors.map((anchor) => anchor.speaker));
  let totalWeightMs = 0;
  for (const token of Array.isArray(tokens) ? tokens.filter(originalToken) : []) {
    const midpoint = tokenMidpoint(token);
    if (midpoint === null) continue;
    const anchor = referenceAnchors.find((candidate) => (
      midpoint >= candidate.startMs && midpoint < candidate.endMs
    ));
    if (!anchor) continue;
    const startMs = finiteNumber(token.start_ms);
    const endMs = finiteNumber(token.end_ms);
    const weight = startMs !== null && endMs !== null && endMs > startMs
      ? endMs - startMs
      : Math.max(1, token.text.length);
    totalWeightMs += weight;
    referenceWeight.set(anchor.speaker, (referenceWeight.get(anchor.speaker) ?? 0) + weight);
    if (typeof token.speaker !== "string" && typeof token.speaker !== "number") continue;
    const speaker = String(token.speaker);
    predicted.add(speaker);
    const key = `${speaker}\u0000${anchor.speaker}`;
    confusion.set(key, (confusion.get(key) ?? 0) + weight);
  }
  const predictedSpeakerIds = [...predicted].sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
  const referenceSpeakerIds = [...references].sort((left, right) => left.localeCompare(right, "ko"));
  const memo = new Map();
  const solve = (index, usedMask) => {
    const memoKey = `${index}:${usedMask}`;
    const cached = memo.get(memoKey);
    if (cached) return cached;
    if (index >= predictedSpeakerIds.length) return { score: 0, mapping: {} };
    const speaker = predictedSpeakerIds[index];
    let best = solve(index + 1, usedMask);
    for (let referenceIndex = 0; referenceIndex < referenceSpeakerIds.length; referenceIndex += 1) {
      const bit = 1 << referenceIndex;
      if ((usedMask & bit) !== 0) continue;
      const reference = referenceSpeakerIds[referenceIndex];
      const remainder = solve(index + 1, usedMask | bit);
      const score = (confusion.get(`${speaker}\u0000${reference}`) ?? 0) + remainder.score;
      if (score > best.score) {
        best = { score, mapping: { [speaker]: reference, ...remainder.mapping } };
      }
    }
    memo.set(memoKey, best);
    return best;
  };
  const best = solve(0, 0);
  const predictedByReference = new Map(
    Object.entries(best.mapping).map(([predictedSpeakerId, referenceSpeakerId]) => (
      [referenceSpeakerId, predictedSpeakerId]
    )),
  );
  const referenceStats = referenceSpeakerIds.map((speaker) => {
    const predictedSpeakerId = predictedByReference.get(speaker) ?? null;
    const totalSpeakerWeightMs = referenceWeight.get(speaker) ?? 0;
    const matchedSpeakerWeightMs = predictedSpeakerId === null
      ? 0
      : confusion.get(`${predictedSpeakerId}\u0000${speaker}`) ?? 0;
    return {
      speaker,
      predictedSpeakerId,
      totalWeightMs: totalSpeakerWeightMs,
      matchedWeightMs: matchedSpeakerWeightMs,
      agreement: totalSpeakerWeightMs > 0
        ? roundedShare(matchedSpeakerWeightMs / totalSpeakerWeightMs)
        : null,
    };
  });
  return {
    referenceSpeakerIds,
    predictedSpeakerIds,
    totalWeightMs,
    matchedWeightMs: best.score,
    agreement: totalWeightMs > 0 ? roundedShare(best.score / totalWeightMs) : null,
    mapping: best.mapping,
    referenceStats,
    minimumSpeakerAgreement: referenceStats.length > 0
      ? Math.min(...referenceStats.map((speaker) => speaker.agreement ?? 0))
      : null,
    unmappedReferenceSpeakerIds: referenceStats
      .filter((speaker) => speaker.predictedSpeakerId === null)
      .map((speaker) => speaker.speaker),
  };
}

export function analyzeDiarizationWindows(tokens, windows) {
  const original = Array.isArray(tokens) ? tokens.filter(originalToken) : [];
  const reports = windows.map((window) => {
    const selected = original.filter((token) => {
      const midpoint = tokenMidpoint(token);
      return midpoint !== null && midpoint >= window.startMs && midpoint < window.endMs;
    });
    const speakerText = new Map();
    const statsBySpeaker = new Map();
    const speakerRuns = [];
    let totalTextLength = 0;
    let speakerlessTextLength = 0;
    for (const token of selected) {
      const length = token.text.length;
      totalTextLength += length;
      if (typeof token.speaker !== "string" && typeof token.speaker !== "number") {
        speakerlessTextLength += length;
        continue;
      }
      const speaker = String(token.speaker);
      speakerText.set(speaker, (speakerText.get(speaker) ?? 0) + length);
      const startMs = finiteNumber(token.start_ms) ?? tokenMidpoint(token);
      const endMs = finiteNumber(token.end_ms) ?? tokenMidpoint(token);
      const previousRun = speakerRuns.at(-1);
      if (previousRun?.speakerId === speaker) {
        previousRun.tokenCount += 1;
        previousRun.textLength += length;
        if (startMs !== null) {
          previousRun.startMs = previousRun.startMs === null
            ? startMs
            : Math.min(previousRun.startMs, startMs);
        }
        if (endMs !== null) {
          previousRun.endMs = previousRun.endMs === null
            ? endMs
            : Math.max(previousRun.endMs, endMs);
        }
      } else {
        speakerRuns.push({
          speakerId: speaker,
          startMs,
          endMs,
          tokenCount: 1,
          textLength: length,
        });
      }
      const previous = statsBySpeaker.get(speaker) ?? {
        tokenCount: 0,
        textLength: 0,
        speechDurationMs: 0,
        firstMs: null,
        lastMs: null,
      };
      const speechDurationMs = startMs !== null && endMs !== null && endMs > startMs
        ? endMs - startMs
        : 0;
      statsBySpeaker.set(speaker, {
        tokenCount: previous.tokenCount + 1,
        textLength: previous.textLength + length,
        speechDurationMs: previous.speechDurationMs + speechDurationMs,
        firstMs: startMs === null
          ? previous.firstMs
          : previous.firstMs === null ? startMs : Math.min(previous.firstMs, startMs),
        lastMs: endMs === null
          ? previous.lastMs
          : previous.lastMs === null ? endMs : Math.max(previous.lastMs, endMs),
      });
    }
    const speakerIds = [...speakerText.keys()].sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
    const attributedTextLength = [...speakerText.values()].reduce((sum, length) => sum + length, 0);
    const dominantLength = Math.max(0, ...speakerText.values());
    const speakerCount = speakerIds.length;
    const expectedMinSpeakers = Math.max(0, Number(window.expectedMinSpeakers) || 0);
    const expectedMaxSpeakers = Math.max(0, Number(window.expectedMaxSpeakers) || 0);
    const expectedMinSupportedSpeakers = Math.max(0, Number(window.expectedMinSupportedSpeakers) || 0);
    const expectedMaxSupportedSpeakers = Math.max(0, Number(window.expectedMaxSupportedSpeakers) || 0);
    const minimumAnchorAgreement = Math.max(0, Math.min(1, Number(window.minimumAnchorAgreement) || 0));
    const minimumSpeakerAnchorAgreement = Math.max(
      0,
      Math.min(1, Number(window.minimumSpeakerAnchorAgreement) || 0),
    );
    const anchorAgreement = Array.isArray(window.referenceSpeakerAnchors)
      ? scoreSpeakerAnchorAgreement(selected, window.referenceSpeakerAnchors, window.startMs)
      : null;
    const anchorMismatch = (minimumAnchorAgreement > 0
      && (anchorAgreement?.agreement === null || anchorAgreement.agreement < minimumAnchorAgreement))
      || (minimumSpeakerAnchorAgreement > 0
        && (
          anchorAgreement?.minimumSpeakerAgreement === null
          || anchorAgreement?.minimumSpeakerAgreement === undefined
          || anchorAgreement.minimumSpeakerAgreement < minimumSpeakerAnchorAgreement
        ));
    const speakerStats = speakerIds.map((speakerId) => {
      const stats = statsBySpeaker.get(speakerId);
      return {
        speakerId,
        tokenCount: stats.tokenCount,
        textLength: stats.textLength,
        speechDurationMs: stats.speechDurationMs,
        textShare: attributedTextLength > 0 ? roundedShare(stats.textLength / attributedTextLength) : 0,
        firstMs: stats.firstMs,
        lastMs: stats.lastMs,
      };
    });
    const supportedSpeakerIds = speakerStats
      .filter((speaker) => (
        speaker.textShare >= 0.1
        || speaker.speechDurationMs >= SUPPORTED_SPEAKER_MIN_DURATION_MS
      ))
      .map((speaker) => speaker.speakerId);
    const weakSpeakerIds = speakerStats
      .filter((speaker) => (
        speaker.textShare < 0.1
        && speaker.speechDurationMs < SUPPORTED_SPEAKER_MIN_DURATION_MS
      ))
      .map((speaker) => speaker.speakerId);
    const supportedSpeakerCount = supportedSpeakerIds.length;
    return {
      ...window,
      tokenCount: selected.length,
      textLength: totalTextLength,
      speakerIds,
      speakerCount,
      speakerStats,
      speakerRuns,
      supportedSpeakerIds,
      weakSpeakerIds,
      supportedSpeakerCount,
      dominantSpeakerShare: attributedTextLength > 0 ? roundedShare(dominantLength / attributedTextLength) : 0,
      speakerlessTextShare: totalTextLength > 0 ? roundedShare(speakerlessTextLength / totalTextLength) : 0,
      collapsed: expectedMinSpeakers > 1 && speakerCount < expectedMinSpeakers,
      fragmented: expectedMaxSpeakers > 0 && speakerCount > expectedMaxSpeakers,
      supportedCollapsed: expectedMinSupportedSpeakers > 0
        && supportedSpeakerCount < expectedMinSupportedSpeakers,
      supportedFragmented: expectedMaxSupportedSpeakers > 0
        && supportedSpeakerCount > expectedMaxSupportedSpeakers,
      ...(anchorAgreement ? { anchorAgreement, anchorMismatch } : {}),
    };
  });
  return summarizeDiarizationWindows(reports);
}

export function analyzeLocalDiarizationSegments(segments, source, minSupportedDurationMs = 2_000) {
  const statsBySpeaker = new Map();
  const speakerRuns = [];
  for (const segment of Array.isArray(segments) ? segments : []) {
    const startSeconds = finiteNumber(segment?.start);
    const endSeconds = finiteNumber(segment?.end);
    if (
      startSeconds === null
      || endSeconds === null
      || endSeconds <= startSeconds
      || (typeof segment?.speaker !== "string" && typeof segment?.speaker !== "number")
    ) continue;
    const speakerId = String(segment.speaker);
    const startMs = Math.round(startSeconds * 1_000);
    const endMs = Math.round(endSeconds * 1_000);
    const durationMs = endMs - startMs;
    const previous = statsBySpeaker.get(speakerId) ?? {
      durationMs: 0,
      segmentCount: 0,
      firstMs: null,
      lastMs: null,
    };
    statsBySpeaker.set(speakerId, {
      durationMs: previous.durationMs + durationMs,
      segmentCount: previous.segmentCount + 1,
      firstMs: previous.firstMs === null ? startMs : Math.min(previous.firstMs, startMs),
      lastMs: previous.lastMs === null ? endMs : Math.max(previous.lastMs, endMs),
    });
    speakerRuns.push({ speakerId, startMs, endMs, durationMs });
  }
  speakerRuns.sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  const speakerIds = [...statsBySpeaker.keys()]
    .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
  const totalDurationMs = [...statsBySpeaker.values()]
    .reduce((sum, speaker) => sum + speaker.durationMs, 0);
  const speakerStats = speakerIds.map((speakerId) => {
    const stats = statsBySpeaker.get(speakerId);
    return {
      speakerId,
      segmentCount: stats.segmentCount,
      durationMs: stats.durationMs,
      durationShare: totalDurationMs > 0 ? roundedShare(stats.durationMs / totalDurationMs) : 0,
      firstMs: stats.firstMs,
      lastMs: stats.lastMs,
    };
  });
  const supportThresholdMs = Math.max(0, Number(minSupportedDurationMs) || 0);
  const supportedSpeakerIds = speakerStats
    .filter((speaker) => speaker.durationMs >= supportThresholdMs)
    .map((speaker) => speaker.speakerId);
  const weakSpeakerIds = speakerStats
    .filter((speaker) => speaker.durationMs < supportThresholdMs)
    .map((speaker) => speaker.speakerId);
  const speakerCount = speakerIds.length;
  const supportedSpeakerCount = supportedSpeakerIds.length;
  const expectedMinSpeakers = Math.max(0, Number(source?.expectedMinSpeakers) || 0);
  const expectedMaxSpeakers = Math.max(0, Number(source?.expectedMaxSpeakers) || 0);
  const expectedMinSupportedSpeakers = Math.max(0, Number(source?.expectedMinSupportedSpeakers) || 0);
  const expectedMaxSupportedSpeakers = Math.max(0, Number(source?.expectedMaxSupportedSpeakers) || 0);
  return {
    ...source,
    totalAttributedDurationMs: totalDurationMs,
    minSupportedDurationMs: supportThresholdMs,
    speakerIds,
    speakerCount,
    speakerStats,
    speakerRuns,
    supportedSpeakerIds,
    weakSpeakerIds,
    supportedSpeakerCount,
    collapsed: expectedMinSpeakers > 1 && speakerCount < expectedMinSpeakers,
    fragmented: expectedMaxSpeakers > 0 && speakerCount > expectedMaxSpeakers,
    supportedCollapsed: expectedMinSupportedSpeakers > 0
      && supportedSpeakerCount < expectedMinSupportedSpeakers,
    supportedFragmented: expectedMaxSupportedSpeakers > 0
      && supportedSpeakerCount > expectedMaxSupportedSpeakers,
  };
}

export function selectLocalDiarizationSegmentsForWindow(segments, window) {
  const windowStartSeconds = Math.max(0, Number(window?.startMs) || 0) / 1_000;
  const windowEndSeconds = Math.max(windowStartSeconds, Number(window?.endMs) || 0) / 1_000;
  return (Array.isArray(segments) ? segments : []).flatMap((segment) => {
    const start = finiteNumber(segment?.start);
    const end = finiteNumber(segment?.end);
    if (
      start === null
      || end === null
      || end <= start
      || (typeof segment?.speaker !== "string" && typeof segment?.speaker !== "number")
    ) return [];
    const midpoint = start + ((end - start) / 2);
    if (midpoint < windowStartSeconds || midpoint >= windowEndSeconds) return [];
    const clippedStart = Math.max(start, windowStartSeconds);
    const clippedEnd = Math.min(end, windowEndSeconds);
    if (clippedEnd <= clippedStart) return [];
    return [{ start: clippedStart, end: clippedEnd, speaker: segment.speaker }];
  });
}

export function relabelTranscriptTokensFromDiarization(
  tokens,
  segments,
  supportedSpeakerIds,
  maxGapMs = 1_000,
  fallbackToNearest = false,
) {
  const supported = new Set((Array.isArray(supportedSpeakerIds) ? supportedSpeakerIds : []).map(String));
  const usableSegments = (Array.isArray(segments) ? segments : [])
    .flatMap((segment) => {
      const startSeconds = finiteNumber(segment?.start);
      const endSeconds = finiteNumber(segment?.end);
      const speakerId = typeof segment?.speaker === "string" || typeof segment?.speaker === "number"
        ? String(segment.speaker)
        : null;
      if (
        startSeconds === null
        || endSeconds === null
        || endSeconds <= startSeconds
        || speakerId === null
        || !supported.has(speakerId)
      ) return [];
      return [{
        speakerId,
        startMs: Math.round(startSeconds * 1_000),
        endMs: Math.round(endSeconds * 1_000),
      }];
    })
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  const speakerOrder = [];
  for (const segment of usableSegments) {
    if (!speakerOrder.includes(segment.speakerId)) speakerOrder.push(segment.speakerId);
  }
  const speakerMap = new Map(speakerOrder.map((speakerId, index) => [speakerId, String(index + 1)]));
  const gapLimitMs = Math.max(0, Number(maxGapMs) || 0);
  let relabeledTokenCount = 0;
  let fallbackRelabeledTokenCount = 0;
  let unmatchedTokenCount = 0;
  let totalTextLength = 0;
  let unmatchedTextLength = 0;
  const relabeled = (Array.isArray(tokens) ? tokens : []).map((token) => {
    if (!originalToken(token)) return token;
    totalTextLength += token.text.length;
    const startMs = finiteNumber(token.start_ms);
    const endMs = finiteNumber(token.end_ms);
    if (startMs === null || endMs === null || endMs < startMs) {
      unmatchedTokenCount += 1;
      unmatchedTextLength += token.text.length;
      return token;
    }
    let best = null;
    for (const segment of usableSegments) {
      const overlapMs = Math.max(0, Math.min(endMs, segment.endMs) - Math.max(startMs, segment.startMs));
      const gapMs = overlapMs > 0
        ? 0
        : Math.min(Math.abs(startMs - segment.endMs), Math.abs(segment.startMs - endMs));
      if (
        best === null
        || overlapMs > best.overlapMs
        || (overlapMs === best.overlapMs && gapMs < best.gapMs)
        || (
          overlapMs === best.overlapMs
          && gapMs === best.gapMs
          && segment.startMs < best.segment.startMs
        )
      ) best = { segment, overlapMs, gapMs };
    }
    if (best === null) {
      unmatchedTokenCount += 1;
      unmatchedTextLength += token.text.length;
      return token;
    }
    if (best.overlapMs <= 0 && best.gapMs > gapLimitMs) {
      unmatchedTokenCount += 1;
      unmatchedTextLength += token.text.length;
      if (!fallbackToNearest) return token;
      relabeledTokenCount += 1;
      fallbackRelabeledTokenCount += 1;
      return { ...token, speaker: speakerMap.get(best.segment.speakerId) };
    }
    relabeledTokenCount += 1;
    return { ...token, speaker: speakerMap.get(best.segment.speakerId) };
  });
  return {
    tokens: relabeled,
    localSpeakerMap: Object.fromEntries(speakerMap),
    relabeledTokenCount,
    fallbackRelabeledTokenCount,
    unmatchedTokenCount,
    unmatchedTextShare: totalTextLength > 0 ? roundedShare(unmatchedTextLength / totalTextLength) : 0,
  };
}

export function rescoreDiarizationAnalysis(analysis, manifest) {
  const sourcesById = new Map(
    (Array.isArray(manifest?.sources) ? manifest.sources : [])
      .filter((source) => typeof source?.id === "string")
      .map((source) => [source.id, source]),
  );
  const windows = (Array.isArray(analysis?.windows) ? analysis.windows : []).map((window) => {
    const source = sourcesById.get(window.id) ?? window;
    const expectedMinSpeakers = Math.max(0, Number(source.expectedMinSpeakers) || 0);
    const expectedMaxSpeakers = Math.max(0, Number(source.expectedMaxSpeakers) || 0);
    const expectedMinSupportedSpeakers = Math.max(0, Number(source.expectedMinSupportedSpeakers) || 0);
    const expectedMaxSupportedSpeakers = Math.max(0, Number(source.expectedMaxSupportedSpeakers) || 0);
    const speakerCount = Math.max(0, Number(window.speakerCount) || 0);
    const supportedSpeakerCount = Math.max(0, Number(window.supportedSpeakerCount) || 0);
    const {
      expectedMinSpeakers: _oldMin,
      expectedMaxSpeakers: _oldMax,
      expectedMinSupportedSpeakers: _oldSupportedMin,
      expectedMaxSupportedSpeakers: _oldSupportedMax,
      minimumAnchorAgreement: _oldMinimumAnchorAgreement,
      minimumSpeakerAnchorAgreement: _oldMinimumSpeakerAnchorAgreement,
      ...preserved
    } = window;
    const minimumAnchorAgreement = Math.max(0, Math.min(1, Number(source.minimumAnchorAgreement) || 0));
    const minimumSpeakerAnchorAgreement = Math.max(
      0,
      Math.min(1, Number(source.minimumSpeakerAnchorAgreement) || 0),
    );
    return {
      ...preserved,
      expectedMinSpeakers,
      ...(expectedMaxSpeakers > 0 ? { expectedMaxSpeakers } : {}),
      ...(expectedMinSupportedSpeakers > 0 ? { expectedMinSupportedSpeakers } : {}),
      ...(expectedMaxSupportedSpeakers > 0 ? { expectedMaxSupportedSpeakers } : {}),
      ...(minimumAnchorAgreement > 0 ? { minimumAnchorAgreement } : {}),
      ...(minimumSpeakerAnchorAgreement > 0 ? { minimumSpeakerAnchorAgreement } : {}),
      collapsed: expectedMinSpeakers > 1 && speakerCount < expectedMinSpeakers,
      fragmented: expectedMaxSpeakers > 0 && speakerCount > expectedMaxSpeakers,
      supportedCollapsed: expectedMinSupportedSpeakers > 0
        && supportedSpeakerCount < expectedMinSupportedSpeakers,
      supportedFragmented: expectedMaxSupportedSpeakers > 0
        && supportedSpeakerCount > expectedMaxSupportedSpeakers,
      anchorMismatch: (minimumAnchorAgreement > 0
        && (window.anchorAgreement?.agreement === null
          || finiteNumber(window.anchorAgreement?.agreement) === null
          || window.anchorAgreement.agreement < minimumAnchorAgreement))
        || (minimumSpeakerAnchorAgreement > 0
          && (window.anchorAgreement?.minimumSpeakerAgreement === null
            || finiteNumber(window.anchorAgreement?.minimumSpeakerAgreement) === null
            || window.anchorAgreement.minimumSpeakerAgreement < minimumSpeakerAnchorAgreement)),
    };
  });
  return summarizeDiarizationWindows(windows);
}

export function buildDiarizationTimeline(sources, silenceMs) {
  const gap = Math.max(0, Number(silenceMs) || 0);
  let cursor = 0;
  const windows = sources.map((source, index) => {
    const durationMs = Math.max(0, Number(source.durationMs) || 0);
    const expectedMinSupportedSpeakers = Math.max(0, Number(source.expectedMinSupportedSpeakers) || 0);
    const expectedMaxSupportedSpeakers = Math.max(0, Number(source.expectedMaxSupportedSpeakers) || 0);
    const window = {
      id: source.id,
      startMs: cursor,
      endMs: cursor + durationMs,
      expectedMinSpeakers: Math.max(0, Number(source.expectedMinSpeakers) || 0),
      ...(Math.max(0, Number(source.expectedMaxSpeakers) || 0) > 0
        ? { expectedMaxSpeakers: Math.max(0, Number(source.expectedMaxSpeakers) || 0) }
        : {}),
      ...(expectedMinSupportedSpeakers > 0 ? { expectedMinSupportedSpeakers } : {}),
      ...(expectedMaxSupportedSpeakers > 0 ? { expectedMaxSupportedSpeakers } : {}),
      ...(Array.isArray(source.referenceSpeakerAnchors)
        ? { referenceSpeakerAnchors: source.referenceSpeakerAnchors }
        : {}),
      ...(Math.max(0, Math.min(1, Number(source.minimumAnchorAgreement) || 0)) > 0
        ? { minimumAnchorAgreement: Math.max(0, Math.min(1, Number(source.minimumAnchorAgreement) || 0)) }
        : {}),
      ...(Math.max(0, Math.min(1, Number(source.minimumSpeakerAnchorAgreement) || 0)) > 0
        ? {
            minimumSpeakerAnchorAgreement: Math.max(
              0,
              Math.min(1, Number(source.minimumSpeakerAnchorAgreement) || 0),
            ),
          }
        : {}),
    };
    cursor = window.endMs + (index < sources.length - 1 ? gap : 0);
    return window;
  });
  return { durationMs: cursor, windows };
}

export function offsetTranscriptTokens(tokens, offsetMs) {
  const offset = Math.max(0, Number(offsetMs) || 0);
  return tokens.map((token) => ({
    ...token,
    ...(finiteNumber(token.start_ms) !== null ? { start_ms: token.start_ms + offset } : {}),
    ...(finiteNumber(token.end_ms) !== null ? { end_ms: token.end_ms + offset } : {}),
  }));
}

export function realtimePcmChunkBytes(durationMs) {
  const duration = Math.max(0, Number(durationMs) || 0);
  return Math.round(duration * PCM_BYTES_PER_MS);
}

function normalizeDiarizationContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  if (!Array.isArray(value.general) || value.general.length === 0 || value.general.length > 10) return undefined;
  const general = [];
  for (const item of value.general) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return undefined;
    if (typeof item.key !== "string" || typeof item.value !== "string") return undefined;
    const key = item.key.trim();
    const text = item.value.trim();
    if (!key || !text || key.length > 200 || text.length > 200) return undefined;
    general.push({ key, value: text });
  }
  return { general };
}

export function buildAsyncDiarizationConfig(fileId, reference, context) {
  const config = {
    model: "stt-async-v5",
    file_id: fileId,
    language_hints: ["ko", "ja", "en", "zh"],
    enable_language_identification: true,
    enable_speaker_diarization: true,
    client_reference_id: reference.slice(0, 256),
  };
  const normalizedContext = normalizeDiarizationContext(context);
  if (normalizedContext) config.context = normalizedContext;
  return config;
}

export function buildRealtimeDiarizationConfig(apiKey, options = {}) {
  const config = {
    api_key: apiKey,
    model: "stt-rt-v5",
    audio_format: "pcm_s16le",
    sample_rate: 16_000,
    num_channels: 1,
    language_hints: ["ko", "ja", "en", "zh"],
    enable_language_identification: true,
    enable_speaker_diarization: true,
  };
  if (options.endpointDetection) {
    config.enable_endpoint_detection = true;
    const sensitivity = finiteNumber(options.endpointSensitivity);
    if (sensitivity !== null && sensitivity >= -1 && sensitivity <= 1) {
      config.endpoint_sensitivity = sensitivity;
    }
    const maxDelay = finiteNumber(options.maxEndpointDelayMs);
    if (maxDelay !== null && maxDelay >= 500 && maxDelay <= 3_000) {
      config.max_endpoint_delay_ms = Math.round(maxDelay);
    }
  }
  const context = normalizeDiarizationContext(options.context);
  if (context) config.context = context;
  return config;
}

export function compareDiarizationRuns(continuous, isolated) {
  const isolatedById = new Map((isolated?.windows ?? []).map((window) => [window.id, window]));
  return (continuous?.windows ?? []).map((window) => {
    const separate = isolatedById.get(window.id);
    const continuousSpeakers = Number(window.speakerCount) || 0;
    const isolatedSpeakers = Number(separate?.speakerCount) || 0;
    const continuousFailed = diarizationIssue(window);
    const isolatedFailed = diarizationIssue(separate);
    return {
      id: window.id,
      continuousSpeakers,
      isolatedSpeakers,
      recoveredByReset: continuousFailed && !isolatedFailed && isolatedSpeakers !== continuousSpeakers,
    };
  });
}

function diarizationIssue(window) {
  return Boolean(window?.collapsed)
    || Boolean(window?.fragmented)
    || Boolean(window?.supportedCollapsed)
    || Boolean(window?.supportedFragmented)
    || Boolean(window?.anchorMismatch);
}

const SPEAKER_SHARE_DRIFT_THRESHOLD = 0.15;

function sortedSpeakerShareProfile(window) {
  const profile = (Array.isArray(window?.speakerStats) ? window.speakerStats : [])
    .map((speaker) => finiteNumber(speaker?.textShare) ?? finiteNumber(speaker?.durationShare))
    .filter((share) => share !== null && share >= 0)
    .sort((left, right) => right - left);
  return profile.length > 0 ? profile : null;
}

function speakerShareProfileDistance(left, right) {
  const length = Math.max(left.length, right.length);
  let difference = 0;
  for (let index = 0; index < length; index += 1) {
    difference += Math.abs((left[index] ?? 0) - (right[index] ?? 0));
  }
  return roundedShare(difference / 2);
}

export function analyzeDiarizationCycleStability(analysis, options = {}) {
  const issueForWindow = options.mode === "local" ? localDiarizationIssue : diarizationIssue;
  const groups = new Map();
  const unparsedWindowIds = [];
  for (const window of Array.isArray(analysis?.windows) ? analysis.windows : []) {
    const match = typeof window?.id === "string" ? window.id.match(/^cycle-(\d+)-(.+)$/u) : null;
    if (!match) {
      if (typeof window?.id === "string") unparsedWindowIds.push(window.id);
      continue;
    }
    const cycle = Number(match[1]);
    const sourceId = match[2];
    const speakerShareProfile = sortedSpeakerShareProfile(window);
    const item = {
      cycle,
      speakerCount: Number(window.speakerCount) || 0,
      supportedSpeakerCount: Number(window.supportedSpeakerCount) || 0,
      issue: issueForWindow(window),
      ...(speakerShareProfile ? { speakerShareProfile } : {}),
    };
    const current = groups.get(sourceId) ?? [];
    current.push(item);
    groups.set(sourceId, current);
  }
  const sources = [...groups.entries()].map(([sourceId, entries]) => {
    const cycles = [...entries].sort((left, right) => left.cycle - right.cycle);
    const rawSpeakerCounts = cycles.map((cycle) => cycle.speakerCount);
    const supportedSpeakerCounts = cycles.map((cycle) => cycle.supportedSpeakerCount);
    const issueCycles = cycles.filter((cycle) => cycle.issue).map((cycle) => cycle.cycle);
    const firstIssueCycle = issueCycles[0] ?? null;
    const lateRegression = cycles.length > 1 && !cycles[0].issue && issueCycles.length > 0;
    const firstShareProfile = cycles.find((cycle) => cycle.speakerShareProfile)?.speakerShareProfile;
    const shareProfileDistancesFromFirst = firstShareProfile
      ? cycles.map((cycle) => cycle.speakerShareProfile
        ? speakerShareProfileDistance(firstShareProfile, cycle.speakerShareProfile)
        : null)
      : [];
    const maxSpeakerShareDrift = shareProfileDistancesFromFirst.reduce(
      (maximum, distance) => distance === null ? maximum : Math.max(maximum, distance),
      0,
    );
    const shareProfileDrift = maxSpeakerShareDrift > SPEAKER_SHARE_DRIFT_THRESHOLD;
    return {
      sourceId,
      cycles,
      rawSpeakerCounts,
      supportedSpeakerCounts,
      issueCycles,
      firstIssueCycle,
      lateRegression,
      ...(shareProfileDistancesFromFirst.length > 0 ? {
        shareProfileDistancesFromFirst,
        maxSpeakerShareDrift,
        shareProfileDrift,
      } : {}),
      consistentRawCount: new Set(rawSpeakerCounts).size <= 1,
      consistentSupportedCount: new Set(supportedSpeakerCounts).size <= 1,
      passedAll: cycles.every((cycle) => !cycle.issue),
    };
  });
  return {
    sources,
    lateRegressionSourceIds: sources.filter((source) => source.lateRegression).map((source) => source.sourceId),
    shareProfileDriftSourceIds: sources.filter((source) => source.shareProfileDrift).map((source) => source.sourceId),
    unparsedWindowIds,
  };
}

function cycleStabilityIfPresent(analysis, options) {
  const result = analyzeDiarizationCycleStability(analysis, options);
  return result.sources.length > 0 ? result : undefined;
}

export function rescoreDiarizationReport(report, manifest) {
  const next = { ...report };
  if (report?.analysis) {
    next.analysis = rescoreDiarizationAnalysis(report.analysis, manifest);
    const cycleStability = cycleStabilityIfPresent(next.analysis);
    if (cycleStability) next.cycleStability = cycleStability;
    else delete next.cycleStability;
  }
  if (report?.continuous) next.continuous = rescoreDiarizationAnalysis(report.continuous, manifest);
  if (report?.isolated) next.isolated = rescoreDiarizationAnalysis(report.isolated, manifest);
  if (next.continuous && next.isolated) {
    next.comparison = compareDiarizationRuns(next.continuous, next.isolated);
    next.verdict = buildDiarizationQualityVerdict(next.continuous, next.isolated);
    const continuousCycleStability = cycleStabilityIfPresent(next.continuous);
    const isolatedCycleStability = cycleStabilityIfPresent(next.isolated);
    if (continuousCycleStability) next.continuousCycleStability = continuousCycleStability;
    else delete next.continuousCycleStability;
    if (isolatedCycleStability) next.isolatedCycleStability = isolatedCycleStability;
    else delete next.isolatedCycleStability;
  }
  return next;
}

export function rescoreLocalDiarizationReport(report) {
  const next = { ...report };
  if (report?.analysis) {
    next.analysis = summarizeLocalDiarizationWindows(report.analysis.windows);
    const cycleStability = cycleStabilityIfPresent(next.analysis, { mode: "local" });
    if (cycleStability) next.cycleStability = cycleStability;
    else delete next.cycleStability;
  }
  if (report?.continuous) {
    next.continuous = summarizeLocalDiarizationWindows(report.continuous.windows);
    const stability = cycleStabilityIfPresent(next.continuous, { mode: "local" });
    if (stability) next.continuousCycleStability = stability;
    else delete next.continuousCycleStability;
  }
  if (report?.isolated) {
    next.isolated = summarizeLocalDiarizationWindows(report.isolated.windows);
    const stability = cycleStabilityIfPresent(next.isolated, { mode: "local" });
    if (stability) next.isolatedCycleStability = stability;
    else delete next.isolatedCycleStability;
  }
  if (next.continuous && next.isolated) {
    const isolatedById = new Map(next.isolated.windows.map((window) => [window.id, window]));
    next.comparison = next.continuous.windows.map((window) => {
      const separate = isolatedById.get(window.id);
      const continuousIssue = next.continuous.issueWindowIds.includes(window.id);
      const isolatedIssue = !separate || next.isolated.issueWindowIds.includes(window.id);
      return {
        id: window.id,
        continuousSpeakers: window.speakerCount,
        isolatedSpeakers: separate?.speakerCount ?? 0,
        continuousSupportedSpeakers: window.supportedSpeakerCount,
        isolatedSupportedSpeakers: separate?.supportedSpeakerCount ?? 0,
        recoveredByReset: continuousIssue && !isolatedIssue,
      };
    });
    next.verdict = {
      passed: next.isolated.issueWindowIds.length === 0
        && next.isolated.windows.length === next.continuous.windows.length,
      continuousIssueIds: next.continuous.issueWindowIds,
      isolatedIssueIds: next.isolated.issueWindowIds,
      recoveredByResetIds: next.comparison
        .filter((window) => window.recoveredByReset)
        .map((window) => window.id),
    };
  }
  return next;
}

export function validateHybridLocalReport(manifestPath, manifest, localReport, scope, options = {}) {
  const expectedFingerprint = diarizationManifestFingerprint(manifest);
  const fingerprintMatches = typeof localReport?.manifestFingerprint === "string"
    && localReport.manifestFingerprint === expectedFingerprint;
  const localInputFingerprintMatches = typeof localReport?.localInputFingerprint === "string"
    && localReport.localInputFingerprint === localDiarizationInputFingerprint(manifest);
  const legacyPathMatches = localReport?.manifestFingerprint === undefined
    && typeof localReport?.manifest === "string"
    && resolve(localReport.manifest) === resolve(manifestPath);
  if (!fingerprintMatches && !localInputFingerprintMatches && !legacyPathMatches) {
    throw new Error("local_report_manifest_mismatch");
  }
  if (localReport?.scope !== scope) throw new Error("local_report_scope_mismatch");
  const sources = Array.isArray(manifest?.sources) ? manifest.sources : [];
  const expectedIds = sources.map((source) => source?.id);
  if (
    expectedIds.some((id) => typeof id !== "string")
    || new Set(expectedIds).size !== expectedIds.length
  ) throw new Error("invalid_manifest");
  const windows = Array.isArray(localReport?.analysis?.windows)
    ? localReport.analysis.windows
    : [];
  const actualIds = windows.map((window) => window?.id);
  if (
    actualIds.some((id) => typeof id !== "string")
    || new Set(actualIds).size !== actualIds.length
    || actualIds.length !== expectedIds.length
    || expectedIds.some((id) => !actualIds.includes(id))
  ) throw new Error("local_report_source_mismatch");
  const rescored = summarizeLocalDiarizationWindows(windows);
  if (!options.allowQualityIssues && (
    rescored.issueWindowIds.length > 0
    || (
      Array.isArray(localReport?.analysis?.issueWindowIds)
      && localReport.analysis.issueWindowIds.length > 0
    )
  )) throw new Error("local_report_quality_failed");
  return windows;
}

export function selectHybridLocalDiarizationWindows(manifest, reports) {
  const sources = Array.isArray(manifest?.sources) ? manifest.sources : [];
  return sources.map((source) => {
    const candidates = (Array.isArray(reports) ? reports : []).flatMap((report) => {
      const window = (Array.isArray(report?.windows) ? report.windows : [])
        .find((candidate) => candidate?.id === source.id);
      return window ? [{ ...window, localScope: report.scope }] : [];
    });
    const selected = candidates.find((candidate) => !localDiarizationIssue({
      ...candidate,
      expectedMinSpeakers: source.expectedMinSpeakers,
      expectedMaxSpeakers: source.expectedMaxSpeakers,
      expectedMinSupportedSpeakers: source.expectedMinSupportedSpeakers,
      expectedMaxSupportedSpeakers: source.expectedMaxSupportedSpeakers,
    }));
    if (!selected) throw new Error("local_report_quality_failed");
    return selected;
  });
}

export function selectDiarizationCandidateByConsensus(
  cloudWindow,
  candidates,
  resetCloudWindow,
  realtimeCandidate,
) {
  const cloudSpeakerCount = Math.max(0, Number(cloudWindow?.speakerCount) || 0);
  const usable = (Array.isArray(candidates) ? candidates : []).flatMap((candidate) => {
    const supportedSpeakerIds = Array.isArray(candidate?.window?.supportedSpeakerIds)
      ? candidate.window.supportedSpeakerIds.map(String)
      : [];
    const supportedSpeakerCount = Math.max(
      supportedSpeakerIds.length,
      Number(candidate?.window?.supportedSpeakerCount) || 0,
    );
    if (!candidate?.label || supportedSpeakerCount <= 0) return [];
    return [{ ...candidate, supportedSpeakerIds, supportedSpeakerCount }];
  });
  const resetCloudSpeakerCount = Math.max(0, Number(resetCloudWindow?.speakerCount) || 0);
  if (
    realtimeCandidate?.label
    && chooseDiarizationModel(resetCloudWindow, realtimeCandidate.window).model === "realtime"
  ) {
    const selectedSpeakerIds = Array.isArray(realtimeCandidate.window?.supportedSpeakerIds)
      ? realtimeCandidate.window.supportedSpeakerIds.map(String)
      : Array.isArray(realtimeCandidate.window?.speakerIds)
        ? realtimeCandidate.window.speakerIds.map(String)
        : [];
    if (selectedSpeakerIds.length >= 2) {
      return {
        id: cloudWindow?.id,
        resolved: true,
        reason: "realtime_supported_turn_after_async_collapse",
        candidateLabel: realtimeCandidate.label,
        selectedSpeakerCount: selectedSpeakerIds.length,
        selectedSpeakerIds,
        continuousCloudSpeakerCount: cloudSpeakerCount,
        resetCloudSpeakerCount,
      };
    }
  }
  if (resetCloudSpeakerCount > 0 && usable.length > 0) {
    const votes = usable.map((candidate) => {
      const speakerIds = Array.isArray(candidate?.window?.speakerIds)
        ? candidate.window.speakerIds.map(String)
        : [];
      const speakerCount = Math.max(speakerIds.length, Number(candidate?.window?.speakerCount) || 0);
      const promoteSingleWeakSpeaker = speakerCount === resetCloudSpeakerCount
        && speakerCount === candidate.supportedSpeakerCount + 1
        && speakerIds.length === speakerCount;
      const rankedSpeakerIds = (Array.isArray(candidate?.window?.speakerStats)
        ? candidate.window.speakerStats
        : [])
        .flatMap((speaker) => {
          const speakerId = typeof speaker?.speakerId === "string" || typeof speaker?.speakerId === "number"
            ? String(speaker.speakerId)
            : "";
          const durationMs = Math.max(0, Number(speaker?.durationMs) || 0);
          return speakerId && speakerIds.includes(speakerId) ? [{ speakerId, durationMs }] : [];
        })
        .sort((left, right) => right.durationMs - left.durationMs || left.speakerId.localeCompare(right.speakerId, "en", { numeric: true }))
        .slice(0, resetCloudSpeakerCount)
        .map((speaker) => speaker.speakerId);
      const recoverFragmentedWeakSpeakers = resetCloudSpeakerCount > candidate.supportedSpeakerCount
        && speakerCount >= resetCloudSpeakerCount
        && rankedSpeakerIds.length === resetCloudSpeakerCount
        && candidate.supportedSpeakerIds.every((speakerId) => rankedSpeakerIds.includes(speakerId));
      const promotedSpeakerIds = recoverFragmentedWeakSpeakers ? rankedSpeakerIds : speakerIds;
      const promoteWeakSpeaker = promoteSingleWeakSpeaker || recoverFragmentedWeakSpeakers;
      return {
        ...candidate,
        voteCount: recoverFragmentedWeakSpeakers
          ? resetCloudSpeakerCount
          : promoteSingleWeakSpeaker
            ? speakerCount
            : candidate.supportedSpeakerCount,
        selectedSpeakerIds: promoteWeakSpeaker ? promotedSpeakerIds : candidate.supportedSpeakerIds,
      };
    });
    const countFrequency = new Map([[resetCloudSpeakerCount, 1]]);
    for (const candidate of votes) {
      countFrequency.set(candidate.voteCount, (countFrequency.get(candidate.voteCount) ?? 0) + 1);
    }
    const realtimeSpeakerIdsForPlateau = Array.isArray(realtimeCandidate?.window?.speakerIds)
      ? realtimeCandidate.window.speakerIds.map(String)
      : [];
    const realtimeSpeakerCountForPlateau = Math.max(
      realtimeSpeakerIdsForPlateau.length,
      Number(realtimeCandidate?.window?.speakerCount) || 0,
    );
    const localVoteCountSet = new Set(votes.map((candidate) => candidate.voteCount));
    const singleExtraSpeakerCount = resetCloudSpeakerCount + 1;
    const singleExtraCandidates = votes
      .filter((candidate) => (
        candidate.voteCount === singleExtraSpeakerCount
        && candidate.supportedSpeakerCount === singleExtraSpeakerCount
      ))
      .sort((left, right) => Number(left.threshold) - Number(right.threshold));
    const resetCountCandidates = votes.filter((candidate) => candidate.voteCount === resetCloudSpeakerCount);
    const singleExtraThresholds = singleExtraCandidates.map((candidate) => Number(candidate.threshold));
    const distinctSingleExtraThresholds = [...new Set(singleExtraThresholds)];
    const adjacentSingleExtraThresholds = distinctSingleExtraThresholds.length >= 3
      && distinctSingleExtraThresholds.every(Number.isFinite)
      && distinctSingleExtraThresholds.at(-1) - distinctSingleExtraThresholds[0] >= 0.02
      && distinctSingleExtraThresholds.slice(1).every((threshold, index) => (
        threshold - distinctSingleExtraThresholds[index] <= 0.011
      ));
    const localEmbeddingModels = new Set(votes.map((candidate) => candidate.embeddingModel));
    const singleExtraCandidatesAreStrong = singleExtraCandidates.length >= 3
      && singleExtraCandidates.every((candidate) => {
        const speakerIds = Array.isArray(candidate?.window?.speakerIds)
          ? candidate.window.speakerIds.map(String)
          : [];
        const speakerCount = Math.max(speakerIds.length, Number(candidate?.window?.speakerCount) || 0);
        const stats = Array.isArray(candidate?.window?.speakerStats)
          ? candidate.window.speakerStats
          : [];
        const durationBySpeaker = new Map(stats.flatMap((speaker) => {
          const speakerId = typeof speaker?.speakerId === "string" || typeof speaker?.speakerId === "number"
            ? String(speaker.speakerId)
            : "";
          return speakerId ? [[speakerId, Math.max(0, Number(speaker.durationMs) || 0)]] : [];
        }));
        const weakDurationMs = stats.reduce((total, speaker) => {
          const speakerId = typeof speaker?.speakerId === "string" || typeof speaker?.speakerId === "number"
            ? String(speaker.speakerId)
            : "";
          return candidate.supportedSpeakerIds.includes(speakerId)
            ? total
            : total + Math.max(0, Number(speaker.durationMs) || 0);
        }, 0);
        return candidate.supportedSpeakerIds.length === singleExtraSpeakerCount
          && candidate.supportedSpeakerIds.every((speakerId) => (
            (durationBySpeaker.get(speakerId) ?? 0) >= 10_000
          ))
          && speakerCount <= singleExtraSpeakerCount + 1
          && weakDurationMs <= 1_000;
      });
    if (
      realtimeCandidate?.label
      && realtimeSpeakerCountForPlateau === resetCloudSpeakerCount
      && localVoteCountSet.size === 2
      && localVoteCountSet.has(resetCloudSpeakerCount)
      && localVoteCountSet.has(singleExtraSpeakerCount)
      && resetCountCandidates.length >= 1
      && adjacentSingleExtraThresholds
      && localEmbeddingModels.size === 1
      && !localEmbeddingModels.has(undefined)
      && singleExtraCandidatesAreStrong
    ) {
      const selected = singleExtraCandidates[0];
      return {
        id: cloudWindow?.id,
        resolved: true,
        reason: "local_stable_single_extra_speaker",
        candidateLabel: selected.label,
        selectedSpeakerCount: selected.supportedSpeakerIds.length,
        selectedSpeakerIds: selected.supportedSpeakerIds,
        continuousCloudSpeakerCount: cloudSpeakerCount,
        resetCloudSpeakerCount,
        realtimeSpeakerCount: realtimeSpeakerCountForPlateau,
        voteCounts: [...countFrequency.entries()].map(([count, votesForCount]) => ({
          count,
          votes: votesForCount,
        })),
      };
    }
    const ranked = [...countFrequency.entries()]
      .sort((left, right) => right[1] - left[1] || left[0] - right[0]);
    const maximumVotes = ranked[0]?.[1] ?? 0;
    const leaders = ranked.filter(([, count]) => count === maximumVotes).map(([count]) => count);
    const localVoteCounts = votes.map((candidate) => candidate.voteCount);
    const unanimousLocalCount = new Set(localVoteCounts).size === 1
      ? localVoteCounts[0]
      : null;
    const localUnanimousOverride = unanimousLocalCount !== null
      && unanimousLocalCount !== resetCloudSpeakerCount;
    const selectedCount = localUnanimousOverride
      ? unanimousLocalCount
      : resetCloudSpeakerCount;
    const resetOverNonunanimousLocal = !localUnanimousOverride
      && ranked[0]?.[0] !== resetCloudSpeakerCount;
    const selected = votes.find((candidate) => candidate.voteCount === selectedCount);
    if (selected) {
      const realtimeSpeakerIds = Array.isArray(realtimeCandidate?.window?.speakerIds)
        ? realtimeCandidate.window.speakerIds.map(String)
        : [];
      const realtimeSupportedSpeakerIds = Array.isArray(realtimeCandidate?.window?.supportedSpeakerIds)
        ? realtimeCandidate.window.supportedSpeakerIds.map(String)
        : [];
      const realtimeSpeakerCount = Math.max(
        realtimeSpeakerIds.length,
        Number(realtimeCandidate?.window?.speakerCount) || 0,
      );
      const realtimeSupportedSpeakerCount = Math.max(
        realtimeSupportedSpeakerIds.length,
        Number(realtimeCandidate?.window?.supportedSpeakerCount) || 0,
      );
      if (
        realtimeCandidate?.label
        && selected.supportedSpeakerCount < selected.selectedSpeakerIds.length
        && realtimeSpeakerCount === selected.selectedSpeakerIds.length
        && realtimeSupportedSpeakerCount === selected.selectedSpeakerIds.length
        && realtimeSupportedSpeakerIds.length === selected.selectedSpeakerIds.length
      ) {
        return {
          id: cloudWindow?.id,
          resolved: true,
          reason: "realtime_supported_count_over_weak_local",
          candidateLabel: realtimeCandidate.label,
          selectedSpeakerCount: realtimeSupportedSpeakerIds.length,
          selectedSpeakerIds: realtimeSupportedSpeakerIds,
          continuousCloudSpeakerCount: cloudSpeakerCount,
          resetCloudSpeakerCount,
        };
      }
      return {
        id: cloudWindow?.id,
        resolved: true,
        reason: localUnanimousOverride
          ? "local_unanimous_override_reset_cloud"
          : resetOverNonunanimousLocal
            ? "reset_cloud_over_nonunanimous_local"
            : leaders.length > 1
              ? "reset_cloud_local_vote_tiebreak"
              : "reset_cloud_local_vote",
        candidateLabel: selected.label,
        selectedSpeakerCount: selected.selectedSpeakerIds.length,
        selectedSpeakerIds: selected.selectedSpeakerIds,
        continuousCloudSpeakerCount: cloudSpeakerCount,
        resetCloudSpeakerCount,
        voteCounts: [...countFrequency.entries()].map(([count, votesForCount]) => ({
          count,
          votes: votesForCount,
        })),
      };
    }
    if (selectedCount === resetCloudSpeakerCount) {
      const resetSpeakerIds = Array.isArray(resetCloudWindow?.speakerIds)
        ? resetCloudWindow.speakerIds.map(String)
        : [];
      const resetSupportedSpeakerIds = Array.isArray(resetCloudWindow?.supportedSpeakerIds)
        ? resetCloudWindow.supportedSpeakerIds.map(String)
        : [];
      const selectedSpeakerIds = resetSpeakerIds.length === resetCloudSpeakerCount
        ? resetSpeakerIds
        : resetSupportedSpeakerIds.length === resetCloudSpeakerCount
          ? resetSupportedSpeakerIds
          : [];
      if (selectedSpeakerIds.length === resetCloudSpeakerCount) {
        return {
          id: cloudWindow?.id,
          resolved: true,
          reason: "reset_cloud_over_nonunanimous_local",
          candidateLabel: "reset-cloud",
          selectedSpeakerCount: selectedSpeakerIds.length,
          selectedSpeakerIds,
          continuousCloudSpeakerCount: cloudSpeakerCount,
          resetCloudSpeakerCount,
          voteCounts: [...countFrequency.entries()].map(([count, votesForCount]) => ({
            count,
            votes: votesForCount,
          })),
        };
      }
    }
  }
  const supportedMatch = usable.find((candidate) => (
    cloudSpeakerCount > 0 && candidate.supportedSpeakerCount === cloudSpeakerCount
  ));
  if (supportedMatch) {
    return {
      id: cloudWindow?.id,
      resolved: true,
      reason: "cloud_local_supported_count_agreement",
      candidateLabel: supportedMatch.label,
      selectedSpeakerCount: supportedMatch.supportedSpeakerCount,
      selectedSpeakerIds: supportedMatch.supportedSpeakerIds,
    };
  }
  const rawMatch = usable.find((candidate) => {
    const speakerIds = Array.isArray(candidate?.window?.speakerIds)
      ? candidate.window.speakerIds.map(String)
      : [];
    const speakerCount = Math.max(speakerIds.length, Number(candidate?.window?.speakerCount) || 0);
    return cloudSpeakerCount > 0
      && speakerCount === cloudSpeakerCount
      && speakerCount === candidate.supportedSpeakerCount + 1
      && speakerIds.length === speakerCount;
  });
  if (rawMatch) {
    const speakerIds = rawMatch.window.speakerIds.map(String);
    return {
      id: cloudWindow?.id,
      resolved: true,
      reason: "cloud_local_raw_count_agreement",
      candidateLabel: rawMatch.label,
      selectedSpeakerCount: speakerIds.length,
      selectedSpeakerIds: speakerIds,
    };
  }
  const countFrequency = new Map();
  for (const candidate of usable) {
    countFrequency.set(
      candidate.supportedSpeakerCount,
      (countFrequency.get(candidate.supportedSpeakerCount) ?? 0) + 1,
    );
  }
  const ranked = [...countFrequency.entries()]
    .sort((left, right) => right[1] - left[1] || left[0] - right[0]);
  if (ranked[0]?.[1] >= 2 && ranked[0][1] > (ranked[1]?.[1] ?? 0)) {
    const count = ranked[0][0];
    const selected = usable.find((candidate) => candidate.supportedSpeakerCount === count);
    return {
      id: cloudWindow?.id,
      resolved: true,
      reason: "local_threshold_consensus",
      candidateLabel: selected.label,
      selectedSpeakerCount: count,
      selectedSpeakerIds: selected.supportedSpeakerIds,
    };
  }
  return {
    id: cloudWindow?.id,
    resolved: false,
    reason: "no_consensus",
    cloudSpeakerCount,
    localSupportedSpeakerCounts: usable.map((candidate) => ({
      label: candidate.label,
      count: candidate.supportedSpeakerCount,
    })),
  };
}

export function buildDiarizationConsensusReport(
  cloudAnalysis,
  localReports,
  resetCloudAnalysis,
  realtimeReport,
) {
  const selections = (Array.isArray(cloudAnalysis?.windows) ? cloudAnalysis.windows : []).map((cloudWindow) => (
    selectDiarizationCandidateByConsensus(
      cloudWindow,
      (Array.isArray(localReports) ? localReports : []).map((report) => ({
        label: report.label,
        threshold: finiteNumber(report?.threshold ?? report?.report?.threshold),
        embeddingModel: report?.embeddingModel ?? report?.report?.embeddingModel,
        window: (Array.isArray(report?.windows) ? report.windows : [])
          .find((candidate) => candidate?.id === cloudWindow.id),
      })),
      (Array.isArray(resetCloudAnalysis?.windows) ? resetCloudAnalysis.windows : [])
        .find((candidate) => candidate?.id === cloudWindow.id),
      realtimeReport
        ? {
            label: realtimeReport.label,
            window: (Array.isArray(realtimeReport.windows) ? realtimeReport.windows : [])
              .find((candidate) => candidate?.id === cloudWindow.id),
          }
        : undefined,
    )
  ));
  return {
    selections,
    resolvedWindowIds: selections.filter((selection) => selection.resolved).map((selection) => selection.id),
    unresolvedWindowIds: selections.filter((selection) => !selection.resolved).map((selection) => selection.id),
  };
}

export function materializeDiarizationConsensusWindows(consensus, localReports) {
  const unresolvedWindowIds = Array.isArray(consensus?.unresolvedWindowIds)
    ? consensus.unresolvedWindowIds
    : [];
  if (unresolvedWindowIds.length > 0) throw new Error("diarization_consensus_unresolved");
  return (Array.isArray(consensus?.selections) ? consensus.selections : []).map((selection) => {
    if (!selection?.resolved || typeof selection?.candidateLabel !== "string") {
      throw new Error("diarization_consensus_unresolved");
    }
    const report = (Array.isArray(localReports) ? localReports : [])
      .find((candidate) => candidate?.label === selection.candidateLabel);
    const window = (Array.isArray(report?.windows) ? report.windows : [])
      .find((candidate) => candidate?.id === selection.id);
    if (!window || !Array.isArray(window.speakerRuns)) {
      throw new Error("local_report_window_missing");
    }
    return {
      ...window,
      localScope: report.scope,
      consensusCandidateLabel: selection.candidateLabel,
      supportedSpeakerIds: selection.selectedSpeakerIds.map(String),
      supportedSpeakerCount: selection.selectedSpeakerIds.length,
    };
  });
}

export function normalizeLocalSpeakerRunsForScope(runs, localScope, targetScope, windowStartMs) {
  const offsetSeconds = (Number(windowStartMs) || 0) / 1_000;
  return (Array.isArray(runs) ? runs : []).map((run) => {
    const localStartSeconds = Number(run.startMs) / 1_000;
    const localEndSeconds = Number(run.endMs) / 1_000;
    const start = localScope === targetScope
      ? localStartSeconds
      : localScope === "isolated"
        ? localStartSeconds + offsetSeconds
        : localStartSeconds - offsetSeconds;
    const end = localScope === targetScope
      ? localEndSeconds
      : localScope === "isolated"
        ? localEndSeconds + offsetSeconds
        : localEndSeconds - offsetSeconds;
    return { start, end, speaker: run.speakerId };
  });
}

export function buildDiarizationQualityVerdict(continuous, isolated) {
  const continuousWindows = Array.isArray(continuous?.windows) ? continuous.windows : [];
  const isolatedWindows = Array.isArray(isolated?.windows) ? isolated.windows : [];
  const isolatedById = new Map(isolatedWindows.map((window) => [window.id, window]));
  const continuousIssueIds = continuousWindows.filter(diarizationIssue).map((window) => window.id);
  const isolatedIssueIds = isolatedWindows.filter(diarizationIssue).map((window) => window.id);
  const missingIsolatedWindowIds = continuousWindows
    .filter((window) => !isolatedById.has(window.id))
    .map((window) => window.id);
  const recoveredByResetIds = compareDiarizationRuns(continuous, isolated)
    .filter((window) => window.recoveredByReset)
    .map((window) => window.id);
  return {
    passed: isolatedIssueIds.length === 0 && missingIsolatedWindowIds.length === 0,
    continuousIssueIds,
    isolatedIssueIds,
    recoveredByResetIds,
    unresolvedIssueIds: [...new Set(isolatedIssueIds)],
    missingIsolatedWindowIds,
  };
}

export function resolveDiarizationScope(value, fallback) {
  const scope = value ?? fallback;
  if (!new Set(["continuous", "isolated", "both"]).has(scope)) throw new Error("invalid_scope");
  return scope;
}

export function chooseDiarizationModel(asyncWindow, realtimeWindow, options = {}) {
  const asyncSpeakers = Number(asyncWindow?.speakerCount) || 0;
  if (asyncSpeakers >= 2) {
    return { model: "async", reason: "async_multi_speaker_preferred" };
  }
  if (asyncSpeakers !== 1) {
    return { model: "async", reason: "async_result_unavailable" };
  }

  const minimumShare = finiteNumber(options.minimumSecondaryTextShare) ?? 0.1;
  const minimumDurationMs = finiteNumber(options.minimumSecondaryDurationMs) ?? 2_000;
  const realtimeSpeakers = Number(realtimeWindow?.speakerCount) || 0;
  const expectedMaxSpeakers = Math.max(
    0,
    Number(realtimeWindow?.expectedMaxSpeakers ?? asyncWindow?.expectedMaxSpeakers) || 0,
  );
  if (expectedMaxSpeakers > 0 && realtimeSpeakers > expectedMaxSpeakers) {
    return { model: "async", reason: "realtime_overfragmented" };
  }
  const supportedSpeakers = (Array.isArray(realtimeWindow?.speakerStats) ? realtimeWindow.speakerStats : [])
    .filter((speaker) => (
      (finiteNumber(speaker?.textShare) ?? 0) >= minimumShare
      && (finiteNumber(speaker?.lastMs) ?? 0) - (finiteNumber(speaker?.firstMs) ?? 0) >= minimumDurationMs
    ));
  if (realtimeSpeakers >= 2 && supportedSpeakers.length >= 2) {
    return { model: "realtime", reason: "supported_turn_after_async_collapse" };
  }
  return { model: "async", reason: "realtime_secondary_speaker_too_weak" };
}

export function compareDiarizationCandidates(asyncAnalysis, realtimeAnalysis, options = {}) {
  const asyncWindows = Array.isArray(asyncAnalysis?.windows) ? asyncAnalysis.windows : [];
  const realtimeWindows = Array.isArray(realtimeAnalysis?.windows) ? realtimeAnalysis.windows : [];
  const realtimeById = new Map(realtimeWindows.map((window) => [window.id, window]));
  const missingRealtimeWindowIds = [];
  const unresolvedWindowIds = [];
  const decisions = asyncWindows.map((asyncWindow) => {
    const realtimeWindow = realtimeById.get(asyncWindow.id);
    if (!realtimeWindow) missingRealtimeWindowIds.push(asyncWindow.id);
    const selection = realtimeWindow
      ? chooseDiarizationModel(asyncWindow, realtimeWindow, options)
      : { model: "async", reason: "realtime_result_unavailable" };
    const selectedWindow = selection.model === "realtime" ? realtimeWindow : asyncWindow;
    if (diarizationIssue(selectedWindow)) unresolvedWindowIds.push(asyncWindow.id);
    return {
      id: asyncWindow.id,
      ...selection,
      asyncSpeakers: Number(asyncWindow.speakerCount) || 0,
      realtimeSpeakers: Number(realtimeWindow?.speakerCount) || 0,
    };
  });
  return { decisions, missingRealtimeWindowIds, unresolvedWindowIds };
}

export function waitForPromiseWithTimeout(promise, timeoutMs, errorCode) {
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(errorCode)), timeoutMs);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timeout));
}

function printUsage() {
  process.stdout.write([
    "사용법:",
    "  node scripts/diarization-quality.mjs run-async --manifest evals/youtube-diarization-manifest.json --clips-dir <다운로드 폴더> --output-dir <결과 폴더> --scope both",
    "  node scripts/diarization-quality.mjs run-realtime --manifest evals/youtube-diarization-manifest.json --clips-dir <다운로드 폴더> --output-dir <결과 폴더> --endpoint-detection true --endpoint-sensitivity -0.8 --max-endpoint-delay-ms 3000 --scope continuous",
    "  node scripts/diarization-quality.mjs run-realtime --manifest evals/youtube-diarization-manifest.json --clips-dir <다운로드 폴더> --output-dir <결과 폴더> --endpoint-detection true --scope both",
    "  node scripts/diarization-quality.mjs run-local --manifest evals/youtube-diarization-manifest.json --clips-dir <다운로드 폴더> --output-dir <결과 폴더> --sherpa-module <모듈 경로> --segmentation-model <모델 경로> --embedding-model <모델 경로>",
    "  node scripts/diarization-quality.mjs run-hybrid --manifest evals/youtube-diarization-manifest.json --clips-dir <다운로드 폴더> --output-dir <결과 폴더> --local-report <로컬 보고서> [--fallback-local-report <보완 로컬 보고서> | --consensus-local-reports <쉼표로 구분한 추가 로컬 보고서> [--realtime-report <경계별 실시간 보고서>]]",
    "  node scripts/diarization-quality.mjs rescore-report --report <기존 보고서> --manifest <최신 manifest> --output <새 보고서>",
    "  node scripts/diarization-quality.mjs rescore-local-report --report <기존 로컬 보고서> --output <새 보고서>",
    "",
    "원본 영상 파일은 test-results 아래에만 두며 저장소에는 포함하지 않습니다.",
    "",
  ].join("\n"));
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error("invalid_arguments");
    flags[key.slice(2)] = value;
  }
  return { command, flags };
}

function parseEnv(contents) {
  const values = {};
  for (const line of contents.split(/\r?\n/u)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

async function loadApiKey() {
  if (process.env.SONIOX_API_KEY?.trim()) return process.env.SONIOX_API_KEY.trim();
  try {
    const values = parseEnv(await readFile(resolve(".env.local"), "utf8"));
    if (values.SONIOX_API_KEY?.trim()) return values.SONIOX_API_KEY.trim();
  } catch {
    // Report one stable local code below. Never include credential or provider response details.
  }
  throw new Error("soniox_key_missing");
}

async function runCommand(command, args) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 8_000) stderr += String(chunk);
    });
    child.once("error", () => reject(new Error("media_command_unavailable")));
    child.once("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(stderr.includes("No such file") ? "media_input_missing" : "media_command_failed"));
    });
  });
}

async function pcmFromClip(input, output) {
  await runCommand("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-i", input,
    "-vn", "-ac", "1", "-ar", String(PCM_SAMPLE_RATE), "-f", "s16le", output,
  ]);
  const bytes = await readFile(output);
  return { bytes, durationMs: Math.floor(bytes.byteLength / PCM_BYTES_PER_MS) };
}

async function wavFromPcm(input, output) {
  await runCommand("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "s16le", "-ar", String(PCM_SAMPLE_RATE), "-ac", "1", "-i", input,
    "-c:a", "pcm_s16le", output,
  ]);
}

async function safeJson(response) {
  let value;
  try {
    value = await response.json();
  } catch {
    throw new Error("soniox_invalid_response");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("soniox_invalid_response");
  return value;
}

async function apiFetch(apiKey, path, init = {}) {
  const response = await fetch(`${SONIOX_API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${apiKey}`, ...init.headers },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`soniox_status_${response.status}`);
  return response;
}

async function deleteRemote(apiKey, path) {
  try {
    await apiFetch(apiKey, path, { method: "DELETE" });
  } catch {
    // Best effort for an eval-only remote resource. The caller never treats cleanup as quality data.
  }
}

async function transcribeAsync(apiKey, audioPath, reference, options = {}) {
  let fileId;
  let transcriptionId;
  try {
    const form = new FormData();
    form.append("file", new Blob([await readFile(audioPath)]), basename(audioPath));
    const uploaded = await safeJson(await apiFetch(apiKey, "/files", { method: "POST", body: form }));
    if (typeof uploaded.id !== "string") throw new Error("soniox_invalid_file_id");
    fileId = uploaded.id;
    const created = await safeJson(await apiFetch(apiKey, "/transcriptions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildAsyncDiarizationConfig(fileId, reference, options.context)),
    }));
    if (typeof created.id !== "string") throw new Error("soniox_invalid_transcription_id");
    transcriptionId = created.id;
    const deadline = Date.now() + MAX_POLL_MS;
    while (Date.now() < deadline) {
      const status = await safeJson(await apiFetch(apiKey, `/transcriptions/${encodeURIComponent(transcriptionId)}`));
      if (status.status === "completed") break;
      if (status.status === "error") throw new Error("soniox_transcription_failed");
      await new Promise((resolvePromise) => setTimeout(resolvePromise, POLL_INTERVAL_MS));
    }
    if (Date.now() >= deadline) throw new Error("soniox_transcription_timeout");
    const transcript = await safeJson(await apiFetch(
      apiKey,
      `/transcriptions/${encodeURIComponent(transcriptionId)}/transcript`,
    ));
    if (!Array.isArray(transcript.tokens)) throw new Error("soniox_invalid_transcript");
    return transcript.tokens;
  } finally {
    if (transcriptionId) await deleteRemote(apiKey, `/transcriptions/${encodeURIComponent(transcriptionId)}`);
    if (fileId) await deleteRemote(apiKey, `/files/${encodeURIComponent(fileId)}`);
  }
}

function realtimeToken(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.text !== "string") return null;
  return {
    text: value.text,
    is_final: value.is_final === true,
    ...(finiteNumber(value.start_ms) !== null ? { start_ms: value.start_ms } : {}),
    ...(finiteNumber(value.end_ms) !== null ? { end_ms: value.end_ms } : {}),
    ...(typeof value.speaker === "string" || typeof value.speaker === "number" ? { speaker: value.speaker } : {}),
    ...(typeof value.language === "string" ? { language: value.language } : {}),
    ...(typeof value.translation_status === "string" ? { translation_status: value.translation_status } : {}),
  };
}

async function transcribeRealtime(apiKey, pcmPath, options) {
  const pcm = await readFile(pcmPath);
  const socket = new WebSocket("wss://stt-rt.soniox.com/transcribe-websocket");
  socket.binaryType = "arraybuffer";
  let terminalError = null;
  let finished = false;
  const finalTokens = [];
  let resolveFinished;
  let rejectFinished;
  const finishedPromise = new Promise((resolvePromise, reject) => {
    resolveFinished = resolvePromise;
    rejectFinished = reject;
  });
  const fail = (code) => {
    if (terminalError || finished) return;
    terminalError = new Error(code);
    rejectFinished(terminalError);
  };
  socket.addEventListener("message", (event) => {
    try {
      const result = JSON.parse(String(event.data));
      if (typeof result.error_code === "number") {
        fail(`soniox_realtime_error_${result.error_code}`);
        return;
      }
      for (const candidate of Array.isArray(result.tokens) ? result.tokens : []) {
        const token = realtimeToken(candidate);
        if (token?.is_final && token.text !== "<end>" && token.text !== "<fin>") finalTokens.push(token);
      }
      if (result.finished === true && !finished) {
        finished = true;
        resolveFinished();
      }
    } catch {
      fail("soniox_realtime_invalid_response");
    }
  });
  socket.addEventListener("error", () => fail("soniox_realtime_connection_error"));
  socket.addEventListener("close", () => {
    if (!finished) fail("soniox_realtime_closed_early");
  });
  await new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => reject(new Error("soniox_realtime_connect_timeout")), 15_000);
    socket.addEventListener("open", () => {
      clearTimeout(timeout);
      resolvePromise();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("soniox_realtime_connection_error"));
    }, { once: true });
  });
  socket.send(JSON.stringify(buildRealtimeDiarizationConfig(apiKey, options)));

  const chunkDurationMs = 100;
  const chunkBytes = realtimePcmChunkBytes(chunkDurationMs);
  const startedAt = performance.now();
  let nextProgressAt = 30_000;
  try {
    for (let offset = 0; offset < pcm.byteLength; offset += chunkBytes) {
      if (terminalError) throw terminalError;
      const targetElapsed = (offset / PCM_BYTES_PER_MS);
      const waitMs = targetElapsed - (performance.now() - startedAt);
      if (waitMs > 0) await new Promise((resolvePromise) => setTimeout(resolvePromise, waitMs));
      if (socket.readyState !== 1) throw new Error("soniox_realtime_closed_early");
      socket.send(pcm.subarray(offset, Math.min(pcm.byteLength, offset + chunkBytes)));
      if (targetElapsed >= nextProgressAt) {
        process.stdout.write(`실시간 입력 진행: ${Math.round(targetElapsed / 1_000)}초 / ${Math.round(pcm.byteLength / PCM_BYTES_PER_MS / 1_000)}초\n`);
        nextProgressAt += 30_000;
      }
    }
    socket.send("");
    await waitForPromiseWithTimeout(finishedPromise, 30_000, "soniox_realtime_finish_timeout");
    return finalTokens;
  } finally {
    socket.close();
  }
}

async function prepareAudio(manifest, clipsDir, outputDir) {
  const pcmDir = join(outputDir, "pcm");
  const wavDir = join(outputDir, "wav");
  await mkdir(pcmDir, { recursive: true });
  await mkdir(wavDir, { recursive: true });
  const prepared = [];
  for (const [index, source] of manifest.sources.entries()) {
    if (typeof source.file !== "string" || typeof source.id !== "string") throw new Error("invalid_manifest");
    const input = resolve(clipsDir, source.file);
    await access(input);
    const pcmPath = join(pcmDir, `${String(index + 1).padStart(2, "0")}-${source.id}.pcm`);
    const wavPath = join(wavDir, `${String(index + 1).padStart(2, "0")}-${source.id}.wav`);
    const pcm = await pcmFromClip(input, pcmPath);
    await wavFromPcm(pcmPath, wavPath);
    prepared.push({ ...source, ...pcm, pcmPath, wavPath });
  }
  const silenceMs = Math.max(0, Number(manifest.silenceMs) || 0);
  const silence = Buffer.alloc(Math.round(silenceMs * PCM_BYTES_PER_MS));
  const timelineChunks = [];
  for (const [index, source] of prepared.entries()) {
    timelineChunks.push(source.bytes);
    if (index < prepared.length - 1) timelineChunks.push(silence);
  }
  const timelinePcm = join(outputDir, "timeline.pcm");
  const timelineWav = join(outputDir, "timeline.wav");
  await writeFile(timelinePcm, Buffer.concat(timelineChunks), { mode: 0o600 });
  await wavFromPcm(timelinePcm, timelineWav);
  return { prepared, timelineWav, timeline: buildDiarizationTimeline(prepared, silenceMs) };
}

async function runAsyncQuality(flags) {
  if (!flags.manifest || !flags["clips-dir"] || !flags["output-dir"]) throw new Error("invalid_arguments");
  const scope = resolveDiarizationScope(flags.scope, "both");
  const manifestPath = resolve(flags.manifest);
  const clipsDir = resolve(flags["clips-dir"]);
  const outputDir = resolve(flags["output-dir"]);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!Array.isArray(manifest.sources) || manifest.sources.length === 0) throw new Error("invalid_manifest");
  await mkdir(outputDir, { recursive: true });
  process.stdout.write("오디오 표준화 및 연속 재생 파일 생성\n");
  const audio = await prepareAudio(manifest, clipsDir, outputDir);
  const apiKey = await loadApiKey();
  const runId = `youtube-diarization-${randomUUID()}`;

  let continuous = null;
  let isolated = null;
  if (scope === "continuous" || scope === "both") {
    process.stdout.write(`연속 세션 저장 후 전사 시작 (${Math.round(audio.timeline.durationMs / 1_000)}초)\n`);
    const continuousTokens = await transcribeAsync(apiKey, audio.timelineWav, `${runId}-continuous`, {
      context: manifest.context,
    });
    continuous = analyzeDiarizationWindows(continuousTokens, audio.timeline.windows);
  }
  if (scope === "isolated" || scope === "both") {
    const isolatedTokens = [];
    for (const [index, source] of audio.prepared.entries()) {
      process.stdout.write(`독립 세션 ${index + 1}/${audio.prepared.length} 전사 시작: ${source.id}\n`);
      const tokens = await transcribeAsync(apiKey, source.wavPath, `${runId}-${source.id}`, {
        context: source.context,
      });
      isolatedTokens.push(...offsetTranscriptTokens(tokens, audio.timeline.windows[index].startMs));
    }
    isolated = analyzeDiarizationWindows(isolatedTokens, audio.timeline.windows);
  }
  const analysis = scope === "continuous" ? continuous : scope === "isolated" ? isolated : undefined;
  const comparison = continuous && isolated ? compareDiarizationRuns(continuous, isolated) : undefined;
  const verdict = continuous && isolated ? buildDiarizationQualityVerdict(continuous, isolated) : undefined;
  const cycleStability = analysis ? cycleStabilityIfPresent(analysis) : undefined;
  const continuousCycleStability = continuous && isolated ? cycleStabilityIfPresent(continuous) : undefined;
  const isolatedCycleStability = continuous && isolated ? cycleStabilityIfPresent(isolated) : undefined;
  const report = {
    version: 1,
    createdAt: new Date().toISOString(),
    model: "stt-async-v5",
    scope,
    manifest: manifestPath,
    manifestFingerprint: diarizationManifestFingerprint(manifest),
    timeline: audio.timeline,
    ...(analysis ? { analysis } : {}),
    ...(cycleStability ? { cycleStability } : {}),
    ...(continuous && isolated ? { continuous, isolated, comparison, verdict } : {}),
    ...(continuousCycleStability ? { continuousCycleStability } : {}),
    ...(isolatedCycleStability ? { isolatedCycleStability } : {}),
  };
  const reportPath = join(outputDir, scope === "both" ? "async-report.json" : `async-${scope}-report.json`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`품질 보고서 저장: ${reportPath}\n`);
  if (analysis) {
    const issueIds = analysis.windows.filter(diarizationIssue).map((window) => window.id);
    process.stdout.write(`화자 구분 결함 구간: ${issueIds.join(", ") || "없음"}\n`);
  } else {
    process.stdout.write(`연속 세션 결함 구간: ${verdict.continuousIssueIds.join(", ") || "없음"}\n`);
    process.stdout.write(`영상별 새 세션 결함 구간: ${verdict.isolatedIssueIds.join(", ") || "없음"}\n`);
    process.stdout.write(`새 세션 복구 구간: ${verdict.recoveredByResetIds.join(", ") || "없음"}\n`);
    process.stdout.write(`품질 게이트: ${verdict.passed ? "통과" : "실패"}\n`);
    if (!verdict.passed) process.exitCode = 2;
  }
}

async function runRealtimeQuality(flags) {
  if (!flags.manifest || !flags["clips-dir"] || !flags["output-dir"]) throw new Error("invalid_arguments");
  const scope = resolveDiarizationScope(flags.scope, "continuous");
  const endpointDetection = flags["endpoint-detection"] !== "false";
  const endpointSensitivity = flags["endpoint-sensitivity"] === undefined
    ? undefined
    : Number(flags["endpoint-sensitivity"]);
  const maxEndpointDelayMs = flags["max-endpoint-delay-ms"] === undefined
    ? undefined
    : Number(flags["max-endpoint-delay-ms"]);
  const realtimeOptions = { endpointDetection, endpointSensitivity, maxEndpointDelayMs };
  const manifestPath = resolve(flags.manifest);
  const clipsDir = resolve(flags["clips-dir"]);
  const outputDir = resolve(flags["output-dir"]);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!Array.isArray(manifest.sources) || manifest.sources.length === 0) throw new Error("invalid_manifest");
  await mkdir(outputDir, { recursive: true });
  process.stdout.write("오디오 표준화 및 실시간 재생 파일 생성\n");
  const audio = await prepareAudio(manifest, clipsDir, outputDir);
  const apiKey = await loadApiKey();
  let continuous = null;
  let isolated = null;
  if (scope === "continuous" || scope === "both") {
    process.stdout.write(`실시간 연속 세션 시작 (${Math.round(audio.timeline.durationMs / 1_000)}초, 자동 문장 종료 ${endpointDetection ? "사용" : "미사용"})\n`);
    const tokens = await transcribeRealtime(apiKey, join(outputDir, "timeline.pcm"), {
      ...realtimeOptions,
      context: manifest.context,
    });
    continuous = analyzeDiarizationWindows(tokens, audio.timeline.windows);
  }
  if (scope === "isolated" || scope === "both") {
    const tokens = [];
    for (const [index, source] of audio.prepared.entries()) {
      process.stdout.write(`실시간 독립 세션 ${index + 1}/${audio.prepared.length} 시작: ${source.id}\n`);
      const sourceTokens = await transcribeRealtime(apiKey, source.pcmPath, {
        ...realtimeOptions,
        context: source.context,
      });
      tokens.push(...offsetTranscriptTokens(sourceTokens, audio.timeline.windows[index].startMs));
    }
    isolated = analyzeDiarizationWindows(tokens, audio.timeline.windows);
  }
  const analysis = scope === "continuous" ? continuous : scope === "isolated" ? isolated : undefined;
  const comparison = continuous && isolated ? compareDiarizationRuns(continuous, isolated) : undefined;
  const verdict = continuous && isolated ? buildDiarizationQualityVerdict(continuous, isolated) : undefined;
  const cycleStability = analysis ? cycleStabilityIfPresent(analysis) : undefined;
  const continuousCycleStability = continuous && isolated ? cycleStabilityIfPresent(continuous) : undefined;
  const isolatedCycleStability = continuous && isolated ? cycleStabilityIfPresent(isolated) : undefined;
  const report = {
    version: 1,
    createdAt: new Date().toISOString(),
    model: "stt-rt-v5",
    scope,
    endpointDetection,
    ...(endpointSensitivity !== undefined ? { endpointSensitivity } : {}),
    ...(maxEndpointDelayMs !== undefined ? { maxEndpointDelayMs } : {}),
    manifest: manifestPath,
    manifestFingerprint: diarizationManifestFingerprint(manifest),
    timeline: audio.timeline,
    ...(analysis ? { analysis } : {}),
    ...(cycleStability ? { cycleStability } : {}),
    ...(continuous && isolated ? { continuous, isolated, comparison, verdict } : {}),
    ...(continuousCycleStability ? { continuousCycleStability } : {}),
    ...(isolatedCycleStability ? { isolatedCycleStability } : {}),
  };
  const suffix = endpointDetection ? "endpoint-on" : "endpoint-off";
  const reportPath = join(outputDir, `realtime-${scope}-${suffix}.json`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`품질 보고서 저장: ${reportPath}\n`);
  if (analysis) {
    const issueIds = analysis.windows.filter(diarizationIssue).map((window) => window.id);
    process.stdout.write(`화자 구분 결함 구간: ${issueIds.join(", ") || "없음"}\n`);
  } else {
    process.stdout.write(`연속 세션 결함 구간: ${verdict.continuousIssueIds.join(", ") || "없음"}\n`);
    process.stdout.write(`영상별 새 세션 결함 구간: ${verdict.isolatedIssueIds.join(", ") || "없음"}\n`);
    process.stdout.write(`새 세션 복구 구간: ${verdict.recoveredByResetIds.join(", ") || "없음"}\n`);
    process.stdout.write(`품질 게이트: ${verdict.passed ? "통과" : "실패"}\n`);
    if (!verdict.passed) process.exitCode = 2;
  }
}

function boundedNumber(value, fallback, minimum, maximum, code) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) throw new Error(code);
  return parsed;
}

async function runLocalQuality(flags) {
  if (
    !flags.manifest
    || !flags["clips-dir"]
    || !flags["output-dir"]
    || !flags["sherpa-module"]
    || !flags["segmentation-model"]
    || !flags["embedding-model"]
  ) throw new Error("invalid_arguments");
  const scope = resolveDiarizationScope(flags.scope, "isolated");
  const threshold = boundedNumber(flags.threshold, 0.85, 0, 1, "invalid_local_threshold");
  const minSupportedSeconds = boundedNumber(
    flags["min-supported-seconds"],
    2,
    0,
    60,
    "invalid_local_support_duration",
  );
  const threads = Math.round(boundedNumber(flags.threads, 4, 1, 16, "invalid_local_threads"));
  const manifestPath = resolve(flags.manifest);
  const clipsDir = resolve(flags["clips-dir"]);
  const outputDir = resolve(flags["output-dir"]);
  const sherpaModulePath = resolve(flags["sherpa-module"]);
  const segmentationModelPath = resolve(flags["segmentation-model"]);
  const embeddingModelPath = resolve(flags["embedding-model"]);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!Array.isArray(manifest.sources) || manifest.sources.length === 0) throw new Error("invalid_manifest");
  await Promise.all([
    access(sherpaModulePath),
    access(segmentationModelPath),
    access(embeddingModelPath),
  ]);
  await mkdir(outputDir, { recursive: true });
  process.stdout.write("오디오 표준화 및 로컬 화자 임베딩 준비\n");
  const audio = await prepareAudio(manifest, clipsDir, outputDir);
  let sherpa;
  try {
    sherpa = createRequire(import.meta.url)(sherpaModulePath);
  } catch {
    throw new Error("local_diarization_module_unavailable");
  }
  if (
    typeof sherpa?.OfflineSpeakerDiarization !== "function"
    || typeof sherpa?.readWave !== "function"
  ) throw new Error("local_diarization_module_invalid");
  const diarizer = new sherpa.OfflineSpeakerDiarization({
    segmentation: {
      pyannote: { model: segmentationModelPath },
      numThreads: threads,
    },
    embedding: {
      model: embeddingModelPath,
      numThreads: threads,
    },
    clustering: { numClusters: 0, threshold },
    minDurationOn: 0.3,
    minDurationOff: 0.2,
  });
  let continuous = null;
  let isolated = null;
  let continuousProcessingMs;
  if (scope === "continuous" || scope === "both") {
    process.stdout.write(`로컬 연속 화자 판정 시작 (${Math.round(audio.timeline.durationMs / 1_000)}초)\n`);
    const wave = sherpa.readWave(audio.timelineWav);
    const startedAt = performance.now();
    const segments = diarizer.process(wave.samples);
    continuousProcessingMs = Math.round(performance.now() - startedAt);
    continuous = summarizeLocalDiarizationWindows(audio.timeline.windows.map((window) => (
      analyzeLocalDiarizationSegments(
        selectLocalDiarizationSegmentsForWindow(segments, window),
        window,
        minSupportedSeconds * 1_000,
      )
    )));
  }
  if (scope === "isolated" || scope === "both") {
    const windows = [];
    for (const [index, source] of audio.prepared.entries()) {
      process.stdout.write(`로컬 독립 화자 판정 ${index + 1}/${audio.prepared.length} 시작: ${source.id}\n`);
      const wave = sherpa.readWave(source.wavPath);
      const startedAt = performance.now();
      const segments = diarizer.process(wave.samples);
      windows.push({
        ...analyzeLocalDiarizationSegments(
          segments,
          audio.timeline.windows[index],
          minSupportedSeconds * 1_000,
        ),
        processingMs: Math.round(performance.now() - startedAt),
      });
    }
    isolated = summarizeLocalDiarizationWindows(windows);
  }
  const analysis = scope === "continuous" ? continuous : scope === "isolated" ? isolated : undefined;
  const comparison = continuous && isolated
    ? continuous.windows.map((window) => {
      const separate = isolated.windows.find((candidate) => candidate.id === window.id);
      const continuousIssue = continuous.issueWindowIds.includes(window.id);
      const isolatedIssue = isolated.issueWindowIds.includes(window.id);
      return {
        id: window.id,
        continuousSpeakers: window.speakerCount,
        isolatedSpeakers: separate?.speakerCount ?? 0,
        continuousSupportedSpeakers: window.supportedSpeakerCount,
        isolatedSupportedSpeakers: separate?.supportedSpeakerCount ?? 0,
        recoveredByReset: continuousIssue && !isolatedIssue,
      };
    })
    : undefined;
  const verdict = continuous && isolated ? {
    passed: isolated.issueWindowIds.length === 0,
    continuousIssueIds: continuous.issueWindowIds,
    isolatedIssueIds: isolated.issueWindowIds,
    recoveredByResetIds: comparison.filter((window) => window.recoveredByReset).map((window) => window.id),
  } : undefined;
  const cycleStability = analysis ? cycleStabilityIfPresent(analysis, { mode: "local" }) : undefined;
  const continuousCycleStability = continuous && isolated
    ? cycleStabilityIfPresent(continuous, { mode: "local" })
    : undefined;
  const isolatedCycleStability = continuous && isolated
    ? cycleStabilityIfPresent(isolated, { mode: "local" })
    : undefined;
  const report = {
    version: 1,
    createdAt: new Date().toISOString(),
    model: "local-speaker-embedding",
    scope,
    manifest: manifestPath,
    manifestFingerprint: diarizationManifestFingerprint(manifest),
    localInputFingerprint: localDiarizationInputFingerprint(manifest),
    threshold,
    minSupportedDurationMs: minSupportedSeconds * 1_000,
    threads,
    segmentationModel: basename(segmentationModelPath),
    embeddingModel: basename(embeddingModelPath),
    ...(continuousProcessingMs !== undefined ? { continuousProcessingMs } : {}),
    ...(analysis ? { analysis } : {}),
    ...(cycleStability ? { cycleStability } : {}),
    ...(continuous && isolated ? { continuous, isolated, comparison, verdict } : {}),
    ...(continuousCycleStability ? { continuousCycleStability } : {}),
    ...(isolatedCycleStability ? { isolatedCycleStability } : {}),
  };
  const reportPath = join(outputDir, scope === "isolated" ? "local-report.json" : `local-${scope}-report.json`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`품질 보고서 저장: ${reportPath}\n`);
  if (analysis) {
    process.stdout.write(`유효 화자 결함 구간: ${analysis.issueWindowIds.join(", ") || "없음"}\n`);
    process.stdout.write(`짧은 조각 포함 원시 과분리 구간: ${analysis.rawFragmentedWindowIds.join(", ") || "없음"}\n`);
    if (analysis.issueWindowIds.length > 0) process.exitCode = 2;
  } else {
    process.stdout.write(`연속 판정 결함 구간: ${verdict.continuousIssueIds.join(", ") || "없음"}\n`);
    process.stdout.write(`독립 판정 결함 구간: ${verdict.isolatedIssueIds.join(", ") || "없음"}\n`);
    process.stdout.write(`독립 판정 복구 구간: ${verdict.recoveredByResetIds.join(", ") || "없음"}\n`);
    process.stdout.write(`품질 게이트: ${verdict.passed ? "통과" : "실패"}\n`);
    if (!verdict.passed) process.exitCode = 2;
  }
}

async function runHybridQuality(flags) {
  if (
    !flags.manifest
    || !flags["clips-dir"]
    || !flags["output-dir"]
    || !flags["local-report"]
  ) throw new Error("invalid_arguments");
  const scope = resolveDiarizationScope(flags.scope, "isolated");
  if (scope === "both") throw new Error("invalid_hybrid_scope");
  const maxGapMs = boundedNumber(flags["max-gap-ms"], 1_000, 0, 5_000, "invalid_hybrid_gap");
  const manifestPath = resolve(flags.manifest);
  const clipsDir = resolve(flags["clips-dir"]);
  const outputDir = resolve(flags["output-dir"]);
  const localReportPath = resolve(flags["local-report"]);
  const fallbackLocalReportPath = flags["fallback-local-report"]
    ? resolve(flags["fallback-local-report"])
    : null;
  const realtimeReportPath = flags["realtime-report"]
    ? resolve(flags["realtime-report"])
    : null;
  const consensusLocalReportPaths = flags["consensus-local-reports"]
    ? flags["consensus-local-reports"]
      .split(",")
      .map((path) => path.trim())
      .filter(Boolean)
      .map((path) => resolve(path))
    : [];
  if (fallbackLocalReportPath && consensusLocalReportPaths.length > 0) {
    throw new Error("invalid_hybrid_local_selection_mode");
  }
  if (realtimeReportPath && consensusLocalReportPaths.length === 0) {
    throw new Error("invalid_hybrid_realtime_selection_mode");
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!Array.isArray(manifest.sources) || manifest.sources.length === 0) throw new Error("invalid_manifest");
  const allLocalReportPaths = [
    localReportPath,
    ...(fallbackLocalReportPath ? [fallbackLocalReportPath] : []),
    ...consensusLocalReportPaths,
  ];
  const allLocalReports = await Promise.all(allLocalReportPaths.map(async (path) => ({
    path,
    report: JSON.parse(await readFile(path, "utf8")),
  })));
  const consensusMode = consensusLocalReportPaths.length > 0;
  const reportCandidates = allLocalReports.map(({ path, report }, index) => {
    const candidateScope = report.scope;
    const threshold = finiteNumber(report.threshold);
    return {
      path,
      report,
      scope: candidateScope,
      label: `${report.embeddingModel ?? basename(path)}@${threshold ?? "unknown"}#${index + 1}`,
      windows: validateHybridLocalReport(
        manifestPath,
        manifest,
        report,
        consensusMode || fallbackLocalReportPath ? candidateScope : scope,
        { allowQualityIssues: Boolean(consensusMode || fallbackLocalReportPath) },
      ),
    };
  });
  const realtimeCandidate = realtimeReportPath
    ? await (async () => {
        const report = JSON.parse(await readFile(realtimeReportPath, "utf8"));
        return {
          path: realtimeReportPath,
          report,
          scope: "continuous",
          sourceScope: report.scope,
          label: `realtime@${basename(realtimeReportPath)}`,
          windows: validateHybridLocalReport(
            manifestPath,
            manifest,
            report,
            report.scope,
            { allowQualityIssues: true },
          ),
        };
      })()
    : null;
  await mkdir(outputDir, { recursive: true });
  process.stdout.write("오디오 표준화 및 하이브리드 화자 재적용 준비\n");
  const audio = await prepareAudio(manifest, clipsDir, outputDir);
  const apiKey = await loadApiKey();
  const runId = `youtube-diarization-hybrid-${randomUUID()}`;
  const cloudTokens = [];
  if (scope === "continuous") {
    process.stdout.write(`하이브리드 연속 전사 시작 (${Math.round(audio.timeline.durationMs / 1_000)}초)\n`);
    const tokens = await transcribeAsync(apiKey, audio.timelineWav, `${runId}-continuous`, {
      context: manifest.context,
    });
    cloudTokens.push(...tokens);
  } else {
    for (const [index, source] of audio.prepared.entries()) {
      process.stdout.write(`하이브리드 전사 ${index + 1}/${audio.prepared.length} 시작: ${source.id}\n`);
      const tokens = await transcribeAsync(apiKey, source.wavPath, `${runId}-${source.id}`, {
        context: source.context,
      });
      cloudTokens.push(...offsetTranscriptTokens(tokens, audio.timeline.windows[index].startMs));
    }
  }
  const cloudAnalysis = analyzeDiarizationWindows(cloudTokens, audio.timeline.windows);
  let resetCloudAnalysis = null;
  if (consensusMode) {
    if (scope === "isolated") {
      resetCloudAnalysis = cloudAnalysis;
    } else {
      const resetCloudTokens = [];
      for (const [index, source] of audio.prepared.entries()) {
        process.stdout.write(`경계별 독립 재확인 ${index + 1}/${audio.prepared.length} 시작: ${source.id}\n`);
        const tokens = await transcribeAsync(apiKey, source.wavPath, `${runId}-reset-${source.id}`, {
          context: source.context,
        });
        resetCloudTokens.push(...offsetTranscriptTokens(tokens, audio.timeline.windows[index].startMs));
      }
      resetCloudAnalysis = analyzeDiarizationWindows(resetCloudTokens, audio.timeline.windows);
    }
  }
  const consensus = consensusMode
    ? buildDiarizationConsensusReport(
        cloudAnalysis,
        reportCandidates,
        resetCloudAnalysis,
        realtimeCandidate,
      )
    : null;
  const resetCloudCandidate = resetCloudAnalysis
    ? {
        label: "reset-cloud",
        scope: "continuous",
        windows: resetCloudAnalysis.windows,
      }
    : null;
  const localWindows = consensus
    ? materializeDiarizationConsensusWindows(
        consensus,
        [
          ...reportCandidates,
          ...(resetCloudCandidate ? [resetCloudCandidate] : []),
          ...(realtimeCandidate ? [realtimeCandidate] : []),
        ],
      )
    : selectHybridLocalDiarizationWindows(manifest, reportCandidates);
  const localById = new Map(
    localWindows
      .filter((window) => typeof window?.id === "string")
      .map((window) => [window.id, window]),
  );
  const combinedTokens = [];
  const relabeling = [];
  for (const [index, source] of audio.prepared.entries()) {
    const window = audio.timeline.windows[index];
    const local = localById.get(source.id);
    if (
      !local
      || !Array.isArray(local.speakerRuns)
      || !Array.isArray(local.supportedSpeakerIds)
      || local.supportedSpeakerIds.length === 0
    ) throw new Error("local_report_window_missing");
    const windowTokens = cloudTokens.filter((token) => {
      const midpoint = tokenMidpoint(token);
      return midpoint !== null && midpoint >= window.startMs && midpoint < window.endMs;
    });
    const relabeled = relabelTranscriptTokensFromDiarization(
      windowTokens,
      normalizeLocalSpeakerRunsForScope(
        local.speakerRuns,
        local.localScope,
        "continuous",
        window.startMs,
      ),
      local.supportedSpeakerIds,
      maxGapMs,
      true,
    );
    combinedTokens.push(...relabeled.tokens);
    relabeling.push({
      id: source.id,
      ...(local.consensusCandidateLabel
        ? { consensusCandidateLabel: local.consensusCandidateLabel }
        : {}),
      localSpeakerMap: relabeled.localSpeakerMap,
      relabeledTokenCount: relabeled.relabeledTokenCount,
      fallbackRelabeledTokenCount: relabeled.fallbackRelabeledTokenCount,
      unmatchedTokenCount: relabeled.unmatchedTokenCount,
      unmatchedTextShare: relabeled.unmatchedTextShare,
    });
  }
  const analysis = analyzeDiarizationWindows(combinedTokens, audio.timeline.windows);
  const speakerIssueWindowIds = analysis.issueWindowIds;
  const unmatchedWindowIds = relabeling
    .filter((window) => window.unmatchedTextShare > 0.02)
    .map((window) => window.id);
  const verdict = {
    passed: speakerIssueWindowIds.length === 0 && unmatchedWindowIds.length === 0,
    speakerIssueWindowIds,
    unmatchedWindowIds,
  };
  const cycleStability = cycleStabilityIfPresent(analysis);
  const report = {
    version: 1,
    createdAt: new Date().toISOString(),
    model: "hybrid-async-local-speaker",
    scope,
    manifest: manifestPath,
    manifestFingerprint: diarizationManifestFingerprint(manifest),
    localReport: localReportPath,
    ...(fallbackLocalReportPath ? {
      fallbackLocalReport: fallbackLocalReportPath,
      localSelection: localWindows.map((window) => ({ id: window.id, scope: window.localScope })),
    } : {}),
    ...(consensus ? {
      consensusLocalReports: reportCandidates.map((candidate) => ({
        label: candidate.label,
        path: candidate.path,
        scope: candidate.scope,
        threshold: candidate.report.threshold,
        embeddingModel: candidate.report.embeddingModel,
      })),
      cloudAnalysis,
      resetCloudAnalysis,
      ...(realtimeCandidate ? {
        realtimeReport: {
          label: realtimeCandidate.label,
          path: realtimeCandidate.path,
          sourceScope: realtimeCandidate.sourceScope,
        },
      } : {}),
      consensus,
      localSelection: localWindows.map((window) => ({
        id: window.id,
        label: window.consensusCandidateLabel,
        scope: window.localScope,
        selectedSpeakerIds: window.supportedSpeakerIds,
      })),
    } : {}),
    maxGapMs,
    analysis,
    ...(cycleStability ? { cycleStability } : {}),
    relabeling,
    verdict,
  };
  const reportPath = join(outputDir, scope === "isolated" ? "hybrid-report.json" : "hybrid-continuous-report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`품질 보고서 저장: ${reportPath}\n`);
  process.stdout.write(`화자 수 결함 구간: ${speakerIssueWindowIds.join(", ") || "없음"}\n`);
  process.stdout.write(`시간대 미연결 구간: ${unmatchedWindowIds.join(", ") || "없음"}\n`);
  process.stdout.write(`품질 게이트: ${verdict.passed ? "통과" : "실패"}\n`);
  if (!verdict.passed) process.exitCode = 2;
}

async function runRescoreReport(flags) {
  if (!flags.report || !flags.manifest || !flags.output) throw new Error("invalid_arguments");
  const reportPath = resolve(flags.report);
  const manifestPath = resolve(flags.manifest);
  const outputPath = resolve(flags.output);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!Array.isArray(manifest.sources) || manifest.sources.length === 0) throw new Error("invalid_manifest");
  const rescored = {
    ...rescoreDiarizationReport(report, manifest),
    rescoredAt: new Date().toISOString(),
    rescoredManifest: manifestPath,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(rescored, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`재채점 보고서 저장: ${outputPath}\n`);
  const issueIds = rescored.analysis?.issueWindowIds
    ?? rescored.verdict?.unresolvedIssueIds
    ?? [];
  process.stdout.write(`재채점 결함 구간: ${issueIds.join(", ") || "없음"}\n`);
}

async function runRescoreLocalReport(flags) {
  if (!flags.report || !flags.output) throw new Error("invalid_arguments");
  const reportPath = resolve(flags.report);
  const outputPath = resolve(flags.output);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  if (report?.model !== "local-speaker-embedding") throw new Error("invalid_local_report");
  const rescored = {
    ...rescoreLocalDiarizationReport(report),
    rescoredAt: new Date().toISOString(),
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(rescored, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`로컬 재채점 보고서 저장: ${outputPath}\n`);
  const issueIds = rescored.analysis?.issueWindowIds
    ?? rescored.verdict?.isolatedIssueIds
    ?? [];
  process.stdout.write(`로컬 재채점 결함 구간: ${issueIds.join(", ") || "없음"}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { command, flags } = parseArgs(process.argv.slice(2));
  if (command === "run-async") {
    runAsyncQuality(flags).catch((error) => {
      process.stderr.write(`화자 구분 품질 테스트 실패: ${error instanceof Error ? error.message : "unknown_error"}\n`);
      process.exitCode = 1;
    });
  } else if (command === "run-realtime") {
    runRealtimeQuality(flags).catch((error) => {
      process.stderr.write(`화자 구분 품질 테스트 실패: ${error instanceof Error ? error.message : "unknown_error"}\n`);
      process.exitCode = 1;
    });
  } else if (command === "run-local") {
    runLocalQuality(flags).catch((error) => {
      process.stderr.write(`로컬 화자 구분 품질 테스트 실패: ${error instanceof Error ? error.message : "unknown_error"}\n`);
      process.exitCode = 1;
    });
  } else if (command === "run-hybrid") {
    runHybridQuality(flags).catch((error) => {
      process.stderr.write(`하이브리드 화자 구분 품질 테스트 실패: ${error instanceof Error ? error.message : "unknown_error"}\n`);
      process.exitCode = 1;
    });
  } else if (command === "rescore-report") {
    runRescoreReport(flags).catch((error) => {
      process.stderr.write(`화자 구분 보고서 재채점 실패: ${error instanceof Error ? error.message : "unknown_error"}\n`);
      process.exitCode = 1;
    });
  } else if (command === "rescore-local-report") {
    runRescoreLocalReport(flags).catch((error) => {
      process.stderr.write(`로컬 화자 구분 보고서 재채점 실패: ${error instanceof Error ? error.message : "unknown_error"}\n`);
      process.exitCode = 1;
    });
  } else {
    printUsage();
  }
}
