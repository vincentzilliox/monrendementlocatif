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
import xml.etree.ElementTree as ET
import zipfile
import json
import pathlib
import sys
import time
import urllib.parse
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


# Le zonage A/B/C : la tension du marché, de A bis (la plus forte) à C.
ZONAGE_ABC = {
    "url": "https://static.data.gouv.fr/resources/liste-des-communes-selon-le-zonage-abc/20260703-091314/liste-ensemble-des-communes-zonage-abc-en-vigueur-26-juin-2026.csv",
    "page": "https://www.data.gouv.fr/datasets/liste-des-communes-selon-le-zonage-abc",
    "titre": "Zonage A/B/C — ministère du Logement, en vigueur au 26 juin 2026",
}
# Les zones tendues de l'article 232 du CGI : « 1. Zone tendue », une agglomération
# de plus de 50 000 habitants, où le loyer d'un nouveau bail est plafonné par
# celui du locataire précédent ; « 2. Zone touristique et tendue ».
ZONAGE_TLV = {
    "url": "https://static.data.gouv.fr/resources/liste-des-communes-selon-le-zonage-tlv-1/20251230-094759/zonage-tlv-decret-22-dec-2025.csv",
    "page": "https://www.data.gouv.fr/datasets/liste-des-communes-selon-le-zonage-tlv-1",
    "titre": "Zones tendues — décret n° 2025-1267 du 22 décembre 2025",
}
# L'encadrement des loyers : aucune source ouverte ne le donne pour toute la
# France, et ses zones sont plus fines que la commune. La liste vient de la
# page officielle, relevée à la main : `verifie` dit quand, `fin` quand
# l'expérimentation s'arrête sauf prolongation — verifier.py échoue au-delà de
# cette date tant que la liste n'a pas été revue. Paris et Lyon s'étendent à
# leurs arrondissements ; Hellemmes et Lomme sont des communes associées de
# Lille, Pierrefitte-sur-Seine a fusionné dans Saint-Denis en 2025.
ENCADREMENT = {
    "page": "https://www.service-public.gouv.fr/particuliers/vosdroits/F1314",
    "titre": "Encadrement des loyers — Service-Public.fr, vérifié le 1ᵉʳ août 2026",
    "verifie": "2026-09-23",
    "fin": "2026-11-24",
    "territoires": [
        ["Paris", "75", ["Paris"], []],
        ["Lille", "59", ["Lille"], []],
        ["Plaine Commune", "93", ["Aubervilliers", "La Courneuve", "Épinay-sur-Seine", "L'Île-Saint-Denis",
                                  "Saint-Denis", "Saint-Ouen-sur-Seine", "Stains", "Villetaneuse"], []],
        ["Est Ensemble", "93", ["Bagnolet", "Bobigny", "Bondy", "Le Pré-Saint-Gervais", "Les Lilas",
                                "Montreuil", "Noisy-le-Sec", "Pantin", "Romainville"], []],
        ["Lyon et Villeurbanne", "69", ["Lyon", "Villeurbanne"], []],
        ["Montpellier", "34", ["Montpellier"], []],
        ["Bordeaux", "33", ["Bordeaux"], []],
        ["Grenoble-Alpes Métropole", "38",
         ["Bresson", "Claix", "Domène", "Eybens", "Fontanil-Cornillon", "Gières", "Meylan", "Murianette",
          "Poisat", "La Tronche", "Seyssins", "Varces-Allières-et-Risset", "Venon"],
         ["Échirolles", "Fontaine", "Grenoble", "Le Pont-de-Claix", "Saint-Égrève", "Saint-Martin-d'Hères",
          "Sassenage", "Seyssinet-Pariset"]],
        ["Pays basque", "64",
         ["Ahetze", "Anglet", "Arbonne", "Arcangues", "Ascain", "Bassussarry", "Bayonne", "Biarritz", "Bidart",
          "Biriatou", "Boucau", "Ciboure", "Guéthary", "Hendaye", "Jatxou", "Lahonce", "Larressore",
          "Mouguerre", "Saint-Jean-de-Luz", "Saint-Pierre-d'Irube", "Urcuit", "Urrugne", "Ustaritz",
          "Villefranque"], []],
    ],
}
# Paris, Lyon et Marseille sont des communes pour les zonages, des
# arrondissements pour DVF et l'ANIL.
ARRONDISSEMENTS = {"75056": "751", "69123": "6938", "13055": "132"}


