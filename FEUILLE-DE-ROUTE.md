# Feuille de route — ce qui ajoute de la valeur pour un investisseur

Établie le 2026-09-23, à la suite d'un audit « produit » du site. Il ne s'agit
plus de la justesse du code (voir `AUDIT.md`) mais de la question que se pose
un investisseur : ce que la calculatrice lui apprend, ce qu'elle lui cache, et
ce qui la rendrait plus utile.

**Le constat.** Le moteur est rigoureux sur ce qu'il modélise : TRI sur fonds
propres, quatre régimes, plus-value, comparaison à mise égale. Son angle mort
principal n'est pas un calcul faux : c'est qu'**il calcule juste sur des
hypothèses qu'il ne vérifie jamais**. Prix, loyer, taxe foncière et DPE sont
saisis à l'aveugle, sans point de comparaison avec le marché. C'est là qu'est
le gain de valeur le plus important (chantier 2).

Les règles du projet s'appliquent à chaque chantier ci-dessous : un chiffre
publié est recalculé par `outils/verifier.py`, et un contrôle ne compte que si on
l'a vu échouer (mutation).

---

## 1. Fait le 2026-09-23 — correctifs rapides

| Correctif | Où | Contrôle ajouté |
|---|---|---|
| **Rendement sans apport.** Un financement à 110 % affichait « — » avec un message faux (« pas de sens mathématique ») ; le TRI se calcule sur l'effort d'épargne (4,4 % sur le scénario de test). `irr()` refuse désormais une chronique qui commence par une rentrée, ce qui supprime aussi un faux 34 % en année 2 quand les loyers couvrent tout sans mise. | `src/moteur.js` (`irr`, `compute`), `src/calculatrice.js` (alertes) | « apport nul : TRI sur l'effort d'épargne », « autofinancé sans mise : TRI non calculable, chaque année » |
| **Comptabilité du LMNP au réel.** Nouveau champ `compta`, 500 €/an par défaut, déductible, visible et compté au seul LMNP réel. Le rendement d'ouverture passe de +5,2 % à **+4,8 %**, et le comparatif des régimes cesse de présenter le LMNP réel comme gratuit à gérer. | `index.html`, `src/moteur.js`, `pages/hypotheses-de-calcul.html` | « comptabilité comptée au LMNP réel », « … neutre hors LMNP réel », `data-defaut="compta"` |
| **Liens partagés antérieurs.** Un lien copié avant l'apparition du champ garde 0 € de comptabilité, donc le scénario d'alors (`LIEN_ORIGINE`, `CHAMPS_TARDIFS`). Tout futur champ qui pèse sur le résultat s'ajoute à `CHAMPS_TARDIFS`. | `src/calculatrice.js` | « lien copié avant un nouveau champ : scénario d'alors » |
| **Seuil LMP.** Alerte au-delà de 23 000 € de recettes meublées, avec l'année de franchissement. | `src/calculatrice.js` | « angles morts signalés : LMP, apport nul, comptabilité » |
| **Tranche d'imposition dans la sensibilité**, un palier de part et d'autre. Elle disparaît quand l'impôt est nul (LMNP réel par défaut). | `src/moteur.js` (`SENS`, `TRANCHES`) | « sensibilité : tranche d'imposition », « tranches du barème = liste du formulaire » |
| **Limites réécrites** en trois groupes (corrigeable, peut changer la réponse, hors cadre), avec sens du biais, ordre de grandeur et contournement. Le DPE, l'encadrement des loyers, le taux d'endettement, la SCI à l'IS et le démembrement y figurent enfin. | `pages/hypotheses-de-calcul.html`, `README.md` | Trois contrôles « limites : … » recalculent les ordres de grandeur publiés sur le **vrai** scénario d'ouverture (`site()` dans le harnais) |
| **DPE et encadrement** rappelés dans l'infobulle du loyer. | `index.html` | — |
| « Effort d'épargne cumulé » n'affiche plus « -0 € ». | `src/calculatrice.js` | — |

Tous ces contrôles ont été validés par mutation (huit réintroductions, huit
échecs attendus). `outils/verifier.py` : **225 contrôles, 0 échec**.

### À reprendre tout de suite

- **Image de partage.** `og-image.png` porte les nouveaux chiffres (+4,8 %,
  −0,5 pt face à la bourse), rendue sous Linux en DejaVu Sans. *Décision du
  2026-09-23 : on la garde pour le moment* ; la régénérer sur le Mac
  (`python3 outils/og_image.py`) rendra la typographie habituelle.
