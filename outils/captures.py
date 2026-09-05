#!/usr/bin/env python3
"""Photographie le site tel qu'un visiteur le verrait.

Sert site/ en local puis capture chaque page avec Chrome sans fenêtre, en
clair et en sombre, sur grand écran et sur téléphone. Utile pour relire une
mise en page avant de publier, sans ouvrir un navigateur à la main.

    python3 outils/captures.py [dossier_de_sortie] [chemin ...]

Sans chemin, capture la page d'accueil. Les fichiers sont nommés
<page>-<largeur>-<theme>.png.
"""

import http.server
import pathlib
import socket
import socketserver
import subprocess
import sys
import threading

RACINE = pathlib.Path(__file__).parent.parent
SITE = RACINE / "site"
CHROME = ("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
          "/usr/bin/google-chrome", "/usr/bin/chromium")
TAILLES = ((1360, 4800), (390, 6500))
# Chrome sans fenêtre refuse une fenêtre de moins de 500 px : pour les largeurs
# inférieures, on contraint la page elle-même et on recadre la capture.
MIN_CHROME = 500


def servir():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    classe = type("Handler", (http.server.SimpleHTTPRequestHandler,),
                  {"__init__": lambda self, *a, **k:
                   http.server.SimpleHTTPRequestHandler.__init__(self, *a, directory=str(SITE), **k),
                   "log_message": lambda *a: None})
    serveur = socketserver.ThreadingTCPServer(("127.0.0.1", port), classe)
    threading.Thread(target=serveur.serve_forever, daemon=True).start()
    return serveur, "http://127.0.0.1:%d" % port


def main():
    args = sys.argv[1:]
    sortie = pathlib.Path(args[0]) if args else RACINE / "captures"
    chemins = args[1:] or ["/"]
    chrome = next((c for c in CHROME if pathlib.Path(c).exists()), None)
    if not chrome:
        print("Chrome introuvable"); return 1
    sortie.mkdir(parents=True, exist_ok=True)
    serveur, base = servir()
    temoins = []
    try:
        for chemin in chemins:
            page = SITE / chemin.strip("/") / "index.html" if chemin != "/" else SITE / "index.html"
            if not page.exists():
                page = SITE / chemin.strip("/")
            nom = "accueil" if chemin == "/" else chemin.strip("/").replace("/", "-").replace(".html", "")
            html = page.read_text(encoding="utf-8")
            for theme in ("light", "dark"):
                for largeur, hauteur in TAILLES:
                    temoin = page.parent / f"__{nom}-{theme}-{largeur}.html"
                    etroit = f"<style>html{{width:{largeur}px;margin:0}}</style>" if largeur < MIN_CHROME else ""
                    temoin.write_text(html.replace('<html lang="fr">', f'<html lang="fr" data-theme="{theme}">')
                                      .replace("</head>", etroit + "</head>"), encoding="utf-8")
                    temoins.append(temoin)
                    url = base + "/" + str(temoin.relative_to(SITE))
                    cible = sortie / f"{nom}-{largeur}-{theme}.png"
                    subprocess.run([chrome, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                                    "--virtual-time-budget=5000", f"--window-size={largeur},{hauteur}",
                                    f"--screenshot={cible}", url],
                                   capture_output=True, timeout=120)
                    print(" ", cible.relative_to(RACINE) if cible.is_relative_to(RACINE) else cible)
    finally:
        serveur.shutdown()
        for t in temoins:
            t.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
