import type { ExtensionSettings } from "@/types";
import { TRANSLATORS } from "@/types";

export function isChromeBrowser(): boolean {
  const userAgent = globalThis.navigator?.userAgent ?? "";
  return (
    userAgent.includes("Chrome") &&
    !userAgent.includes("Edg") &&
    !userAgent.includes("OPR") &&
    !userAgent.includes("Firefox")
  );
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function getDefaultExtensionSettings(): ExtensionSettings {
  return {
    translator: isChromeBrowser() ? TRANSLATORS.CHROME : TRANSLATORS.MYMEMORY,
    captionLanguage: "en",
    hideNativeCc: true,
    listeningShortcuts: true,
    pauseOnHover: true,
    blurSubtitles: false,
  };
}

export function normalizeExtensionSettings(
  settings?: Partial<ExtensionSettings>
): ExtensionSettings {
  const defaults = getDefaultExtensionSettings();
  // Picks known fields only, so settings saved by 1.2 lose their OpenRouter
  // apiKey and model the next time they are written.
  const next: ExtensionSettings = {
    translator: settings?.translator ?? defaults.translator,
    captionLanguage: "en",
    hideNativeCc: readBoolean(settings?.hideNativeCc, defaults.hideNativeCc),
    listeningShortcuts: readBoolean(
      settings?.listeningShortcuts,
      defaults.listeningShortcuts
    ),
    pauseOnHover: readBoolean(settings?.pauseOnHover, defaults.pauseOnHover),
    blurSubtitles: readBoolean(settings?.blurSubtitles, defaults.blurSubtitles),
  };

  if (!Object.values(TRANSLATORS).includes(next.translator)) {
    next.translator = defaults.translator;
  }

  if (!isChromeBrowser() && next.translator === TRANSLATORS.CHROME) {
    next.translator = TRANSLATORS.MYMEMORY;
  }

  return next;
}
