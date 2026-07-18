# Classifieur par ascendance de graphe (« S13 ») — Design

Date : 2026-07-18
Statut : validé (banc d'essai comparatif + accord Johan), à planifier
Remplace le mécanisme de matching de la spec 2026-07-17 (le vocabulaire rimessolides).

## 1. Contexte

Le classifieur mergé (vocabulaire rimessolides + matching de mots) a été évalué sur 35
cartes réelles avec vérité terrain : **P 27% / R 88% / F1 41** — précision inutilisable.
Un banc comparatif de 15+ stratégies (voir mémoire `interest-classifier-bench-2026-07`,
scripts dans le scratchpad de session) a établi un gagnant net :

**S13 « ascendance de graphe »** : une carte reçoit une étiquette si l'une de ses
catégories Wikipédia est une **descendante** de la catégorie racine de l'étiquette dans
le graphe des catégories (montée des parents, profondeur bornée).
Résultats : **d≤3 → P 86 / R 72 / F1 78** ; **d≤4 → P 77 / R 80 / F1 78**.
La profondeur est un curseur précision/rappel. Les hybrides (∪ phrases) et les racines
élargies par recherche font MOINS bien (69-74) — la version pure gagne.

## 2. Objectifs

- Remplacer le matching de mots par l'ascendance de graphe. **Supprimer** la voie
  rimessolides (code, permission, handler) — elle est inférieure et morte.
- Conserver un **fast-path titre** (verdict instantané sans réseau) : les parts du nom
  de l'étiquette matchées en bord de mot sur le titre de la carte, en attendant que le
  cache de graphe couvre la carte.
- Deux profondeurs configurables : `interestDepthTag` (défaut 3, précision — auto-tag)
  et `interestDepthMarket` (défaut 4, rappel — repérage, auto-bid, protection vente).
- **Racines éditables** : les racines résolues par étiquette sont visibles dans le
  dashboard ; l'utilisateur peut en retirer/ajouter (corrige les FN du type
  « Techno & électro » → il manque la racine « Musique électronique »). Zéro dur.
- Les 4 comportements (repérage, auto-bid, auto-tag, protection) inchangés côté flags.

## 3. Architecture

Tout en content-script : l'API MediaWiki accepte le CORS anonyme via `origin=*`
(enrich.js le fait déjà) → **aucun besoin du service worker ni de host_permission**.

```
tagsync.listTags() ─▶ ancestry.rootsFor(tag) ──▶ racines (résolues ∪ ajoutées) \ retirées
                                                   cache DB interest_roots (TTL 90j)
enrich.js ─▶ card_meta.categories (topicales: clshow=!hidden, redirects=1)
                     │
interest.walkAncestry(cats, rootsByTag, parentsMap, depth) ─▶ {tagId: profondeur}
                     ▲
ancestry.fillParents(noms, budget) ──▶ cache DB cat_parents (batch 50/appel, TTL 90j)
engine: interestState() (cache 10 min) + backfill budgété par cycle + 4 comportements
dashboard: racines éditables + comptes par étiquette + curseurs de profondeur
```

### 3.1 `src/interest.js` (pur, refondu)
Garde `normalize`, `STOPWORDS`, `matchable`, `nameWords`. Supprime `compileVocab`/
`classify`. Ajoute :
- `META_RE`, `BIO_RE`, `topicalCat(name)` — filtres (catégories meta/maintenance et
  « Naissance à / Décès à » : habiter un lieu ≠ être à propos du lieu).
- `walkAncestry(startCats, rootsByTag, parentsOf, maxDepth, maxFrontier=200)` →
  `{tagId: depth}` ; `rootsByTag = [{tagId, roots:[]}]`, `parentsOf: Map(nom→[parents])`.
  Profondeur 0 = une catégorie de départ EST une racine.
- `missingParents(startCats, parentsOf, maxDepth)` → noms dont les parents manquent au
  cache (pour le backfill budgété).
- `titleTags(card, tags)` → fast-path titre (parts du nom en bord de mot).

### 3.2 Nouveau `src/ancestry.js` → `WMC_ANCESTRY` (I/O : réseau + DB)
- `api(params)` : fetch `fr.wikipedia.org/w/api.php` + `origin=*`, retry léger 429.
- `resolveRoots(name)` : Catégorie:<nom sans parenthèses> si elle existe, sinon par
  part (`&`, `/`) : existence directe puis recherche ns=14 (top hit recouvrant le terme),
  filtres `topicalCat`.
