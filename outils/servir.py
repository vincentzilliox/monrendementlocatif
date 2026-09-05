#!/usr/bin/env python3
"""Construit le site et le sert en local, puis ouvre le navigateur.

À utiliser pour relire le site comme un visiteur : les chemins sont absolus
(/css/style.css, /guides/…) et les pages autres que la calculatrice n'existent
que dans site/. Ouvrir index.html en double-clic ne peut donc pas fonctionner —
c'est un fichier source, pas une page.

    python3 outils/servir.py            ->  http://127.0.0.1:8000
    python3 outils/servir.py 8080       ->  sur le port indiqué
    python3 outils/servir.py --sans-navigateur

Ctrl+C pour arrêter.
"""

import pathlib
import sys
import threading
import webbrowser

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import _local

PORT_PAR_DEFAUT = 8000


def main():
    args = [a for a in sys.argv[1:] if a != "--sans-navigateur"]
    ouvrir = "--sans-navigateur" not in sys.argv
    depart = int(args[0]) if args else PORT_PAR_DEFAUT

    print("Construction…")
    erreur = _local.construire()
    if erreur:
        print(erreur)
        return 1

    # Le port demandé peut être pris par une session précédente : on avance.
    port = _local.port_libre(depart)
    if port is None:
        print("Aucun port libre entre %d et %d." % (depart, depart + 19))
        return 1

    serveur = _local.serveur(port, journal=lambda l: print("  " + l))
    serveur.daemon_threads = True
    url = "http://127.0.0.1:%d/" % port

    print("\n  %s\n  Ctrl+C pour arrêter.\n" % url)
    if ouvrir:
        threading.Timer(0.4, webbrowser.open, [url]).start()
    try:
        serveur.serve_forever()
    except KeyboardInterrupt:
        print("\nArrêt.")
    finally:
        serveur.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
