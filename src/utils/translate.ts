/**
 * Translation helpers for the extension.
 */

import {
  isChromeAIAvailable,
  TRANSLATOR_LABELS,
  TRANSLATORS,
} from "@/shared/translation";
import type { Translator } from "@/types";

const MYMEMORY_DISCLAIMER = "Este traductor gratuito a veces puede fallar.";
// Chrome's on-device model returns one literal rendering, never alternatives.
const CHROME_DISCLAIMER = "Traducción literal, sin variantes ni matices.";

interface TranslationResult {
  translation: string;
  error?: string;
  disclaimer?: string;
}

export { isChromeAIAvailable, TRANSLATOR_LABELS, TRANSLATORS };

export async function translateFromChrome(
  term: string
): Promise<{ translation: string }> {
  if (!("Translator" in self)) {
    return { translation: "" };
  }

  try {
    // @ts-expect-error Translator is an emerging Chrome API.
    const translator = await Translator.create({
      sourceLanguage: "en",
      targetLanguage: "es",
    });
    const result = await translator.translate(term);
    return { translation: String(result || "").trim() };
  } catch (error) {
    console.error("[LingText] Chrome Translation API error:", error);
    return { translation: "" };
  }
}

export async function translateWithMyMemory(
  term: string
): Promise<TranslationResult> {
  const sanitizedText = term.trim();
  if (!sanitizedText) {
    return { translation: "", error: "INVALID_TEXT" };
  }

  try {
    const url = new URL("https://api.mymemory.translated.net/get");
    url.searchParams.set("q", sanitizedText);
    url.searchParams.set("langpair", "en|es");

    const response = await fetch(url.toString());
    if (!response.ok) {
      return { translation: "", error: "API_ERROR" };
    }

    const data = (await response.json()) as {
      responseData?: { translatedText?: string };
      responseStatus?: number | string;
      responseDetails?: string;
      quotaFinished?: boolean;
    };
    const responseStatus =
      data.responseStatus === undefined
        ? 200
        : Number.parseInt(String(data.responseStatus), 10);
    const responseDetails = String(data.responseDetails || "").toLowerCase();
    const quotaExceeded =
      data.quotaFinished === true ||
      responseDetails.includes("quota") ||
      (responseDetails.includes("limit") && responseDetails.includes("day"));

    if (quotaExceeded) {
      return { translation: "", error: "MYMEMORY_QUOTA_EXCEEDED" };
    }

    if (responseStatus !== 200) {
      return { translation: "", error: "API_ERROR" };
    }

    const translation = (data.responseData?.translatedText || "").trim();
    if (!translation) {
      return { translation: "", error: "INVALID_RESPONSE" };
    }

    return { translation, disclaimer: MYMEMORY_DISCLAIMER };
  } catch (error) {
    console.error("[LingText] MyMemory translation error:", error);
    return { translation: "", error: "NETWORK_ERROR" };
  }
}

// Chrome tries the on-device model first and falls back to MyMemory.
export async function translateTerm(
  term: string,
  translator: Translator
): Promise<TranslationResult> {
  if (translator === TRANSLATORS.CHROME) {
    const local = await translateFromChrome(term);
    if (local.translation) {
      return { translation: local.translation, disclaimer: CHROME_DISCLAIMER };
    }
  }

  return translateWithMyMemory(term);
}
