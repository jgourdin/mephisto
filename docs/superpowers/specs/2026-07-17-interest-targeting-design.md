# Ciblage par thèmes (« Interest targeting ») — Design

Date : 2026-07-17 (révisé — thèmes dynamiques multi-utilisateurs)
Statut : validé (brainstorming), à planifier
Auteur : Johan + Claude

## 1. Contexte & problème

WikiMasters permet d'attacher des **étiquettes** perso aux cartes, stockées dans la base
Supabase de l'utilisateur (tables `tags` et `user_card_tags`). On veut que le companion
**cible automatiquement les cartes qui rentrent dans les étiquettes**, pour deux usages :
**acquérir** (repérer/prioriser au marché et aux paquets) et **ranger** (auto-étiqueter).

**Contrainte forte (multi-utilisateurs)** : le companion sera utilisé par les **amis** de
Johan, qui ont **leurs propres étiquettes**. Donc **rien n'est en dur** : ni les thèmes,
ni leur vocabulaire. Le companion **lit les étiquettes existantes de chaque utilisateur**
et **dérive automatiquement** un vocabulaire de matching par étiquette.

**Source de vocabulaire** : `rimessolides.com/motscles.aspx?m=<mot>` renvoie ~130 mots du
champ lexical d'un mot (ex. `manga` → *shonen, shojo, Toriyama, One Piece, Naruto, otaku,
Glénat…*), dans des `<a href="motscles.aspx?m=…">mot</a>` séparés par virgules, sans
poids. Excellent pour la récall.

Un premier étiquetage manuel classait à partir de la **description d'une ligne** → mauvaise
récall (ex. `Mathilde de Flandre` non taguée *Histoire de France*). La bonne matière est
les **catégories Wikipédia** de la carte (déjà fetchées par `enrich.js`) + son **titre**.

## 2. Objectifs

- **Zéro thème/regex en dur.** Le companion lit les tags de l'utilisateur (`GET /tags`) et
  construit leur vocabulaire dynamiquement.
