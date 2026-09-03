# Austruss Online Viewer — a browser-based IFC viewer

A lightweight, from-scratch BIM/IFC viewer in the spirit of Swyvl: drop an
`.ifc` file in the browser, get a 3D view, a spatial tree, and a properties
panel — no server, no upload, no native install. Parsing happens client-side
via WebAssembly.

## Stack

- **Vite + TypeScript** — build tooling, no framework needed for this scope
- **[@thatopen/components](https://docs.thatopen.com)** (v3) — the actively
  maintained successor to the old IFC.js / `web-ifc-viewer` project. Wraps
  Three.js + `web-ifc` and provides the World/Scene/Camera/Highlighter
  building blocks used here
- **@thatopen/fragments** — converts parsed IFC geometry into the
  "Fragments" format (instanced meshes, worker-based), which is what makes
  large models stay responsive instead of freezing the tab
- **web-ifc** — the actual WASM IFC parser (IFC2x3 and IFC4)
- **three** — rendering

## Quick start

```bash
npm install
npm run dev
```

Open the printed local URL for the viewer, then drag an `.ifc` file onto
the viewport (or click it to browse). The catalog page is at `/catalog.html`
on that same local server — it needs Google Drive configured first (see
below) to show anything. `npm install` also copies the `web-ifc` WASM
binaries into `public/vendor/web-ifc/` via a postinstall script — if you
ever bump the `web-ifc` version, rerun `node scripts/copy-wasm.mjs` to
resync them.

```bash
npm run build    # type-check + production build to dist/ (both pages)
npm run preview  # serve the production build locally
```

`npm run build` on its own builds for serving at `/` (root). The GitHub
Pages deploy workflow builds with a repo-name subpath instead — see
"Deploying to GitHub Pages" below; you don't need to do this manually
unless you're testing a Pages-path build locally
(`GITHUB_PAGES_REPO=your-repo-name npm run build`).

## What's here

- **Fit view, set pivot, viewport background** — toolbar controls for
  camera framing and viewport appearance
- **Spatial tree** (left panel) — click any node to select and zoom the
  corresponding element; category badges show the IFC entity type
- **Properties panel** (right) — attributes plus property sets
  (`IsDefinedBy` → `HasProperties`) for whatever's selected
- **Isolate / show all** — hide everything except the current selection,
  or reset visibility
- **Opening a new file replaces the current model** rather than adding a
  second one into the same scene — the tree, properties, and isolate all
  assume a single active model at a time
- **Save locally / Save to Drive** — export the loaded model to the
  compact `.frag` format, either as a browser download (for testing) or
  uploaded to the shared Drive folder (see "Enabling save" below)
- Light/dark theme toggle, persisted across visits
- Both side panels collapse via the small toggle buttons in the viewport
  gutters

## What's not here yet

This is a solid starting scaffold, not a Swyvl clone. Deliberately left out
so the first version stays reviewable:

- Section/clipping planes and measurement tools (ThatOpen ships components
  for both — `ClipEdges`/`Clipper` and the `LengthMeasurement` /
  `AreaMeasurement` components — they just aren't wired into the UI yet)
- Multi-model federation (loading and layering several IFCs together)
- Saved views, markups, sharing links — these would need a backend
- Search/filter within the spatial tree
- Category-based visibility toggles (walls off, structure only, etc.)

## Project layout

```
src/
  viewer.ts       IfcViewer class — wraps the ThatOpen World, IFC loader,
                   Fragments manager, and Highlighter/selection
  tree.ts         Spatial tree rendering + click-to-select
  properties.ts   Properties panel rendering from ItemData
  icons.ts        Inline SVG icon set
  main.ts         Viewer page shell — wires the DOM to the viewer, and
                   handles ?fileId=&name= deep links from the catalog
  style.css       Design tokens (colors, type, spacing) — viewer page
  app.css         Layout and component styles — viewer page
  catalog.ts      Catalog page — lists models from Drive, groups by
                   Project → Job → Zone, links into the viewer
  catalog.css     Catalog page styles (imports style.css's tokens via a
                   CSS @import, not a JS import — see the comment in
                   catalog.css for why that distinction matters)
  drive.ts        Apps Script backend client (list files) — used only by
                   catalog.ts
  naming.ts       Parses the job-number/zone/drawing naming convention
                   out of a filename
public/
  drive-config.json  Apps Script URL + folder ID — edit this directly,
                     no rebuild needed (see "Google Drive setup" below)
  projects.json      Job number → project name lookup — same, no rebuild
scripts/
  copy-wasm.mjs   Postinstall — copies web-ifc's .wasm files into public/
.github/workflows/
  deploy.yml      Auto-builds and deploys to GitHub Pages on push to main
apps-script/
  Code.gs         The Apps Script backend itself — deployed separately
                   via script.google.com, not part of the Vite build
```

## Naming convention

The catalog parses model filenames against this pattern to group them:

```
<JobNumber>-<ProductCode>-<Zone>-<DrawingNumber>[revision]<description>.ifc
```

(`.frag` works the same way — see "Enabling save" below for what that
extension is and why the viewer produces it.)

e.g. `25177-LGS-A2-410__A__BUILDING_A2_-_3D_Model_-_IFC.ifc` parses to job
`25177`, zone `A2`, drawing `410`, revision `A`. This already matches your
existing file naming — nothing needs to change there. A revision can be
written either as `[B]` or as `__B__`; anything else in the filename is
treated as free-form description text and only used for display.

Job number and zone drive the grouping directly. Project *name* isn't in
the filename (e.g. "Lennox Head" isn't derivable from `25177-...`), so
that comes from `public/projects.json` instead — a small job-number →
project-name lookup you maintain separately, since that mapping rarely
changes once a job number exists. Any job number not listed there falls
back to showing as "Job `<number>`" in the catalog.

Files that don't match the pattern at all are silently skipped by the
catalog (they won't crash it, they just won't show up) — worth checking
`public/projects.json` and the actual Drive filenames if something you
expect to see isn't appearing.

## Deploying to GitHub Pages

1. Create a new **public** repository on your GitHub account (free GitHub
   Pages requires public — see the note in "What's public here" below
   before doing this if that gives you pause).
2. Push this project to it:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<repo-name>.git
   git push -u origin main
   ```
3. In the repo on GitHub: **Settings → Pages → Source → GitHub Actions**.
   That's it — the workflow in `.github/workflows/deploy.yml` picks up
   from here automatically. It reads the repo name itself
   (`github.event.repository.name`) to set the right base path, so it
   works regardless of what you name the repo.
4. Push again (or re-run the workflow from the **Actions** tab) and the
   site goes live at `https://<your-username>.github.io/<repo-name>/`.
   The catalog is at `.../catalog.html`, the viewer at the root.

Every push to `main` redeploys automatically from then on.

### What's public here

Once this is live, anyone with the URL can open it — there's no login.
That means:
- The **app's source code** is visible (it's a public repo either way).
- The **catalog page's contents** — job numbers, project names, zone
  names, filenames — are visible to anyone with the Pages URL, since the
  catalog fetches straight from Drive client-side with no auth gate.
- The **Drive API key** in `drive-config.json` is visible in the built
  JS/JSON (this is normal and expected for a client-side app — see the
  Drive setup section below on restricting it so that visibility is
  harmless).
- Anyone who finds a model's direct Drive download URL can fetch that
  file directly, same as if they had the Drive share link itself.

If any of that changes your mind about what's public, this is the moment
to reconsider before models go up — not something to walk back easily
once a link's been shared around.

## Google Drive setup

Browsing, downloading, and saving all go through one Google Apps Script
Web App — the same approach your other internal tools (Frame Pack Sorter,
the Staff Review app) already use. No Google Cloud Console, no API key to
create or restrict. The script runs under whichever Google account
deploys it; nobody viewing the site needs to sign in.

1. Go to [script.google.com](https://script.google.com) → **New project**.
2. Delete the default `Code.gs` contents and paste in this repo's
   `apps-script/Code.gs` in full.
3. **Deploy → New deployment → type: Web app**:
   - **Execute as**: Me
   - **Who has access**: Anyone
   
   Click Deploy, authorize it when prompted (it needs Drive access to
   read and write files), and copy the resulting `.../exec` URL.
4. **Sanity-check the deployment**: open that `.../exec` URL directly in
   a browser tab. You should see `{"status":"ok","message":"..."}`. If you
   see a Google sign-in prompt or an error instead, the deployment's
   access setting isn't actually "Anyone" — fix that before going further.
5. **Create a folder in Google Drive** for your models (subfolders per
   project are fine — the backend walks them recursively). It doesn't
   need to be shared publicly this time — the script already has access
   to it as whatever account deployed the script.
6. **Get the folder ID** from its URL:
   `https://drive.google.com/drive/folders/`**`<this part>`**
7. **Fill in `public/drive-config.json`**:
   ```json
   {
     "scriptUrl": "<your Apps Script /exec URL>",
     "rootFolderId": "<your folder ID>"
   }
   ```
   Commit and push — no rebuild needed for future edits to this file,
   since it's fetched at runtime rather than bundled.
8. Upload `.ifc` or `.frag` files into that Drive folder following the
   naming convention above, and add any new job numbers to
   `public/projects.json`. Open `catalog.html` and they should show up.
   Open a model in the viewer and try **Save to Drive** — it saves into
   the same folder, overwriting a file of the same name rather than
   duplicating it, so re-saving a revision stays clean.

If the catalog shows an error instead of your models, it'll say exactly
what's wrong (unconfigured script/folder, a backend error, or no matching
files) — that message is the place to start.

### Save exports the converted `.frag` version, not your original `.ifc`

Once a model's loaded, it's already been converted client-side from IFC
into the Fragments format the viewer actually renders — a purpose-built
binary format, much more compact than IFC's verbose text encoding for
property-heavy models (an early test on a real Austruss model came in at
roughly 6x smaller). **Save to Drive exports that converted version**
(`model.getBuffer()`, compressed) rather than re-uploading the original
raw `.ifc` bytes. A few knock-on effects worth knowing:

- **Loading a saved `.frag` back is much faster than loading the source
  `.ifc`** — it skips IFC parsing entirely (no WASM, no attribute
  extraction, none of the stages you've seen in the loading bar). Drop a
  `.frag` file on the viewer the same way you'd drop an `.ifc`, or use
  **Save locally** to download one for testing without touching Drive.
- **If you loaded the source `.ifc` with "skip small hardware" or "skip
  mesh-based proxy elements" ticked, the saved `.frag` only contains what
  was actually loaded** — those exclusions get baked in permanently, not
  just hidden. Fine for a quick review copy; worth knowing before treating
  a `.frag` as the authoritative version of a model.
- **The catalog will list both** if a folder has an `.ifc` and a `.frag`
  version of the same drawing (same job/zone/drawing number, since the
  naming convention parser accepts either extension) — it doesn't
  currently dedupe or prefer one over the other, so you'll see two rows.
  Worth knowing rather than a surprise; not something the catalog handles
  for you yet.

**Known limits, worth knowing before you rely on this:**
- **File size on downloads and saves**: Apps Script Web App responses and
  POST bodies cap out around 50MB, and base64 transport inflates size by
  roughly a third. This applies both to saving *and* to downloading a
  model from the catalog (the backend has to base64-encode file bytes
  into its response either way) — a real difference from a plain public
  Drive link, which has no such ceiling since Google serves the bytes
  directly. In practice this is unlikely to bite if `.frag` is the normal
  thing being browsed and loaded, given the size reduction above; a very
  large raw `.ifc` could still occasionally hit it. The app checks and
  tells you clearly rather than failing silently when it happens.
- **CORS on saves**: the client deliberately sends the save request as
  `Content-Type: text/plain` rather than `application/json` — see the
  comment at the top of `apps-script/Code.gs` for why (an `application/json`
  POST triggers a CORS preflight that Apps Script Web Apps don't handle,
  silently blocking the request). List and download requests are plain
  GETs and don't have this problem. I couldn't test any of this against a
  live deployment from this environment, so if something fails with what
  looks like a network/CORS error rather than the backend's own error
  message, that's the first thing to check.
- **One shared identity**: every list/download/save is attributed to
  whichever Google account owns the Apps Script deployment, not to
  whoever's using the site — there's no per-user identity in this model,
  consistent with how the other tools' Sheets sync already works.

## Performance notes for heavy models

Steel-framing exports tend to have far more individual elements than a
typical architectural IFC — every stud, track, and fastener is its own
entity. Two things in this scaffold specifically target that:

- **`CIRCLE_SEGMENTS` is set to 8** (web-ifc's default is 12) in
  `viewer.ts`. Round profiles, bolts, and punched holes all get tessellated
  as circles; a lower segment count meaningfully cuts triangle count and
  parse time with no visible difference at normal zoom levels.
- **`loadIfc()` accepts an optional `excludeCategories` list** of IFC type
  codes to skip geometry generation for entirely — e.g. fasteners, if you
  don't need to see every screw to review framing layout:

  ```ts
  import * as WEBIFC from "web-ifc";

  await viewer.loadIfc(buffer, file.name, {
    excludeCategories: [WEBIFC.IFCMECHANICALFASTENER, WEBIFC.IFCDISCRETEACCESSORY],
  });
  ```

  This isn't wired into the UI (it's a real trade-off — those elements
  become invisible and unselectable, not just faster), but it's there to
  test if you want to see how much a given category is actually costing
  you. `web-ifc`'s type codes are documented in its `ifc-schema.d.ts`.

The other big lever is outside this app entirely: if your authoring
software can export a smaller scope (a single building or level instead
of the whole federated project), that directly cuts element count more
than any client-side tuning can — worth trying if a model still feels
heavy after the above.

## Notes on the API surface

`@thatopen/components` v3's public API differs meaningfully from the old
`web-ifc-viewer` tutorials still floating around online (that package is
legacy/frozen). Everything in `viewer.ts` was checked directly against the
installed package's `.d.ts` files rather than assumed from memory, since
the library has moved fast — worth doing the same if you extend this and
something doesn't match what a blog post says.
