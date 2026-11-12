import type { ExtensionSettings, PhraseEntry, WordEntry } from "@/types";
import {
  getDefaultExtensionSettings,
  normalizeExtensionSettings,
} from "@/utils/settings";

// v4 dropped web sync: no tombstones, sync clocks or last-sync timestamp.
const SCHEMA_VERSION = 4;
const STORAGE_KEYS = {
  VERSION: "lt2_schema_version",
  WORDS: "lt2_words",
  PHRASES: "lt2_phrases",
  SETTINGS: "lt2_settings",
} as const;
const LEGACY_SYNC_KEYS = [
  "lt2_last_sync",
  "lt2_deleted_words",
  "lt2_pending_sync",
] as const;

interface LegacyDeletedEntry {
  key: string;
  deletedAt: number;
}

let storageMutationQueue: Promise<unknown> = Promise.resolve();

function enqueueStorageMutation<T>(operation: () => Promise<T>): Promise<T> {
  const next = storageMutationQueue.then(operation, operation);
  storageMutationQueue = next.catch(() => undefined);
  return next;
}

// Entries saved before v4 carry sync clocks from the old web sync.
function stripSync<T extends object>(entry: T): T {
  if (!("sync" in entry)) {
    return entry;
  }

  const { sync: _sync, ...rest } = entry as T & { sync?: unknown };
  return rest as T;
}

// Words deleted before v4 could still sit in lt2_words behind a tombstone
// (an older sync re-imported them). Apply those tombstones one last time.
function dropTombstonedWords(
  words: WordEntry[],
  deleted: LegacyDeletedEntry[] | undefined
): WordEntry[] {
  if (!Array.isArray(deleted) || deleted.length === 0) {
    return words;
  }

  const deletedAtByKey = new Map<string, number>();
  for (const entry of deleted) {
    const previous = deletedAtByKey.get(entry.key) ?? 0;
    deletedAtByKey.set(entry.key, Math.max(previous, entry.deletedAt));
  }

  return words.filter((word) => {
    const deletedAt = deletedAtByKey.get(word.wordLower);
    return deletedAt === undefined || deletedAt < (word.updatedAt ?? word.addedAt);
  });
}

export async function initializeStore(): Promise<void> {
  const result = await chrome.storage.local.get([
    STORAGE_KEYS.VERSION,
    STORAGE_KEYS.WORDS,
    STORAGE_KEYS.PHRASES,
    STORAGE_KEYS.SETTINGS,
    "lt2_deleted_words",
  ]);

  if (result[STORAGE_KEYS.VERSION] === SCHEMA_VERSION) {
    return;
  }

  const words = dropTombstonedWords(
    ((result[STORAGE_KEYS.WORDS] as WordEntry[] | undefined) || []).map(
      stripSync
    ),
    result.lt2_deleted_words as LegacyDeletedEntry[] | undefined
  );
  const phrases = (
    (result[STORAGE_KEYS.PHRASES] as PhraseEntry[] | undefined) || []
  ).map(stripSync);
  const settings = normalizeExtensionSettings(
    (result[STORAGE_KEYS.SETTINGS] as Partial<ExtensionSettings> | undefined) ||
      getDefaultExtensionSettings()
  );

  await chrome.storage.local.set({
    [STORAGE_KEYS.VERSION]: SCHEMA_VERSION,
    [STORAGE_KEYS.WORDS]: words,
    [STORAGE_KEYS.PHRASES]: phrases,
    [STORAGE_KEYS.SETTINGS]: settings,
  });
  await chrome.storage.local.remove([...LEGACY_SYNC_KEYS]);
}

export async function getWords(): Promise<WordEntry[]> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.WORDS);
  return (result[STORAGE_KEYS.WORDS] as WordEntry[] | undefined) || [];
}

export async function getWord(wordLower: string): Promise<WordEntry | null> {
  const words = await getWords();
  return words.find((entry) => entry.wordLower === wordLower) || null;
}

export async function putWord(entry: WordEntry): Promise<void> {
  await enqueueStorageMutation(async () => {
    const words = await getWords();
    const index = words.findIndex((item) => item.wordLower === entry.wordLower);

    if (index >= 0) {
      words[index] = {
        ...words[index],
        ...entry,
        addedAt: words[index].addedAt,
        updatedAt: Date.now(),
      };
    } else {
      words.push(entry);
    }

    await chrome.storage.local.set({ [STORAGE_KEYS.WORDS]: words });
  });
}

export async function deleteWord(wordLower: string): Promise<void> {
  await enqueueStorageMutation(async () => {
    const words = await getWords();
    await chrome.storage.local.set({
      [STORAGE_KEYS.WORDS]: words.filter((item) => item.wordLower !== wordLower),
    });
  });
}

export async function getPhrases(): Promise<PhraseEntry[]> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.PHRASES);
  return (result[STORAGE_KEYS.PHRASES] as PhraseEntry[] | undefined) || [];
}

export async function putPhrase(entry: PhraseEntry): Promise<void> {
  await enqueueStorageMutation(async () => {
    const phrases = await getPhrases();
    const index = phrases.findIndex(
      (item) => item.phraseLower === entry.phraseLower
    );

    if (index >= 0) {
      phrases[index] = {
        ...phrases[index],
        ...entry,
        addedAt: phrases[index].addedAt,
        updatedAt: Date.now(),
      };
    } else {
      phrases.push(entry);
    }

    await chrome.storage.local.set({ [STORAGE_KEYS.PHRASES]: phrases });
  });
}

export async function deletePhrase(phraseLower: string): Promise<void> {
  await enqueueStorageMutation(async () => {
    const phrases = await getPhrases();
    await chrome.storage.local.set({
      [STORAGE_KEYS.PHRASES]: phrases.filter(
        (item) => item.phraseLower !== phraseLower
      ),
    });
  });
}

export async function getSettings(): Promise<ExtensionSettings> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  const stored = result[STORAGE_KEYS.SETTINGS] as ExtensionSettings | undefined;

  if (!stored) {
    return getDefaultExtensionSettings();
  }

  return normalizeExtensionSettings(stored);
}

export async function setSettings(
  patch: Partial<ExtensionSettings>
): Promise<ExtensionSettings> {
  return enqueueStorageMutation(async () => {
    const current = await getSettings();
    const next = normalizeExtensionSettings({ ...current, ...patch });

    await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: next });
    return next;
  });
}
