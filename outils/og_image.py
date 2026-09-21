#!/usr/bin/env python3
"""Régénère og-image.png, l'image affichée quand on partage le site.

Rend outils/og-image.html (1200 × 630, autonome, sans police externe) avec
Chrome sans fenêtre et écrit le PNG à la racine, d'où build.py le recopie.

    python3 outils/og_image.py
"""

import pathlib
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import _local
from _local import CHROME, RACINE, premier_existant


def main():
    chrome = premier_existant(CHROME)
    if not chrome:
        print("Chrome introuvable"); return 1
    cible = RACINE / "og-image.png"
    subprocess.run([chrome, "--headless=new", *_local.options_chrome(chrome), "--disable-gpu", "--hide-scrollbars",
                    "--force-device-scale-factor=1", "--window-size=1200,630",
                    f"--screenshot={cible}", (RACINE / "outils" / "og-image.html").as_uri()],
                   capture_output=True, timeout=60, check=True)
    print(f"  og-image.png  ({cible.stat().st_size:,} o)".replace(",", " "))
    return 0


if __name__ == "__main__":
    sys.exit(main())