# Les taux du marché : affichés sous les champs, et confrontés aux valeurs par
# défaut par verifier.py. Ils ne remplacent pas les valeurs par défaut : chacune
# déplace le chiffre de la page d'accueil, et doit rester une décision.
BCE = "https://data-api.ecb.europa.eu/service/data/"
TAUX = {
    "credit": {"serie": "MIR/M.FR.B.A2C.A.R.A.2250.EUR.N", "titre": "Taux des nouveaux crédits à l'habitat, France — BCE"},
    "depot": {"serie": "FM/D.U2.EUR.4F.KR.DFR.LEV", "titre": "Taux de la facilité de dépôt — BCE"},
}
# L'inflation vient d'Eurostat : la série de la BCE s'est arrêtée au changement
# de base de l'IPCH, en décembre 2025.
EUROSTAT = {"url": "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_minr?geo=FR&coicop18=TOTAL&unit=RCH_A&lastTimePeriod=1",
            "page": "https://ec.europa.eu/eurostat/databrowser/view/prc_hicp_minr/default/table",
            "titre": "Inflation sur un an, IPCH France — Eurostat"}
IRL = {"url": "https://bdm.insee.fr/series/sdmx/data/SERIES_BDM/001515333?lastNObservations=5",
       "page": "https://www.insee.fr/fr/statistiques/serie/001515333",
       "titre": "Indice de référence des loyers — INSEE"}


# Les DPE depuis juillet 2021 (ADEME) : combien de logements diagnostiqués sont
# classés F ou G, commune par commune. L'API agrège ; elle limite à 50 requêtes
# par minute sans compte, d'où l'attente entre deux départements.
DPE = {"api": "https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant",
       "page": "https://data.ademe.fr/datasets/dpe03existant",
       "titre": "DPE des logements existants depuis juillet 2021 — ADEME"}
# Sous ce nombre de DPE, la part d'une commune dit peu : on se replie sur le département.
DPE_MIN = 30


# La taxe foncière : les taux votés (commune, syndicats, intercommunalité —
# variables E12, E22 et E32 du REI de la DGFiP) de deux millésimes, et la
# revalorisation légale des bases entre les deux (article 1518 bis du CGI).
# Ensemble, ils disent de combien la taxe d'un même logement a augmenté.
REI = {
    "url": "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/impots-locaux-fichier-de-recensement-des-elements-dimposition-a-la-fiscalite-dir/attachments/rei_%s",
    "fichiers": {"2022": "2022_fichier_notice_trace_zip", "2025": "2025_fichier_notice_tracezip"},
    "page": "https://data.economie.gouv.fr/explore/dataset/impots-locaux-fichier-de-recensement-des-elements-dimposition-a-la-fiscalite-dir/",
    "titre": "Recensement des éléments d'imposition (REI) — DGFiP",
    "revalorisation": {"2023": 7.1, "2024": 3.9, "2025": 1.7},
}
TAUX_TF = ("E12", "E22", "E32")
# Le classeur 2022 titre ses colonnes en toutes lettres ; les CSV suivants, par code.
LIBELLES_REI = {"DEPARTEMENT": "DEP", "COMMUNE": "COM",
                "FB - COMMUNE / TAUX NET": "E12",
                "FB - SYNDICATS ET ORG. ASSIMILES / TAUX NET": "E22",
                "FB - GFP / TAUX APPLICABLE SUR LE TERRITOIRE DE LA COMMUNE": "E32"}


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


def lire_csv(chemin):
    """Les fichiers ministériels : UTF-8 avec BOM, point-virgule."""
    return list(csv.DictReader(io.StringIO(chemin.read_bytes().decode("utf-8-sig")), delimiter=";"))


def etendre(code, codes):
    """Le code d'un zonage, ou ceux de ses arrondissements."""
    prefixe = ARRONDISSEMENTS.get(code)
    return [c for c in codes if c.startswith(prefixe) and c != code] if prefixe else [code]


