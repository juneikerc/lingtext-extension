import { useEffect, useState } from "react";

import type {
  ExtensionSettings,
  PhraseEntry,
  Translator,
  WordEntry,
} from "@/types";
import {
  getDefaultExtensionSettings,
  normalizeExtensionSettings,
} from "@/utils/settings";
import { lingtextUrl, openVocabularyPage } from "@/utils/links";
import { TRANSLATOR_LABELS } from "@/utils/translate";

export default function Popup() {
  const [stats, setStats] = useState({ words: 0, phrases: 0 });
  const [settings, setSettings] = useState<ExtensionSettings>(
    getDefaultExtensionSettings
  );

  useEffect(() => {
    loadAll().catch((error) => {
      console.error("[LingText Popup] Failed to load initial data:", error);
    });
  }, []);

  const loadAll = async () => {
    const [words, phrases, currentSettings] = await Promise.all([
      chrome.runtime.sendMessage({ type: "LT2_GET_WORDS" }) as Promise<
        WordEntry[]
      >,
      chrome.runtime.sendMessage({ type: "LT2_GET_PHRASES" }) as Promise<
        PhraseEntry[]
      >,
      chrome.runtime.sendMessage({
        type: "LT2_GET_SETTINGS",
      }) as Promise<ExtensionSettings>,
    ]);

    setStats({ words: words.length, phrases: phrases.length });
    setSettings(normalizeExtensionSettings(currentSettings));
  };

  const updateSettings = async (patch: Partial<ExtensionSettings>) => {
    const next = (await chrome.runtime.sendMessage({
      type: "LT2_SET_SETTINGS",
      payload: patch,
    })) as ExtensionSettings;

    setSettings(normalizeExtensionSettings(next));
  };

  const openVocabulary = () => {
    openVocabularyPage()
      .then(() => window.close())
      .catch((error) => {
        console.error("[LingText Popup] Failed to open vocabulary:", error);
      });
  };

  return (
    <div className="popup">
      <header className="popup-header">
        <div className="logo">
          <img className="logo-icon" src="/icons/icon-32.png" alt="LingText" />
          <span className="logo-text">
            Ling<span className="logo-text-accent">Text</span>
          </span>
        </div>
        <span className="version">v{chrome.runtime.getManifest().version}</span>
      </header>

      <main className="popup-body">
        <section>
          <h2 className="section-title">Tu vocabulario</h2>
          <div className="stats-grid">
            <div className="stat-card">
              <span className="stat-value">{stats.words}</span>
              <span className="stat-label">Palabras</span>
            </div>
            <div className="stat-card">
              <span className="stat-value">{stats.phrases}</span>
              <span className="stat-label">Frases</span>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-primary vocab-button"
            onClick={openVocabulary}
          >
            Ver mi vocabulario
          </button>
        </section>

        <section className="card">
          <h2 className="section-title">Traductor</h2>
          <select
            className="translator-select"
            value={settings.translator}
            onChange={(event) =>
              updateSettings({ translator: event.target.value as Translator })
            }
          >
            {Object.entries(TRANSLATOR_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </section>

        <section className="help-section">
          <h2 className="section-title">Cómo usar</h2>
          <ol>
            <li>Activa los subtítulos en inglés en YouTube</li>
            <li>Haz clic en palabras para traducirlas</li>
            <li>Guarda palabras y frases para repasarlas</li>
          </ol>
        </section>

        <a
          className="promo-link"
          href={lingtextUrl("/", "popup_promo")}
          target="_blank"
          rel="noreferrer"
        >
          <span className="promo-link-title">Lee en inglés con LingText</span>
          <span className="promo-link-text">
            Textos, cuentos y canciones con traducción al hacer clic. Gratis.
          </span>
        </a>
      </main>

      <footer className="popup-footer">
        <a
          href={lingtextUrl("/", "popup_footer")}
          target="_blank"
          rel="noreferrer"
        >
          lingtext.org
        </a>
      </footer>
    </div>
  );
}
