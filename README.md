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
  camera framing and viewport appearance, including uploading a custom
  background image (remembered across visits, up to 3MB)
- **Locations** — save the current view (pivot point *and* camera
  position, captured together automatically) under a name and recall it
  later — restores the full framing, not just where the camera orbits
  around. Saved per model (by filename) in the browser's local storage,
  so they're specific to this device and this model file, not shared via
  Drive. Older saved locations from before camera position was captured
  still work — they just recall the pivot alone
- **Home view** — separate from named Locations: **Set Home** captures
  the current view as a single dedicated view for that model, no naming
  needed; **Home** recalls it, and it's also what a model opens to
  automatically instead of the usual fit-to-model framing. **Home** (not
  Set Home) is available in external/share mode too, sourced from a
  `?home=` link parameter instead of local storage. If a home view is
  set for a model, both the Share button and the save-success screen
  automatically include it in the generated link — no manual step needed
  (unlike Locations below, which stay opt-in since sharing all of them
  isn't necessarily wanted)
- **Pivot and location markers** — a small green sphere in the 3D scene
  shows the current pivot point, updated only when it's deliberately set
  (Set Pivot, recalling a Location, or selecting an element — selecting
  something locks the pivot onto it, both retargeting the orbit and
  moving the marker there). It's deliberately *not* tracked continuously
  off the camera's live orbit target — panning moves that target right
  along with it, so a marker tied to it drifts off the model into empty
  space the moment you pan, disconnected from any real point. Every saved
  Location for the loaded model shows as a larger blue sphere with its
  name floating above it, all at once, so you can see where they all are
  at a glance. Markers are simple always-on-top spheres sized for typical
  metre-scale IFC models — not derived from the model's own scale, and
  not screen-space-constant (they'll look larger up close, smaller from a
  distance, like anything else in the scene)
- **Spatial tree** (left panel) — click any node to select and zoom the
  corresponding element; category badges show the IFC entity type
- **Properties panel** (right) — attributes plus property sets
  (`IsDefinedBy` → `HasProperties`) for whatever's selected
- **Selection info pin** — selecting an element (canvas click or tree)
  shows a small pin with its Name and Frame name, anchored to the
  element's actual center and following the camera as you orbit
- **Isolate / Hide / Show all** — Isolate hides everything except the
  current selection; Hide is the inverse, hiding just the selected
  element while leaving everything else visible (stacks — hiding several
  elements one at a time keeps them all hidden); Show all resets both
- **Multi-model overlay — currently disabled.** The code is all still
  here (tree groups, coordination alignment, Sessions, Browse Drive,
  catalog multi-select) but the entry points are hidden pending a bug fix
  — loading more than ~2-3 models together can still misposition or lose
  models. To re-enable: remove `hidden` from `.tree-head-actions` in
  `main.ts`'s markup and `display: none` from `.model-select` in
  `catalog.css`. Everything below in this section describes what's there
  once re-enabled, not current default behavior.
- ~~**Multi-model overlay**~~ — "Open IFC" replaces whatever's loaded, as
  before. A "+" button in the model tree's header adds another model
  alongside it instead (e.g. overlaying a services model over a
  structural one) — either by uploading a file, or by browsing and
  picking one straight from the configured Drive folder without leaving
  the viewer. The spatial tree shows one collapsible group per loaded
  model, each with its own close button to unload just that model.
  Selecting an element makes its model the "active" one for Save/
  Locations, so those act on whatever you're actually working with.
  The catalog page also supports this directly — check the box on
  several models and hit "Open together" to load them all as one
  overlay in a single trip, instead of adding them one at a time
- ~~**Sessions**~~ — a bookmark button next to "+" saves the current set of
  loaded models under a name, for recalling the same overlay setup
  later without re-adding each one by hand. Only models that were loaded
  *from Drive* can be included (a locally-uploaded file has no stable
  reference to fetch again later) — saving warns you if some loaded
  models got left out for this reason. Sessions live in the browser's
  local storage, same as Locations — device/browser-specific, not synced
- **Save locally / Save to Drive** — export the loaded model(s) to the
  compact `.frag` format, either as a browser download (for testing) or
  uploaded to the shared Drive folder. With more than one model loaded,
  Save to Drive saves each one separately under its own existing name
  rather than merging them (see "Enabling save" below). If a filename
  doesn't match the naming convention, Save to Drive prompts for the
  missing Job/Product/Zone/Drawing pieces before saving, rather than
  silently uploading something the catalog will never be able to find.
  Project name is always asked for too, even when the rest of the name
  already matches the convention — it's saved as a `catalog-overrides.json`
  entry the same way the catalog's own edit popup does, so a brand-new
  job number doesn't sit as "Job `<number>`" until someone notices and
  fixes it later. Pre-fills with the name already on record when one
  exists, left blank otherwise (never pre-filled with the "Job `<number>`"
  placeholder itself, since that isn't a real name to silently re-save).
  Saving to Drive shows a full-page blocking overlay with a spinner and a
  Cancel button — added after people were clicking Save multiple times in
  a row with no visible sign the page was busy — which switches to a
  checkmark, a QR code, and a link once it finishes, with its own Close
  button. That link (and the QR code) point at the app's own restricted
  external viewer — same link the Share button generates — not Drive's
  own file page, since the point is to hand someone something they can
  actually open and look at
- Light/dark theme toggle, persisted across visits — defaults to light on
  a first visit with nothing saved yet
- The Austruss logo/wordmark links back to a blank `index.html` (clears
  whatever's loaded) — normal viewer only, not the external/share mode
- Both side panels collapse via the small toggle buttons in the viewport
  gutters
- **Mobile layout** (≤768px) — the side panels become full-screen overlays
  (hidden by default, opened via the same gutter toggles, each with its
  own close button since the toggle that opened it gets covered once the
  overlay is up), the toolbar condenses to Fit / Isolate / Show all /
  theme toggle (Open IFC is desktop-only — mobile use is expected to be
  arriving via a shared link, not local upload), and the header logo and
  nav link shrink to icon-only. Touch orbit/pan/zoom comes from
  `camera-controls`' own defaults (one-finger orbit, two-finger
  pinch-zoom + pan) — verified against its source rather than assumed,
  and `touch-action: none` is set on the canvas so the browser doesn't
  intercept those gestures as page scroll/zoom instead. The catalog
  page's header wraps onto multiple rows at narrow widths, and its body
  scrolls independently (found and fixed a real bug here — the whole app
  has `overflow: hidden` on `html`/`body` for the viewer's fixed layout,
  which the catalog page had silently inherited despite being a plain
  scrollable list, with nothing giving it its own scroll container)
- **Model display names** — anywhere a loaded model's name is shown (the
  viewer header, spatial tree group headers) shows "Job `<number>` —
  `<Project>` — Zone `<zone>`" instead of the raw filename, parsed the
  same way the catalog does. Falls back to the raw filename if it
  doesn't match the naming convention (e.g. a locally-uploaded file with
  an arbitrary name)

