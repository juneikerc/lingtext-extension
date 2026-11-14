import { useCallback, useEffect, useRef, useState } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

import SelectionPopup from "@/components/SelectionPopup";
import SubtitleOverlay from "@/components/SubtitleOverlay";
import WordPopup from "@/components/WordPopup";
import type {
  ExtensionSettings,
  PhraseEntry,
  SubtitleCue,
  WordEntry,
  WordPopupState,
} from "@/types";
import {
  getDefaultExtensionSettings,
  normalizeExtensionSettings,
} from "@/utils/settings";
import { translateTerm } from "@/utils/translate";
import { normalizeWord, tokenize } from "@/utils/tokenize";

import {
  loadEnglishTranscript,
  requestCapturedTranscript,
  watchCapturedTranscripts,
} from "./caption-track-loader";
import { stabilizeCues } from "./cue-stabilizer";
import {
  getPlayerVideo,
  useHoverPause,
  useListeningShortcuts,
} from "./listening-controls";
import { setNativeCcHidden } from "./native-cc";
import {
  getCurrentVideoId,
  watchPlayerRect,
  watchVideoId,
} from "./player-observer";
import { findCueIndexAtTime } from "./subtitle-engine";

interface OverlayRootProps {
  shadowRoot: ShadowRoot;
}

interface SelectionPopupState {
  x: number;
  y: number;
  text: string;
  translation: string;
  disclaimer?: string;
  isLoading?: boolean;
}

const SUBTITLE_TRANSITION_MS = 80;
// DOM fallback: YouTube's auto-generated captions add one word per DOM
// mutation. While the text only grows, wait for it to settle (or at most
// DOM_GROWTH_MAX_WAIT_MS) so the overlay updates in phrases, not words.
const DOM_GROWTH_SETTLE_MS = 450;
const DOM_GROWTH_MAX_WAIT_MS = 1200;
const SUBTITLE_OFFSET_KEY = "lt2_youtube_subtitle_offset";
const DEFAULT_SUBTITLE_OFFSET = { x: 0, y: 0 };

interface SubtitleOffset {
  x: number;
  y: number;
}

interface SubtitleDragState {
  pointerId: number;
  startX: number;
  startY: number;
  startOffset: SubtitleOffset;
}

function isSubtitleOffset(value: unknown): value is SubtitleOffset {
  const candidate = value as Partial<SubtitleOffset> | undefined;
  return (
    typeof candidate?.x === "number" &&
    Number.isFinite(candidate.x) &&
    typeof candidate.y === "number" &&
    Number.isFinite(candidate.y)
  );
}

function clampSubtitleOffset(
  offset: SubtitleOffset,
  playerRect: DOMRect | null
): SubtitleOffset {
  if (!playerRect) {
    return offset;
  }

  const maxX = Math.max(0, playerRect.width * 0.42);
  const minY = -Math.max(0, playerRect.height - 140);
  const maxY = 36;

  return {
    x: Math.min(Math.max(offset.x, -maxX), maxX),
    y: Math.min(Math.max(offset.y, minY), maxY),
  };
}

function readNativeCaptionsActive(): boolean {
  const button = document.querySelector<HTMLElement>(".ytp-subtitles-button");
  if (!button) {
    return false;
  }

  const ariaPressed = button.getAttribute("aria-pressed");
  if (ariaPressed === "true") {
    return true;
  }

  if (ariaPressed === "false") {
    return false;
  }

  return button.classList.contains("ytp-button-active");
}

