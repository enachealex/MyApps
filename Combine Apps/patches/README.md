# Patches to the upstream apps

`scripts/fetch-upstream.*` applies `patches/<app>/*.patch` (in name order) after checking each app
out at its pinned commit. Each patch is the smallest change that lets an app build or run next to
the others in one process; each changed line is marked `craft-suite:` in the source.

When an app's commit changes in `upstream.lock` and one of its patches no longer applies, look at
why it was needed (below) and whether upstream fixed it; drop the patch or redo it against the new
code (`git -C vendor/<app> diff -- <file> > patches/<app>/<name>.patch`).

| Patch | Why |
| --- | --- |
| `vectorcraft/0001-pdf-import-accept-pdfcraft-hayro.patch` | Cargo applies a `[patch]` to the whole build, so every app gets PdfCraft's patched PDF interpreter (`hayro-interpret`), which adds a warning kind (`ContentTruncated`). VectorCraft's PDF import matched every warning kind by name and stopped compiling; it now has a catch-all arm. |
