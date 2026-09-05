#!/usr/bin/env python3
"""Ce dont les trois outils ont besoin en commun : servir site/ et trouver Chrome.

verifier.py, captures.py et servir.py redéfinissaient chacun le même serveur
de fichiers et la même liste de chemins possibles pour Chrome. Trois copies
d'un même idiome, qui dérivaient l'une de l'autre au fil des retouches.
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
JSC = ("/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc",)


def premier_existant(chemins):
    return next((c for c in chemins if pathlib.Path(c).exists()), None)


def port_libre(depart=0, essais=20):
    """Un port disponible. `depart=0` en laisse choisir un au système ; sinon on
    avance depuis celui demandé, qu'une session précédente peut occuper."""
    for p in range(depart, depart + (1 if depart == 0 else essais)):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", p))
                return s.getsockname()[1]
            except OSError:
                continue
    return None


def serveur(port, journal=None):
    """Un serveur de site/ prêt à démarrer. `journal` reçoit chaque requête, ou
    None pour ne rien afficher."""
    classe = type("Handler", (http.server.SimpleHTTPRequestHandler,),
                  {"__init__": lambda self, *a, **k:
                   http.server.SimpleHTTPRequestHandler.__init__(
                       self, *a, directory=str(SITE), **k),
                   "log_message": (lambda self, f, *a: journal(f % a)) if journal
                   else (lambda *a: None)})
    return socketserver.ThreadingTCPServer(("127.0.0.1", port), classe)


def servir_en_fond():
    """Sert site/ sur un port libre, dans un thread de fond. Rend (serveur, url)."""
    port = port_libre()
    srv = serveur(port)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, "http://127.0.0.1:%d" % port


def construire():
    """Relance build.py. Rend None si tout va bien, le message d'erreur sinon."""
    fait = subprocess.run([sys.executable, "build.py"], cwd=RACINE,
                          capture_output=True, text=True)
    return None if fait.returncode == 0 else (fait.stderr.strip() or fait.stdout.strip())
