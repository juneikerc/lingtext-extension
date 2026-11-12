export interface WordEntry {
  word: string;
  wordLower: string;
  translation: string;
  status: "unknown";
  addedAt: number;
  updatedAt?: number;
}

export interface PhraseEntry {
  phrase: string;
  phraseLower: string;
  translation: string;
  parts: string[];
  addedAt: number;
  updatedAt?: number;
}

export enum TRANSLATORS {
  CHROME = "chrome",
  MYMEMORY = "mymemory",
}

export type Translator = TRANSLATORS;