- **Guides.** Leurs exemples chiffrés datent d'avant la comptabilité et
  retiennent 2 % d'inflation, contre 2,5 % aujourd'hui (taux de dépôt de la
  BCE). Ils restent justes pour les hypothèses qu'ils énoncent, mais le lecteur
  qui clique sur la calculatrice n'y retrouve pas leurs chiffres. Le plus
  exposé est `lmnp-reel-ou-micro-bic.html`, qui annonce 4,3 % pour le LMNP au
  réel sans frais de comptabilité. À recalculer, puis à ancrer par des
  contrôles comme ceux des limites.
- **Harnais de test.** `base()` dans `outils/verifier.py` est un scénario figé
  (inflation 2 %, Livret A −0,3 %) qui ne suit plus les valeurs d'ouverture.
  C'est voulu pour les invariants ; mais tout chiffre présenté comme « le
  scénario par défaut » doit passer par `site()`, qui relit `index.html`.
- **Prélèvements sociaux à 18,6 % en meublé.** De nombreuses sources concordent
  désormais (article 12 de la LFSS 2026). La réserve de la page d'hypothèses
  peut être allégée après une vérification sur le BOFiP.

---

## 2. Chantier moyen — confronter les hypothèses au marché

### 2.1 ✅ Commune, surface, type de bien — fait le 2026-09-23

Trois champs facultatifs en tête du bien. La commune se cherche dans la liste
de son initiale (`chercherCommunes()` : chaque mot tapé ouvre un mot du nom,
« st » vaut « saint », « oe » vaut « œ ») et voyage dans le lien par son code
INSEE. Commune et surface sont en mode Essentiel, qui passe à quatorze réglages.

### 2.2 ✅ Architecture — faite le 2026-09-23

`outils/donnees.py`, seul outil qui touche au réseau, écrit `donnees/`
(versionné) : `communes/<initiale>.json` pour la recherche,
`marche/<département>.json` pour les chiffres, `sources.json` pour les titres et
périodes. `build.py` recopie sans rien télécharger ; la page charge une
initiale quand on tape, un département quand une commune est choisie — aucun
appel tiers. Budgets et contrôles : fichiers ≤ 250 Ko et ≤ 150 Ko, toutes les
communes avec leur fiche, bornes de plausibilité, ventes DVF de moins de
18 mois, initiales identiques en Python et en JavaScript sur 4 346 noms
délicats. Le poids du site hors données passe de 600 à 650 Ko (voir 2.7).

Deux pièges rencontrés, à connaître pour les prochains imports : les fichiers de
l'ANIL sont en Windows-1252 (en latin-1, « Œ » devient un caractère de
contrôle) ; DVF et l'ANIL codent Paris, Lyon et Marseille par arrondissement,
jamais par commune.

### 2.3 Les sources — cinq branchées, cinq à venir

