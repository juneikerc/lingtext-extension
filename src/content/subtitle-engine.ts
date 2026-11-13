import type { SubtitleCue } from "@/types";

export function findCueIndexAtTime(cues: SubtitleCue[], time: number): number {
  let left = 0;
  let right = cues.length - 1;

  while (left <= right) {
    const mid = (left + right) >> 1;
    const cue = cues[mid];

    if (time < cue.start) {
      right = mid - 1;
      continue;
    }

    if (time >= cue.end) {
      left = mid + 1;
      continue;
    }

    return mid;
  }

  return -1;
}

/** Index of the last cue that started at or before `time`, or -1. */
export function findLastStartedCueIndex(
  cues: SubtitleCue[],
  time: number
): number {
  let left = 0;
  let right = cues.length - 1;
  let found = -1;

  while (left <= right) {
    const mid = (left + right) >> 1;

    if (cues[mid].start <= time) {
      found = mid;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  return found;
}

/**
 * The line "R" repeats: the cue on screen or, between lines, the last one
 * that ended. -1 before the first cue.
 */
export function findRepeatCueIndex(cues: SubtitleCue[], time: number): number {
  const active = findCueIndexAtTime(cues, time);
  return active !== -1 ? active : findLastStartedCueIndex(cues, time);
}

/**
 * The cue before or after the current one. Between lines, "previous" is the
 * line that just ended and "next" the one about to start. -1 when there is
 * none.
 */
export function findAdjacentCueIndex(
  cues: SubtitleCue[],
  time: number,
  direction: -1 | 1
): number {
  const active = findCueIndexAtTime(cues, time);
  const target =
    active !== -1
      ? active + direction
      : findLastStartedCueIndex(cues, time) + (direction === 1 ? 1 : 0);

  return target >= 0 && target < cues.length ? target : -1;
}
