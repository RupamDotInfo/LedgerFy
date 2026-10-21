# Design reference

`Desktop/1.html` and `Desktop/2.html` are the desktop design reference the
interface is built from. They are static mockups, not part of the build, and
nothing in the application is generated from them.

Open either file in a browser. They render their own Tailwind from a CDN and
load the Material Symbols font, so they need a network connection. A couple of
the illustrations are hosted on Google's image CDN and will eventually appear
as broken images; the layout is the point, not the artwork.

The token names in the mockups — `surface-container`, `on-surface`,
`label-sm`, `space-sm`, `gutter` — are the same tokens the application defines
in `src/styles/main.css`, so the mockup and the built interface can be read
side by side.
