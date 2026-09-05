#!/usr/bin/env python3
"""Régénère og-image.png, l'image affichée quand on partage le site.

Rend outils/og-image.html (1200 × 630, autonome, sans police externe) avec
Chrome sans fenêtre et écrit le PNG à la racine, d'où build.py le recopie.

    python3 outils/og_image.py
"""

import pathlib
import subprocess
import sys

RACINE = pathlib.Path(__file__).parent.parent
CHROME = ("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
          "/usr/bin/google-chrome", "/usr/bin/chromium")


def main():
    chrome = next((c for c in CHROME if pathlib.Path(c).exists()), None)
    if not chrome:
        print("Chrome introuvable"); return 1
    cible = RACINE / "og-image.png"
    subprocess.run([chrome, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                    "--force-device-scale-factor=1", "--window-size=1200,630",
                    f"--screenshot={cible}", (RACINE / "outils" / "og-image.html").as_uri()],
                   capture_output=True, timeout=60, check=True)
    print(f"  og-image.png  ({cible.stat().st_size:,} o)".replace(",", " "))
    return 0


if __name__ == "__main__":
    sys.exit(main())
