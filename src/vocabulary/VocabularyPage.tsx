import { useEffect, useMemo, useState } from "react";

import type { PhraseEntry, WordEntry } from "@/types";
import { lingtextUrl } from "@/utils/links";

type Tab = "words" | "phrases";

interface VocabularyItem {
  key: string;
  text: string;
  translation: string;
  addedAt: number;
}

const dateFormatter = new Intl.DateTimeFormat("es", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function toItems(words: WordEntry[], phrases: PhraseEntry[], tab: Tab) {
  const items: VocabularyItem[] =
    tab === "words"
      ? words.map((word) => ({
          key: word.wordLower,
          text: word.word,
          translation: word.translation,
          addedAt: word.addedAt,
        }))
      : phrases.map((phrase) => ({
          key: phrase.phraseLower,
          text: phrase.phrase,
          translation: phrase.translation,
          addedAt: phrase.addedAt,
        }));

  return items.sort((a, b) => b.addedAt - a.addedAt);
}

function csvCell(value: string): string {
  return /[",\n;]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function downloadCsv(words: WordEntry[], phrases: PhraseEntry[]) {
  const rows = [
    ["tipo", "ingles", "espanol", "guardada"],
    ...words.map((word) => [
      "palabra",
      word.word,
      word.translation,
      new Date(word.addedAt).toISOString().slice(0, 10),
    ]),
    ...phrases.map((phrase) => [
      "frase",
      phrase.phrase,
      phrase.translation,
      new Date(phrase.addedAt).toISOString().slice(0, 10),
    ]),
  ];

  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  // BOM so Excel opens accents correctly.
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `lingtext-vocabulario-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function speak(text: string) {
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  speechSynthesis.speak(utterance);
}

export default function VocabularyPage() {
  const isWelcome = new URLSearchParams(window.location.search).has("welcome");
  const version = chrome.runtime.getManifest().version;

  const [words, setWords] = useState<WordEntry[]>([]);
  const [phrases, setPhrases] = useState<PhraseEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<Tab>("words");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const load = async () => {
      const [nextWords, nextPhrases] = await Promise.all([
        chrome.runtime.sendMessage({ type: "LT2_GET_WORDS" }) as Promise<
          WordEntry[]
        >,
        chrome.runtime.sendMessage({ type: "LT2_GET_PHRASES" }) as Promise<
          PhraseEntry[]
        >,
      ]);
      setWords(nextWords || []);
      setPhrases(nextPhrases || []);
      setLoaded(true);
    };

    load().catch((error) => {
      console.error("[LingText] Failed to load vocabulary:", error);
      setLoaded(true);
    });

    // Keep the list live while the user saves words on YouTube.
    const handleChange = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string
    ) => {
      if (area !== "local") {
        return;
      }
      if (changes.lt2_words) {
        setWords((changes.lt2_words.newValue as WordEntry[] | undefined) || []);
      }
      if (changes.lt2_phrases) {
        setPhrases(
          (changes.lt2_phrases.newValue as PhraseEntry[] | undefined) || []
        );
      }
    };

    chrome.storage.onChanged.addListener(handleChange);
    return () => chrome.storage.onChanged.removeListener(handleChange);
  }, []);

  const items = useMemo(() => {
    const all = toItems(words, phrases, tab);
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return all;
    }
    return all.filter(
      (item) =>
        item.text.toLowerCase().includes(needle) ||
        item.translation.toLowerCase().includes(needle)
    );
  }, [words, phrases, tab, query]);

  const handleDelete = (key: string) => {
    chrome.runtime
      .sendMessage({
        type: tab === "words" ? "LT2_DELETE_WORD" : "LT2_DELETE_PHRASE",
        payload: key,
      })
      .catch((error) => {
        console.error("[LingText] Failed to delete entry:", error);
      });
  };

  const total = words.length + phrases.length;
  const emptyLabel = tab === "words" ? "palabras" : "frases";

  return (
    <div className="page">
      <header className="topbar">
        <div className="topbar-inner">
          <a
            className="logo"
            href={lingtextUrl("/", "header_logo")}
            target="_blank"
            rel="noreferrer"
          >
            <img className="logo-icon" src="/icons/icon-48.png" alt="" />
            <span className="logo-text">
              Ling<span className="logo-accent">Text</span>
            </span>
            <span className="logo-product">for YouTube</span>
          </a>
          <span className="version">v{version}</span>
        </div>
      </header>

      <main className="layout">
        <div className="main-column">
          {isWelcome && (
            <section className="welcome" aria-labelledby="welcome-title">
              <h1 id="welcome-title">Ya puedes aprender inglés en YouTube</h1>
              <ol className="welcome-steps">
                <li>
                  <strong>Abre un vídeo</strong> con subtítulos en inglés y
                  actívalos (CC).
                </li>
                <li>
                  <strong>Haz clic en una palabra</strong> para ver su
                  traducción, o selecciona una frase.
                </li>
                <li>
                  Pulsa <strong>Marcar para repasar</strong> y la palabra
                  aparecerá aquí.
                </li>
              </ol>
              <a
                className="btn btn-primary btn-inline"
                href="https://www.youtube.com"
                target="_blank"
                rel="noreferrer"
              >
                Abrir YouTube
              </a>
            </section>
          )}

          <section className="vocab" aria-labelledby="vocab-title">
            <div className="vocab-head">
              <div>
                {isWelcome ? (
                  <h2 id="vocab-title" className="vocab-title">
                    Tu vocabulario
                  </h2>
                ) : (
                  <h1 id="vocab-title" className="vocab-title">
                    Tu vocabulario
                  </h1>
                )}
                <p className="vocab-sub">
                  Lo que guardas en los subtítulos de YouTube. Se queda en este
                  navegador.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-inline"
                onClick={() => downloadCsv(words, phrases)}
                disabled={total === 0}
              >
                Descargar CSV
              </button>
            </div>

            <div className="vocab-toolbar">
              <div className="tabs" role="tablist" aria-label="Tipo">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "words"}
                  className={`tab ${tab === "words" ? "active" : ""}`}
                  onClick={() => setTab("words")}
                >
                  Palabras <span className="tab-count">{words.length}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "phrases"}
                  className={`tab ${tab === "phrases" ? "active" : ""}`}
                  onClick={() => setTab("phrases")}
                >
                  Frases <span className="tab-count">{phrases.length}</span>
                </button>
              </div>
              <input
                className="search"
                type="search"
                placeholder="Buscar en inglés o español"
                aria-label="Buscar"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>

            {!loaded ? null : items.length === 0 ? (
              <div className="empty">
                {query.trim() ? (
                  <p>No hay {emptyLabel} que coincidan con «{query.trim()}».</p>
                ) : (
                  <>
                    <p className="empty-title">
                      Todavía no has guardado {emptyLabel}.
                    </p>
                    <p>
                      {tab === "words"
                        ? "En YouTube, haz clic en una palabra de los subtítulos y pulsa «Marcar para repasar»."
                        : "En YouTube, selecciona varias palabras de los subtítulos y pulsa «Guardar frase»."}
                    </p>
                  </>
                )}
              </div>
            ) : (
              <ul className="entries">
                {items.map((item) => (
                  <li key={item.key} className="entry">
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => speak(item.text)}
                      aria-label={`Escuchar ${item.text}`}
                      title="Escuchar"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M11 5 6 9H3v6h3l5 4V5z" />
                        <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
                      </svg>
                    </button>
                    <div className="entry-text">
                      <span className="entry-term" lang="en">
                        {item.text}
                      </span>
                      <span className="entry-translation">
                        {item.translation || "—"}
                      </span>
                    </div>
                    <span className="entry-date">
                      {dateFormatter.format(item.addedAt)}
                    </span>
                    <button
                      type="button"
                      className="icon-btn danger"
                      onClick={() => handleDelete(item.key)}
                      aria-label={`Eliminar ${item.text}`}
                      title="Eliminar"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="promo" aria-labelledby="promo-title">
          <div className="promo-intro">
            <p className="eyebrow">Sigue aprendiendo</p>
            <h2 id="promo-title">Lo que oyes en YouTube, léelo en LingText</h2>
            <p>
              Los vídeos te acostumbran el oído. Leer fija el vocabulario.
              LingText es un lector de inglés donde traduces cualquier palabra
              con un clic, igual que aquí.
            </p>
          </div>

          <div className="promo-card premium">
            <span className="tag tag-premium">Premium</span>
            <h3>Importa tus vídeos de YouTube y apréndelos a fondo</h3>
            <p className="promo-lead">
              Pega el enlace de cualquier vídeo y estúdialo dentro de LingText,
              con traducciones que entienden el contexto.
            </p>

            <figure className="context-demo">
              <p className="context-demo-sentence" lang="en">
                She finally <mark>settled into</mark> her new job.
              </p>
              <div className="context-demo-row literal">
                <span className="context-demo-label">Palabra por palabra</span>
                <span className="context-demo-value">asentado en</span>
              </div>
              <div className="context-demo-row contextual">
                <span className="context-demo-label">En contexto, con Premium</span>
                <span className="context-demo-value">adaptarse a</span>
              </div>
            </figure>

            <ul className="checks">
              <li>Transcripción sincronizada: visible, difuminada u oculta</li>
              <li>Pausa automática al final de cada línea</li>
              <li>Las palabras que guardas vuelven en tu repaso y en lecturas nuevas</li>
            </ul>
            <a
              className="btn btn-primary"
              href={lingtextUrl("/premium", "premium_youtube")}
              target="_blank"
              rel="noreferrer"
            >
              Importar vídeos con Premium
            </a>
            <p className="promo-note">
              También importas páginas web y libros en PDF.
            </p>
          </div>

          <div className="promo-card">
            <span className="tag">Gratis · sin cuenta</span>
            <h3>Lee en inglés con traducción al instante</h3>
            <ul className="checks">
              <li>Textos y cuentos en inglés por niveles</li>
              <li>Canciones con la letra interactiva</li>
              <li>Test para saber tu nivel de inglés</li>
              <li>Repaso de vocabulario con repetición espaciada</li>
            </ul>
            <a
              className="btn btn-primary"
              href={lingtextUrl("/textos-en-ingles", "free_read")}
              target="_blank"
              rel="noreferrer"
            >
              Empezar a leer gratis
            </a>
            <a
              className="text-link"
              href={lingtextUrl(
                "/tests/cual-es-mi-nivel-de-ingles",
                "free_level_test"
              )}
              target="_blank"
              rel="noreferrer"
            >
              ¿No sabes tu nivel? Haz el test
            </a>
          </div>

        </aside>
      </main>

      <footer className="footer">
        <span>LingText for YouTube v{version}</span>
        <a
          href={lingtextUrl("/", "footer")}
          target="_blank"
          rel="noreferrer"
        >
          lingtext.org
        </a>
        <a
          href={lingtextUrl("/legal/politica-de-privacidad", "footer_privacy")}
          target="_blank"
          rel="noreferrer"
        >
          Privacidad
        </a>
      </footer>
    </div>
  );
}
