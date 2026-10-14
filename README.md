# Gestion documentation

Site de documentation Accen :

- **Documentation publique** : visible par tout le monde, gérée depuis `/admin`.
- **Documents clients** : le client saisit son code (`USER_TOKEN`) et voit ses fichiers.
  Table FileMaker **WEB_DOCUMENTATION** : un enregistrement = un fichier, même `USER_TOKEN` = même client.
- **Administration** (`/admin`, token `config.docAdminToken`) : clients et codes, dépôt de fichiers
  (le serveur crée l'enregistrement FileMaker), désactivation, expiration, nouveau code.

## Architecture

| Partie | Dossier | Rôle |
|---|---|---|
| Front | `app/` (Nuxt 4, généré en statique) | interface client + admin |
| Serveur | `nodejs-server/web-documentation/` (Express) | API `/api/v1`, fichiers, FileMaker |

- `core/datas/data.js` : toutes les routes (`doc_*`), échanges chiffrés `{ data: encrypt(...) }`.
- `core/FileMaker.js` : client Data API (méthode `deleteRecord` ajoutée).
- Tout est dans FileMaker : `WEB_DOCUMENTATION` (documents clients et publics, `isPublic = 1`) et `WEB_DOCUMENTATION_CLIENT` (fiches clients). Un ancien `documentation-data/db.json` est importé automatiquement au démarrage puis renommé `db.json.importe-<date>`.
- Fichiers dans **Dropbox** : `/DOCUMENTATION/<code client>/` et `/DOCUMENTATION/public/`
  (identifiants `dropBoxRefreshToken` / `dropboxAuthentification` du `config.js`, dossier modifiable via `docDropboxRoot`).

## Configuration

`nodejs-server/web-documentation/config.js` (non versionné) :

```js
docAdminToken: '…',          // token à saisir sur /admin
docFmDatabase: 'Hotline',    // fichier FileMaker contenant WEB_DOCUMENTATION
docMaxUploadMb: 50,
// docDataPath: '/home/web-documentation/documentation-data',
fmpwd: 'Basic …',            // compte FileMaker avec privilège fmrest
cryptageKey: '…',            // clé de chiffrement des échanges
```

`.env` du front (non versionné) :

```
NUXT_PUBLIC_CRYPTAGE_KEY=   # même valeur que cryptageKey
# NUXT_PUBLIC_API_BASE=http://localhost:8096/api/v1   (défaut : https://documentation.accen.me/api/v1)
```

## Développement

```bash
npm install && npm run dev   # le front appelle directement https://documentation.accen.me/api/v1
```

Pour travailler sur un Express local : `NUXT_PUBLIC_API_BASE=http://localhost:8096/api/v1` dans `.env`,
puis `cd nodejs-server/web-documentation && npm install && node server.js`.

## Mise en production

```bash
npm run generate                       # front statique dans .output/public (Node 20+ sur le poste)
rsync -a --delete .output/public/ root@websites02:/home/web-documentation/app/
# sur le serveur : copier core/datas/data.js, core/FileMaker.js, server.js, compléter config.js
# puis relancer node server.js (port 8096)
```

Le serveur n'exécute que l'Express (compatible Node 16) ; Nuxt n'y tourne pas.

## FileMaker

Modèle **WEB_DOCUMENTATION** avec les rubriques `USER_TOKEN`, `file_path`, `nom`, `description`, `isDelete`
(+ `Clé primaire` et un horodatage de création dont le nom commence par « Horodatage »).

Aucune suppression dans FileMaker : « Supprimer » dans l'admin passe `isDelete` à 1 et supprime le fichier dans Dropbox.
Les enregistrements avec `isDelete` = 1 sont ignorés partout (site client, admin, liens de fichiers).
`file_path` contient le chemin Dropbox complet ; un ancien `file_path` sans « / » désigne un fichier stocké sur le serveur.
