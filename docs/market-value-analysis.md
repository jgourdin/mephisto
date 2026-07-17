# 💹 WikiMasters — Qu'est-ce qui fait la valeur d'une carte ?

_Étude menée le 2026-07-17 via Méphisto. Échantillon : ~150 enchères **réelles** (avec offre, hors botnet `Wf`), prix = offre courante (`current_bid`). Données par carte : `rarity`, `atk`, `def`, `q_score`, `pageviews` (vues Wikipédia), `category`._

## 🎯 TL;DR

Le prix d'une carte se décide dans cet ordre :

1. **Rareté** (facteur dominant, catégoriel) : **L ≫ UR ≫ SR/R/PC/C**.
2. **Popularité** = `pageviews` Wikipédia → **le driver continu n°1** (corrélation **0,58**).
3. **Qualité** = `q_score` (corrélation **0,42**).
4. **Stats de combat** (atk/def) → comptent **au sein des UR/L** (corr ~0,4-0,5), pour l'usage en Bataille.

**Une carte est chère si elle est RARE ET CÉLÈBRE** (beaucoup de vues Wikipédia), idéalement avec de bonnes stats. Rareté sans popularité = tiède ; popularité sans rareté = plafonnée.

---

## 1. La rareté — le palier de base

Prix médian par rareté (marché réel, botnet exclu) :

| Rareté | Prix médian | Fourchette | n |
|---|---|---|---|
| **L** (Légendaire) | **~1 000** | 46 – 1 210+ | 5 |
| **UR** | **~302** | 10 – 2 500 | 22-34 |
| SR | 13 | 1 – 666 | 29 |
| R | 13 | 1 – 221 | 13 |
| C | 13 | 1 – 50 | 4 |
| PC | 10 | 2 – 15 | 10 |

**Sauts énormes** : SR → UR ≈ **×23**, UR → L ≈ **×3**. En dessous de UR (SR/R/PC/C), tout est un **plancher-commodité à ~10-13 WB**, quelles que soient les autres stats. La rareté fixe donc le « palier » ; le reste ne fait que positionner la carte **à l'intérieur** de son palier.

---

## 2. La popularité (`pageviews`) — le vrai moteur du prix

**Corrélation prix ↔ pageviews : 0,58** — le plus fort de tous les critères continus. Les cartes chères sont des **sujets connus du grand public** :

- Position sexuelle (L) — **44 114** vues → 2 861 WB (malgré un q_score de seulement 35 !)
- Conor McGregor (L) — 44 050 vues → 2 199
- Ariana Grande (L) — 28 519 vues → 3 301
- Bayern Munich (L) — 31 150 vues → 1 465

À l'inverse, les sujets obscurs (peu de vues) restent baratés même en bonne rareté. **La célébrité du sujet prime souvent sur sa « qualité ».**

---

## 3. La qualité (`q_score`) — corrélation 0,42

