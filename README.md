# LingText for YouTube

Interactive English subtitles for YouTube, built for Spanish speakers who are
learning English. Click any word in the subtitles to translate it, select a
phrase to translate it whole, and save what you want to learn.

[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/lingtext-for-youtube/phnakkjkhjmobonjiebnbhdknckmobhn)
· [lingtext.org](https://lingtext.org/extension)

> **En español:** LingText for YouTube convierte los subtítulos en inglés de
> YouTube en subtítulos interactivos. Haz clic en una palabra para ver su
> traducción al español, selecciona una frase para traducirla completa y
> guarda tu vocabulario en la extensión. Es gratuita, no necesita cuenta y su
> código es abierto. La interfaz está en español.

## Features

- Click-to-translate on every word of YouTube's English subtitles.
- Pause on hover: the video pauses while the mouse is over the subtitle and
  resumes when it leaves (only if the extension paused it). It stays paused
  while a word or phrase popup is open. Can be turned off in the popup.
- Keyboard shortcuts to listen again: `R` repeats the current line,
  `Shift+←` / `Shift+→` jump to the previous or next line, and `B` loops the
  current line until you press it again or seek away. They need the captured
  transcript's timings, so they are off when the overlay falls back to
  reading YouTube's rendered captions. Can be turned off in the popup.
- Blur mode for listening practice: the eye button next to the subtitle's
  drag handle blurs the text, and moving the mouse over the subtitle reveals
  it (it stays readable while a word or phrase popup is open). Also in the
  popup.
- Phrase translation by selecting several words.
- Line-by-line subtitles, including YouTube's auto-generated captions.
- Save words and phrases; saved words are highlighted when they appear again.
- A vocabulary page (the extension's options page) to search, listen to,
  delete and export your list as CSV.
- Translation with Chrome's on-device Translator API or with MyMemory.
- Option to hide YouTube's native captions while the overlay is showing.

## How it works

```
src/
  content/
    youtube-page-data.ts   # MAIN world, document_start: captures the player's caption request
    caption-track-loader.ts# reads the captured transcript (direct fetch as fallback)
    caption-parser.ts      # json3 / srv1 / srv3 parsing
    cue-stabilizer.ts      # merges and de-overlaps cues into readable lines
    subtitle-engine.ts     # cue lookup by playback time
    listening-controls.ts  # repeat/previous/next/loop shortcuts and pause on hover
    overlay-root.tsx       # overlay UI, word/phrase popups, DOM caption fallback
  background/              # service worker: message router + chrome.storage.local store
  popup/                   # toolbar popup
  vocabulary/              # vocabulary page (options page)
  shared/                  # tokenizer, translator ids, vocabulary types
```

YouTube's caption URLs return an empty body unless the request carries the
player's proof-of-origin token. Instead of fetching captions itself, the
extension listens to the `/api/timedtext` response the YouTube player already
requests when captions are on, and reuses that request's token to fetch the
English track if the player is showing another language. If no transcript can
be captured, the overlay falls back to reading YouTube's rendered captions.

## Privacy

- No account, no analytics and no tracking in the extension.
- Saved words, phrases and settings live in `chrome.storage.local` in your
  browser. They are never sent to LingText's servers. Uninstalling the
  extension deletes them.
- When you translate with **MyMemory**, the word or phrase is sent to
  `api.mymemory.translated.net`. The **Chrome** translator runs on your device.
- Links to lingtext.org from the popup and the vocabulary page carry UTM
  parameters so LingText can tell visits came from the extension.

Full policy: [lingtext.org/legal/politica-de-privacidad](https://lingtext.org/legal/politica-de-privacidad).

### Permissions

| Permission                  | Why                                                                  |
| --------------------------- | -------------------------------------------------------------------- |
| `storage`                   | Keep your vocabulary and settings in the browser.                    |
| `https://www.youtube.com/*` | Show the subtitle overlay and read the caption track YouTube loads. |

## Development

Requires Node.js 22 and Chrome.

```bash
npm install
npm run dev        # Vite dev build with hot reload
npm run build      # typecheck + production build into dist/
npm run package    # build and zip dist/ as lingtext-extension-<version>.zip
```

Load the extension from `chrome://extensions` → **Developer mode** →
**Load unpacked** → select `dist/`.

### Releasing

1. Bump `version` in `manifest.json`, `package.json` and `package-lock.json`.
2. Tag the commit (`git tag v1.5 && git push --tags`).
3. CI builds the package and attaches the zip to a GitHub Release, ready to
   upload to the Chrome Web Store.

## Contributing

Issues and pull requests are welcome. Please run `npm run build` before
opening a PR. User-facing text is in Spanish.

## License

Copyright 2026 Juneiker. Code is licensed under the
[Apache License 2.0](LICENSE); see also [NOTICE](NOTICE).

The **LingText** name and logo (including the icons in `public/icons/`) are
trademarks of LingText and are not covered by the license. If you publish a
fork, use a different name and icon.
