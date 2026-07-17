# Ciblage par thèmes (« Interest targeting ») — Design

Date : 2026-07-17
Statut : validé (brainstorming), à planifier
Auteur : Johan + Claude

## 1. Contexte & problème

WikiMasters permet d'attacher des **étiquettes** (tags) perso aux cartes, stockées dans
la base Supabase de l'utilisateur (tables `tags` et `user_card_tags` — voir
`docs/recon.md` à compléter). Johan a défini 11 étiquettes reflétant ses goûts :

`Manga & anime`, `Jeu vidéo`, `Histoire de France`, `Gauche & luttes`, `Philosophie`,
`Techno & électro`, `Rap & hip-hop`, `Chanson française`, `Val-de-Marne (94)`, `Paris`,
`Nîmes & Gard`.

On veut que le companion **cible automatiquement les cartes qui rentrent dans ces
étiquettes**, pour deux usages : **acquérir** (repérer/prioriser au marché et aux
paquets) et **ranger** (auto-étiqueter la collection).

Un premier étiquetage manuel a classé les cartes à partir de leur **description d'une
ligne** uniquement → **mauvaise récall** : ex. `Mathilde de Flandre` (« épouse de
Guillaume le Conquérant, duchesse de Normandie, reine consort d'Angleterre ») n'a pas
été taguée *Histoire de France* car la ligne ne contient pas « France ». La bonne source
est la liste des **catégories Wikipédia** de la carte — que `enrich.js` récupère déjà
mais jette (il n'en garde qu'un booléen `geekCat`).

## 2. Objectifs

- Un classifieur **déterministe, sans IA, local** : `carte → { clés d'étiquette }`.
- Source de vérité : les **catégories Wikipédia** ; **fast-path texte** pour un verdict
  instantané hors-ligne en attendant l'enrichissement.
- Alimente **4 comportements** (tous sélectionnés par Johan) :
  1. **Marché — repérage passif** : surligner + notifier les enchères on-theme.
  2. **Marché — auto-bid** : les cartes on-theme deviennent prioritaires (dans les
     plafonds existants).
  3. **Collection — auto-étiquetage** : appliquer la/les étiquette(s) aux cartes
     possédées (opt-in + dry-run).
  4. **Vente — protection** : ne jamais auto-vendre / défausser une carte on-theme.
- **Premier run = re-tag propre de toute la collection** (corrige Mathilde & co.).

## 3. Non-objectifs (YAGNI)

- Pas d'éditeur de règles dans l'UI (règles en dur dans le code).
- Pas de plafond de mise par thème (un seul bouton `interestBidBonus`).
- Pas de refonte de `value.js` (le classifieur reste un concern séparé ; synergie
  éventuelle plus tard).
- Pas de classification IA/LLM (contraire à l'éthos déterministe du projet).

## 4. Architecture

Tout tourne en **content-script** (session = cookies de l'utilisateur), aucune donnée ne
sort vers un tiers. Flux :

```
enrich.js  ── fetch catégories Wikipédia (rate-limité, cache ~mensuel) ──▶ card_meta
                                                                              │
WMC_INTEREST.classify(card, meta) ◀───────────────────────────────────────────┘
   │  (catégories = vérité ; fallback texte si non enrichi)
   ▼
engine.js ── applique les 4 comportements selon les flags ──▶ marché / collection
   │
   └── tagsync.js (auto-tag) ──▶ Supabase user_card_tags
dashboard.js ── section « Tes thèmes » (compteurs + deals on-theme)
```

### 4.1 Nouveau module `src/interest.js` → `WMC_INTEREST`

Responsabilité unique : décider les thèmes d'une carte. Aucune I/O.

```
THEMES = [ { key, name, color, catRe, textRe }, ... ]   // 11 entrées
classify(card, meta) -> string[]        // clés de thème, [] si aucun
themesFor(card, meta) -> [{key,name,color}]
isOnTheme(card, meta) -> boolean
```

- `catRe` : RegExp testée sur **chaque titre de catégorie Wikipédia** de `meta.categories`.
- `textRe` : RegExp testée sur `card.category + " " + card.wikipedia_title` (fast-path
  quand `meta.categories` est absent).
- Règle de fusion : si `meta.categories` présent → verdict par `catRe` (autoritaire) ;
  sinon → verdict par `textRe` (provisoire, marqué « non confirmé »).
- Dépendances : aucune (module pur, testable isolément).

### 4.2 Modif `src/enrich.js`

- **Conserver la liste des catégories** : `card_meta.categories = string[]` (titres de
  catégories, nettoyés du préfixe « Catégorie: »). `geekCat` reste dérivé pour
  compat `value.js`.
- **Élargir la portée** : aujourd'hui `enrichSeen` ne traite que UR/L. Les comportements
  ont besoin des catégories pour (a) toutes les cartes possédées (auto-tag + protection),
  (b) les cartes du marché ciblées (`targetRarities`). On garde le débit doux
  (`enrichPerCycle`, cache mensuel) mais on élargit l'ensemble candidat. Ajout d'un
  paramètre de portée (ex. `enrichScope: "highRarity" | "owned" | "market"`).

### 4.3 Nouveau module `src/tagsync.js` → `WMC_TAGSYNC`

Client Supabase pour les étiquettes (mécanisme prouvé : token lu dans le cookie
`sb-<ref>-auth-token`, préfixe `base64-`, éventuellement chunké ; clé anon publique ;
`Authorization: Bearer <access_token>`).

```
getToken() -> string|null           // interne, jamais exposé/loggé
ensureThemeTags() -> {key:tagId}     // crée les 11 tags manquants (nom+couleur)
listAssignments() -> Set("uid|tagId")
assignTags(pairs) -> {ok, count}     // bulk POST, Prefer: merge-duplicates
```

- Idempotent (merge-duplicates), réversible (supprimer une étiquette retire tout).
- Respecte `dryRun` : logge les POST au lieu de les émettre.
- Échec token → retourne null, l'appelant skip proprement.

### 4.4 Modif `src/engine.js`

Dans la boucle existante :
- **Marché** : pour chaque enchère de `targetRarities`, `classify`. Si on-theme →
  highlight + `wmcNotify` (⃝1, sous `interestWatch`) ; et si `interestAutoBid`, la carte
  entre dans la file d'auto-bid avec priorité + bonus de plafond `interestBidBonus`
  **borné par `maxBidWb`/`dailySpendCapWb`** (⃝2).
- **Collection** : passe sur les cartes possédées ; pour chaque thème manquant vs
  `listAssignments`, `assignTags` (⃝3, sous `interestAutoTag` + `dryRun`).
- **Auto-sell** : filtrer les cartes `isOnTheme` (⃝4, sous `interestProtectSell`),
  exactement comme `sellSkipStarred`.

### 4.5 Modif `src/dashboard.js`

Nouvelle section « Tes thèmes » : compteur de cartes par étiquette (depuis la collection
enrichie) + liste des enchères on-theme actuellement au marché sous plafond.

### 4.6 Modif `src/config.js`

Nouveaux flags (défauts sûrs) :

```
interestWatch:       false,   // surlignage + notif marché
interestAutoBid:     false,   // on-theme prioritaire pour l'auto-bid (dans les caps)
interestAutoTag:     false,   // auto-étiquette les cartes possédées (respecte dryRun)
interestProtectSell: true,    // jamais auto-vendre/défausser une carte on-theme (sûr)
interestThemes:      ["manga","jeu_video","histoire_fr","gauche","philo",
                      "techno","rap","chanson_fr","val94","paris","nimes_gard"],
//                    thèmes actifs (désactivable, ex. la géo pour l'acquisition)
interestBidBonus:    20,       // WB ajoutés au plafond d'une carte on-theme, borné par maxBidWb
```

## 5. Règles de classification (patterns initiaux)

Testées sur les **catégories** (fiable) ; `textRe` analogue pour le fast-path. Ajustées
itérativement contre la collection dumpée (jeu de test avec vérité terrain connue).

| clé | catRe (extrait) |
|-----|-----------------|
| `manga` | `manga\|anime\|mangaka\|série d'animation japonaise\|light novel` |
| `jeu_video` | `jeu vidéo\|personnage de jeu vidéo\|entreprise de jeux vidéo\|sport électronique` |
| `histoire_fr` | `roi de France\|monarque franc\|dynastie (mérov\|carol\|capét)\|noblesse française\|duché de Normandie\|maison de Flandre\|maréchal d'Empire\|Premier Empire\|Révolution française\|Gaulois\|guerres de Vendée\|Résistance\|régime de Vichy` |
| `gauche` | `communis\|sociali\|syndicali\|anarchis\|féminis\|écologis\|extrême gauche\|révolutionnaire\|anticolonial` |
| `philo` | `philosoph\|métaphysique\|épistémologie\|ontologie\|concept philosophique` |
| `techno` | `musique électronique\|techno\|\bhouse\b\|disc jockey\|producteur de musique électronique` |
| `rap` | `rappeu\|hip-hop\|beatmaker\|drill\|trap` |
| `chanson_fr` | `chanson française\|auteur-compositeur.*français\|chanteu(r\|se) français\|variété française` |
| `val94` | `commune du Val-de-Marne\|Val-de-Marne` |
| `paris` | `arrondissement de Paris\|monument de Paris\|station de métro de Paris\|Paris Saint-Germain` (PAS « Naissance à Paris ») |
| `nimes_gard` | `Nîmes\|commune du Gard\|Camargue\|Cévennes\|Alès\|Uzès` |

Faux positifs neutralisés par construction (on teste des **catégories entières**, pas des
sous-chaînes) : « électroculture » ∌ `techno`, « municipales » ∌ Alès.

## 6. Gestion d'erreurs

- Fetch Wikipédia KO → fallback `textRe` ; si texte insuffisant, carte **non classée**
  (jamais mal taguée).
- Token Supabase absent/expiré → skip propre, retry au cycle suivant (pas de crash).
- Auto-bid : le bonus on-theme ne peut **jamais** dépasser `maxBidWb` ni
  `dailySpendCapWb`.
- Auto-tag : POST bulk idempotent ; en cas d'erreur réseau, le cycle suivant réessaie
  (diff vs `listAssignments`).

## 7. Tests

- **Unitaires `classify`** sur fixtures `{card, meta.categories}` :
  - Mathilde de Flandre → `histoire_fr` (via « Duchesse de Normandie »).
  - un rappeur, un producteur techno, une commune du 94, un philosophe → thème attendu.
  - pièges : « électroculture » → `[]`, « élections municipales » → `[]`.
- **Régression récall/précision** sur la collection (refetch des catégories) : objectif
  = zéro raté du type Mathilde ; on liste les désaccords pour affiner les patterns.
- **Live en `dryRun`** : inspecter les « would-tag / would-bid » loggés avant d'activer.

## 8. Déroulé (rollout)

1. `WMC_INTEREST` + tests unitaires (aucune I/O, aucun risque).
2. `enrich.js` conserve `categories` + portée élargie.
3. `tagsync.js` + `ensureThemeTags` (dry-run d'abord).
4. Premier run : re-tag complet de la collection (corrige les ratés).
5. Branchement `engine.js` des 4 comportements derrière leurs flags.
6. Section dashboard.

## 9. Questions ouvertes

- Périmètre exact des thèmes « acquisition » vs « organisation » (géo utile à collectionner ?)
  — laissé configurable via `interestThemes`, défaut = tous.
- Valeur par défaut de `interestBidBonus` à calibrer sur données réelles.