def zonages(frais, codes):
    """{code: {"z": zone A/B/C, "t": 1 zone tendue, 2 touristique et tendue}}."""
    sortie = defaultdict(dict)
    for l in lire_csv(telecharger(ZONAGE_ABC["url"], "zonage-abc.csv", frais)):
        zone = next(v for k, v in l.items() if k.startswith("Zonage ABC")).strip()
        for c in etendre(l["CODGEO"].strip(), codes):
            sortie[c]["z"] = zone
    for l in lire_csv(telecharger(ZONAGE_TLV["url"], "zonage-tlv.csv", frais)):
        cle = next(k for k in l if k.startswith("Zonage TLV post"))
        rang = l[cle].strip()[:1]
        if rang in ("1", "2"):
            for c in etendre(l["CODGEO25"].strip(), codes):
                sortie[c]["t"] = int(rang)
    return sortie


def encadrement(noms):
    """{code: 1 si toute la commune est encadrée, 2 si une partie}. Un nom
    introuvable arrête l'import : la liste officielle a changé, ou une commune
    a fusionné — à relire, pas à deviner."""
    parNom = defaultdict(list)
    for code, nom in noms.items():
        parNom[(departement(code), nom)].append(code)
    sortie = {}
    for territoire, dep, entieres, parties in ENCADREMENT["territoires"]:
        for rang, liste in ((1, entieres), (2, parties)):
            for nom in liste:
                if nom in ("Paris", "Lyon"):
                    prefixe = {"Paris": "751", "Lyon": "6938"}[nom]
                    trouves = [c for c in noms if c.startswith(prefixe)]
                else:
                    trouves = parNom.get((dep, nom), [])
                if not trouves:
                    raise SystemExit("encadrement : « %s » (%s) introuvable dans la Carte des loyers" % (nom, dep))
                for c in trouves:
                    sortie[c] = rang
    return sortie


def evolution(frais):
    """{département: {"pa": [prix an0, prix an1, an0, an1], "pm": ...}} : le prix
    typique de la première et de la dernière année complète de DVF, par
    département — une commune a trop peu de ventes pour une tendance."""
    chemin = telecharger(DVF["url"], "dvf-mensuel.csv", frais)
    somme = defaultdict(lambda: defaultdict(lambda: [0.0, 0]))
    mois = defaultdict(set)
    with open(chemin, encoding="utf-8") as f:
        for l in csv.DictReader(f):
            if l["echelle_geo"] != "departement":
                continue
            an = l["annee_mois"][:4]
            mois[an].add(l["annee_mois"])
            for cle, type_ in (("pa", "appartement"), ("pm", "maison")):
                n, med = nombre(l["nb_ventes_" + type_]), nombre(l["med_prix_m2_" + type_])
                if n and med:
                    somme[(l["code_geo"], cle)][an][0] += med*n
                    somme[(l["code_geo"], cle)][an][1] += int(n)
    completes = sorted(an for an, m in mois.items() if len(m) == 12)
    a0, a1 = completes[0], completes[-1]
    sortie = defaultdict(dict)
    for (dep, cle), parAn in somme.items():
        if parAn[a0][1] >= 100 and parAn[a1][1] >= 100:
            sortie[dep][cle] = [round(parAn[a0][0]/parAn[a0][1]), round(parAn[a1][0]/parAn[a1][1]), int(a0), int(a1)]
    return sortie, (a0, a1)


def taux():
    """Les derniers taux publiés, toujours frais : quelques octets par série.
    Pour le taux de dépôt, la date à laquelle il a pris sa valeur actuelle."""
    sortie = {}
    for cle, t in TAUX.items():
        n = 400 if cle == "depot" else 1
        with urllib.request.urlopen(BCE + t["serie"] + "?format=csvdata&lastNObservations=%d" % n, timeout=60) as r:
            lignes = list(csv.DictReader(io.StringIO(r.read().decode("utf-8"))))
        valeur, periode = float(lignes[-1]["OBS_VALUE"]), lignes[-1]["TIME_PERIOD"]
        if cle == "depot":
            depuis = periode
            for l in reversed(lignes):
                if float(l["OBS_VALUE"]) != valeur:
                    break
                depuis = l["TIME_PERIOD"]
            periode = depuis
        sortie[cle] = {"valeur": valeur, "periode": periode, "titre": t["titre"],
                       "page": "https://data.ecb.europa.eu/data/datasets/" + t["serie"].replace("/", "/" + t["serie"].split("/")[0] + ".", 1)}
    with urllib.request.urlopen(EUROSTAT["url"], timeout=60) as r:
        d = json.loads(r.read().decode("utf-8"))
    mois = next(iter(d["dimension"]["time"]["category"]["index"]))
    sortie["inflation"] = {"valeur": float(next(iter(d["value"].values()))), "periode": mois,
                           "titre": EUROSTAT["titre"], "page": EUROSTAT["page"]}
    import re
    with urllib.request.urlopen(IRL["url"], timeout=60) as r:
        obs = re.findall(r'TIME_PERIOD="([^"]*)" OBS_VALUE="([^"]*)"', r.read().decode("utf-8"))
    obs = sorted(obs)
    (t0, v0), (t1, v1) = obs[-5], obs[-1]
    sortie["irl"] = {"valeur": round((float(v1)/float(v0) - 1)*100, 2), "periode": t1, "depuis": t0,
                     "titre": IRL["titre"], "page": IRL["page"]}
    return sortie