- **Vocabulaire par étiquette** = mots rimessolides (pour chaque mot significatif du nom du
  tag) **∪** les mots du nom lui-même, **filtrés** (mode Prudent, §5), **mis en cache**, et
  **éditables** (l'utilisateur peut retirer un mot fautif).
- **Classifieur déterministe, sans IA** : une carte matche un tag si ses **catégories
  Wikipédia + son titre** contiennent un mot du vocabulaire (bord de mot, ≥4 lettres).
- Alimente **4 comportements** (tous choisis) : (1) repérage marché (surligne/notifie),
  (2) auto-bid prioritaire on-theme (dans les plafonds), (3) auto-étiquetage collection
  (opt-in + dry-run), (4) protection anti-vente du on-theme.
- **Premier run = re-tag propre** de la collection (corrige les ratés type Mathilde).

## 3. Non-objectifs (YAGNI)

- Pas de création de thèmes par le companion (il ne fait que lire/appliquer les tags
  existants de l'utilisateur).
- Pas de classification IA/LLM.
- Pas de plafond de mise par thème (un seul `interestBidBonus`).
- Pas de refonte de `value.js`.

## 4. Architecture

Content-script sauf le fetch rimessolides (CORS bloqué depuis la page → **service worker**
avec **permission d'hôte**). Aucune donnée vers un tiers hormis l'envoi du **mot du tag** à
rimessolides (comme une requête Wikipédia).

```
tagsync.listTags() ──▶ [{id,name}]  (tags de l'utilisateur)
       │
lexicon.buildVocab(tag) ──(msg)──▶ background: fetch rimessolides (host perm) ──▶ mots
       │  ∪ mots du nom, filtrés (Prudent), moins removals, cache DB (interest_vocab)
       ▼
WMC_INTEREST.classify(card, meta, vocab) ──▶ [tagId,…]
       │   (catégories Wikipédia + titre ; enrich.js fournit meta.categories)
       ▼
engine.js ── 4 comportements (flags config) ──▶ marché / collection / tagsync
dashboard.js ── section « Tes thèmes » : tags + comptes + vocabulaire éditable
```

### 4.1 `src/interest.js` → `WMC_INTEREST` (pur, aucune I/O)

```
normalize(s) -> string                         // minuscule + sans diacritiques
STOPWORDS: Set<string>                          // mini liste noire FR + termes trop génériques
matchable(word) -> boolean                      // longueur >= 4 && pas dans STOPWORDS
nameWords(name) -> string[]                     // mots significatifs d'un nom de tag (sans "(94)", &, ponctuation, stopwords)
classify(card, meta, vocab) -> string[]         // vocab = [{tagId, words:string[]}] ; renvoie les tagId qui matchent
```
Matching : sources = `meta.categories` (si présent) + `wikipedia_title`, normalisées ; un
tag matche si un de ses `words` (déjà filtrés) apparaît en **bord de mot** dans une source.

### 4.2 `src/lexicon.js` → `WMC_LEXICON`

```
parseRimes(html) -> string[]                    // pur : extrait les mots des <a motscles.aspx?m=…>
buildVocab(tag, cfg) -> Promise<string[]>        // cache-first ; sinon fetch (via background) + nom, filtre, cache
allVocab() / removeWord(tagName, word) / resetVocab(tagName)  // édition + cache
```
- Fetch délégué au background (`chrome.runtime.sendMessage({type:"rimes", word})`).
- Cache DB `interest_vocab` : `{ name, words:[], removed:[], fetchedAt }`, TTL long (~90 j).
- `words` finaux = `filter(matchable, rimes(mot1)∪rimes(mot2)∪nameWords) \ removed`.

### 4.3 `src/background.js` (modif)

Handler message `{type:"rimes", word}` → `fetch("https://www.rimessolides.com/motscles.aspx?m="+enc)`
(autorisé par la permission d'hôte), renvoie `{ok, html}`. Le content-script parse via
`parseRimes`. Timeout + échec silencieux.

### 4.4 `src/tagsync.js`

- `parseAuthToken(cookie)` / `jwtSub(token)` (purs, inchangés).
- **`listTags() -> [{id,name,color}]`** (nouveau) — lit les tags de l'utilisateur.
- `listAssignments()`, `assignTags(pairs, dryRun)` (inchangés).
- **`ensureThemeTags` supprimé** (plus de création hardcodée).

### 4.5 `src/db.js` (modif)

Nouveau store `interest_vocab` (keyPath `name`) + `getVocab/putVocab/allVocab`. `VERSION`
4 → 5 (le store `card_meta` gagne aussi `categories`, rétrocompatible).

### 4.6 `src/enrich.js` (modif)

`fetchSignals` conserve `categories: string[]` (nettoyées) ; `enrichSeen(cards, max, opts)`
avec `opts.rarities` (défaut `["UR","L"]`) — élargi à toutes raretés pour le ciblage.

### 4.7 `src/engine.js` (modif)

- `interestVocab(cfg)` : `listTags` → `buildVocab` par tag (cache, débit doux) → `[{tagId,words}]`.
- `onThemeTags(card, meta, vocab)` = `WMC_INTEREST.classify`.
- Comportement 2 : `willingToPay` ajoute `interestBidBonus` si on-theme, **borné par `maxBidWb`** ; tri sniper on-theme d'abord.
- Comportement 4 : `autoSell` skip les cartes on-theme (fast-path titre).
- Comportement 3 : `interestAutoTag` — diff vs `listAssignments`, `assignTags` (dry-run aware).
- Comportement 1 : `interestMarketScan` — notifie les enchères on-theme (dédup via storage).
- `enrichCards` enrichit aussi la collection (toutes raretés) quand une feature interest est active.

### 4.8 `src/dashboard.js` (modif)

Section « Tes thèmes » : pour chaque tag de l'utilisateur, compte de cartes possédées qui
matchent + **le vocabulaire** (puces cliquables ; clic = retirer le mot → `removeWord` +
recache). Contrôles pour les flags.

### 4.9 `manifest.json` (modif)

- `host_permissions += "https://www.rimessolides.com/*"`.
- `content_scripts[0].js` ordre : `config, db, api, analysis, value, interest, enrich, lexicon, tagsync, engine, driver, dashboard`.

## 5. Filtrage (mode « Prudent », choisi)

- Mots **≥ 4 lettres**, comparaison en **bord de mot** (`\b`), sur texte **normalisé** (sans
  accents/casse).
- **Liste noire** FR + termes trop génériques du champ lexical (ex. *tome, volume, série,
  film, roman, album, genre, auteur, titre, style, oeuvre, page, saison, personnage…*).
- Matching **uniquement** sur **catégories Wikipédia + titre** (jamais la description libre).
- **Éditable** : mots retirés par l'utilisateur stockés dans `removed` (persistant), exclus
  du vocabulaire.
- Repli **noms propres/composés** (Val-de-Marne, Nîmes & Gard) : rimessolides mono-mot ne
  couvre pas → on garde les `nameWords` comme vocabulaire (matche « Val-de-Marne »).

## 6. Gestion d'erreurs

- Fetch rimessolides KO / CORS / vide → vocabulaire = `nameWords` seuls (dégradation
  gracieuse, jamais de crash).
- Fetch Wikipédia KO → classify sur le titre seul.
- Token Supabase absent → `listTags`/`assignTags` renvoient vide/false, skip propre.
- Auto-bid : bonus on-theme borné par `maxBidWb` ; `dailySpendCapWb` inchangé.
- Auto-tag idempotent (merge-duplicates), réversible.

## 7. Tests

- `WMC_INTEREST` (pur) : `nameWords`, `matchable`/STOPWORDS, `classify` (Mathilde via
  catégories, rappeur, commune 94 via nom, pièges *tome/électroculture* → ∅), `activeThemes`.
- `WMC_LEXICON.parseRimes` (pur) : extrait les mots d'un HTML rimessolides fixture, ignore
  la nav ; union + filtrage + removals.
- `tagsync.parseAuthToken/jwtSub` (purs).
- `enrich.cleanCategoryTitles` (pur).
- I/O (engine, background fetch, dashboard) : validation **live en dry-run**.

## 8. Déroulé (rollout)

1. `WMC_INTEREST` (matching pur) + tests.
2. `enrich.js` conserve les catégories.
3. `WMC_LEXICON.parseRimes` + cache DB (`interest_vocab`) + tests ; background fetch + perm.
4. `tagsync.listTags`.
5. `engine.js` : vocabulaire + 4 comportements (flags, dry-run).
6. `dashboard.js` : section + vocabulaire éditable.
7. Premier run encadré (dry-run → réel), vérif Mathilde, affinage stoplist.

## 9. Questions ouvertes

- Choix du/des mot(s) rimessolides à interroger pour un nom multi-mots : on interroge chaque
  `nameWord` significatif et on unionne (défaut retenu).
- Valeur par défaut `interestBidBonus` à calibrer en réel.
