/**
 * Shared extension types for LingText Chrome extension (v2)
 */

import type {
  PhraseEntry as SharedPhraseEntry,
  Translator as SharedTranslator,
  WordEntry as SharedWordEntry,
} from "@/shared/vocabulary";
import { TRANSLATORS as SharedTranslators } from "@/shared/vocabulary";

export { SharedTranslators as TRANSLATORS };
export type Translator = SharedTranslator;

export type WordEntry = SharedWordEntry;

export type PhraseEntry = SharedPhraseEntry;

export interface ExtensionSettings {
  translator: Translator;
  captionLanguage: "en";
  hideNativeCc: boolean;
  /** R, Shift+←/→ and B on the watch page (needs a captured transcript). */
  listeningShortcuts: boolean;
  /** Pause while the mouse is over the subtitle; resume when it leaves. */
  pauseOnHover: boolean;
}

export interface WordPopupState {
  x: number;
  y: number;
  word: string;
  lower: string;
  translation: string;
  disclaimer?: string;
  isLoading?: boolean;
}

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

export type ExtensionMessage =
  | { type: "LT2_GET_WORDS" }
  | { type: "LT2_GET_WORD"; payload: string }
  | { type: "LT2_PUT_WORD"; payload: WordEntry }
  | { type: "LT2_DELETE_WORD"; payload: string }
  | { type: "LT2_GET_PHRASES" }
  | { type: "LT2_PUT_PHRASE"; payload: PhraseEntry }
  | { type: "LT2_DELETE_PHRASE"; payload: string }
  | { type: "LT2_GET_SETTINGS" }
  | {
      type: "LT2_SET_SETTINGS";
      payload: Partial<ExtensionSettings>;
    };
