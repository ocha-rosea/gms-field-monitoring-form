# GMS Field Monitor

**Live app: <https://ocha-rosea.github.io/gms-field-monitoring-form/>**

A web form for filling the OneGMS **Field Site Monitoring (FSM) report template** in the field, and regenerating the exact Excel file for upload back to OneGMS.

Everything is in [index.html](index.html): no server, no install, no data leaves the device.

## How it works

1. Export the monitoring template for your project from OneGMS (`Monitoring-<project>_<date>.xlsx`).
2. Open `index.html` in any modern browser (double-click the file, or visit the hosted page once; it keeps working offline afterwards).
3. Drop the exported .xlsx onto the page. The form is built **from the file itself**:
   - fields are located through the `fld_*` named ranges GMS uses to read the upload;
   - dropdown options come from the template's own data-validation lists;
   - project info, indicators and activities are pre-filled from the GMS export.
4. Fill the form. Each section is a short step-by-step wizard (numbered dots = sub-sections; green = complete). Fields marked __*__ are mandatory: the form does not move forward (next step, dot-jump, or next tab) until the current step's mandatory fields are filled; going back is always allowed. Tab badges show how many mandatory fields remain per section. A draft autosaves in the browser after every keystroke; you can also **Export draft** to a JSON file and **Import** it on another machine.
5. Click **Generate Excel for GMS**. The download is the *original* workbook, byte-identical except for your answers injected into the GMS-named cells, so OneGMS accepts it exactly like a hand-filled template.
6. Open the file once in Excel (scores on the `Rep Templ.Scoring` sheet recalculate automatically on open), check it, upload to OneGMS.

Because the form adapts to whatever file is dropped in, it works for any project and any CBPF country export that uses the standard FSM template, and re-loading an already-filled report restores its values for editing.

## Why not just edit the Excel?

The GMS template is sheet-protected, slow on small screens, and easy to corrupt with generic tools (openpyxl-style round-trips silently strip workbook internals). This app never rebuilds the workbook; it patches only the value of edited cells inside the original zip, preserving styles, protection, validations, named ranges, printer settings and metadata untouched.

## Hosting

Hosted on GitHub Pages from the `main` branch of [ocha-rosea/gms-field-monitoring-form](https://github.com/ocha-rosea/gms-field-monitoring-form); pushing to `main` redeploys automatically. The monitoring templates are **excluded by `.gitignore`**; monitors load their own project export at use time, so no project data is ever published. Keep it that way: never commit `Monitoring-*.xlsx` files or exported drafts.

## Branding

Styled with the official OCHA brand palette (UN Blue `#009edb` for all blues; flat design, no gradients) and the OCHA primary typeface **Roboto**, self-hosted under `assets/fonts/` so the app makes no third-party requests (falls back to Arial if the fonts cannot load, per the brand guideline). The header shows the ESAHF wordmark and the footer the OCHA logo, both from `assets/` (swap the wordmark to rebrand for another fund). The landing page explains the workflow in four steps, illustrated with [OCHA Humanitarian Icons](https://un-ocha.github.io/humanitarian-icons/) stored under `assets/icons/`.

The mandatory-field list is the `REQUIRED` set near the top of the script in `index.html`; add or remove `fld_*` names there to change what is enforced.

## Offline use

A service worker (`sw.js`) caches the page and all assets on the first online visit. After that the app opens with **no connection at all**, survives closed tabs and device restarts, and can be added to the home screen (Android and iOS) so it launches full screen like an app. Drafts in local storage work the same offline.

Update strategy for new deployments: the page itself is fetched **network-first**, so an online user always gets the latest deployment immediately, while an offline user gets the cached copy. Static assets use **stale-while-revalidate** (served instantly from cache, refreshed in the background when online). Bump `CACHE` in `sw.js` only when the precached file list changes; the new worker deletes all older caches on activation.

## Security and privacy

All parsing, form filling and Excel generation happen in the browser; the app has no server, no analytics and no cookies. A Content-Security-Policy meta tag makes this browser-enforced: only same-origin resources may load and outbound connections to any other origin are refused, so even a future bug or a malicious workbook could not send data anywhere. Drafts are stored unencrypted in the browser's localStorage on the device; on shared computers, press Discard draft when done. The only network traffic is serving the page itself from GitHub Pages and the user's own upload to OneGMS.

## Notes / limits

- Tested against the FSM template family with `fld_*` named ranges (200 fields); the app warns if a workbook without them is loaded.
- Text answers are written as inline strings (standard OOXML); Excel normalises them on first save.
- Browser requirement: any 2023+ Chrome/Edge/Firefox/Safari (uses native `CompressionStream`).
- Drafts live in the browser's localStorage keyed by file name; "Discard draft" reverts to the file's contents.
