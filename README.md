# GLM Viewer

A dependency-free, local-first browser for native Supreme Ruler `.glm` archives and standard ZIP containers. It reads the archive index without uploading the file, provides folder navigation and search, and extracts individual entries using their original stored filenames. Entire folders or archives can also be downloaded as ZIP files while preserving their directory structure.

## Run locally

```sh
python3 -m http.server 4173
```

Then open <http://localhost:4173>. Modern Chromium- or Firefox-based browsers are recommended for Deflate decompression support.

The native parser has been verified against the split `sp2.glm` fixture in this repository: 106 directories and 7,648 files. `.glm` is not one universal format, so unrelated producer-specific variants may still require their own parser.
