#!/usr/bin/env python3
"""Generates the two font files made from Inter (SIL Open Font License 1.1). The output is committed.

1. src/styles/inter-figures.woff2 — only the digits 0-9 of the app's Inter (the same variable file
   the app loads from @fontsource-variable/inter), drawn with their even-width forms. The CSS puts it
   in front of Inter for figures (--font-mono): prices, hours and kilometres line up, while the
   hyphens, dots and spaces around them keep their normal width. (Inter's own `tnum` feature widens
   those too, which made "C-00001" or "0723 375 248" look typed on a typewriter.)

2. supabase/functions/_shared/reportFonts.ts — Inter Regular and Bold for the history report PDF,
   cut down to the letters a report can print (Latin, Latin-1, Latin Extended-A, Romanian ș ț Ș Ț
   with the comma below, dashes, quotes, bullet, ellipsis, euro, minus), digits even-width as in the
   app, as base64 so the Edge Function needs no files next to it.

Needs fonttools and brotli (`pip install fonttools brotli`) and the static Inter fonts from the
`inter-ui` npm package, which is not a dependency of the app:
    npm pack inter-ui@4.1.1 && tar xzf inter-ui-4.1.1.tgz   # makes ./package
    python3 scripts/gen-fonts.py path/to/package
"""
import base64
import io
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
DIGITS = range(0x30, 0x3A)
REPORT_UNICODES = (
    list(range(0x20, 0x7F))
    + list(range(0xA0, 0x100))
    + list(range(0x100, 0x180))
    + list(range(0x218, 0x21C))
    + list(range(0x2010, 0x2015))
    + list(range(0x2018, 0x201F))
    + [0x2022, 0x2026, 0x20AC, 0x2212]
)


def tabular_digits(font: TTFont) -> None:
    """Points the digits 0-9 of the character map at their even-width glyphs (Inter's `tnum`)."""
    gsub = font['GSUB'].table
    mapping: dict[str, str] = {}
    for record in gsub.FeatureList.FeatureRecord:
        if record.FeatureTag != 'tnum':
            continue
        for index in record.Feature.LookupListIndex:
            for table in gsub.LookupList.Lookup[index].SubTable:
                mapping.update(getattr(table, 'mapping', {}))
    for cmap in font['cmap'].tables:
        if not cmap.isUnicode():
            continue
        for code in DIGITS:
            glyph = cmap.cmap.get(code)
            if glyph in mapping:
                cmap.cmap[code] = mapping[glyph]


def cut(font: TTFont, unicodes, features: list[str], flavor: str | None) -> bytes:
    options = subset.Options()
    options.layout_features = features
    options.hinting = False
    options.name_IDs = ['*']
    options.flavor = flavor
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=list(unicodes))
    subsetter.subset(font)
    out = io.BytesIO()
    font.flavor = flavor
    font.save(out)
    return out.getvalue()


def figures() -> None:
    source = ROOT / 'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2'
    font = TTFont(source)
    tabular_digits(font)
    data = cut(font, DIGITS, [], 'woff2')
    (ROOT / 'src/styles/inter-figures.woff2').write_bytes(data)
    print(f'src/styles/inter-figures.woff2: {len(data)} bytes')


def report(package: Path) -> None:
    parts = []
    for name, file in (('INTER_REGULAR', 'Inter-Regular.woff2'), ('INTER_BOLD', 'Inter-Bold.woff2')):
        font = TTFont(package / 'web' / file)
        tabular_digits(font)
        data = cut(font, REPORT_UNICODES, ['kern'], None)
        parts.append(f"export const {name} =\n  '{base64.b64encode(data).decode()}';\n")
        print(f'{name}: {len(data)} bytes')
    header = (
        '// Inter Regular and Bold (SIL Open Font License 1.1, see fonts/OFL.txt), the app\'s typeface, cut\n'
        '// down to the letters a report can print: Latin, Latin-1, Latin Extended-A, Romanian ș ț Ș Ț\n'
        '// (comma below), dashes, quotes, bullet, ellipsis, euro, minus; digits even-width, as in the app.\n'
        '// Generated, do not edit: scripts/gen-fonts.py. Embedded as text so the Edge Function needs no\n'
        '// files next to it.\n\n'
    )
    (ROOT / 'supabase/functions/_shared/reportFonts.ts').write_text(header + '\n'.join(parts))


if __name__ == '__main__':
    figures()
    if len(sys.argv) > 1:
        report(Path(sys.argv[1]))
    else:
        print('No inter-ui package given: reportFonts.ts left as it is.')
