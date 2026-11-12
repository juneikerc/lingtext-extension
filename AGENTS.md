# AGENTS.md

LingText for YouTube is a Chrome extension (Manifest V3) that turns YouTube's
English subtitles into interactive subtitles for Spanish speakers learning
English: click a word or select a phrase to translate it to Spanish (Chrome's
on-device Translator API or MyMemory) and save it to a vocabulary list kept in
`chrome.storage.local`. Built with React, TypeScript and Vite
(`@crxjs/vite-plugin`). Open source under Apache-2.0.

See `README.md` for the source layout and how caption capture works.

## Commands

- `npm ci`: install dependencies.
- `npm run typecheck`: type-check only.
- `npm run build`: type-check and build the extension into `dist/`. This is
  not an Astro project, so running the build is fine. Run it before
  committing.
- `npm run package`: build and zip `dist/` for the Chrome Web Store.

## Conventions

- User-facing text in the extension is in Spanish. Docs (README, this file)
  are in English.
- Never commit `node_modules/`, `dist/` or `*.zip`.