## What's not here yet

This is a solid starting scaffold, not a Swyvl clone. Deliberately left out
so the first version stays reviewable:

- Section/clipping planes and measurement tools (ThatOpen ships components
  for both — `ClipEdges`/`Clipper` and the `LengthMeasurement` /
  `AreaMeasurement` components — a clip plane was tried and pulled back
  out again; neither is wired into the UI at the moment)
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

Each entry can be a plain string (just the name — treated as active), or
an object with a `status`:
```json
{
  "25177": "Lennox Head",
  "24098": { "name": "Old Job", "status": "complete" }
}
```
A `"complete"` job is hidden from the catalog's default view (project
groups all start collapsed — click a header to expand one, or use
"Expand all" / "Collapse all" in the toolbar) but stays fully
searchable — typing anything into the search box, or ticking "Show
completed", brings it back.

Status can be set two ways now: editing this file directly (as above),
or the Active/Complete toggle in a model's edit popup on the catalog
page (see "Correcting a bad import" below) — that one writes to
`catalog-overrides.json` instead, and takes precedence over whatever's
in this file if both set a status for the same job.

Files that don't match the pattern at all are silently skipped by the
catalog (they won't crash it, they just won't show up) — worth checking
`public/projects.json` and the actual Drive filenames if something you
expect to see isn't appearing.

### Correcting a bad import from the catalog itself

Each model row has a small pencil/edit button (hidden in external mode —
see below) for fixing a project name or per-model field that parsed
wrong, without renaming the actual file in Drive or hand-editing
`projects.json`. It covers: project name and Active/Complete status
(both apply to every model under that job number, not just the one you
clicked), zone, drawing number, revision, and description.

These corrections are saved to a `catalog-overrides.json` file the
backend creates in your Drive folder — not `projects.json`, and not this
browser's local storage — so a fix is visible to everyone using the
catalog, immediately, without needing a rebuild or a push. This needed a
small addition to `apps-script/Code.gs` (two new actions,
`getOverrides`/`saveOverrides`) — if you're setting this up fresh, the
copy already in this repo has it; if you deployed an older version,
see "Redeploying after a Code.gs change" below.

"Reset to filename" in the edit popup clears the override for that
model's zone/drawing/revision/description back to whatever the naming
convention would parse on its own — it doesn't touch the project name,
since that's shared across the whole job.

## Sharing with people outside Austruss

Rather than genuinely separate pages, this is a restricted *mode* on the
same viewer and catalog, switched on by a `?external=1` URL parameter —
functionally identical to separate pages from the other end (different
URL, different look, different capabilities), without duplicating the
whole viewer/catalog code a second time.