Le `q_score` (complétude/qualité de l'article) corrèle positivement avec le prix, mais **moins fort que les pageviews**. Une carte peut être chère avec un q_score faible si elle est très populaire (Position sexuelle, q 35 → 2 861). Le q_score aide, la popularité décide.

---

## 4. Les stats de combat (atk/def) — pour la Bataille

Corrélation prix ↔ (atk+def) **par rareté** :

| Rareté | corr atk | corr def | corr atk+def |
|---|---|---|---|
| **UR** | 0,41 | **0,48** | 0,49 |
| SR | -0,11 | -0,02 | -0,04 |
| R | -0,05 | -0,07 | -0,07 |
| PC | -0,28 | -0,25 | -0,27 |

→ Les stats comptent **uniquement dans les UR (et L)** : une UR puissante se paie plus cher (utile en Bataille). En dessous de UR, les stats **ne jouent pas** — ces cartes sont des commodités. `def` pèse un peu plus que `atk`.

---

## 5. Tendances par thème

Prix médian + vues médianes par grand thème (regroupement par mots-clés) :

| Thème | Prix médian | Vues médianes | Carte phare | n |
|---|---|---|---|---|
| **Histoire** | **500** | 3 999 | Toutânkhamon | 5 |
| **Sport** | **200** | 7 999 | Conor McGregor | 16 |
| Célébrité/Personne | 50 | 10 782 | Ariana Grande | 19 |
| Culture/Média | 30 | 1 278 | The Last of Us | 17 |
| Géographie | 22 | 1 688 | Libye | 11 |
| Autre | 17 | 1 174 | Position sexuelle | 60 |
| **Science/Nature** | **13** | **7** | Naphtalène | 14 |

**Lecture clé : le thème n'est pas un critère en soi — il agit *via* la popularité.** Les thèmes chers (Sport, Histoire, célébrités) sont ceux à **fortes vues** ; le thème le moins cher (Science/Nature) a une médiane de **7 vues** seulement → sujets obscurs → cartes baratées. Donc « miser sur le sport/les célébrités » revient en fait à **miser sur les sujets à fortes pageviews**.

_(Note : petits échantillons par thème (5-19), tendances directionnelles.)_

---

## 6. Les cartes premium (exemples réels)

| Carte | Rareté | Prix | Vues | q_score |
|---|---|---|---|---|
| Concorde (avion) | UR | **4 000** | 17 942 | 84,7 |
| Ariana Grande | L | 3 301 | 28 519 | 84,9 |
| Position sexuelle | L | 2 861 | 44 114 | 35 |
| Conor McGregor | L | 2 199 | 44 050 | 86,3 |
| Astate (élément) | UR | 2 000 | 8 071 | 79,7 |
| Toutânkhamon | UR | 1 320 | 10 542 | 84 |
| Gisèle Halimi | L | 1 100 | 22 482 | 87,4 |

Profil-type de la carte chère : **rareté élevée (L/UR) + sujet célèbre (fortes vues) + souvent bon q_score et/ou bonnes stats.**

---

## 7. Formule de valeur (heuristique)

```
valeur ≈  PALIER(rareté)          // L ≫ UR ≫ reste (~10-13 plancher)
          × popularité(pageviews)  // driver n°1 dans le palier
          + bonus qualité(q_score)
          + bonus stats(atk+def)   // seulement UR/L, utilité Bataille
```

La **licorne** (carte la plus chère possible) = **L ou UR + fortes pageviews + haut q_score + hautes stats** (ex. Concorde, Ariana Grande, Conor McGregor).

---

## 8. Implications pour Méphisto

**Achat (sniper) :**
- Les vraies pépites = **UR/L à fortes pageviews listées pas cher** (bradées en heure creuse). Prioriser le **pageviews élevé** comme signal de sous-cotation.
- Ignorer SR/R/PC/C pour le flip (plancher ~10-13) — sauf gratuites (paquets).

**Vente :**
- Pricer les UR/L selon leur **valeur réelle** (rareté + pageviews + stats), ne jamais les brader.
- Les cartes « célèbres » (fortes vues) sont celles qui montent le plus → à lister au **pic** pour capter les acheteurs.

**Modèle de valeur (feature #2) :** doit combiner **rareté (palier) + pageviews (poids fort) + q_score + atk/def**. `pageviews` est le meilleur prédicteur unique — à mettre au cœur du scoring.

---

## Méthodologie & limites

- Échantillon : ~150 enchères réelles (avec offre), botnet `Wf` exclu (prix fixes 100/150 sur Communes = artificiels).
- Prix = **offre courante** (`current_bid`), pas prix final → l'**ordre relatif** est fiable, les valeurs absolues sont indicatives (souvent sous-estimées, l'enchère n'étant pas close).
- Corrélations = Pearson sur l'échantillon réel ; petits n par thème/rareté → directionnel.
- Piste d'affinage : accumuler les **prix de clôture réels** (via le watcher + arêtes de trade) pour un modèle chiffré par carte.
