# ReceiptMind artwork

Original vector artwork: a receipt with a magnifying glass, using the app's forest green, warm white and gold palette. No fonts or third-party imagery. The SVG remains editable; PNGs are reproducibly generated with `npm run assets:generate`.

- `icon.png`: opaque 1024px iOS/store icon; the OS applies the corner mask.
- `adaptive-foreground.png`: transparent 1024px Android foreground with clear mask-safe margins; the config supplies its background.
- `adaptive-monochrome.png`: transparent silhouette for Android themed icons.
- `splash-mark.png`: centered transparent symbol for the native splash plugin.
- `asset-preview.png`: inspection sheet, not shipped as a launcher asset.

Inspect circle/squircle launcher masks, themed icons and splash on physical devices before release. Android 12+ controls splash icon size and timing; development clients do not reproduce release splash behavior exactly.