**Worth being clear about upfront**: this app is public (your call,
earlier in the project) — anything reachable by URL is reachable by
anyone who has that URL, external mode or not. The restriction here is
*curation* (don't hand someone your whole company's catalog when they
only need one project), not real access control. If that ever needs to
change, it'd mean adding actual authentication, which is a different
and larger piece of work.

**What external mode strips out**, on the viewer: Open IFC, Set pivot,
Background, Save locally, Save to Drive. Kept: Fit view, Isolate, Show
all, the properties panel, theme toggle, and — per request — the ability
to *select* (not create) saved Locations, if any were included in the
link. "Browse models" in the header becomes "Other zones," linking to
the catalog in the same restricted mode instead of the full company
catalog.

**On the catalog page**, external mode filters everything to a single
job number and hides "Show completed" (an internal project-tracking
concept) and the generic "Open viewer" link (nothing to open without
picking a specific model first).

**Getting the link** — a "Share" button in the viewer toolbar (only
enabled once the loaded model has actually been saved to or opened from
Drive — a purely local file has no stable fileId to share) opens a popup
with the ready-made link, a "Copy link" button, and a QR code with its
own "Copy QR image" button. This covers the fileId/name/job parts
automatically; there's still no button for the Locations part below,
since that one's a bit more involved.

For reference, the link it builds looks like:
```
index.html?external=1&fileId=<driveFileId>&name=<filename>&job=<jobNumber>
```

To include selectable Locations, add a `locations` parameter — a
URL-encoded JSON array. `cameraPosition` is optional; without it, picking
the location only jumps the pivot rather than the full view:

```
&locations=%5B%7B%22name%22%3A%22Stair%20core%22%2C%22point%22%3A%7B%22x%22%3A1.2%2C%22y%22%3A0%2C%22z%22%3A3.4%7D%2C%22cameraPosition%22%3A%7B%22x%22%3A5%2C%22y%22%3A3%2C%22z%22%3A8%7D%7D%5D
```
which decodes to:
```json
[{ "name": "Stair core", "point": { "x": 1.2, "y": 0, "z": 3.4 }, "cameraPosition": { "x": 5, "y": 3, "z": 8 } }]
```
The easiest way to get real coordinates: open the model yourself, use
Set Pivot + Locations to save one, then open your browser's dev tools →
Application → Local Storage → find the `setout-locations:<filename>` key
— that's the same shape, ready to copy into the array above, append to
the Share button's link, and URL-encode.

This is normally automatic — the Share button and the save-success
screen both include a model's `home` parameter on their own if one's
been set (via "Set Home"). The manual version below is only for building
a link entirely by hand, or overriding what's currently set: add a
`home` parameter — the same `{point, cameraPosition}` shape as one
Location entry, not wrapped in an array:

```
&home=%7B%22point%22%3A%7B%22x%22%3A1.2%2C%22y%22%3A0%2C%22z%22%3A3.4%7D%2C%22cameraPosition%22%3A%7B%22x%22%3A5%2C%22y%22%3A3%2C%22z%22%3A8%7D%7D
```
which decodes to:
```json
{ "point": { "x": 1.2, "y": 0, "z": 3.4 }, "cameraPosition": { "x": 5, "y": 3, "z": 8 } }
```
Find real coordinates the same way — dev tools → Local Storage → the
`setout-home:<filename>` key for a model you've clicked "Set Home" on.
("Home" works in external mode; "Set Home" doesn't — nothing to persist
to there.)

The equivalent catalog link for "other zones in this project":
```
catalog.html?external=1&job=<jobNumber>
```

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

### Redeploying after a Code.gs change

**Unlike everything else in this repo, `apps-script/Code.gs` does not
auto-deploy on `git push`.** GitHub Pages only serves the frontend
(`index.html`, `catalog.html`, and their JS/CSS) — the Apps Script backend
lives entirely on Google's side, in a project you edit at
script.google.com, separate from this repo. This repo's copy of
`Code.gs` is the source of truth to *read*, but pushing it to GitHub
doesn't change what's actually running.

Whenever `Code.gs` changes (a new feature that needs a new action, a bug
fix in the backend), the fix has to be re-pasted into the Apps Script
editor and redeployed:

1. Open your Apps Script project at script.google.com.
2. Replace `Code.gs`'s contents with the updated version from this repo.
3. **Deploy → Manage deployments → click the pencil/edit icon on your
   existing deployment → Version: New version → Deploy.** (Creating a
   *new* deployment instead of a new version of the existing one would
   change the `/exec` URL, breaking every link and saved config that
   points at the old one — always edit the existing deployment.)

Nothing on the frontend needs to change for this — `public/drive-config.json`
still points at the same URL either way.

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