- `rootsFor(tagName, cfg)` : effectives = (résolues ∪ `added`) \ `removed` ; cache DB
  `interest_roots` `{name, resolved, added, removed, fetchedAt}` (TTL `rootsTtlDays`).
- `addRoot(tagName, root)` / `removeRoot(tagName, root)` (édition dashboard).
- `fillParents(names, maxCalls)` : parents topicaux par lots de 50 titres/appel
  (`prop=categories&cllimit=500&clshow=!hidden` + `clcontinue`), écrit `cat_parents`
  `{name, parents, fetchedAt}` ; renvoie le nombre d'appels consommés.
- `parentsMap()` : Map depuis `WMC_DB.allCatParents()`.

### 3.3 `src/db.js` (v6)
Stores : `cat_parents` (keyPath `name`), `interest_roots` (keyPath `name`) ; suppression
du store `interest_vocab` (obsolète). Accesseurs get/put/all correspondants.

### 3.4 `src/engine.js`
- `interestState(cfg)` (remplace `interestVocab`) : cache mémoire 10 min de
  `{tags, rootsByTag, parents}`.
- `onThemeTags(card, meta, state, depth)` : si `meta.categories` → `walkAncestry` ;
  sinon `titleTags` (fast-path).
- Profondeurs : auto-tag → `interestDepthTag` ; protection vente, repérage marché,
  auto-bid → `interestDepthMarket`.
- Nouveau job `ancestryBackfill(cfg)` : union des `missingParents` des cartes possédées
  (et du marché si repérage actif), `fillParents` avec budget
  `ancestryFetchPerCycle` (défaut 4 appels/cycle) ; invalide le cache parents.
- Garde fail-closed protection vente : ajoute `WMC_ANCESTRY` à la liste des modules
  requis.
- `enrich.js` : `clshow=!hidden&redirects=1` sur la requête catégories (les catégories
  cachées sont du bruit de maintenance).

### 3.5 `src/dashboard.js`
Section « Tes thèmes » v2 : par étiquette, **racines résolues** en puces cliquables
(clic = retirer) + champ « ajouter une racine », compte de cartes possédées qui matchent
(walk au depth tag). Contrôles : les 2 profondeurs (num). Suppression des puces de
vocabulaire rimessolides.

### 3.6 Suppressions (nettoyage)
`src/lexicon.js`, `test/lexicon.test.js`, handler `{type:"rimes"}` de `background.js`,
`host_permissions` rimessolides du manifest, entrées manifest, flags `vocabTtlDays`
(remplacé par `rootsTtlDays`).

## 4. Config (défauts)

```
interestDepthTag: 3,       // auto-tag : précision (banc: P86/R72)
interestDepthMarket: 4,    // repérage/bid/protection : rappel (banc: P77/R80)
ancestryFetchPerCycle: 4,  // budget d'appels API parents par cycle (batch de 50)
rootsTtlDays: 90,          // TTL de la résolution des racines
```

## 5. Gestion d'erreurs

- API KO / 429 → retry léger puis abandon silencieux : la carte reste non classée par
  graphe, le fast-path titre continue de fonctionner ; le backfill réessaie au cycle
  suivant. **Jamais de mauvaise étiquette par défaut.**
- Pas de session → `listTags` vide → comportements inertes.
- Fail-closed protection vente si les modules interest sont absents (SW).
- Cycles dans le graphe : ensemble `visited` ; explosion : `maxFrontier` 200/niveau.

## 6. Tests

- Purs (`node --test`) : `walkAncestry` (fixture parents — cas Mathilde : « Duchesse de
  Normandie » →(3)→ « Histoire de France » ; profondeur 0 ; cycle ; maxDepth borne les
  FP type « d5 »), `missingParents`, `titleTags`, `topicalCat` (META/BIO), `nameWords`
  conservés.
- **Régression banc** : script qui rejoue l'éval 35 cartes avec le `walkAncestry` de
  prod + le cache du banc → F1 attendu ≥ 75% à d≤3 (le banc a donné 78%).
- Live dry-run : notif « Étiquetage (dry-run) », racines visibles dans le dashboard.

## 7. Hors-scope

Pondération par profondeur (score continu), multi-langues (frwiki seulement — les cartes
du jeu sont fr), résolution de racines par top-K recherche (testée au banc : moins bonne).