def passoires(frais, departements):
    """{code: [DPE classés F ou G, DPE]} par commune, et par département.
    Un fichier de cache par département : un import interrompu reprend où il
    s'était arrêté."""
    dossier = CACHE / "dpe"
    dossier.mkdir(parents=True, exist_ok=True)
    def compter(qs):
        url = DPE["api"] + "/values_agg?field=code_insee_ban&agg_size=1000&qs=" + urllib.parse.quote(qs)
        with urllib.request.urlopen(url, timeout=120) as r:
            d = json.loads(r.read().decode("utf-8"))
        time.sleep(1.4)
        return {a["value"]: a["total"] for a in d["aggs"]}, d["total"]
    communes, parDep = {}, {}
    for dep in sorted(departements):
        cache = dossier / ("%s.json" % dep)
        if frais or not cache.exists():
            tous, n = compter("code_departement_ban:%s" % dep)
            fg, n_fg = compter("code_departement_ban:%s AND etiquette_dpe:(F OR G)" % dep)
            cache.write_text(json.dumps({"tous": tous, "fg": fg, "n": n, "n_fg": n_fg}))
        c = json.loads(cache.read_text())
        parDep[dep] = [c["n_fg"], c["n"]]
        for code, n in c["tous"].items():
            if n >= DPE_MIN:
                communes[code] = [c["fg"].get(code, 0), n]
    return communes, parDep


def lignes_rei(chemin):
    """Les lignes d'un REI, qu'il soit livré en CSV (2023 et après) ou en
    classeur Excel (2022) : celui-ci se lit en flux, 140 Mo compressés."""
    z = zipfile.ZipFile(chemin)
    noms = z.namelist()
    csvs = [n for n in noms if n.lower().endswith(".csv")]
    if csvs:
        yield from csv.DictReader(io.TextIOWrapper(z.open(csvs[0]), encoding="utf-8", errors="replace"), delimiter=";")
        return
    classeur = zipfile.ZipFile(z.open([n for n in noms if n.startswith("REI_") and n.endswith(".xlsx")][0]))
    ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    partages = [("".join(t.text or "" for t in si.iter(ns + "t")))
                for _, si in ET.iterparse(classeur.open("xl/sharedStrings.xml")) if si.tag == ns + "si"]
    entete = None
    colonne = lambda ref: ref.rstrip("0123456789")
    for _, ligne in ET.iterparse(classeur.open("xl/worksheets/sheet1.xml")):
        if ligne.tag != ns + "row":
            continue
        valeurs = {}
        for c in ligne.iter(ns + "c"):
            v = c.find(ns + "v")
            if v is None:
                t = c.find(ns + "is")
                texte = "".join(x.text or "" for x in t.iter(ns + "t")) if t is not None else ""
            else:
                texte = partages[int(v.text)] if c.get("t") == "s" else v.text
            valeurs[colonne(c.get("r"))] = texte
        ligne.clear()
        if entete is None:
            entete = {k: LIBELLES_REI.get(v.strip(), v) for k, v in valeurs.items()}
            continue
        yield {entete[k]: v for k, v in valeurs.items() if k in entete}


