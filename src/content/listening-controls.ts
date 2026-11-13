import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

import type { SubtitleCue } from "@/types";

import { findAdjacentCueIndex, findRepeatCueIndex } from "./subtitle-engine";

/**
 * "Listen better" controls on the watch page:
 *
 * - R            repeat the current line (or the last one that ended)
 * - Shift+← / →  previous / next line
 * - B            loop the current line on and off
 *
 * None of these is one of YouTube's shortcuts: it seeks with the plain
 * arrows (5 s), J/L (10 s) and Ctrl+←/→ (chapters), so Ctrl, Alt and Meta
 * combinations are left alone. All three need cue times, so they are off
 * when the overlay reads captions from the DOM; the keys then reach YouTube
 * untouched.
 */
export type ListeningAction = "repeat" | "previous" | "next" | "toggleLoop";

// Land a hair after the cue start so float rounding never resolves the
// position to the previous cue, whose end equals this cue's start.
const SEEK_OFFSET_S = 0.01;
// A seek that lands this close to the looped line keeps the loop (frame
// steps, YouTube's own re-seeks while buffering).
const LOOP_SEEK_TOLERANCE_S = 0.25;

export function getPlayerVideo(): HTMLVideoElement | null {
  return (
    document.querySelector<HTMLVideoElement>("#movie_player video") ??
    document.querySelector<HTMLVideoElement>("video")
  );
}

export function getListeningAction(
  event: KeyboardEvent
): ListeningAction | null {
  if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing) {
    return null;
  }

  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    if (!event.shiftKey) {
      return null;
    }
    return event.key === "ArrowLeft" ? "previous" : "next";
  }

  if (event.shiftKey) {
    return null;
  }

  // event.key, not event.code, so the letters follow the user's layout.
  // Lower-cased so Caps Lock does not get in the way.
  switch (event.key.toLowerCase()) {
    case "r":
      return "repeat";
    case "b":
      return "toggleLoop";
    default:
      return null;
  }
}

function isEditableElement(element: Element | null): boolean {
  if (!element) {
    return false;
  }

  if (element instanceof HTMLElement && element.isContentEditable) {
    return true;
  }

  const tag = element.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function getDeepActiveElement(): Element | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement;
  }
  return active;
}

/** True while the user is typing: YouTube's search box, comments, etc. */
export function isTypingContext(event: KeyboardEvent): boolean {
  const [origin] = event.composedPath();
  return (
    (origin instanceof Element && isEditableElement(origin)) ||
    isEditableElement(getDeepActiveElement())
  );
}

function seekToCue(video: HTMLVideoElement, cue: SubtitleCue) {
  video.currentTime = cue.start + SEEK_OFFSET_S;
}

interface ListeningShortcutsOptions {
  /** Stabilized transcript cues; empty in the DOM fallback. */
  cues: SubtitleCue[];
  /** Setting on, captions on and a transcript with timings loaded. */
  enabled: boolean;
  videoId: string | null;
}

export function useListeningShortcuts({
  cues,
  enabled,
  videoId,
}: ListeningShortcutsOptions) {
  const [loopCue, setLoopCue] = useState<SubtitleCue | null>(null);

  const stopLoop = useCallback(() => setLoopCue(null), []);

  // A new video, a new transcript or turning the shortcuts off ends the loop.
  useEffect(() => {
    setLoopCue(null);
  }, [cues, enabled, videoId]);

  useEffect(() => {
    if (!enabled || cues.length === 0) {
      return;
    }

    // Keys whose keydown we took, so their keyup does not reach YouTube
    // either.
    const handledCodes = new Set<string>();

    const runAction = (action: ListeningAction, video: HTMLVideoElement) => {
      const time = video.currentTime;

      if (action === "toggleLoop") {
        setLoopCue((current) => {
          if (current) {
            return null;
          }
          const index = findRepeatCueIndex(cues, time);
          return index === -1 ? null : cues[index];
        });
        return;
      }

      if (action === "repeat") {
        const index = findRepeatCueIndex(cues, time);
        if (index !== -1) {
          seekToCue(video, cues[index]);
        }
        return;
      }

      const index = findAdjacentCueIndex(
        cues,
        time,
        action === "previous" ? -1 : 1
      );
      if (index !== -1) {
        setLoopCue(null);
        seekToCue(video, cues[index]);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || window.location.pathname !== "/watch") {
        return;
      }

      const action = getListeningAction(event);
      if (!action || isTypingContext(event)) {
        return;
      }

      const video = getPlayerVideo();
      if (!video) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      handledCodes.add(event.code);

      // Holding Shift+→ walks through the lines; holding R or B should not
      // restart the line or flip the loop on every auto-repeat.
      if (event.repeat && (action === "repeat" || action === "toggleLoop")) {
        return;
      }

      runAction(action, video);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (!handledCodes.delete(event.code)) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    // Window capture runs before YouTube's own key handlers.
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
    };
  }, [cues, enabled]);

  useEffect(() => {
    if (!loopCue) {
      return;
    }

    const video = getPlayerVideo();
    if (!video) {
      setLoopCue(null);
      return;
    }

    let rafId = 0;

    // While the user's own seek is in flight, `seeking` is already true, so
    // the loop never pulls them back before handleSeeking sees where they
    // went.
    const enforceLoop = () => {
      if (!video.seeking && video.currentTime >= loopCue.end) {
        seekToCue(video, loopCue);
      }
    };

    // requestAnimationFrame keeps the jump tight; timeupdate (about 4 Hz)
    // keeps the loop going while the tab is in the background.
    const tick = () => {
      enforceLoop();
      rafId = requestAnimationFrame(tick);
    };

    const handleSeeking = () => {
      const time = video.currentTime;
      if (
        time < loopCue.start - LOOP_SEEK_TOLERANCE_S ||
        time >= loopCue.end + LOOP_SEEK_TOLERANCE_S
      ) {
        setLoopCue(null);
      }
    };

    const handleEmptied = () => setLoopCue(null);

    video.addEventListener("timeupdate", enforceLoop);
    video.addEventListener("seeking", handleSeeking);
    video.addEventListener("emptied", handleEmptied);
    tick();

    return () => {
      cancelAnimationFrame(rafId);
      video.removeEventListener("timeupdate", enforceLoop);
      video.removeEventListener("seeking", handleSeeking);
      video.removeEventListener("emptied", handleEmptied);
    };
  }, [loopCue]);

  return { loopCue, stopLoop };
}

