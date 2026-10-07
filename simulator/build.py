"""
Assemble the single-file simulator from its sources.

    python simulator/build.py   ->   simulator/balloon-rocket-simulator.html

The output has no build-time dependencies and runs offline in any modern browser
(the Google Fonts link is optional; without a network the page falls back to system fonts).
"""
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE / "src"
css = (SRC / "styles.css").read_text()
body = (SRC / "body.html").read_text()
engine = (SRC / "engine.js").read_text()
app = (SRC / "app.js").read_text()
assert "</script" not in engine and "</script" not in app

head = ('<title>Balloon Rocket Simulator</title>\n'
        '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600'
        '&family=Barlow+Condensed:wght@500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">\n'
        '<style>\n' + css + '\n</style>\n')
reset = ('<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);'
         'padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}'
         '[hidden]{display:none!important}</style>\n')
page = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        + reset + head + '</head>\n<body>\n' + body
        + '\n<script id="engine-src">\n' + engine + '\n</script>\n<script>\n' + app + '\n</script>\n</body>\n</html>\n')
out = HERE / "balloon-rocket-simulator.html"
out.write_text(page)
print(f"wrote {out.relative_to(HERE.parent)} ({len(page) / 1024:.0f} KB)")
