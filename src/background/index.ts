/**
 * Background service worker entrypoint.
 */

import type { ExtensionMessage } from "@/types";
import { vocabularyPageUrl } from "@/utils/links";

import { handleMessage } from "./router";
import { initializeStore } from "./store";

const storeReady = initializeStore().catch((error) => {
  console.error("[LingText] Failed to initialize extension store:", error);
  throw error;
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason !== chrome.runtime.OnInstalledReason.INSTALL) {
    return;
  }

  chrome.tabs.create({ url: vocabularyPageUrl({ welcome: true }) }).catch(
    (error) => {
      console.error("[LingText] Failed to open welcome page:", error);
    }
  );
});

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    storeReady
      .then(() => handleMessage(message))
      .then(sendResponse)
      .catch((error) => {
        console.error("[LingText] Error handling runtime message:", error);
        sendResponse({
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return true;
  }
);
