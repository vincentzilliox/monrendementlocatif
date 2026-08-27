#!/usr/bin/env python3
"""Fabrique la version autonome du site à partir de index.html.

index.html est écrit pour l'hébergement Artifact, qui fournit lui-même
<!doctype>, <html> et <head>. Pour un hébergement classique il faut cette
enveloppe — en particulier la balise viewport, sans laquelle les navigateurs
mobiles rendent la page à 980 px de large puis la dézooment.

Usage : python3 build.py   ->  écrit site/index.html
"""

import pathlib
import re

RACINE = pathlib.Path(__file__).parent
SOURCE = RACINE / "index.html"
SORTIE = RACINE / "site" / "index.html"

DOMAINE = "https://monrendementlocatif.fr/"
TITRE = "Rentabilité locative : votre rendement réel, année par année"
DESCRIPTION = (
    "Calculez le rendement annualisé de votre investissement locatif, en euros "
    "courants et en pouvoir d'achat. Point mort, meilleure année de revente, "
    "et comparaison avec le Livret A, un fonds euros et la bourse."
)
# Le carré violet du logotype, en SVG inline : pas de requête réseau.
FAVICON = (
    "data:image/svg+xml,"
    "%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E"
    "%3Crect width='32' height='32' rx='7' fill='%237040D8'/%3E"
    "%3Cpath d='M8 22 L14 15 L19 19 L25 10' stroke='white' stroke-width='3' "
    "fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"
)


def main() -> None:
    src = SOURCE.read_text(encoding="utf-8")

    coupe = src.index('<header class="masthead">')
    entete, corps = src[:coupe], src[coupe:]

    # Le <title> de la source sert de nom à l'Artifact ; le site en veut un plus
    # descriptif. On retire l'ancien pour éviter d'en avoir deux.
    entete = re.sub(r"<title>.*?</title>\s*", "", entete, flags=re.S)

    page = f"""<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{TITRE}</title>
<meta name="description" content="{DESCRIPTION}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#F8F7FB" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#15111E" media="(prefers-color-scheme: dark)">
<link rel="icon" href="{FAVICON}">
<link rel="canonical" href="{DOMAINE}">
<meta property="og:type" content="website">
<meta property="og:url" content="{DOMAINE}">
<meta property="og:title" content="{TITRE}">
<meta property="og:description" content="{DESCRIPTION}">
<meta property="og:locale" content="fr_FR">
<meta name="twitter:card" content="summary">
{entete.strip()}
</head>
<body>
{corps.rstrip()}
</body>
</html>
"""

    SORTIE.parent.mkdir(exist_ok=True)
    SORTIE.write_text(page, encoding="utf-8")
    print(f"écrit {SORTIE.relative_to(RACINE)} ({len(page) / 1024:.0f} Ko)")


if __name__ == "__main__":
    main()
