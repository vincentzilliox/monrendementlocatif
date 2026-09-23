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
  −0,5 pt face à la bourse), mais elle a été rendue sous Linux, en DejaVu Sans,
  faute de police Helvetica ou Inter sur cette machine. La régénérer sur le Mac
  (`python3 outils/og_image.py`) pour retrouver la typographie habituelle.
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

### 2.1 Deux champs de plus : commune et surface

Sans eux, aucune donnée de marché ne peut s'appliquer. La **commune** se saisit
avec une autocomplétion sur le Code officiel géographique de l'INSEE ; la
**surface** en m². Tous deux sont facultatifs : sans eux, la calculatrice se
comporte comme aujourd'hui.

### 2.2 Architecture : importer à la construction, jamais appeler un tiers

`verifier.py` interdit tout appel vers un domaine tiers, et la page d'accueil
promet « ni publicité, ni service tiers ». Les données ne doivent donc **pas**
être interrogées depuis le navigateur. Le principe :

- un script `outils/donnees.py` télécharge les sources ci-dessous (toutes sous
  Licence Ouverte), les réduit à quelques indicateurs par commune, et écrit
  `site/donnees/<département>.json`, servi depuis le même domaine et chargé à
  la demande ;
- chaque indicateur garde sa **source et sa date**, affichées à côté de la
  valeur (« loyer d'annonce médian, ANIL, 3ᵉ trimestre 2025 ») ;
- une reconstruction mensuelle suffit à suivre toutes les sources ;
- **pas de scraping** de Leboncoin, SeLoger ou PAP : leurs conditions
  d'utilisation et le droit des bases de données l'interdisent, et la Carte
  des loyers de l'ANIL est déjà calculée à partir de leurs annonces.

### 2.3 Les sources

| Source | Indicateur retenu | Usage |
|---|---|---|
| [Statistiques DVF](https://www.data.gouv.fr/datasets/statistiques-dvf) (DGFiP / Etalab, semestriel) | Prix médian au m² et nombre de ventes, appartements et maisons, par commune | Situer le prix saisi ; proposer la valeur actuelle en mode « bien détenu » |
| [Carte des loyers 2025](https://www.data.gouv.fr/datasets/carte-des-loyers-indicateurs-de-loyers-dannonce-par-commune-en-2025) (ANIL, annuel) | Loyer d'annonce au m² charges comprises, avec intervalle, selon la taille du logement | Situer le loyer saisi ; le proposer à défaut |
| Arrêtés d'encadrement des loyers (open data de Paris, Lyon, Lille, Bordeaux, Montpellier…) | Loyer de référence majoré par zone, nombre de pièces, époque, nu ou meublé | Alerte « loyer au-dessus du plafond légal » |
| Fichier REI de la DGFiP (`data.economie.gouv.fr`) | Taux de taxe foncière et de CFE votés par commune, avec leur historique | Ordre de grandeur de la taxe foncière ; dérive locale au lieu de l'inflation |
| Taux des droits de mutation par département (DGFiP) | Taux départemental | Frais de notaire exacts au lieu de 8 % partout |
| Zonage A/B/C et communes en zone tendue | Tension locative | Vacance par défaut ; taxe sur les logements vacants |
| INSEE (recensement) et LOVAC (Cerema) | Taux de logements vacants, évolution de la population | Vacance par défaut réaliste |
| [DPE logements existants](https://data.ademe.fr/datasets/dpe03existant) (ADEME, mensuel) | Part de passoires F et G par commune | Contexte du champ DPE (2.4) |
| Banque de France, BCE, INSEE | Taux moyen des crédits à l'habitat, taux d'usure, Livret A, taux de dépôt de la BCE, IRL, inflation | Valeurs par défaut mises à jour à la construction. Plus de « 2,50 % depuis le 16 septembre 2026 » à réécrire à la main : la date vient de la source. |
| Indices Notaires-INSEE | Historique des prix de l'ancien par région | Revalorisation par défaut fondée sur l'historique local, présentée comme telle |

Chaque import s'accompagne de contrôles : fichier présent, date de fraîcheur
inférieure à N mois, valeurs dans des bornes plausibles (un prix médian à
0 €/m² ou à 80 000 €/m² fait échouer la construction).

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

### 2.5 Repères de marché à l'écran

Sous le prix et le loyer, une barre discrète situe la saisie par rapport à la
commune : « 4 000 €/m² — marché : 3 200 à 4 100 €/m², 412 ventes en 2025 ».
Une saisie hors de l'intervalle n'est pas bloquée ; elle est dite. C'est le
passage d'une hypothèse devinée à une hypothèse vérifiée.

### 2.6 Outils de décision, sans nouvelle donnée

- **Calculs inversés** : « prix maximum pour égaler la bourse », « loyer
  minimum », « taux au-delà duquel le verdict change ». Une bissection sur
  `compute()`, dans le moteur, donc aussi sur l'accueil. C'est l'outil de
  négociation qui manque le plus.
- **Seuils de bascule** dans le graphique de sensibilité : la valeur de chaque
  paramètre à laquelle l'avis éditorial change de phrase.
- ✅ **Capacité d'emprunt** — *fait le 2026-09-23.* Revenus nets et crédits en
  cours (facultatifs, repliés dans le financement) donnent le taux
  d'endettement au sens du HCSF, l'emprunt maximal au même taux et une alerte
  au-delà de 35 % (`endettement()` dans le moteur). Les revenus sont
  `PRIVES` : jamais dans un lien, conservés à l'ouverture du lien d'un autre.
  Reste : le reste à vivre, et la méthode différentielle de certaines banques.
- **Frais de dossier et de garantie déductibles** au réel foncier (l'année du
  paiement) et au LMNP réel (étalés sur la durée du prêt). Ils sont aujourd'hui
  payés sans être déduits : effet faible, mais c'est une inexactitude.

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
