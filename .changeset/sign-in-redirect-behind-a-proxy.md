---
"@eia/web": patch
---

A download link followed without a session no longer redirects to the container's own address.

Both download routes built the sign-in redirect with `new URL("/sign-in", request.url)`, which
behind a proxy resolves against the address the process is bound to — observed on staging on
19 November 2026 as `https://0.0.0.0:3000/sign-in`. The Location header is now relative, which
RFC 7231 permits and every browser resolves against the address it asked for. Guessing the public
origin from a forwarded header would be building a redirect out of a header.
