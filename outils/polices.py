#!/usr/bin/env python3
"""Récupère les polices depuis Google Fonts pour les héberger nous-mêmes.

Charger les polices depuis les serveurs de Google transmet l'adresse IP de
chaque visiteur à un tiers. La CNIL considère ce transfert comme un traitement
de données soumis à consentement, et un tribunal allemand a condamné un site
sur ce motif en 2022. Les servir depuis notre propre domaine supprime le
problème, et accélère l'affichage : une connexion de moins à établir.

À relancer seulement si l'on change de police ou de graisse.

    python3 outils/polices.py     ->  polices/
"""

import pathlib
import re
import urllib.request

RACINE = pathlib.Path(__file__).parent.parent
SORTIE = RACINE / "polices"

# Un navigateur récent obtient du woff2 ; un vieil agent recevrait du ttf.
AGENT = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
         "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

# Seules les graisses réellement employées par la feuille de style.
FAMILLES = {
    "Public Sans": [400, 500, 600],
    "IBM Plex Mono": [400, 500],
    "Spectral": [600],
}
# Le français tient dans « latin » ; « latin-ext » ne sert qu'aux rares œ et ligatures,
# et grâce à unicode-range le navigateur ne le télécharge que s'il en a besoin.
SOUS_ENSEMBLES = ("latin", "latin-ext")


def recuperer(url):
    requete = urllib.request.Request(url, headers={"User-Agent": AGENT})
    with urllib.request.urlopen(requete, timeout=30) as reponse:
        return reponse.read()


def main():
    SORTIE.mkdir(exist_ok=True)
    regles = []
    total = 0

    for famille, graisses in FAMILLES.items():
        css = recuperer(
            "https://fonts.googleapis.com/css2?family=%s:wght@%s&display=swap"
            % (famille.replace(" ", "+"), ";".join(str(g) for g in graisses))
        ).decode("utf-8")

        # Chaque bloc est précédé d'un commentaire nommant le sous-ensemble.
        for sous_ens, bloc in re.findall(r"/\* (\S+) \*/\s*(@font-face \{.*?\})", css, re.S):
            if sous_ens not in SOUS_ENSEMBLES:
                continue
            graisse = re.search(r"font-weight:\s*(\d+)", bloc).group(1)
            lien = re.search(r"url\((https://[^)]+\.woff2)\)", bloc).group(1)
            plage = re.search(r"unicode-range:\s*([^;]+);", bloc).group(1).strip()

            nom = "%s-%s-%s.woff2" % (famille.lower().replace(" ", "-"), graisse, sous_ens)
            octets = recuperer(lien)
            (SORTIE / nom).write_bytes(octets)
            total += len(octets)
            print("  %-34s %6d o" % (nom, len(octets)))

            regles.append(
                "@font-face{font-family:'%s';font-style:normal;font-weight:%s;"
                "font-display:swap;src:url(/assets/fonts/%s) format('woff2');"
                "unicode-range:%s}" % (famille, graisse, nom, plage)
            )

    (SORTIE / "polices.css").write_text("\n".join(regles) + "\n", encoding="utf-8")
    print("\n%d fichiers, %.0f Ko au total" % (len(regles), total / 1024))
    print("Relancez ensuite : python3 build.py")


if __name__ == "__main__":
    main()
