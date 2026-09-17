# GLM Viewer

A dependency-free, local-first browser for ZIP-compatible `.glm` archives. It reads the archive index without uploading the file, provides folder navigation and search, and extracts individual entries using their original stored filenames.

## Run locally

```sh
python3 -m http.server 4173
```

Then open <http://localhost:4173>. Modern Chromium- or Firefox-based browsers are recommended for Deflate decompression support.

> **Format note:** `.glm` is not one universal file format. The viewer recognizes GLM archives that use a standard ZIP container. A sample from another producer will require a parser for that producer's binary layout.