def taxe_fonciere(frais, codes):
    """{code: [taux an0, taux an1, évolution annuelle en %]} : le taux global
    de taxe foncière bâtie, et la hausse annuelle moyenne de la taxe d'un même
    logement — taux votés et revalorisation des bases."""
    taux = {}
    for an, suffixe in REI["fichiers"].items():
        chemin = telecharger(REI["url"] % suffixe, "rei-%s.zip" % an, frais)
        taux[an] = {}
        for l in lignes_rei(chemin):
            try:
                t = sum(float((l.get(k) or "0").replace(",", ".")) for k in TAUX_TF)
            except ValueError:
                continue
            taux[an][(l.get("DEP") or "").strip() + (l.get("COM") or "").strip()] = t
    a0, a1 = sorted(taux)
    bases = 1.0
    for an, r in REI["revalorisation"].items():
        if a0 < an <= a1:
            bases *= 1 + r/100
    sortie = {}
    for code, t1 in taux[a1].items():
        t0 = taux[a0].get(code)
        if not t0 or not t1:
            continue
        evolution = ((t1/t0)*bases) ** (1/(int(a1) - int(a0))) - 1
        for c in etendre(code, codes):
            sortie[c] = [round(t0, 2), round(t1, 2), round(evolution*100, 2)]
    return sortie, (a0, a1)


def main():
    frais = "--frais" in sys.argv
    print("Loyers d'annonce (ANIL)")
    parCommune, noms = loyers(frais)
    print("Prix de vente (DVF)")
    ventes, (debut, fin) = prix(frais)

    print("Zonages, encadrement, tendance des prix")
    zones = zonages(frais, list(noms))
    print("Taxe foncière (REI de la DGFiP)")
    tf, (tf0, tf1) = taxe_fonciere(frais, list(noms))
    print("Passoires thermiques (ADEME, deux requêtes par département)")
    dpe, dpeDep = passoires(frais, {departement(c) for c in noms})
    encadre = encadrement(noms)
    tendance, (a0, a1) = evolution(frais)

    marche = defaultdict(lambda: {"c": {}, "d": {}})
    index = []
    for code, nom in noms.items():
        dep = departement(code)
        # Le nom voyage avec les chiffres : un lien qui ne porte que le code
        # retrouve ainsi de quoi afficher la commune.
        fiche = {"n": nom}
        fiche.update(parCommune[code])
        fiche.update(ventes.get(code, {}))
        fiche.update(zones.get(code, {}))
        if code in encadre:
            fiche["e"] = encadre[code]
        if code in dpe:
            fiche["dpe"] = dpe[code]
        if code in tf:
            fiche["tf"] = tf[code]
        marche[dep]["c"][code] = fiche
        n = sum(fiche[k][1] for k in ("pa", "pm") if k in fiche)
        index.append([code, nom, n])
    for dep in marche:
        marche[dep]["d"] = dict(ventes.get(dep, {}))
        if tendance.get(dep):
            marche[dep]["d"]["ev"] = tendance[dep]
        if dpeDep.get(dep, [0, 0])[1] >= DPE_MIN:
            marche[dep]["d"]["dpe"] = dpeDep[dep]
    # Les communes les plus actives d'abord : à nom égal, c'est celle qu'on cherche.
    index.sort(key=lambda c: (c[1].lower(), -c[2]))

    sources = {
        "millesime": fin[:4],
        "dvf": {"titre": DVF["titre"], "page": DVF["page"], "periode": [debut, fin],
                "note": "moyenne des prix médians mensuels au m², pondérée par le nombre de ventes"},
        "tendance": {"titre": DVF["titre"], "page": DVF["page"], "periode": [a0, a1],
                     "note": "prix typique au m² du département, première et dernière année complète"},
        "zonage": {"titre": ZONAGE_ABC["titre"], "page": ZONAGE_ABC["page"]},
        "dpe": {"titre": DPE["titre"], "page": DPE["page"], "minimum": DPE_MIN},
        "taxeFonciere": {"titre": REI["titre"], "page": REI["page"], "periode": [tf0, tf1],
                         "revalorisation": REI["revalorisation"],
                         "note": "taux votés (commune, syndicats, intercommunalité) et revalorisation légale des bases"},
        "tension": {"titre": ZONAGE_TLV["titre"], "page": ZONAGE_TLV["page"]},
        "encadrement": {k: ENCADREMENT[k] for k in ("titre", "page", "verifie", "fin")},
        "loyers": {"titre": ANIL["titre"], "page": ANIL["page"], "periode": ANIL["periode"],
                   "references": {k: v[1] for k, v in ANIL["fichiers"].items()},
                   "note": "loyer d'annonce prédit au m², charges comprises, pour un logement de référence"},
    }
    print("Taux du marché (BCE, INSEE)")
    (SORTIE / "taux.json").write_text(json.dumps(taux(), ensure_ascii=False, indent=1), encoding="utf-8")
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
