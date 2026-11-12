import { TRANSLATORS } from "./vocabulary";

export { TRANSLATORS };

export const TRANSLATOR_LABELS: Record<TRANSLATORS, string> = {
  [TRANSLATORS.CHROME]: "⚡ Rápido | Básico",
  [TRANSLATORS.MYMEMORY]: "🆓 Gratis | Básico",
};

export function isChromeAIAvailable(): boolean {
  const runtime = globalThis as typeof globalThis & {
    navigator?: { userAgent?: string };
    Translator?: unknown;
  };
  const userAgent = runtime.navigator?.userAgent ?? "";
  const isChrome =
    userAgent.includes("Chrome") &&
    !userAgent.includes("Edg") &&
    !userAgent.includes("OPR");

  return isChrome && "Translator" in runtime;
}