| Source | Indicateur retenu | Usage | État |
|---|---|---|---|
| [Statistiques DVF](https://www.data.gouv.fr/datasets/statistiques-dvf) (DGFiP / Etalab, semestriel) | Prix médian au m², appartements et maisons, 24 derniers mois, repli sur le département sous 10 ventes | Situer le prix saisi | ✅ Reste : proposer la valeur actuelle en mode « bien détenu » |
| [Carte des loyers 2025](https://www.data.gouv.fr/datasets/carte-des-loyers-indicateurs-de-loyers-dannonce-par-commune-en-2025) (ANIL, annuel) | Loyer d'annonce au m² charges comprises, fourchette, selon la surface | Situer le loyer saisi | ✅ Reste : un bouton « reprendre le loyer du marché » |
| Encadrement des loyers ([Service-Public.fr](https://www.service-public.gouv.fr/particuliers/vosdroits/F1314)) | 95 communes, entières ou en partie, relevées à la main | Alerte avec lien vers le simulateur officiel | ✅ *Fait le 2026-09-23.* Le plafond dépend de l'adresse : non vérifié. Contrôle qui échoue après le 24 novembre 2026 si la liste n'a pas été revue. Reste : les loyers de référence de Paris (open data, licence ODbL) pour situer le loyer sans l'adresse exacte. |
| Fichier REI de la DGFiP (`data.economie.gouv.fr`) | Taux de taxe foncière et de CFE votés par commune, avec leur historique | Dérive locale de la taxe foncière au lieu de l'inflation | À faire. Le montant lui-même dépend de la valeur locative, inconnue : le taux seul ne le donne pas. |
| Taux des droits de mutation par département (DGFiP) | Taux départemental | Frais de notaire au lieu de 8 % partout | À faire. Gain faible (7,5 % ou 8 %). |
| [Zonage A/B/C](https://www.data.gouv.fr/datasets/liste-des-communes-selon-le-zonage-abc) et [zones tendues](https://www.data.gouv.fr/datasets/liste-des-communes-selon-le-zonage-tlv-1) (décret du 22 décembre 2025) | Tension du marché, zone tendue d'agglomération ou touristique | Résumé « face au marché », alerte sur le loyer de relocation | ✅ *Fait le 2026-09-23.* Un décret du 25 août 2026 pourrait avoir revu la liste : le fichier national n'est pas encore à jour. |
| INSEE (recensement) et LOVAC (Cerema) | Taux de logements vacants, évolution de la population | Vacance par défaut réaliste | À faire |
| [DPE logements existants](https://data.ademe.fr/datasets/dpe03existant) (ADEME, mensuel) | Part de passoires F et G par commune | Contexte du champ DPE (2.4) | À faire |
| Banque de France, BCE, INSEE | Taux moyen des crédits à l'habitat, taux d'usure, Livret A, taux de dépôt de la BCE, IRL, inflation | Valeurs par défaut mises à jour à l'import | À faire. Attention : chaque changement de valeur par défaut déplace le chiffre de l'accueil et impose de régénérer l'image de partage. |
| Tendance des prix (DVF, par département) | Évolution annuelle moyenne entre la première et la dernière année complète | Mise en regard de la revalorisation retenue | ✅ *Fait le 2026-09-23*, à partir de DVF plutôt que des indices Notaires-INSEE, qui ne descendent pas au département. |

### 2.4 ✅ Champ « Classe DPE » — fait le 2026-09-23

**Fait** : champ facultatif A à G. F ou G gèlent le loyer dans le moteur (`gelLoyer`) ;
l'interdiction de louer est datée dans la simulation par une alerte
(`INTERDICTION_DPE`), pas simulée — le calcul suppose les travaux faits.
Contrôles : « DPE F ou G : loyers gelés, autres classes indexées » et la sonde
des angles morts. **Reste** : la part de passoires par commune (2.3), et un
scénario « sans travaux » où le loyer s'arrête à la date d'interdiction.

Le projet initial :


Un champ A à G, facultatif :

- **F ou G** : l'indexation des loyers passe à 0, conformément au gel des loyers.
- **G, F ou E** : une alerte signale si l'interdiction de louer (G depuis 2025,
  F en 2028, E en 2034) tombe avant l'horizon, et renvoie vers le plafond de
  déficit à 21 400 € pour la rénovation énergétique.
- **Précaution** : la réforme du DPE du 1ᵉʳ janvier 2026 a reclassé de nombreux
  logements chauffés à l'électricité ; une classe antérieure à 2026 est à
  recalculer avant de s'y fier.

Critère de fin : une mutation qui rend l'indexation à un logement G fait échouer
un contrôle.

### 2.5 ✅ Repères de marché à l'écran — faits le 2026-09-23

Sous le prix : le prix au m² saisi, celui des ventes de la commune, l'écart en
pourcentage. Sous le loyer : le loyer hors charges au m², celui des annonces
charges comprises pour le logement de référence, la fourchette, et un
avertissement au-dessus ou en dessous. Une saisie hors norme n'est pas
bloquée : elle est dite. Contrôles à réponse connue sur `reperesMarche()`, et
une sonde asynchrone qui tape « lyon 3 », choisit, attend le fichier et lit les
deux lignes. Un résumé « Face au marché » dans les résultats, sous les indicateurs, les
rend visibles sans ouvrir le panneau — y compris sur téléphone.

Le projet initial :



Sous le prix et le loyer, une barre discrète situe la saisie par rapport à la
commune : « 4 000 €/m² — marché : 3 200 à 4 100 €/m², 412 ventes en 2025 ».
Une saisie hors de l'intervalle n'est pas bloquée ; elle est dite. C'est le
passage d'une hypothèse devinée à une hypothèse vérifiée.

### 2.6 Outils de décision, sans nouvelle donnée

- ✅ **Calculs inversés** — *fait le 2026-09-23.* Prix maximal, loyer minimal,
  taux maximal et revalorisation minimale pour faire jeu égal avec la bourse,
  sous le graphique des placements (`seuils()`, dichotomie arrêtée à une
  précision par paramètre ; option `horizonSeul` du moteur pour ne résoudre que
  le TRI final — 44 ms les quatre, la sensibilité en profite). Reste : les
  proposer sur la page d'accueil, et un seuil « taux de vacance maximal ».
- **Seuils de bascule** dans le graphique de sensibilité — *en partie fait* :
  les seuils face à la bourse sont exactement la frontière entre « excellente
  affaire » et « belle réserve de valeur ». Reste la seconde frontière, celle
  de l'inflation (rendement réel nul).
- ✅ **Capacité d'emprunt** — *fait le 2026-09-23.* Revenus nets et crédits en
  cours (facultatifs, repliés dans le financement) donnent le taux
  d'endettement au sens du HCSF, l'emprunt maximal au même taux et une alerte
  au-delà de 35 % (`endettement()` dans le moteur). Les revenus sont
  `PRIVES` : jamais dans un lien, conservés à l'ouverture du lien d'un autre.
  Reste : le reste à vivre, et la méthode différentielle de certaines banques.
- ✅ **Frais de dossier et de garantie déductibles** — *fait le 2026-09-23*,
  l'année de leur paiement, au réel foncier (déficit reportable seulement)
  comme au LMNP réel. Le rendement d'ouverture ne bouge pas : l'impôt y est
  déjà nul.

### 2.7 ✅ Budget de poids — validé le 2026-09-23

Le contrôle « poids total sous 600 Ko » est devenu « poids du site, hors
données de marché, sous 650 Ko », et le mode Essentiel passe à quatorze
réglages (commune et surface) : deux décisions validées le 2026-09-23. Les
données ont leurs propres budgets, par fichier chargé.

---

## 3. Chantier long

- **Pages par ville.** Des pages « Rendement locatif à Lyon » générées à partir
  des données du chantier 2 : prix DVF, loyer ANIL, encadrement, taxe foncière,
  rendement brut estimé, et un lien vers la calculatrice préremplie. C'est le
  principal levier de visibilité : le sitemap ne compte que 11 URL. Se limiter
  aux 200 à 300 communes qui ont assez de ventes pour publier un chiffre
  honnête, pour éviter des pages trop maigres.
- **Comparer plusieurs biens côte à côte**, en réutilisant le lien complet
  comme format d'échange. Deux ou trois scénarios, mêmes graphiques
  superposés.
- **Bande d'incertitude** sur le graphique de rendement : trois scénarios
  (pessimiste, central, optimiste) tirés des paramètres les plus sensibles, ou
  quelques centaines de tirages dans un worker.
- **Dossier pour la banque.** Il n'existe aujourd'hui **aucune** feuille de
  style d'impression (`@media print`). Une page imprimable : plan de
  financement, trésorerie année par année, taux d'endettement.
- **Tranche d'imposition par période** : « à partir de l'année N, tranche X »,
  pour la retraite.
- **Travaux datés** : un poste « en année N » (ravalement, toiture), déductible
  l'année de son paiement au réel foncier et amorti à partir de cette année-là
  au LMNP réel.
- **Changement de régime en cours de route** : passage du nu au meublé pour un
  bien détenu, avec une base amortissable égale à la valeur vénale à la date du
  passage ; bascule du micro vers le réel.
- **Euros d'aujourd'hui** : une bascule euros courants / euros constants sur
  les graphiques de gain. La donnée existe déjà (`gainConstant` est calculé par
  le moteur), mais elle n'est affichée nulle part.
- **Guides manquants** : DPE et gel des loyers, encadrement, financement à
  110 %, statut LMP, SCI à l'IS face au LMNP.

---

## 4. Petites dettes repérées en chemin

- Quand le rendement n'est calculable à aucune année (loyers qui couvrent tout,
  sans mise), le graphique « Rendement selon l'année de revente » reste un
  cadre vide. Il faudrait une phrase à la place.
- Au bout du barème (tranche 0 % ou 45 %), la ligne « Tranche d'imposition » de
  la sensibilité n'a qu'un côté ; l'infobulle affiche quand même les deux, le
  second identique au rendement actuel.
- **Mesure d'audience** : il n'y en a aucune, par choix. Les statistiques
  côté serveur de Cloudflare ne demandent ni script ni appel tiers ; elles
  diraient au moins quelles pages et quels guides sont lus, sans renier la
  promesse « ni service tiers ».
