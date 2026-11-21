# Step Recorder

An Edge (and Chrome) extension that turns a workflow into a step-by-step guide while you do it. Click through a
process once; it captures each click, typed value and dropdown choice with a screenshot, highlights what you
clicked, and lets you tidy the guide and share it as a single file.

Everything stays in your browser. Nothing is uploaded and the extension makes no network requests.

## Install

Pre-built zips are attached to each [GitHub Release](../../releases) (with a `.sha256` checksum).

1. Download `step-recorder-vX.Y.Z.zip` and unzip it to a folder you'll keep (Edge reads the extension from there).
2. Open `edge://extensions`, switch on **Developer mode**, click **Load unpacked** and choose the unzipped folder.
3. Pin the extension (puzzle-piece icon, then the pin) so it's one click away.

To update, unzip the new release over the same folder and click the reload icon on the extension card.

## Use

1. Open the site where your workflow starts, click the Step Recorder icon, then **Start recording**
   (or press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>).
2. Do the workflow as normal. A small red toolbar on the page shows the step count and has **Pause** and **Stop**.
3. Press **Stop**. Your guide opens: edit titles, add notes, reorder, delete (with Undo), remove a screenshot
   that shows something private, or add text-only steps.
4. **Download guide (HTML)** gives one self-contained file anyone can open; you can also print or save as PDF,
   or copy as Markdown. Earlier guides are listed under **See all guides** in the popup.

Shortcuts can be changed at `edge://extensions/shortcuts`. Settings (in the popup) let you turn off screenshot
blurring, keep typed text out of step titles, or hide the on-page toolbar.

**Privacy:** password and card-like fields are never written into steps and are blurred in screenshots, but
screenshots show everything else on screen. Check a guide before sharing it. Browser pages (`edge://`, the
extension store) can't be recorded. See [SECURITY.md](SECURITY.md).

## Development

Requires Node 22 or newer. There is no build step: the code in `extension/` is exactly what runs in the browser.

```bash
npm ci                 # install exact dev dependencies (ESLint, Playwright)
npm run check          # lint + version consistency + unit tests + build the zip  (what CI runs)
npm run lint           # ESLint only
npm test               # unit tests only
npx playwright install chromium   # one-off, for the browser test
npm run test:e2e       # loads the extension in Chromium and records/edits/exports a guide
```

`npm run build` writes `dist/step-recorder-vX.Y.Z.zip` plus a `.sha256` file. The zip is byte-for-byte
reproducible: the same source always produces the same checksum.

To try your changes, load the `extension/` folder with **Load unpacked** and press the reload icon after edits.
If you want the browser test to use a specific browser binary, set `STEP_RECORDER_CHROMIUM=/path/to/chrome`.

```
extension/   the extension itself (manifest.json is the authoritative version)
  lib/       pure logic shared by the pages and the tests
test/unit/   fast tests (Node's built-in test runner)
test/e2e/    real-browser test (Playwright + Chromium)
scripts/     zip builder, version bump, release checks
.github/     CI, release workflow, templates, Dependabot
```

### Continuous integration

`.github/workflows/ci.yml` runs on every pull request and push to `main`: lint, version check, unit tests, build
and a reproducibility check on Ubuntu (Node 22 and 24) and Windows (Node 22), plus the Chromium browser test.
Workflows have read-only permissions and use no secrets. Pull requests also get the built zip as a downloadable
artifact for testing.

## Making a release

**Versioning:** [Semantic Versioning](https://semver.org/), `MAJOR.MINOR.PATCH` (breaking change or removed
feature, new feature, fix). The version lives in `extension/manifest.json`; `package.json` and
`package-lock.json` mirror it and CI fails if they disagree. Tags are `vMAJOR.MINOR.PATCH` (for example `v1.2.0`).
No pre-release suffixes: browsers only accept numeric extension versions.

1. Make sure `main` is green and up to date, and that **Unreleased** in `CHANGELOG.md` describes the changes.
2. On a branch: `npm run version:set -- 1.2.0` (updates the three version files and dates the changelog).
3. Run `npm run check` and `npm run test:e2e`, review `git diff`, and open a pull request.
4. After it is merged: `git checkout main && git pull`, then
   ```bash
   git tag -a v1.2.0 -m "Step Recorder 1.2.0"
   git push origin v1.2.0
   ```
5. The **Release** workflow re-runs every check, builds the zip, confirms it is identical to the CI build, and
   creates a **draft** GitHub Release with the zip, its checksum and the changelog notes.
6. Open the draft under **Releases**, download the zip, run `sha256sum -c step-recorder-v1.2.0.zip.sha256`, load it
   once in Edge, then click **Publish release**.

If the workflow fails before the draft exists, fix the problem on `main`, delete the tag
(`git push --delete origin v1.2.0 && git tag -d v1.2.0`) and tag again. Nothing is published to a browser store;
that would be a separate, manual step.

## License

[MIT](LICENSE)
