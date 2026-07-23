# Fonts

## Optional: full Hebrew glyphs in generated PDFs

The server-side PDF generator (`lib/gift-cards/pdf.ts`) renders Latin text,
amounts, the gift-card code, the QR code, and the redemption URL out of the box
using the built-in PDF fonts. To render **Hebrew** greetings/names as real
glyphs (rather than the ASCII-safe fallback), drop a Hebrew-capable TrueType
font here named exactly:

    public/fonts/NotoSansHebrew-Regular.ttf

Recommended: Noto Sans Hebrew (SIL Open Font License) from Google Fonts.
The generator auto-detects the file, embeds it via fontkit, and applies naive
RTL ordering per line. When the file is absent, PDF generation still succeeds
(never crashes on Hebrew input) using the Latin fallback.