export default function OverlayRoot({ shadowRoot }: OverlayRootProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const wordLookupSeqRef = useRef(0);
  const selectionLookupSeqRef = useRef(0);
  const subtitleOffsetRef = useRef<SubtitleOffset>(DEFAULT_SUBTITLE_OFFSET);
  const subtitleDragRef = useRef<SubtitleDragState | null>(null);

  const [videoId, setVideoId] = useState<string | null>(getCurrentVideoId());
  const [playerRect, setPlayerRect] = useState<DOMRect | null>(null);
  const [settings, setSettings] = useState<ExtensionSettings>(
    getDefaultExtensionSettings
  );

  const [unknownSet, setUnknownSet] = useState<Set<string>>(new Set());
  const [phrases, setPhrases] = useState<string[][]>([]);

  const [transcriptCues, setTranscriptCues] = useState<SubtitleCue[]>([]);
  const [useTranscript, setUseTranscript] = useState(false);

  const [nativeCaptionsActive, setNativeCaptionsActive] = useState(false);
  const [currentSubtitle, setCurrentSubtitle] = useState("");
  const [displayedSubtitle, setDisplayedSubtitle] = useState("");
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [subtitleOffset, setSubtitleOffset] = useState<SubtitleOffset>(
    DEFAULT_SUBTITLE_OFFSET
  );

  // Blur mode: the line is readable only while the mouse is over it.
  const [blurRevealed, setBlurRevealed] = useState(false);

  const [popup, setPopup] = useState<WordPopupState | null>(null);
  const [selectionPopup, setSelectionPopup] =
    useState<SelectionPopupState | null>(null);

  useEffect(() => {
    const stopWatchingVideoId = watchVideoId((nextVideoId) => {
      setVideoId(nextVideoId);
      setCurrentSubtitle("");
      setDisplayedSubtitle("");
      setTranscriptCues([]);
      setUseTranscript(false);
      wordLookupSeqRef.current += 1;
      selectionLookupSeqRef.current += 1;
      setPopup(null);
      setSelectionPopup(null);
    });

    const stopWatchingRect = watchPlayerRect((rect) => {
      setPlayerRect(rect);
    });

    return () => {
      stopWatchingVideoId();
      stopWatchingRect();
    };
  }, []);

  useEffect(() => {
    chrome.storage.local
      .get(SUBTITLE_OFFSET_KEY)
      .then((result) => {
        const stored = result[SUBTITLE_OFFSET_KEY];
        if (!isSubtitleOffset(stored)) {
          return;
        }

        const next = clampSubtitleOffset(stored, playerRect);
        subtitleOffsetRef.current = next;
        setSubtitleOffset(next);
      })
      .catch((error) => {
        console.error("[LingText] Failed to load subtitle position:", error);
      });
  }, [playerRect]);

  useEffect(() => {
    const loadInitial = async () => {
      try {
        const [words, phrasesResult, settingsResult] = await Promise.all([
          chrome.runtime.sendMessage({ type: "LT2_GET_WORDS" }) as Promise<
            WordEntry[]
          >,
          chrome.runtime.sendMessage({ type: "LT2_GET_PHRASES" }) as Promise<
            PhraseEntry[]
          >,
          chrome.runtime.sendMessage({
            type: "LT2_GET_SETTINGS",
          }) as Promise<ExtensionSettings>,
        ]);

        setUnknownSet(new Set(words.map((word) => word.wordLower)));
        setPhrases(phrasesResult.map((phrase) => phrase.parts));
        setSettings(normalizeExtensionSettings(settingsResult));
      } catch (error) {
        console.error("[LingText] Failed to load extension data:", error);
      }
    };

    loadInitial().catch((error) => {
      console.error("[LingText] Failed initial content load:", error);
    });

    const handleStorageChange = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string
    ) => {
      if (area !== "local") {
        return;
      }

      if (changes.lt2_words) {
        const words =
          (changes.lt2_words.newValue as WordEntry[] | undefined) || [];
        setUnknownSet(new Set(words.map((word) => word.wordLower)));
      }

      if (changes.lt2_phrases) {
        const phraseEntries =
          (changes.lt2_phrases.newValue as PhraseEntry[] | undefined) || [];
        setPhrases(phraseEntries.map((entry) => entry.parts));
      }

      if (changes.lt2_settings) {
        const next =
          (changes.lt2_settings.newValue as ExtensionSettings | undefined) ||
          getDefaultExtensionSettings();
        setSettings(normalizeExtensionSettings(next));
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  useEffect(() => {
    if (window.location.pathname !== "/watch") {
      setNativeCaptionsActive(false);
      return;
    }

    let rafId: number | null = null;

    const update = () => {
      if (rafId !== null) {
        return;
      }

      rafId = requestAnimationFrame(() => {
        rafId = null;
        setNativeCaptionsActive(readNativeCaptionsActive());
      });
    };

    const target = document.body || document.documentElement;
    if (!target) {
      update();
      return;
    }

    const observer = new MutationObserver(update);
    observer.observe(target, {
      attributes: true,
      attributeFilter: ["aria-pressed", "class", "style", "hidden"],
      childList: true,
      subtree: true,
    });

    const intervalId = window.setInterval(update, 500);
    window.addEventListener("yt-navigate-finish", update as EventListener);
    update();

    return () => {
      observer.disconnect();
      window.clearInterval(intervalId);
      window.removeEventListener("yt-navigate-finish", update as EventListener);

      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [videoId]);

  useEffect(() => {
    if (!videoId || window.location.pathname !== "/watch") {
      setTranscriptCues([]);
      setUseTranscript(false);
      return;
    }

    let cancelled = false;
    // A transcript captured from the player's own request wins over the
    // direct fetch, which YouTube now answers with an empty body.
    let hasCaptured = false;

    const applyTranscript = (result: {
      cues: SubtitleCue[];
      isAutoGenerated: boolean;
    }): boolean => {
      const stableCues = stabilizeCues(result.cues, {
        isAutoGenerated: result.isAutoGenerated,
      });

      if (stableCues.length === 0) {
        return false;
      }

      setTranscriptCues(stableCues);
      setUseTranscript(true);
      return true;
    };

    const stopWatchingCaptures = watchCapturedTranscripts((transcript) => {
      if (cancelled || transcript.videoId !== videoId) {
        return;
      }

      hasCaptured = applyTranscript(transcript) || hasCaptured;
    });

    const run = async () => {
      const captured = await requestCapturedTranscript(videoId);
      if (cancelled || hasCaptured) {
        return;
      }

      if (captured && applyTranscript(captured)) {
        hasCaptured = true;
        return;
      }

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const result = await loadEnglishTranscript(videoId);
        if (cancelled || hasCaptured) {
          return;
        }

        if (result && applyTranscript(result)) {
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, 900));
      }
    };

    run().catch((error) => {
      console.error("[LingText] Failed to load transcript:", error);
    });

    return () => {
      cancelled = true;
      stopWatchingCaptures();
    };
  }, [videoId]);

  useEffect(() => {
    if (
      !useTranscript ||
      transcriptCues.length === 0 ||
      !nativeCaptionsActive
    ) {
      setCurrentSubtitle("");
      return;
    }

    const video = getPlayerVideo();
    if (!video) {
      setCurrentSubtitle("");
      return;
    }

    let rafId = 0;
    let lastIndex = -1;

    const tick = () => {
      const index = findCueIndexAtTime(transcriptCues, video.currentTime);

      if (index !== -1 && index !== lastIndex) {
        lastIndex = index;
        setCurrentSubtitle(transcriptCues[index].text);
      }

      if (index === -1) {
        if (lastIndex !== -1) {
          lastIndex = -1;
        }
        setCurrentSubtitle("");
      }

      rafId = requestAnimationFrame(tick);
    };

    tick();

    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [nativeCaptionsActive, useTranscript, transcriptCues]);

  useEffect(() => {
    if (useTranscript || window.location.pathname !== "/watch") {
      return;
    }

    let rafId: number | null = null;
    let cachedText = "";
    let committedText = "";
    let growthTimer: ReturnType<typeof setTimeout> | null = null;
    let growthSince = 0;

    const clearGrowthTimer = () => {
      if (growthTimer !== null) {
        clearTimeout(growthTimer);
        growthTimer = null;
      }
    };

    const commit = (text: string) => {
      clearGrowthTimer();
      growthSince = 0;
      committedText = text;
      setCurrentSubtitle(text);
    };

    const updateFromDom = () => {
      if (rafId !== null) {
        return;
      }

      rafId = requestAnimationFrame(() => {
        rafId = null;

        if (!nativeCaptionsActive) {
          cachedText = "";
          commit("");
          return;
        }

        const segments = document.querySelectorAll(
          ".ytp-caption-window-container .ytp-caption-segment"
        );

        const text = Array.from(segments)
          .map((segment) => segment.textContent || "")
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();

        if (text === cachedText) {
          return;
        }

        cachedText = text;

        const isGrowth =
          committedText.length > 0 &&
          text.toLowerCase().startsWith(committedText.toLowerCase());

        if (!isGrowth) {
          commit(text);
          return;
        }

        const now = performance.now();
        if (growthSince === 0) {
          growthSince = now;
        }

        if (now - growthSince >= DOM_GROWTH_MAX_WAIT_MS) {
          commit(text);
          return;
        }

        clearGrowthTimer();
        growthTimer = setTimeout(() => {
          growthTimer = null;
          commit(cachedText);
        }, DOM_GROWTH_SETTLE_MS);
      });
    };

    const target = document.body || document.documentElement;
    if (!target) {
      return;
    }

    const observer = new MutationObserver(updateFromDom);
    observer.observe(target, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    updateFromDom();

    return () => {
      observer.disconnect();
      clearGrowthTimer();
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [nativeCaptionsActive, useTranscript, videoId]);

  useEffect(() => {
    if (currentSubtitle === displayedSubtitle) {
      return;
    }

    if (!currentSubtitle) {
      setDisplayedSubtitle("");
      setIsTransitioning(false);
      return;
    }

    if (!displayedSubtitle) {
      setDisplayedSubtitle(currentSubtitle);
      setIsTransitioning(false);
      return;
    }

    const prev = displayedSubtitle.trim().toLowerCase();
    const next = currentSubtitle.trim().toLowerCase();
    const isGrowth = prev.length > 0 && next.startsWith(prev);

    if (isGrowth) {
      setDisplayedSubtitle(currentSubtitle);
      setIsTransitioning(false);
      return;
    }

    if (transitionTimeoutRef.current) {
      clearTimeout(transitionTimeoutRef.current);
    }

    setIsTransitioning(true);

    transitionTimeoutRef.current = setTimeout(() => {
      setDisplayedSubtitle(currentSubtitle);
      setIsTransitioning(false);
    }, SUBTITLE_TRANSITION_MS);

    return () => {
      if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current);
      }
    };
  }, [currentSubtitle, displayedSubtitle]);

  useEffect(() => {
    const shouldHide =
      settings.hideNativeCc &&
      window.location.pathname === "/watch" &&
      nativeCaptionsActive &&
      Boolean(currentSubtitle || displayedSubtitle);

    setNativeCcHidden(shouldHide);

    return () => {
      setNativeCcHidden(false);
    };
  }, [
    settings.hideNativeCc,
    nativeCaptionsActive,
    currentSubtitle,
    displayedSubtitle,
  ]);

  const isWatchPage = window.location.pathname === "/watch";
  const { loopCue, stopLoop } = useListeningShortcuts({
    cues: transcriptCues,
    // Only with cue timings (not the DOM fallback) and while the overlay is
    // showing them.
    enabled:
      settings.listeningShortcuts &&
      isWatchPage &&
      useTranscript &&
      transcriptCues.length > 0 &&
      nativeCaptionsActive,
    videoId,
  });

  const subtitleVisible =
    isWatchPage && Boolean(playerRect && displayedSubtitle);
  const hoverPause = useHoverPause({
    enabled: settings.pauseOnHover,
    // Popups only render with the subtitle, so a hidden one holds nothing.
    holdOpen: subtitleVisible && Boolean(popup || selectionPopup),
    subtitleVisible,
    videoId,
  });

  // A hidden subtitle gets no mouseleave; start the next line blurred.
  useEffect(() => {
    if (!subtitleVisible) {
      setBlurRevealed(false);
    }
  }, [subtitleVisible]);

  const { onMouseMove: hoverPauseMouseMove, onMouseLeave: hoverPauseLeave } =
    hoverPause;

  // Reveal on real mouse movement, like the hover pause: Chrome also fires
  // mouseenter/mousemove when a new line appears under a resting cursor.
  const handleSubtitleMouseMove = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      hoverPauseMouseMove(event);
      if (event.movementX !== 0 || event.movementY !== 0) {
        setBlurRevealed(true);
      }
    },
    [hoverPauseMouseMove]
  );

  const handleSubtitleMouseLeave = useCallback(() => {
    hoverPauseLeave();
    setBlurRevealed(false);
  }, [hoverPauseLeave]);

  const toggleBlurSubtitles = useCallback(() => {
    const blurSubtitles = !settings.blurSubtitles;
    setSettings((prev) => ({ ...prev, blurSubtitles }));
    chrome.runtime
      .sendMessage({ type: "LT2_SET_SETTINGS", payload: { blurSubtitles } })
      .catch((error) => {
        console.error("[LingText] Failed to save blur setting:", error);
      });
  }, [settings.blurSubtitles]);

  const handleWordClick = useCallback(
    async (word: string, lower: string, x: number, y: number) => {
      const lookupSeq = wordLookupSeqRef.current + 1;
      wordLookupSeqRef.current = lookupSeq;
      selectionLookupSeqRef.current += 1;
      setSelectionPopup(null);
      setPopup({ x, y, word, lower, translation: "", isLoading: true });

      try {
        const existing = (await chrome.runtime.sendMessage({
          type: "LT2_GET_WORD",
          payload: lower,
        })) as WordEntry | null;

        if (lookupSeq !== wordLookupSeqRef.current) {
          return;
        }

        if (existing) {
          setPopup({
            x,
            y,
            word,
            lower,
            translation: existing.translation,
            disclaimer: undefined,
            isLoading: false,
          });
          return;
        }

        const translated = await translateTerm(word, settings.translator);

        if (lookupSeq !== wordLookupSeqRef.current) {
          return;
        }

        setPopup({
          x,
          y,
          word,
          lower,
          translation: translated.translation || "...",
          disclaimer: translated.disclaimer,
          isLoading: false,
        });
      } catch (error) {
        console.error("[LingText] Failed to open word popup:", error);
        if (lookupSeq === wordLookupSeqRef.current) {
          setPopup({
            x,
            y,
            word,
            lower,
            translation: "No se pudo traducir.",
            isLoading: false,
          });
        }
      }
    },
    [settings]
  );

  const handleSpeak = useCallback((word: string) => {
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = "en-US";
    speechSynthesis.speak(utterance);
  }, []);

  const handleMarkKnown = useCallback(async (lower: string) => {
    await chrome.runtime.sendMessage({
      type: "LT2_DELETE_WORD",
      payload: lower,
    });

    setUnknownSet((prev) => {
      const next = new Set(prev);
      next.delete(lower);
      return next;
    });

    setPopup(null);
  }, []);

  const handleMarkUnknown = useCallback(
    async (lower: string, word: string, translation: string) => {
      const entry: WordEntry = {
        word,
        wordLower: lower,
        translation,
        status: "unknown",
        addedAt: Date.now(),
      };

      await chrome.runtime.sendMessage({
        type: "LT2_PUT_WORD",
        payload: entry,
      });

      setUnknownSet((prev) => {
        const next = new Set(prev);
        next.add(lower);
        return next;
      });

      setPopup(null);
    },
    []
  );

  const closePopups = useCallback(() => {
    wordLookupSeqRef.current += 1;
    selectionLookupSeqRef.current += 1;
    setPopup(null);
    setSelectionPopup(null);
  }, []);

  const persistSubtitleOffset = useCallback((offset: SubtitleOffset) => {
    chrome.storage.local
      .set({ [SUBTITLE_OFFSET_KEY]: offset })
      .catch((error) => {
        console.error("[LingText] Failed to save subtitle position:", error);
      });
  }, []);

  const handleSubtitleDragStart = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();

      subtitleDragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startOffset: subtitleOffsetRef.current,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    []
  );

  const handleSubtitleDragMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const dragState = subtitleDragRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const next = clampSubtitleOffset(
        {
          x: dragState.startOffset.x + event.clientX - dragState.startX,
          y: dragState.startOffset.y + event.clientY - dragState.startY,
        },
        playerRect
      );

      subtitleOffsetRef.current = next;
      setSubtitleOffset(next);
    },
    [playerRect]
  );

  const handleSubtitleDragEnd = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const dragState = subtitleDragRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      subtitleDragRef.current = null;

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      persistSubtitleOffset(subtitleOffsetRef.current);
    },
    [persistSubtitleOffset]
  );

  const handleMouseUp = useCallback(async () => {
    // @ts-expect-error ShadowRoot.getSelection is not typed in lib.dom.
    const selection = shadowRoot.getSelection?.() || document.getSelection();
    if (!selection || selection.isCollapsed) {
      return;
    }

    let range: Range;
    try {
      range = selection.getRangeAt(0);
    } catch {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    const text = selection.toString().trim();
    if (!text || text.length < 3) {
      return;
    }

    const words = text
      .split(/\s+/)
      .map((part: string) => part.trim())
      .filter(Boolean);

    if (words.length < 2) {
      return;
    }

    const rect = range.getBoundingClientRect();
    const lookupSeq = selectionLookupSeqRef.current + 1;
    selectionLookupSeqRef.current = lookupSeq;
    wordLookupSeqRef.current += 1;

    setSelectionPopup({
      x: rect.left + rect.width / 2,
      y: rect.top,
      text,
      translation: "",
      isLoading: true,
    });

    setPopup(null);
    selection.removeAllRanges();

    try {
      const result = await translateTerm(text, settings.translator);

      if (lookupSeq !== selectionLookupSeqRef.current) {
        return;
      }

      setSelectionPopup({
        x: rect.left + rect.width / 2,
        y: rect.top,
        text,
        translation: result.translation || "...",
        disclaimer: result.disclaimer,
        isLoading: false,
      });
    } catch (error) {
      console.error("[LingText] Failed to translate selection:", error);
      if (lookupSeq === selectionLookupSeqRef.current) {
        setSelectionPopup({
          x: rect.left + rect.width / 2,
          y: rect.top,
          text,
          translation: "No se pudo traducir.",
          isLoading: false,
        });
      }
    }
  }, [settings.translator, shadowRoot]);

  const handleSavePhrase = useCallback(
    async (text: string, translation: string) => {
      const parts = tokenize(text)
        .filter((token) => token.isWord)
        .map((token) => token.lower || normalizeWord(token.text))
        .filter(Boolean);

      if (parts.length < 2) {
        return;
      }

      const entry: PhraseEntry = {
        phrase: text,
        phraseLower: parts.join(" "),
        translation,
        parts,
        addedAt: Date.now(),
      };

      await chrome.runtime.sendMessage({
        type: "LT2_PUT_PHRASE",
        payload: entry,
      });
      setPhrases((prev) => [...prev, parts]);
      setSelectionPopup(null);
    },
    []
  );

  if (window.location.pathname !== "/watch") {
    return null;
  }

  if (!playerRect || !displayedSubtitle) {
    return null;
  }

  // Keep the line readable while one of its popups is open.
  const isBlurred =
    settings.blurSubtitles && !blurRevealed && !popup && !selectionPopup;

  return (
    <div
      ref={containerRef}
      className="lingtext-wrapper"
      style={{
        position: "fixed",
        left: playerRect.left,
        top: playerRect.top,
        width: playerRect.width,
        height: playerRect.height,
        pointerEvents: "none",
        zIndex: 2147483646,
      }}
      onMouseUp={handleMouseUp}
    >
      <div
        className={`lingtext-container ${isTransitioning ? "lingtext-transitioning" : ""} ${isBlurred ? "lingtext-blurred" : ""}`}
        style={{
          transform: `translate(calc(-50% + ${subtitleOffset.x}px), ${subtitleOffset.y}px)`,
        }}
      >
        <button
          type="button"
          className="lingtext-drag-handle"
          aria-label="Mover subtítulos"
          title="Mover subtítulos"
          onPointerDown={handleSubtitleDragStart}
          onPointerMove={handleSubtitleDragMove}
          onPointerUp={handleSubtitleDragEnd}
          onPointerCancel={handleSubtitleDragEnd}
          onClick={(event) => event.stopPropagation()}
          onMouseUp={(event) => event.stopPropagation()}
        >
          <span className="lingtext-drag-handle-dots" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`lingtext-blur-toggle ${settings.blurSubtitles ? "lingtext-blur-toggle-active" : ""}`}
          aria-pressed={settings.blurSubtitles}
          aria-label="Desenfocar subtítulos"
          title={
            settings.blurSubtitles
              ? "Subtítulos desenfocados: pasa el ratón para leerlos. Clic para mostrarlos siempre"
              : "Desenfocar subtítulos para practicar la escucha"
          }
          onClick={(event) => {
            event.stopPropagation();
            toggleBlurSubtitles();
          }}
          onMouseUp={(event) => event.stopPropagation()}
        >
          {settings.blurSubtitles ? (
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M2 2l12 12M6.6 6.7a2 2 0 0 0 2.7 2.7M4.4 4.6C2.9 5.6 1.8 7 1.5 8c.7 2 3.2 4.5 6.5 4.5 1.3 0 2.5-.4 3.5-1M7 3.6c.3 0 .7-.1 1-.1 3.3 0 5.8 2.5 6.5 4.5-.3.8-.8 1.7-1.5 2.4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M1.5 8c.7-2 3.2-4.5 6.5-4.5s5.8 2.5 6.5 4.5c-.7 2-3.2 4.5-6.5 4.5S2.2 10 1.5 8z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <circle
                cx="8"
                cy="8"
                r="2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              />
            </svg>
          )}
        </button>
        {loopCue && (
          <button
            type="button"
            className="lingtext-loop-badge"
            aria-label="Quitar bucle"
            title="Repitiendo esta línea. Clic o B para quitar el bucle"
            onClick={(event) => {
              event.stopPropagation();
              stopLoop();
            }}
            onMouseUp={(event) => event.stopPropagation()}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M3 7.5V6a2 2 0 0 1 2-2h7m-2-2 2 2-2 2M13 8.5V10a2 2 0 0 1-2 2H4m2 2-2-2 2-2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>Bucle</span>
            <span className="lingtext-loop-badge-close" aria-hidden="true">
              ×
            </span>
          </button>
        )}
        <SubtitleOverlay
          text={displayedSubtitle}
          unknownSet={unknownSet}
          phrases={phrases}
          onWordClick={handleWordClick}
          onMouseEnter={hoverPause.onMouseEnter}
          onMouseMove={handleSubtitleMouseMove}
          onMouseLeave={handleSubtitleMouseLeave}
        />
      </div>

      {popup && (
        <WordPopup
          popup={popup}
          isUnknown={unknownSet.has(popup.lower)}
          onSpeak={handleSpeak}
          onMarkKnown={handleMarkKnown}
          onMarkUnknown={handleMarkUnknown}
          onClose={closePopups}
        />
      )}

      {selectionPopup && (
        <SelectionPopup
          popup={selectionPopup}
          onSpeak={handleSpeak}
          onSave={handleSavePhrase}
          onClose={closePopups}
        />
      )}
    </div>
  );
}