interface HoverPauseOptions {
  enabled: boolean;
  /** A word or phrase popup is open: keep the pause until it closes. */
  holdOpen: boolean;
  /** The subtitle is on screen. Unmounting never fires mouseleave. */
  subtitleVisible: boolean;
  videoId: string | null;
}

/**
 * Pauses the video while the mouse is over the subtitle and resumes it when
 * the mouse leaves, but only if the extension paused it.
 */
export function useHoverPause({
  enabled,
  holdOpen,
  subtitleVisible,
  videoId,
}: HoverPauseOptions) {
  const hoveringRef = useRef(false);
  // Pause at most once per hover, so playing the video by hand while the
  // mouse is still on the subtitle sticks.
  const engagedRef = useRef(false);
  const pausedByUsRef = useRef(false);
  const holdOpenRef = useRef(holdOpen);

  const release = useCallback((resume: boolean) => {
    if (!pausedByUsRef.current) {
      return;
    }

    pausedByUsRef.current = false;
    const video = getPlayerVideo();
    if (resume && video?.paused) {
      video.play().catch(() => {
        // Autoplay policy or a source swap; leave the video paused.
      });
    }
  }, []);

  const resumeIfIdle = useCallback(() => {
    if (!hoveringRef.current && !holdOpenRef.current) {
      release(true);
    }
  }, [release]);

  useEffect(() => {
    holdOpenRef.current = holdOpen;
    resumeIfIdle();
  }, [holdOpen, resumeIfIdle]);

  useEffect(() => {
    if (!enabled) {
      release(true);
    }
  }, [enabled, release]);

  useEffect(() => {
    if (!subtitleVisible) {
      hoveringRef.current = false;
      engagedRef.current = false;
      resumeIfIdle();
    }
  }, [subtitleVisible, resumeIfIdle]);

  // A new video starts on its own terms: forget the old pause.
  useEffect(() => {
    hoveringRef.current = false;
    engagedRef.current = false;
    pausedByUsRef.current = false;
  }, [videoId]);

  // If the user plays the video themselves, the pause is no longer ours.
  useEffect(() => {
    const handlePlay = (event: Event) => {
      if (event.target === getPlayerVideo()) {
        pausedByUsRef.current = false;
      }
    };

    // Media events do not bubble, but they do go through the capture phase.
    document.addEventListener("play", handlePlay, true);
    return () => document.removeEventListener("play", handlePlay, true);
  }, []);

  const onMouseEnter = useCallback(() => {
    hoveringRef.current = true;
  }, []);

  // Pause on real mouse movement rather than on mouseenter: Chrome also
  // fires mouseenter when a new line appears under a cursor that is resting
  // on the player.
  const onMouseMove = useCallback(
    (event: ReactMouseEvent) => {
      hoveringRef.current = true;

      if (!enabled || engagedRef.current) {
        return;
      }

      if (event.movementX === 0 && event.movementY === 0) {
        return;
      }

      engagedRef.current = true;
      const video = getPlayerVideo();
      if (!video || video.paused || video.ended) {
        return;
      }

      video.pause();
      pausedByUsRef.current = true;
    },
    [enabled]
  );

  const onMouseLeave = useCallback(() => {
    hoveringRef.current = false;
    engagedRef.current = false;
    resumeIfIdle();
  }, [resumeIfIdle]);

  return { onMouseEnter, onMouseMove, onMouseLeave };
}
