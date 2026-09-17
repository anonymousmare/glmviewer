# GLM Viewer

A dependency-free, local-first browser for Supreme Ruler `.glm` archives and standard ZIP containers. It reads only the archive index while browsing, provides folder navigation and search, and extracts entries using their original stored paths and filenames.

## Run locally

```sh
python3 -m http.server 4173
```

Then open <http://localhost:4173>. Modern Chromium- or Firefox-based browsers are recommended for Deflate decompression support.

Use **Extract all** in Chrome or Edge to choose an output directory and recreate the complete folder tree. Individual-file extraction works in all modern browsers.

The native parser was verified against `sp2.glm`: 106 directories, 7,648 files, and a 304,948-byte index. `.glm` is not one universal format, so unrelated producer-specific variants may still require their own parser.
