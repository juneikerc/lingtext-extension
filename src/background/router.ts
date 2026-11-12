import type { ExtensionMessage } from "@/types";

import {
  deletePhrase,
  deleteWord,
  getPhrases,
  getSettings,
  getWord,
  getWords,
  putPhrase,
  putWord,
  setSettings,
} from "./store";

export async function handleMessage(
  message: ExtensionMessage
): Promise<unknown> {
  switch (message.type) {
    case "LT2_GET_WORDS":
      return getWords();

    case "LT2_GET_WORD":
      return getWord(message.payload);

    case "LT2_PUT_WORD":
      await putWord(message.payload);
      return { success: true };

    case "LT2_DELETE_WORD":
      await deleteWord(message.payload);
      return { success: true };

    case "LT2_GET_PHRASES":
      return getPhrases();

    case "LT2_PUT_PHRASE":
      await putPhrase(message.payload);
      return { success: true };

    case "LT2_DELETE_PHRASE":
      await deletePhrase(message.payload);
      return { success: true };

    case "LT2_GET_SETTINGS":
      return getSettings();

    case "LT2_SET_SETTINGS":
      return setSettings(message.payload);

    default:
      return { error: "Unknown message type" };
  }
}
