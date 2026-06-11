# GMS Field Monitor

**Live app: <https://ocha-rosea.github.io/gms-field-monitoring-form/>**

A web form for filling the OneGMS **Field Site Monitoring (FSM) report template** in the field, and regenerating the exact Excel file for upload back to OneGMS.

It runs entirely in your browser: no server, no install, and no data leaves the device.

## How it works

1. Export the monitoring template for your project from OneGMS (`Monitoring-<project>_<date>.xlsx`).
2. Open the app at the link above. Open it once while online; afterwards it works offline, and you can add it to your home screen. It opens on your **records home**.
3. Choose **New report**, pick **one** or **multiple locations**, and load the exported template. The form is built from the file itself: fields from the `fld_*` named ranges GMS reads, dropdowns from the template's own lists, and project info, indicators and activities pre-filled from the export.
4. Fill the form in short guided steps. Fields marked __*__ are mandatory and must be completed before moving on. Entries autosave on the device, and the report stays on your records home so you can reopen and continue it **without the original file**.
5. **Generate Excel for GMS** fills your answers into the original template and saves a timestamped copy to the report.
6. Open that file once in Excel to refresh the scores, check it, and upload to OneGMS.

The form adapts to whatever template you load, so it works for any project and any CBPF country export that uses the standard FSM template.

## Records and multiple locations

The app opens on a **records home** listing your saved reports with their status (draft, complete, generated, uploaded). Reports are stored in the browser, so you can reopen and continue one **without the original file**, and re-download any generated Excel. Use **Export backup / Import backup** to move your whole records database between devices through internal channels.

When starting a report you choose **one location** or **multiple locations**. A multiple-location report holds a list of locations (each can be planned up front), and different team members can fill different locations on their own devices. Share a project with **Export field pack** and merge contributions with **Import field pack** (locations merge by a stable id, so partial sets combine cleanly). **Consolidate & generate** then aggregates the locations (numbers summed, text combined with location prefixes, scores left for you to set), opens an editable review, and produces one timestamped final Excel for upload. The final Excel is always reviewed and edited in Excel before upload, which is the quality gate. See [PLAN.md](PLAN.md) for the full design.

## Why use this form?

It is faster and easier to fill on a phone or tablet in the field: guided steps, the template's own dropdowns and scoring rubrics, mandatory-field checks, and autosave that works offline. When you generate, the app fills your answers into the **original GMS template** and changes nothing else, so styles, validations, named ranges and every other workbook detail are preserved exactly as GMS produced them, and the file uploads just like a hand-filled template.

## Hosting

Hosted on GitHub Pages from the `main` branch of [ocha-rosea/gms-field-monitoring-form](https://github.com/ocha-rosea/gms-field-monitoring-form); pushing to `main` redeploys automatically.

## Branding

Styled with the official OCHA brand palette (UN Blue `#009edb` for all blues; flat design, no gradients) and the OCHA primary typeface **Roboto**, self-hosted under `assets/fonts/` so the app makes no third-party requests (falls back to Arial if the fonts cannot load, per the brand guideline). The header shows the ESAHF wordmark and the footer the OCHA logo, both from `assets/` (swap the wordmark to rebrand for another fund). The landing page explains the workflow in four steps, illustrated with [OCHA Humanitarian Icons](https://un-ocha.github.io/humanitarian-icons/) stored under `assets/icons/`.

The mandatory-field list is the `REQUIRED` set near the top of the script in `index.html`; add or remove `fld_*` names there to change what is enforced.

## Offline use

A service worker (`sw.js`) caches the page and all assets on the first online visit. After that the app opens with **no connection at all**, survives closed tabs and device restarts, and can be added to the home screen (Android and iOS) so it launches full screen like an app. Drafts in local storage work the same offline.

Update strategy for new deployments: the page itself is fetched **network-first**, so an online user always gets the latest deployment immediately, while an offline user gets the cached copy. Static assets use **stale-while-revalidate** (served instantly from cache, refreshed in the background when online). Bump `CACHE` in `sw.js` only when the precached file list changes; the new worker deletes all older caches on activation.

## Security and privacy

All parsing, form filling and Excel generation happen in the browser; the app has no server, no analytics and no cookies. A Content-Security-Policy meta tag makes this browser-enforced: only same-origin resources may load and outbound connections to any other origin are refused, so even a future bug or a malicious workbook could not send data anywhere. Drafts are stored unencrypted in the browser on the device; on shared computers, press Discard draft when done. The only network traffic is serving the page itself from GitHub Pages and the user's own upload to OneGMS.

**Usage policy.** Monitoring reports contain personal data (staff and persons-met names, contacts, red-flag findings). Enter and store data only on organization-issued devices, and download or share exported files (drafts, location bundles, generated Excel, database backups) through internal UN channels only, never personal email or storage. Exported location bundles can be passphrase-encrypted for sharing within a monitoring team.

See [PLAN.md](PLAN.md) for the architecture and roadmap of the multi-location, records-based version.

## Handwriting input

Every note field is a standard text box, so on a stylus device monitors can **write by hand directly into any field and the device converts it to text**, fully offline, with no app changes. This is the recommended approach: it keeps the stored value as plain text (which the GMS cells require), needs no model download, and works with no network. The app deliberately does not bundle a handwriting recognition engine (a capable offline model would add tens of MB and is unreliable on field handwriting) and cannot use a cloud recognizer (the Content-Security-Policy blocks it).

The ✎ marker on a text field appears only on **pen or touch-capable devices**; it is hidden on mouse-only desktops. Tapping it shows device-specific guidance:
- **iPad + Apple Pencil**: write directly into the box; iPadOS Scribble converts it (Settings → Apple Pencil → Scribble).
- **Samsung / Android with stylus**: write directly into the box (Settings → Advanced features → S Pen → Pen to text).
- **Windows touch/pen**: browsers do not auto-convert, so open the **touch keyboard** from the taskbar, switch to its **handwriting (pen) panel**, and write into the focused field; Windows converts it to text.

The app does not ship its own recognition engine. The browser's on-device Handwriting Recognition API (`navigator.createHandwritingRecognizer`) would allow an in-app pad, but it is unavailable on Windows desktop browsers, so guidance to the OS handwriting input is used instead.

## Notes / limits

- Tested against the FSM template family with `fld_*` named ranges (200 fields); the app warns if a workbook without them is loaded.
- Text answers are written as inline strings (standard OOXML); Excel normalises them on first save.
- Browser requirement: any 2023+ Chrome/Edge/Firefox/Safari (uses native `CompressionStream`).
- Drafts live in the browser's localStorage keyed by file name; "Discard draft" reverts to the file's contents.
