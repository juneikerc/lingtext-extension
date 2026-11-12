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

export function getDefaultExtensionSettings(): ExtensionSettings {
  return {
    translator: isChromeBrowser() ? TRANSLATORS.CHROME : TRANSLATORS.MYMEMORY,
    captionLanguage: "en",
    hideNativeCc: true,
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
    hideNativeCc: settings?.hideNativeCc ?? defaults.hideNativeCc,
  };

  if (!Object.values(TRANSLATORS).includes(next.translator)) {
    next.translator = defaults.translator;
  }

  if (!isChromeBrowser() && next.translator === TRANSLATORS.CHROME) {
    next.translator = TRANSLATORS.MYMEMORY;
  }

  return next;
}
