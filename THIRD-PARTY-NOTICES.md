# Third-party notices

## GSAP runtime

The browser build and generated `rost-preview.html` include GSAP. GSAP retains its own copyright and license independently of the project's other files:

```text
Copyright 2008-2026, GreenSock. All rights reserved.
Subject to the terms at https://gsap.com/standard-license
```

The authoritative terms are the [GSAP Standard License](https://gsap.com/standard-license). The installed runtime's notice is available in `node_modules/gsap/gsap-core.js`; the installed version is recorded in `package-lock.json`.

The Vite build retains legal comments inline. The standalone exporter embeds the resulting JavaScript with those notices intact.

## Other dependencies

Dependencies installed by `npm ci`, including Vite, resvg, `ffmpeg-static` and the FFmpeg binary it installs, retain their respective licenses. Consult each installed package's license files, package metadata and upstream notices. This document does not relicense those dependencies or binaries.

`node_modules`, generated MP4 files and the downloaded FFmpeg binary are not committed to this repository.
