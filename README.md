# GMS Field Monitor

**Live app: <https://ocha-rosea.github.io/gms-field-monitoring-form/>**

A web form for filling the OneGMS **Field Site Monitoring (FSM) report template** in the field, and regenerating the Excel file for upload back to OneGMS.

It runs entirely in your browser: no server, no install, and no data leaves the device.

## How it works

1. Export the monitoring template for your project from OneGMS (`Monitoring-<project>_<date>.xlsx`).
2. Open the app at the link above. Open it once while online; afterwards it works offline, and you can add it to your home screen. It opens on your **records home**.
3. Choose **New report**, pick **one** or **multiple locations**, and load the exported template. The form, including its dropdowns and the project's pre-filled details, is built from the template you load.
4. Fill the form in short guided steps. Fields marked __*__ are mandatory and must be completed before moving on. Entries autosave on the device, and the report stays on your records home so you can reopen and continue it **without the original file**.
5. **Generate Excel for GMS** fills your answers into the original template and saves a timestamped copy to the report.
6. Open that file once in Excel to refresh the scores, check it, and upload to OneGMS.

The form adapts to whatever template you load, so it works for any project and any CBPF country export that uses the standard FSM template.

## Records and multiple locations

The app opens on a **records home** listing your saved reports with their status (draft, complete, generated, uploaded). Reports are stored on the device, so you can reopen and continue one **without the original file**, and re-download any generated Excel. Use **Export backup / Import backup** to move your whole set of records between devices through internal channels.

When starting a report you choose **one location** or **multiple locations**. A multiple-location report holds a list of locations (each can be planned ahead of the visit), and different team members can fill different locations on their own devices. Share a project with **Export field pack** and combine contributions with **Import field pack**; partial sets merge cleanly, so one person can gather two locations and another five and still end up with a single report. **Consolidate & generate** then combines the locations (numbers added up, text combined and labelled by location, scores left for you to set), opens an editable review, and produces one final Excel for upload. Always review and edit that final Excel before uploading; that is the quality gate.

## Why use this form?

It is faster and easier to fill on a phone or tablet in the field: guided steps, the template's own dropdowns and scoring, mandatory-field checks, and autosave that works offline. When you generate, the app fills your answers into the **original GMS template** and changes nothing else, so the file uploads just like a hand-filled template.

## Keeping in sync with the GMS template

The app is built around the current OneGMS FSM template. If OneGMS changes the template structure — adding, removing or renaming fields or sections — **the app may need an update** before those changes appear. Test the app against any new template version before using it in the field.

## Offline and updates

After the first online visit the app works with **no connection at all**, survives closed tabs and device restarts, and can be added to the home screen so it opens like an app. When a new version is published, it applies automatically the next time you open the app online.

## Privacy and data

Everything happens in your browser: no server, no analytics, and nothing is sent anywhere. Your entries are kept only on the device until you upload the generated Excel to OneGMS yourself. On a shared computer, use **Discard draft** when you finish.

**Usage policy.** Monitoring reports contain personal data (staff and persons-met names, contacts, red-flag findings). Enter and store data only on organization-issued devices, and download or share exported files through internal UN channels only, never personal email or storage. Field packs shared between team members can be passphrase-protected.

## Handwriting

On a stylus or touch device you can handwrite into any text box and your device converts it to text. Each text field shows a ✎ marker on supported devices; tap it for how to do it on yours:
- **iPad + Apple Pencil**: write directly into the box (Settings → Apple Pencil → Scribble).
- **Samsung / Android with stylus**: write directly into the box (Settings → Advanced features → S Pen → Pen to text).
- **Windows touch/pen**: open the touch keyboard from the taskbar, switch to its handwriting (pen) panel, and write into the field.

---

Technical design, architecture and maintenance notes are in [DESIGN.md](DESIGN.md).
