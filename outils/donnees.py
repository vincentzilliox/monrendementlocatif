#!/usr/bin/env python3
"""Importe les données de marché : prix de vente (DVF) et loyers d'annonce (ANIL).

La calculatrice situe le prix et le loyer saisis par rapport à la commune. Elle
n'appelle pour cela aucun service tiers : ce script télécharge les sources
publiques, les réduit à quelques indicateurs par commune et écrit `donnees/`,
qui est versionné. `build.py` le recopie dans `site/donnees/` sans rien
télécharger, et la page charge le fichier de son département à la demande.

À relancer quand une source publie un nouveau millésime — DVF en avril et en
octobre, la Carte des loyers en décembre :

    python3 outils/donnees.py

Réseau requis. Les téléchargements sont gardés dans `.cache/donnees/`, hors du
dépôt ; `--frais` les refait.
"""

import csv
import io
import unicodedata
import json
import pathlib
import sys
import urllib.request
from collections import defaultdict

RACINE = pathlib.Path(__file__).parent.parent
CACHE = RACINE / ".cache" / "donnees"
SORTIE = RACINE / "donnees"

# Les prix de vente : médianes mensuelles par commune, cinq ans de mutations.
DVF = {
    "url": "https://data-pipeline-open.s3.sbg.io.cloud.ovh.net/dvf/stats_dvf.csv",
    "page": "https://www.data.gouv.fr/datasets/statistiques-dvf",
    "titre": "Statistiques DVF — DGFiP, Etalab",
}
# On ne garde que les derniers mois : cinq ans de prix mêlés diraient le marché
# de 2021 autant que celui d'aujourd'hui.
MOIS_DVF = 24

# Les loyers d'annonce : un indicateur par commune et par type de logement.
ANIL = {
    "page": "https://www.data.gouv.fr/datasets/carte-des-loyers-indicateurs-de-loyers-dannonce-par-commune-en-2025",
    "titre": "Carte des loyers 2025 — ANIL, ministère du Logement",
    "periode": "annonces leboncoin et SeLoger 2019-2025, 3ᵉ trimestre 2025",
    "fichiers": {
        # clé : [adresse, surface du logement de référence en m²]
        "la":  ["https://static.data.gouv.fr/resources/carte-des-loyers-indicateurs-de-loyers-dannonce-par-commune-en-2025/20251211-145010/pred-app-mef-dhup.csv", 52],
        "l12": ["https://static.data.gouv.fr/resources/carte-des-loyers-indicateurs-de-loyers-dannonce-par-commune-en-2025/20251211-144934/pred-app12-mef-dhup.csv", 37],
        "l3":  ["https://static.data.gouv.fr/resources/carte-des-loyers-indicateurs-de-loyers-dannonce-par-commune-en-2025/20251211-144951/pred-app3-mef-dhup.csv", 72],
        "lm":  ["https://static.data.gouv.fr/resources/carte-des-loyers-indicateurs-de-loyers-dannonce-par-commune-en-2025/20251211-145039/pred-mai-mef-dhup.csv", 92],
    },
}


def telecharger(url, nom, frais):
    CACHE.mkdir(parents=True, exist_ok=True)
    cible = CACHE / nom
    if frais or not cible.exists():
        print("  télécharge", nom, "…", flush=True)
        with urllib.request.urlopen(url, timeout=600) as r, open(cible, "wb") as f:
            while bloc := r.read(1 << 20):
                f.write(bloc)
    return cible


def departement(code):
    """Le département d'un code commune INSEE : trois caractères outre-mer."""
    return code[:3] if code.startswith("97") else code[:2]


def initiale(nom):
    """La lettre sous laquelle on range une commune : première lettre du nom, sans
    accent. La page ne charge que la liste de la lettre tapée."""
    # Même règle que initiale() dans src/moteur.js ; outils/verifier.py les confronte.
    lettre = unicodedata.normalize("NFD", nom.replace("Œ", "Oe").replace("Æ", "Ae"))[0].lower()
    return lettre if "a" <= lettre <= "z" else "_"


def nombre(v):
    v = (v or "").strip().replace(",", ".")
    return float(v) if v else None


def loyers(frais):
    """{code: {clé: [loyer, bas, haut, annonces]}} et {code: nom}.

    Les fichiers sont en Windows-1252 : en latin-1, « Œ » deviendrait un
    caractère de contrôle. Le loyer est prédit au m², charges comprises, pour le logement de référence
    ; bas et haut encadrent les loyers individuels, pas la seule moyenne. Une
    commune sans assez d'annonces reçoit l'estimation de sa maille : on garde
    alors 0 annonce, pour que la page le dise."""
    parCommune, noms = defaultdict(dict), {}
    for cle, (url, _) in ANIL["fichiers"].items():
        brut = telecharger(url, "anil-%s.csv" % cle, frais).read_bytes()
        for l in csv.DictReader(io.StringIO(brut.decode("cp1252")), delimiter=";"):
            code = l["INSEE_C"].strip()
            noms[code] = l["LIBGEO"].strip()
            parCommune[code][cle] = [round(nombre(l["loypredm2"]), 2), round(nombre(l["lwr.IPm2"]), 2),
                                     round(nombre(l["upr.IPm2"]), 2),
                                     int(nombre(l["nbobs_com"]) or 0) if l["TYPPRED"].strip() == "commune" else 0]
    return parCommune, noms


