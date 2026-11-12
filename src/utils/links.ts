const LINGTEXT_ORIGIN = "https://lingtext.org";

export const VOCABULARY_PAGE_PATH = "src/vocabulary/index.html";

/** lingtext.org link tagged so visits from the extension show up in analytics. */
export function lingtextUrl(path: string, content: string): string {
  const url = new URL(path, LINGTEXT_ORIGIN);
  url.searchParams.set("utm_source", "chrome_extension");
  url.searchParams.set("utm_medium", "extension");
  url.searchParams.set("utm_campaign", "lingtext_for_youtube");
  url.searchParams.set("utm_content", content);
  return url.toString();
}

export function vocabularyPageUrl(options: { welcome?: boolean } = {}): string {
  const url = chrome.runtime.getURL(VOCABULARY_PAGE_PATH);
  return options.welcome ? `${url}?welcome=1` : url;
}

/**
 * The vocabulary page is the extension's options page, so Chrome focuses an
 * already-open tab instead of opening a duplicate.
 */
export function openVocabularyPage(): Promise<void> {
  return chrome.runtime.openOptionsPage();
}