def prix(frais):
    """{code: {"pa": [prix médian, ventes], "pm": [...]}} sur les derniers mois,
    communes et départements, et la période retenue.

    Le fichier donne une médiane par mois : on en fait la moyenne pondérée par
    le nombre de ventes. Ce n'est pas la médiane exacte de la période, mais un
    prix typique qui ne dépend pas d'un mois creux."""
    chemin = telecharger(DVF["url"], "dvf-mensuel.csv", frais)
    with open(chemin, encoding="utf-8") as f:
        mois = sorted({l["annee_mois"] for l in csv.DictReader(f) if l["echelle_geo"] == "nation"})
    retenus = set(mois[-MOIS_DVF:])
    somme = defaultdict(lambda: {"pa": [0.0, 0], "pm": [0.0, 0]})
    with open(chemin, encoding="utf-8") as f:
        for l in csv.DictReader(f):
            if l["annee_mois"] not in retenus or l["echelle_geo"] not in ("commune", "departement"):
                continue
            for cle, type_ in (("pa", "appartement"), ("pm", "maison")):
                n, med = nombre(l["nb_ventes_" + type_]), nombre(l["med_prix_m2_" + type_])
                if n and med:
                    somme[l["code_geo"]][cle][0] += med*n
                    somme[l["code_geo"]][cle][1] += int(n)
    sortie = {code: {cle: [round(s/n), n] for cle, (s, n) in v.items() if n} for code, v in somme.items()}
    return sortie, (min(retenus), max(retenus))


def main():
    frais = "--frais" in sys.argv
    print("Loyers d'annonce (ANIL)")
    parCommune, noms = loyers(frais)
    print("Prix de vente (DVF)")
    ventes, (debut, fin) = prix(frais)

    marche = defaultdict(lambda: {"c": {}, "d": {}})
    index = []
    for code, nom in noms.items():
        dep = departement(code)
        # Le nom voyage avec les chiffres : un lien qui ne porte que le code
        # retrouve ainsi de quoi afficher la commune.
        fiche = {"n": nom}
        fiche.update(parCommune[code])
        fiche.update(ventes.get(code, {}))
        marche[dep]["c"][code] = fiche
        n = sum(fiche[k][1] for k in ("pa", "pm") if k in fiche)
        index.append([code, nom, n])
    for dep in marche:
        marche[dep]["d"] = ventes.get(dep, {})
    # Les communes les plus actives d'abord : à nom égal, c'est celle qu'on cherche.
    index.sort(key=lambda c: (c[1].lower(), -c[2]))

    sources = {
        "millesime": fin[:4],
        "dvf": {"titre": DVF["titre"], "page": DVF["page"], "periode": [debut, fin],
                "note": "moyenne des prix médians mensuels au m², pondérée par le nombre de ventes"},
        "loyers": {"titre": ANIL["titre"], "page": ANIL["page"], "periode": ANIL["periode"],
                   "references": {k: v[1] for k, v in ANIL["fichiers"].items()},
                   "note": "loyer d'annonce prédit au m², charges comprises, pour un logement de référence"},
    }
    for dossier in ("marche", "communes"):
        (SORTIE / dossier).mkdir(parents=True, exist_ok=True)
        for ancien in (SORTIE / dossier).glob("*.json"):
            ancien.unlink()
    (SORTIE / "communes.json").unlink(missing_ok=True)
    compact = lambda o: json.dumps(o, ensure_ascii=False, separators=(",", ":"))
    (SORTIE / "sources.json").write_text(json.dumps(sources, ensure_ascii=False, indent=1), encoding="utf-8")
    parLettre = defaultdict(list)
    for c in index:
        parLettre[initiale(c[1])].append(c)
    for lettre, communes in parLettre.items():
        (SORTIE / "communes" / ("%s.json" % lettre)).write_text(compact(communes), encoding="utf-8")
    for dep, contenu in sorted(marche.items()):
        (SORTIE / "marche" / ("%s.json" % dep)).write_text(compact(contenu), encoding="utf-8")
    taille = sum(f.stat().st_size for f in SORTIE.rglob("*.json"))
    print("  %d communes, %d départements, DVF %s → %s, %d Ko"
          % (len(index), len(marche), debut, fin, taille // 1024))


if __name__ == "__main__":
    main()
