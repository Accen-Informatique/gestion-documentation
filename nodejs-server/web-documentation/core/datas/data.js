var express = require('express');
var app = express();
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var { uuid } = require('uuidv4');
var fmrestapi = require('../FileMaker');
var config = require('../../config');
var CryptoJS = require("crypto-js");
const axios = require('axios').default;


// ######################
// Site de documentation Accen — tout est dans FileMaker (aucun fichier db.json)
//  - WEB_DOCUMENTATION : un enregistrement = un fichier
//      · document client : USER_TOKEN = code du client
//      · document public : isPublic = 1 (USER_TOKEN vide), categorie
//  - WEB_DOCUMENTATION_CLIENT : une fiche par client (USER_TOKEN, nom, note, isActive, dateExpiration, derniereConnexion)
//  - administration : protégée par config.docAdminToken
//  - aucune suppression dans FileMaker : « supprimer » passe isDelete à 1 et supprime le fichier dans Dropbox
//  - fichiers stockés dans Dropbox : /DOCUMENTATION/<code client>/ et /DOCUMENTATION/public/
//  - un ancien documentation-data/db.json est importé automatiquement dans FileMaker au démarrage
// Toutes les routes POST reçoivent { data: encrypt(body) } et renvoient encrypt({ code, message, data })
// ######################

var FM_DB = config.docFmDatabase || 'Hotline';
var LAYOUT_DOCS = config.docFmLayout || 'WEB_DOCUMENTATION';
var LAYOUT_CLIENTS = config.docFmClientLayout || 'WEB_DOCUMENTATION_CLIENT';
var FIELDS = { token: 'USER_TOKEN', path: 'file_path', name: 'nom', description: 'description', deleted: 'isDelete', isPublic: 'isPublic', category: 'categorie' };
var CLIENT_FIELDS = { token: 'USER_TOKEN', name: 'nom', note: 'note', active: 'isActive', expires: 'dateExpiration', lastUsed: 'derniereConnexion', deleted: 'isDelete' };

var DATA_PATH = config.docDataPath || path.join(__dirname, '../../documentation-data');
var FILES_PATH = path.join(DATA_PATH, 'files'); // anciens fichiers stockés sur le serveur (file_path sans « / »)
var LEGACY_DB_FILE = path.join(DATA_PATH, 'db.json'); // ancien stockage, importé puis renommé
var MAX_UPLOAD_MB = config.docMaxUploadMb || 50;
var FILE_LINK_HOURS = 12;

fs.mkdirSync(DATA_PATH, { recursive: true });

function encrypt(datas) {
    return CryptoJS.AES.encrypt(JSON.stringify(datas), config.cryptageKey).toString()
}

function decrypt(data) {
    var bytes = CryptoJS.AES.decrypt(data, config.cryptageKey);
    var originalData = JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
    return originalData
}

// ######################
// Réponses
// ######################

// Erreur avec un message affichable côté client
function DocError(message, detail) {
    this.userMessage = message;
    this.detail = detail;
}

// Enveloppe une route async : décrypte le body, renvoie toujours une réponse chiffrée
function route(handler) {
    return function (req, res) {
        Promise.resolve()
            .then(function () {
                if (req.body && typeof req.body.data === 'string') req.body = decrypt(req.body.data)
                else req.body = {}
                return handler(req, res)
            })
            .then(function (data) {
                if (!res.headersSent) res.json(encrypt({ code: 0, message: 'ok', data: data === undefined ? {} : data }));
            })
            .catch(function (err) {
                if (!(err instanceof DocError)) console.error('[documentation]', req.path, err);
                else if (err.detail) console.error('[documentation]', req.path, JSON.stringify(err.detail));
                var message = err instanceof DocError ? err.userMessage : 'Erreur interne';
                // L'admin voit le détail FileMaker (code + message) pour diagnostiquer
                if (is_admin(req.body)) {
                    var d = err instanceof DocError ? err.detail : { message: err && err.message };
                    if (d && (d.code !== undefined || d.message)) message += ' [FileMaker ' + (d.code !== undefined ? d.code : '?') + (d.message ? ' : ' + d.message : '') + ']';
                }
                if (!res.headersSent) res.json(encrypt({ code: -1, message: message, data: {} }));
            });
    }
}

// ######################
// FileMaker (WEB_DOCUMENTATION)
// ######################

// Codes FileMaker « aucun enregistrement » : 401 (recherche vide), 101 (enregistrement absent)
var NO_RECORD = ['401', '101'];
var FM_ERROR = 'Le serveur FileMaker ne répond pas correctement. Réessayez plus tard.';

// Transforme un appel callback de fmrestapi en promesse
function fmp(fm, method) {
    var args = Array.prototype.slice.call(arguments, 2);
    if (typeof fm[method] !== 'function') {
        return Promise.resolve({ code: '-1', message: 'méthode ' + method + ' absente de core/FileMaker.js', data: '' });
    }
    return new Promise(function (resolve) {
        try {
            fm[method].apply(fm, args.concat([resolve]));
        } catch (err) {
            resolve({ code: '-1', message: err.message, data: '' });
        }
    });
}

// login → action → logout (toujours)
async function fmSession(action) {
    var fm = new fmrestapi(FM_DB);
    var pkglogin = await fmp(fm, 'login', config.fmpwd);
    if (pkglogin.code != 0) throw new DocError(FM_ERROR, pkglogin);
    var token = pkglogin.data;
    try {
        return await action(fm, token);
    } finally {
        await fmp(fm, 'logout', token);
    }
}

// ######################
// FileMaker : fonctions communes aux deux tables
// ######################

function field(r, name) {
    var v = r.fieldData[name];
    return v === undefined || v === null ? '' : String(v);
}

function flag(r, name) {
    var v = field(r, name).trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'oui';
}

// Suppression logique : isDelete = 1 → enregistrement ignoré partout (rien n'est supprimé dans FileMaker)
function is_deleted(r) {
    return flag(r, FIELDS.deleted);
}

function is_public(r) {
    return flag(r, FIELDS.isPublic);
}

// Recherche exacte : échappe les opérateurs FileMaker
function exact(value) {
    return '==' + String(value).replace(/([@*#?!=<>"~\\/]|\.\.)/g, '\\$1');
}

function record_id(id) {
    id = String(id || '');
    if (id.indexOf('fm-') === 0) id = id.slice(3);
    return /^\d+$/.test(id) ? id : null;
}

async function fm_find(fm, token, layout, query, sort) {
    // sans tri explicite : tri par nom (un tableau de tri vide est refusé par FileMaker, erreur 404)
    var pkgfind = await fmp(fm, 'findRecords', token, layout, query, sort && sort.length ? sort : [{ fieldName: FIELDS.name, sortOrder: "ascend" }]);
    if (NO_RECORD.includes(String(pkgfind.code))) return [];
    if (pkgfind.code != 0) throw new DocError(FM_ERROR, pkgfind);
    return pkgfind.data.data.filter(function (r) { return !is_deleted(r) });
}

async function fm_get(fm, token, layout, id) {
    var rid = record_id(id);
    if (!rid) return null;
    var pkgget = await fmp(fm, 'getRecord', token, layout, rid);
    if (NO_RECORD.includes(String(pkgget.code))) return null;
    if (pkgget.code != 0) throw new DocError(FM_ERROR, pkgget);
    var record = pkgget.data.data[0] || null;
    return record && !is_deleted(record) ? record : null;
}

async function fm_all(fm, token, layout) {
    var records = [];
    var limit = 500;
    for (var offset = 1; ; offset += limit) {
        var pkgget = await fmp(fm, 'getRecords', token, layout, offset, limit);
        if (NO_RECORD.includes(String(pkgget.code))) break;
        if (pkgget.code != 0) throw new DocError(FM_ERROR, pkgget);
        records = records.concat(pkgget.data.data.filter(function (r) { return !is_deleted(r) }));
        if (pkgget.data.data.length < limit) break;
    }
    return records;
}

async function fm_create(fm, token, layout, data) {
    var pkgcreate = await fmp(fm, 'createRecord', token, layout, data, {}, "");
    if (pkgcreate.code != 0) throw new DocError(FM_ERROR, pkgcreate);
    var pkgget = await fmp(fm, 'getRecord', token, layout, pkgcreate.data.recordId);
    if (pkgget.code != 0) throw new DocError(FM_ERROR, pkgget);
    return pkgget.data.data[0];
}

async function fm_edit(fm, token, layout, id, data) {
    var pkgedit = await fmp(fm, 'editRecords', token, layout, record_id(id), data, {}, "");
    if (pkgedit.code != 0) throw new DocError(FM_ERROR, pkgedit);
    var pkgget = await fmp(fm, 'getRecord', token, layout, record_id(id));
    if (pkgget.code != 0) throw new DocError(FM_ERROR, pkgget);
    return pkgget.data.data[0];
}

function soft_delete(fm, token, layout, id) {
    return fm_edit(fm, token, layout, id, { [FIELDS.deleted]: 1 });
}

// ---------- Dates ----------

// Horodatage FileMaker « MM/JJ/AAAA HH:MM:SS » (ou ISO) → ISO
function parse_ts(raw) {
    raw = String(raw || '').trim();
    if (!raw) return null;
    var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(raw);
    var d = m ? new Date(+m[3], +m[1] - 1, +m[2], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) : new Date(raw);
    return isNaN(d.getTime()) ? null : d.toISOString();
}

// Date → horodatage FileMaker « MM/JJ/AAAA HH:MM:SS » (heure locale du serveur) ; '' pour vider
function fm_ts(value) {
    if (!value) return '';
    var d = new Date(value);
    if (isNaN(d.getTime())) return '';
    var p = function (n) { return ('0' + n).slice(-2) };
    return p(d.getMonth() + 1) + '/' + p(d.getDate()) + '/' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

// Rubriques « Horodatage de création » / « Horodatage de modification » repérées par leur nom
function fm_created(r) {
    var keys = Object.keys(r.fieldData);
    var key = keys.find(function (k) { return /^horodatage.*cr[ée]ation/i.test(k) }) || keys.find(function (k) { return /^horodatage/i.test(k) && !/modif/i.test(k) });
    return key ? parse_ts(r.fieldData[key]) : null;
}

function fm_updated(r) {
    var key = Object.keys(r.fieldData).find(function (k) { return /^horodatage.*modif/i.test(k) });
    return (key && parse_ts(r.fieldData[key])) || fm_created(r);
}

// ---------- Cache (évite de solliciter FileMaker à chaque page visiteur) ----------
// Invalidé pour tous les processus via le fichier documentation-data/.cache-version

var cache = {};
var CACHE_MS = 30 * 1000;
var CACHE_VERSION_FILE = path.join(DATA_PATH, '.cache-version');

function cache_version() {
    try { return fs.statSync(CACHE_VERSION_FILE).mtimeMs; } catch (err) { return 0; }
}

function cached(key, loader) {
    var hit = cache[key];
    if (hit && Date.now() - hit.at < CACHE_MS && hit.version === cache_version()) return hit.value;
    var value = loader();
    cache[key] = { at: Date.now(), version: cache_version(), value: value };
    value.catch(function () { delete cache[key] });
    return value;
}

function clear_cache() {
    cache = {};
    try { fs.writeFileSync(CACHE_VERSION_FILE, String(Date.now())); } catch (err) { console.error('[documentation] cache', err); }
}

// ---------- Lectures ----------

// Documents d'un client (USER_TOKEN, hors documents publics)
async function fm_docs_by_token(fm, token, userToken) {
    var list = await fm_find(fm, token, LAYOUT_DOCS, [{ [FIELDS.token]: exact(userToken) }], [{ fieldName: FIELDS.name, sortOrder: "ascend" }]);
    // FileMaker ignore la casse : on revérifie de la même façon
    var wanted = String(userToken).toLowerCase();
    return list.filter(function (r) { return !is_public(r) && field(r, FIELDS.token).toLowerCase() === wanted });
}

async function fm_public_docs(fm, token) {
    var list = await fm_find(fm, token, LAYOUT_DOCS, [{ [FIELDS.isPublic]: '==1' }]);
    return list.filter(is_public).sort(function (a, b) { return String(fm_updated(b) || '').localeCompare(String(fm_updated(a) || '')) });
}

function get_documents_by_token(userToken) {
    return cached('docs:' + userToken, function () {
        return fmSession(function (fm, token) { return fm_docs_by_token(fm, token, userToken) });
    });
}

function get_public_docs() {
    return cached('public', function () { return fmSession(fm_public_docs) });
}

function get_clients() {
    return cached('clients', function () {
        return fmSession(function (fm, token) { return fm_all(fm, token, LAYOUT_CLIENTS) });
    });
}

function nowIso() {
    return new Date().toISOString();
}

// ######################
// Codes d'accès
// ######################

var ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sans 0/O, 1/I/L

function generate_token_value() {
    var s = '';
    // au moins une lettre et un chiffre (le « - » sert de caractère spécial)
    while (!/[A-Z]/.test(s) || !/[0-9]/.test(s)) {
        s = '';
        for (var i = 0; i < 16; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
    }
    return s.match(/.{4}/g).join('-');
}

// Code personnalisé : 6 à 64 caractères, sans espace, avec au moins une lettre, un chiffre et un caractère spécial
var CUSTOM_CODE_RULE = 'Code personnalisé : au moins 6 caractères, dont une lettre, un chiffre et un caractère spécial (ex. ! ? @ # - _), sans espace.';
function is_valid_custom_code(code) {
    return code.length >= 6 && code.length <= 64
        && !/\s/.test(code)
        && /\p{L}/u.test(code)
        && /\p{N}/u.test(code)
        && /[^\p{L}\p{N}]/u.test(code);
}

// Comparaison d'un code saisi : tolérante (casse, tirets) pour les codes générés, exacte pour les codes personnalisés
function token_matches(stored, raw) {
    stored = String(stored || '');
    raw = String(raw || '').trim();
    if (stored === raw) return true;
    if (/^[A-Z0-9-]+$/.test(stored)) return normalize_token(stored) === normalize_token(raw);
    return false;
}

function normalize_token(value) {
    return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function token_status(t) {
    if (!t.active) return 'disabled';
    if (t.expiresAt && Date.parse(t.expiresAt) <= Date.now()) return 'expired';
    return 'active';
}

function safe_equal(a, b) {
    var ha = crypto.createHash('sha256').update(String(a)).digest();
    var hb = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
}


// Fiche client WEB_DOCUMENTATION_CLIENT → format attendu par l'admin
function to_client(r) {
    var value = field(r, CLIENT_FIELDS.token);
    var nom = field(r, CLIENT_FIELDS.name).trim();
    var activeRaw = field(r, CLIENT_FIELDS.active).trim().toLowerCase();
    var t = {
        id: r.recordId,
        value: value,
        // fiche créée automatiquement à partir d'un USER_TOKEN saisi dans FileMaker : pas encore de nom
        source: nom ? 'site' : 'filemaker',
        label: nom || value,
        note: field(r, CLIENT_FIELDS.note),
        active: !(activeRaw === '0' || activeRaw === 'false' || activeRaw === 'non'),
        expiresAt: parse_ts(field(r, CLIENT_FIELDS.expires)),
        createdAt: fm_created(r),
        lastUsedAt: parse_ts(field(r, CLIENT_FIELDS.lastUsed))
    };
    t.status = token_status(t);
    return t;
}

/**
 * Codes valides parmi ceux envoyés par le navigateur.
 * Fiche client → doit être active / non expirée ; sinon → au moins un document FileMaker avec ce USER_TOKEN.
 */
async function resolve_codes(codes) {
    var list = Array.isArray(codes) ? codes.filter(function (c) { return typeof c === 'string' && c }).slice(0, 20) : [];
    if (!list.length) return [];
    var clients = await get_clients().catch(function () { return null });
    var valid = [];
    for (var i = 0; i < list.length; i++) {
        var code = list[i];
        // FileMaker injoignable : on garde le code plutôt que de le supprimer chez le client
        if (clients === null) { valid.push({ code: code, label: 'Accès privé', expiresAt: null }); continue; }
        var r = clients.find(function (c) { return field(c, CLIENT_FIELDS.token) === code });
        if (r) {
            var meta = to_client(r);
            if (meta.status === 'active') valid.push({ code: code, label: meta.label, expiresAt: meta.expiresAt });
            continue;
        }
        var records = await get_documents_by_token(code).catch(function () { return null });
        if (records === null || records.length) valid.push({ code: code, label: 'Accès privé', expiresAt: null });
    }
    return valid;
}

function is_admin(body) {
    return !!config.docAdminToken && typeof body.adminToken === 'string' && safe_equal(body.adminToken, config.docAdminToken);
}

function require_admin(req) {
    if (!is_admin(req.body)) throw new DocError('Accès administrateur requis.');
}

// Limitation des tentatives échouées par IP (mémoire)
var hits = {};

function client_ip(req) {
    return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}

function assert_not_limited(req, bucket, max) {
    var e = hits[bucket + ':' + client_ip(req)];
    if (e && e.resetAt > Date.now() && e.count >= max) {
        throw new DocError('Trop de tentatives. Réessayez dans ' + Math.ceil((e.resetAt - Date.now()) / 60000) + ' min.');
    }
}

function record_failure(req, bucket) {
    var k = bucket + ':' + client_ip(req);
    var e = hits[k];
    if (!e || e.resetAt <= Date.now()) hits[k] = { count: 1, resetAt: Date.now() + 15 * 60 * 1000 };
    else e.count++;
}

function clear_failures(req, bucket) {
    delete hits[bucket + ':' + client_ip(req)];
}
// ######################
// Fichiers
// ######################

var MIME_BY_EXT = {
    pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
    txt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown', csv: 'text/csv', json: 'application/json', log: 'text/plain', xml: 'application/xml', zip: 'application/zip',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
};

// Fichiers texte affichables (servis en text/plain : rien n'est interprété par le navigateur)
var TEXT_TYPES = ['text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/xml'];

// Types affichables dans le navigateur ; le reste est forcé en téléchargement
var INLINE_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'video/mp4', 'video/webm', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'text/plain'];

function file_ext(name) {
    var m = /\.([a-z0-9]{1,8})$/i.exec(name || '');
    return m ? m[1].toLowerCase() : '';
}

function guess_mime(name) {
    return MIME_BY_EXT[file_ext(name)] || 'application/octet-stream';
}

function clean_filename(name) {
    var n = String(name || 'document');
    // Nom UTF-8 mal décodé par l'upload (ex. « Ã© » au lieu de « é »)
    if (/Ã|Â/.test(n)) {
        var fixed = Buffer.from(n, 'latin1').toString('utf8');
        if (!fixed.includes('\uFFFD')) n = fixed;
    }
    n = n.split(/[\\/]/).pop().replace(/[\u0000-\u001f"]/g, '').slice(0, 200);
    return n || 'document';
}

// ######################
// Dropbox (API HTTP via axios : compatible Node 16, mêmes identifiants que les états des lieux)
// ######################

var DBX_AUTH = config.dropboxAuthUrl || 'https://api.dropbox.com/oauth2/token';
var DBX_API = config.dropboxApiUrl || 'https://api.dropboxapi.com/2';
var DBX_CONTENT = config.dropboxContentUrl || 'https://content.dropboxapi.com/2';
var DBX_ROOT = (config.docDropboxRoot || '/DOCUMENTATION').replace(/\/+$/, '');
var DBX_ERROR = 'Dropbox ne répond pas correctement. Réessayez plus tard.';
var dbxToken = null;

// Jeton d'accès (refresh token), gardé en mémoire jusqu'à son expiration
async function dbx_token() {
    if (dbxToken && dbxToken.until > Date.now()) return dbxToken.value;
    try {
        var response = await axios.post(DBX_AUTH,
            "grant_type=refresh_token&refresh_token=" + encodeURIComponent(config.dropBoxRefreshToken), {
            headers: {
                Authorization: config.dropboxAuthentification,
                'Content-Type': "application/x-www-form-urlencoded"
            }
        });
        dbxToken = { value: response.data.access_token, until: Date.now() + ((response.data.expires_in || 3600) - 300) * 1000 };
        return dbxToken.value;
    } catch (err) {
        throw new DocError(DBX_ERROR, dbx_detail(err));
    }
}

function dbx_detail(err) {
    var r = err && err.response;
    var summary = r && r.data && (r.data.error_summary || r.data.error_description || (typeof r.data === 'string' ? r.data.slice(0, 200) : ''));
    return { code: r ? 'Dropbox ' + r.status : 'Dropbox', message: summary || (err && err.message) || '' };
}

// En-tête Dropbox-API-Arg : JSON en ASCII (accents échappés)
function dbx_arg(obj) {
    return JSON.stringify(obj).replace(/[\u007f-￿]/g, function (c) { return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4) });
}

function is_dropbox_path(storedName) {
    return String(storedName || '').charAt(0) === '/';
}

async function dbx_upload(dropboxPath, buffer) {
    var token = await dbx_token();
    try {
        await axios.post(DBX_CONTENT + '/files/upload', buffer, {
            headers: {
                Authorization: 'Bearer ' + token,
                'Dropbox-API-Arg': dbx_arg({ path: dropboxPath, mode: 'overwrite', autorename: false, mute: true }),
                'Content-Type': 'application/octet-stream'
            },
            maxBodyLength: Infinity,
            maxContentLength: Infinity
        });
    } catch (err) {
        throw new DocError(DBX_ERROR, dbx_detail(err));
    }
}

async function dbx_delete(dropboxPath) {
    var token = await dbx_token();
    try {
        await axios.post(DBX_API + '/files/delete_v2', { path: dropboxPath }, {
            headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
        });
    } catch (err) {
        var d = dbx_detail(err);
        if (/not_found/.test(d.message)) return; // déjà absent
        throw new DocError(DBX_ERROR, d);
    }
}

// Contenu d'un dossier : { chemin_minuscule: taille }
async function dbx_list(folder) {
    var token = await dbx_token();
    var headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
    var sizes = {};
    try {
        var response = await axios.post(DBX_API + '/files/list_folder', { path: folder, recursive: false }, { headers: headers });
        for (; ;) {
            response.data.entries.forEach(function (e) { if (e['.tag'] === 'file') sizes[e.path_lower] = e.size });
            if (!response.data.has_more) break;
            response = await axios.post(DBX_API + '/files/list_folder/continue', { cursor: response.data.cursor }, { headers: headers });
        }
    } catch (err) {
        var d = dbx_detail(err);
        if (/not_found/.test(d.message)) return sizes; // dossier pas encore créé
        throw new DocError(DBX_ERROR, d);
    }
    return sizes;
}

// Téléchargement en flux (Range transmis pour la lecture vidéo)
async function dbx_download(dropboxPath, range) {
    var token = await dbx_token();
    var headers = {
        Authorization: 'Bearer ' + token,
        'Dropbox-API-Arg': dbx_arg({ path: dropboxPath }),
        'Content-Type': 'text/plain; charset=dropbox-cors-hack'
    };
    if (range) headers.Range = range;
    return axios.post(DBX_CONTENT + '/files/download', '', { headers: headers, responseType: 'stream', validateStatus: function () { return true } });
}

// ######################
// Fichiers
// ######################

function legacy_path(storedName) {
    // basename : un file_path saisi dans FileMaker ne peut pas sortir du dossier
    return path.join(FILES_PATH, path.basename(String(storedName || '')));
}

// Nom d'origine à partir d'un nom stocké « <uuid>-<nom> »
function original_name(storedName) {
    var b = path.basename(String(storedName || ''));
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i.test(b) ? b.slice(37) : b;
}

function get_upload(req) {
    var file = req.files && req.files.file;
    if (Array.isArray(file)) file = file[0];
    if (!file) throw new DocError('Aucun fichier reçu.');
    var size = file.size || (file.data && file.data.length) || 0;
    if (size > MAX_UPLOAD_MB * 1024 * 1024) throw new DocError('Fichier trop volumineux (max. ' + MAX_UPLOAD_MB + ' Mo).');
    return { name: clean_filename(file.name), data: file.data, size: size };
}

// Dossier Dropbox : /DOCUMENTATION/<code client> ou /DOCUMENTATION/public
function dropbox_folder(folder) {
    return DBX_ROOT + '/' + String(folder || 'public').replace(/[^A-Za-z0-9_-]/g, '_');
}

/** Envoie le fichier dans Dropbox ; storedName = chemin Dropbox « /DOCUMENTATION/<dossier>/<uuid>-<nom> » */
async function save_file(upload, folder) {
    var ext = path.extname(upload.name).toLowerCase();
    var safeExt = /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : '';
    var safeName = upload.name.replace(/[^\p{L}\p{N}._ -]/gu, '_').replace(/^\.+/, '').slice(0, 150) || ('document' + safeExt);
    var storedName = dropbox_folder(folder) + '/' + uuid() + '-' + safeName;
    await dbx_upload(storedName, upload.data);
    return { storedName: storedName, originalName: upload.name, mimeType: guess_mime(upload.name), size: upload.size };
}

/** Supprime le fichier (Dropbox, ou ancien fichier serveur) */
async function remove_file(storedName) {
    if (!storedName) return;
    if (is_dropbox_path(storedName)) return dbx_delete(storedName);
    await fs.promises.unlink(legacy_path(storedName)).catch(function () { });
}

/** Tailles des fichiers : { chemin_minuscule: taille } ; null si Dropbox est injoignable */
async function file_sizes(storedNames) {
    var sizes = {};
    var folders = {};
    for (var i = 0; i < storedNames.length; i++) {
        var n = storedNames[i];
        if (!n) continue;
        if (is_dropbox_path(n)) folders[path.posix.dirname(n).toLowerCase()] = true;
        else {
            var st = await fs.promises.stat(legacy_path(n)).catch(function () { return null });
            if (st) sizes[n.toLowerCase()] = st.size;
        }
    }
    try {
        var list = Object.keys(folders);
        for (var j = 0; j < list.length; j++) Object.assign(sizes, await dbx_list(list[j]));
    } catch (err) {
        console.error('[documentation] tailles Dropbox', err.detail || err);
        return null;
    }
    return sizes;
}

// Lien de fichier signé (pas de secret dans l'URL) : <id>.<expiration>.<signature>
function sign_file(id, exp) {
    return crypto.createHmac('sha256', String(config.cryptageKey)).update(id + '.' + exp).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function file_url(req, id) {
    var exp = Date.now() + FILE_LINK_HOURS * 3600 * 1000;
    return req.baseUrl + '/doc_file/' + encodeURIComponent(id) + '?exp=' + exp + '&sig=' + sign_file(id, exp);
}

// ######################
// Mise en forme des documents (même format pour public et client)
// ######################

function doc_file_info(r, sizes) {
    var storedName = field(r, FIELDS.path);
    var name = storedName ? original_name(storedName) : '';
    // sizes = null : Dropbox injoignable → taille inconnue, fichier supposé présent
    var size = sizes && storedName ? sizes[storedName.toLowerCase()] : undefined;
    return {
        name: name,
        mimeType: guess_mime(name),
        size: size === undefined ? null : size,
        ext: file_ext(name),
        missing: !storedName || (sizes !== null && size === undefined)
    };
}

async function to_doc(req, r, unlockedBy, sizes) {
    if (sizes === undefined) sizes = await file_sizes([field(r, FIELDS.path)]);
    var file = doc_file_info(r, sizes);
    var id = 'fm-' + r.recordId;
    var pub = is_public(r);
    return {
        id: id,
        recordId: r.recordId,
        title: field(r, FIELDS.name) || file.name.replace(/\.[^.]+$/, '') || 'Document',
        description: field(r, FIELDS.description),
        category: pub ? field(r, FIELDS.category) : '',
        visibility: pub ? 'public' : 'private',
        unlockedBy: pub ? [] : unlockedBy,
        file: file,
        fileUrl: file_url(req, id),
        createdAt: fm_created(r),
        updatedAt: fm_updated(r)
    };
}

async function to_docs(req, records, unlockedBy) {
    var sizes = await file_sizes(records.map(function (r) { return field(r, FIELDS.path) }));
    var out = [];
    for (var i = 0; i < records.length; i++) out.push(await to_doc(req, records[i], unlockedBy, sizes));
    return out;
}

// Retrouve un document si le visiteur y a droit (null sinon)
async function resolve_visible_doc(req, id, codes, admin) {
    var rid = record_id(id);
    if (!rid) return null;
    var record = await fmSession(function (fm, token) { return fm_get(fm, token, LAYOUT_DOCS, rid) });
    if (!record) return null;
    if (is_public(record)) return { record: record, label: '' };
    if (admin) return { record: record, label: '' };
    var owner = field(record, FIELDS.token).toLowerCase();
    var valid = await resolve_codes(codes);
    var match = valid.find(function (v) { return owner && v.code.toLowerCase() === owner });
    return match ? { record: record, label: match.label } : null;
}

// ######################
// Import de l'ancien stockage documentation-data/db.json (une seule fois)
// ######################

var migration = null;

function migrate_legacy_db() {
    if (!migration) {
        migration = run_migration().catch(function (err) {
            console.error('[documentation] import db.json', err.detail || err);
        }).then(function () { migration = null });
    }
    return migration;
}

async function run_migration() {
    if (!fs.existsSync(LEGACY_DB_FILE)) return;
    // Renommage atomique : un seul processus fait l'import
    var work = LEGACY_DB_FILE + '.import-' + process.pid;
    try { fs.renameSync(LEGACY_DB_FILE, work); } catch (err) { return; }
    try {
        var db = JSON.parse(fs.readFileSync(work, 'utf8'));
        var imported = { clients: 0, documents: 0 };
        await fmSession(async function (fm, token) {
            // Import rejouable : on ignore ce qui est déjà dans FileMaker
            var clients = (await fm_all(fm, token, LAYOUT_CLIENTS)).map(function (r) { return field(r, CLIENT_FIELDS.token).toLowerCase() });
            var paths = (await fm_all(fm, token, LAYOUT_DOCS)).map(function (r) { return field(r, FIELDS.path).toLowerCase() });
            var tokens = db.tokens || [];
            for (var i = 0; i < tokens.length; i++) {
                var t = tokens[i];
                if (t.deletedAt || !t.value || clients.includes(String(t.value).toLowerCase())) continue;
                await fm_create(fm, token, LAYOUT_CLIENTS, {
                    [CLIENT_FIELDS.token]: t.value,
                    [CLIENT_FIELDS.name]: t.source === 'filemaker' && t.label === t.value ? '' : (t.label || ''),
                    [CLIENT_FIELDS.note]: t.note || '',
                    [CLIENT_FIELDS.active]: t.active === false ? 0 : 1,
                    [CLIENT_FIELDS.expires]: fm_ts(t.expiresAt),
                    [CLIENT_FIELDS.lastUsed]: fm_ts(t.lastUsedAt)
                });
                imported.clients++;
            }
            var docs = db.documents || [];
            for (var j = 0; j < docs.length; j++) {
                var d = docs[j];
                var stored = d.file && d.file.storedName;
                if (!stored || paths.includes(String(stored).toLowerCase())) continue;
                await fm_create(fm, token, LAYOUT_DOCS, {
                    [FIELDS.token]: '',
                    [FIELDS.isPublic]: 1,
                    [FIELDS.path]: stored,
                    [FIELDS.name]: d.title || '',
                    [FIELDS.description]: d.description || '',
                    [FIELDS.category]: d.category || ''
                });
                imported.documents++;
            }
        });
        fs.renameSync(work, LEGACY_DB_FILE + '.importe-' + Date.now());
        clear_cache();
        console.log('[documentation] db.json importé dans FileMaker :', imported.clients, 'client(s),', imported.documents, 'document(s) public(s)');
    } catch (err) {
        // Échec : le fichier est remis en place, nouvel essai au prochain appel admin
        try { fs.renameSync(work, LEGACY_DB_FILE); } catch (e) { }
        throw err;
    }
}

setTimeout(migrate_legacy_db, 2000);

// ######################
// Routes visiteur
// ######################

// Vérifie un code saisi par un client ; data = { code, label, documentCount }
app.post('/doc_check_code', route(async function (req) {
    assert_not_limited(req, 'client-token', 10);
    var raw = String(req.body.code || '').trim().slice(0, 200);
    if (raw.length < 4) throw new DocError('Saisissez un code d\'accès valide.');

    var r = (await get_clients()).find(function (c) { return token_matches(field(c, CLIENT_FIELDS.token), raw) });
    var value, label = 'Accès privé', meta = null;
    if (r) {
        meta = to_client(r);
        if (meta.status !== 'active') {
            record_failure(req, 'client-token');
            throw new DocError(meta.status === 'expired' ? 'Ce code d\'accès a expiré.' : 'Ce code d\'accès est désactivé.');
        }
        value = meta.value;
        label = meta.label;
    } else {
        // USER_TOKEN présent uniquement dans WEB_DOCUMENTATION (sans fiche client)
        var records = await get_documents_by_token(raw);
        if (!records.length) {
            record_failure(req, 'client-token');
            throw new DocError('Code d\'accès inconnu.');
        }
        value = field(records[0], FIELDS.token);
    }
    clear_failures(req, 'client-token');

    if (r) {
        await fmSession(function (fm, token) {
            return fm_edit(fm, token, LAYOUT_CLIENTS, r.recordId, { [CLIENT_FIELDS.lastUsed]: fm_ts(new Date()) });
        }).catch(function (err) { console.error('[documentation] derniereConnexion', err.detail || err) });
    }
    var documentCount = (await get_documents_by_token(value).catch(function () { return [] })).length;
    return { code: value, label: label, expiresAt: meta ? meta.expiresAt : null, documentCount: documentCount };
}));

// Documents visibles : publics + ceux des codes valides ; renvoie aussi la liste des codes encore valides
app.post('/doc_get_documents', route(async function (req) {
    var valid = await resolve_codes(req.body.codes);
    var publicDocs = [];
    var publicError = null;
    try {
        publicDocs = await to_docs(req, await get_public_docs(), []);
    } catch (err) {
        console.error('[documentation] doc_get_documents public', err.detail || err);
        publicError = 'Documentation momentanément indisponible.';
    }

    var found = [];
    var seen = {};
    var clientError = null;
    for (var i = 0; i < valid.length; i++) {
        try {
            var records = await get_documents_by_token(valid[i].code);
            for (var j = 0; j < records.length; j++) {
                if (seen[records[j].recordId]) continue;
                seen[records[j].recordId] = true;
                found.push({ record: records[j], label: valid[i].label });
            }
        } catch (err) {
            clientError = 'Documents privés momentanément indisponibles.';
        }
    }
    var sizes = await file_sizes(found.map(function (f) { return field(f.record, FIELDS.path) }));
    var privateDocs = [];
    for (var k = 0; k < found.length; k++) privateDocs.push(await to_doc(req, found[k].record, [found[k].label], sizes));
    return { publicDocs: publicDocs, privateDocs: privateDocs, clientError: clientError || publicError, codes: valid };
}));

app.post('/doc_get_document', route(async function (req) {
    var found = await resolve_visible_doc(req, req.body.id, req.body.codes, is_admin(req.body));
    if (!found) throw new DocError('Document introuvable ou accès non autorisé.');
    return to_doc(req, found.record, found.label ? [found.label] : []);
}));

// Téléchargement / affichage d'un fichier (lien signé fourni par les routes ci-dessus)
app.get('/doc_file/:id', function (req, res) {
    var id = String(req.params.id || '');
    var exp = Number(req.query.exp);
    var sig = String(req.query.sig || '');
    var notFound = function () { res.status(404).send('Document introuvable ou lien expiré.') };
    if (!exp || exp < Date.now() || !sig || !safe_equal(sig, sign_file(id, exp))) return notFound();

    Promise.resolve().then(async function () {
        var record = await fmSession(function (fm, token) { return fm_get(fm, token, LAYOUT_DOCS, id) });
        if (!record) return notFound();
        var storedName = field(record, FIELDS.path);
        if (!storedName) return notFound();
        var name = original_name(storedName);
        var mimeType = guess_mime(name);
        var isText = TEXT_TYPES.includes(mimeType);
        var inline = req.query.dl === undefined && (INLINE_TYPES.includes(mimeType) || isText);
        var ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
        var headers = {
            'Content-Type': inline ? (isText ? 'text/plain; charset=utf-8' : mimeType) : (mimeType === 'image/svg+xml' || mimeType.indexOf('text/html') === 0 ? 'application/octet-stream' : mimeType),
            'Content-Disposition': (inline ? 'inline' : 'attachment') + '; filename="' + ascii + '"; filename*=UTF-8\'\'' + encodeURIComponent(name),
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'private, no-store'
        };

        // Ancien fichier stocké sur le serveur
        if (!is_dropbox_path(storedName)) {
            var filePath = legacy_path(storedName);
            if (!fs.existsSync(filePath)) return notFound();
            return res.sendFile(filePath, { headers: headers });
        }

        // Fichier Dropbox relayé en flux
        var dl = await dbx_download(storedName, req.headers.range);
        if (dl.status === 409) { dl.data.resume(); return notFound(); }
        if (dl.status !== 200 && dl.status !== 206) {
            dl.data.resume();
            console.error('[documentation] doc_file Dropbox', dl.status);
            return res.status(502).send('Fichier momentanément indisponible.');
        }
        headers['Accept-Ranges'] = 'bytes';
        if (dl.headers['content-length']) headers['Content-Length'] = dl.headers['content-length'];
        if (dl.headers['content-range']) headers['Content-Range'] = dl.headers['content-range'];
        res.status(dl.status).set(headers);
        dl.data.pipe(res);
    }).catch(function (err) {
        console.error('[documentation] doc_file', err.detail || err);
        if (!res.headersSent) res.status(502).send('Fichier momentanément indisponible.');
    });
});

// ######################
// Routes admin (body.adminToken obligatoire)
// ######################

app.post('/doc_admin_login', route(async function (req) {
    if (!config.docAdminToken) throw new DocError('Aucun token admin n\'est configuré sur le serveur (config.docAdminToken).');
    assert_not_limited(req, 'admin', 5);
    if (!is_admin(req.body)) {
        record_failure(req, 'admin');
        throw new DocError('Token administrateur incorrect.');
    }
    clear_failures(req, 'admin');
    return {};
}));

// ---------- Documentation publique (WEB_DOCUMENTATION, isPublic = 1) ----------

async function get_public_record(fm, token, id) {
    var record = await fm_get(fm, token, LAYOUT_DOCS, id);
    if (!record || !is_public(record)) throw new DocError('Document introuvable.');
    return record;
}

app.post('/doc_admin_get_public', route(async function (req) {
    require_admin(req);
    await migrate_legacy_db();
    return to_docs(req, await fmSession(fm_public_docs), []);
}));

// multipart : data = encrypt({ adminToken, title, category, description }), file
app.post('/doc_admin_add_public', route(async function (req) {
    require_admin(req);
    var upload = get_upload(req);
    var stored = await save_file(upload, 'public');
    try {
        var record = await fmSession(function (fm, token) {
            return fm_create(fm, token, LAYOUT_DOCS, {
                [FIELDS.token]: '',
                [FIELDS.isPublic]: 1,
                [FIELDS.path]: stored.storedName,
                [FIELDS.name]: String(req.body.title || '').trim().slice(0, 160) || upload.name.replace(/\.[^.]+$/, ''),
                [FIELDS.description]: String(req.body.description || '').trim().slice(0, 2000),
                [FIELDS.category]: String(req.body.category || '').trim().slice(0, 60)
            });
        });
        clear_cache();
        return to_doc(req, record, []);
    } catch (err) {
        await remove_file(stored.storedName).catch(function () { });
        throw err;
    }
}));

app.post('/doc_admin_edit_public', route(async function (req) {
    require_admin(req);
    var data = {};
    if ('title' in req.body) {
        var title = String(req.body.title || '').trim().slice(0, 160);
        if (!title) throw new DocError('Le titre est obligatoire.');
        data[FIELDS.name] = title;
    }
    if ('description' in req.body) data[FIELDS.description] = String(req.body.description || '').trim().slice(0, 2000);
    if ('category' in req.body) data[FIELDS.category] = String(req.body.category || '').trim().slice(0, 60);
    var record = await fmSession(async function (fm, token) {
        var current = await get_public_record(fm, token, req.body.id);
        return fm_edit(fm, token, LAYOUT_DOCS, current.recordId, data);
    });
    clear_cache();
    return to_doc(req, record, []);
}));

// multipart : data = encrypt({ adminToken, id }), file
app.post('/doc_admin_replace_public_file', route(async function (req) {
    require_admin(req);
    var upload = get_upload(req);
    var current = await fmSession(function (fm, token) { return get_public_record(fm, token, req.body.id) });
    var previous = field(current, FIELDS.path);
    var stored = await save_file(upload, 'public');
    try {
        var record = await fmSession(function (fm, token) {
            return fm_edit(fm, token, LAYOUT_DOCS, current.recordId, { [FIELDS.path]: stored.storedName });
        });
    } catch (err) {
        await remove_file(stored.storedName).catch(function () { });
        throw err;
    }
    await remove_file(previous).catch(function (e) { console.error('[documentation] ancien fichier', e.detail || e) });
    clear_cache();
    return to_doc(req, record, []);
}));

// Suppression : isDelete = 1 puis suppression du fichier dans Dropbox
app.post('/doc_admin_delete_public', route(async function (req) {
    require_admin(req);
    var record = await fmSession(async function (fm, token) {
        var current = await get_public_record(fm, token, req.body.id);
        await soft_delete(fm, token, LAYOUT_DOCS, current.recordId);
        return current;
    });
    clear_cache();
    try {
        await remove_file(field(record, FIELDS.path));
    } catch (err) {
        throw new DocError('Document masqué (isDelete = 1), mais la suppression dans Dropbox a échoué.', err.detail || err);
    }
    return {};
}));

// ---------- Clients (WEB_DOCUMENTATION_CLIENT + documents WEB_DOCUMENTATION) ----------

async function get_client_record(fm, token, id) {
    var record = await fm_get(fm, token, LAYOUT_CLIENTS, id);
    if (!record) throw new DocError('Client introuvable.');
    return record;
}

// Code libre (casse ignorée) parmi les clients non supprimés
function code_taken(clients, value) {
    var v = String(value).toLowerCase();
    return clients.some(function (c) { return field(c, CLIENT_FIELDS.token).toLowerCase() === v });
}

function new_code(clients) {
    var value = generate_token_value();
    while (code_taken(clients, value)) value = generate_token_value();
    return value;
}

// Liste des clients avec leurs documents ; un USER_TOKEN saisi dans WEB_DOCUMENTATION sans fiche client en obtient une
app.post('/doc_admin_get_clients', route(async function (req) {
    require_admin(req);
    await migrate_legacy_db();
    var result = await fmSession(async function (fm, token) {
        var docs = (await fm_all(fm, token, LAYOUT_DOCS)).filter(function (r) { return !is_public(r) });
        var clients = await fm_all(fm, token, LAYOUT_CLIENTS);

        var groups = {};
        docs.forEach(function (r) {
            var v = field(r, FIELDS.token).trim();
            if (!v) return;
            var k = v.toLowerCase();
            if (!groups[k]) groups[k] = { value: v, records: [] };
            groups[k].records.push(r);
        });
        var unknown = Object.keys(groups).filter(function (k) { return !code_taken(clients, k) });
        for (var i = 0; i < unknown.length; i++) {
            clients.push(await fm_create(fm, token, LAYOUT_CLIENTS, {
                [CLIENT_FIELDS.token]: groups[unknown[i]].value,
                [CLIENT_FIELDS.name]: '',
                [CLIENT_FIELDS.active]: 1
            }));
        }
        return { docs: docs, clients: clients, groups: groups, created: unknown.length };
    });
    if (result.created) clear_cache();

    var sizes = await file_sizes(result.docs.map(function (r) { return field(r, FIELDS.path) }));
    var tokens = result.clients.map(to_client).sort(function (a, b) { return a.label.localeCompare(b.label, 'fr') });
    var out = [];
    for (var i = 0; i < tokens.length; i++) {
        var t = tokens[i];
        var list = (result.groups[t.value.toLowerCase()] || {}).records || [];
        var files = [];
        for (var j = 0; j < list.length; j++) files.push(await to_doc(req, list[j], [t.label], sizes));
        out.push(Object.assign(t, { files: files }));
    }
    return { fmError: null, tokens: out };
}));

app.post('/doc_admin_create_client', route(async function (req) {
    require_admin(req);
    var label = String(req.body.label || '').trim().slice(0, 120);
    if (!label) throw new DocError('Indiquez le nom du client.');
    var custom = String(req.body.value || '').trim();
    if (custom && !is_valid_custom_code(custom)) throw new DocError(CUSTOM_CODE_RULE);

    var record = await fmSession(async function (fm, token) {
        var clients = await fm_all(fm, token, LAYOUT_CLIENTS);
        // Les clients supprimés (isDelete = 1) ne bloquent pas leur ancien code
        if (custom && code_taken(clients, custom)) throw new DocError('Ce code existe déjà.');
        return fm_create(fm, token, LAYOUT_CLIENTS, {
            [CLIENT_FIELDS.token]: custom || new_code(clients),
            [CLIENT_FIELDS.name]: label,
            [CLIENT_FIELDS.note]: String(req.body.note || '').trim().slice(0, 1000),
            [CLIENT_FIELDS.active]: req.body.active === false ? 0 : 1,
            [CLIENT_FIELDS.expires]: fm_ts(req.body.expiresAt)
        });
    });
    clear_cache();
    return Object.assign(to_client(record), { files: [] });
}));

app.post('/doc_admin_edit_client', route(async function (req) {
    require_admin(req);
    var data = {};
    if ('label' in req.body) {
        var label = String(req.body.label || '').trim().slice(0, 120);
        if (!label) throw new DocError('Le nom du client est obligatoire.');
        data[CLIENT_FIELDS.name] = label;
    }
    if ('note' in req.body) data[CLIENT_FIELDS.note] = String(req.body.note || '').trim().slice(0, 1000);
    if ('active' in req.body) data[CLIENT_FIELDS.active] = req.body.active === true ? 1 : 0;
    if ('expiresAt' in req.body) data[CLIENT_FIELDS.expires] = fm_ts(req.body.expiresAt);
    var record = await fmSession(async function (fm, token) {
        var current = await get_client_record(fm, token, req.body.id);
        return fm_edit(fm, token, LAYOUT_CLIENTS, current.recordId, data);
    });
    clear_cache();
    return to_client(record);
}));

// Nouveau code : USER_TOKEN mis à jour sur la fiche et sur ses documents, l'ancien code ne donne plus accès
app.post('/doc_admin_regenerate_client', route(async function (req) {
    require_admin(req);
    var record = await fmSession(async function (fm, token) {
        var current = await get_client_record(fm, token, req.body.id);
        var value = new_code(await fm_all(fm, token, LAYOUT_CLIENTS));
        var docs = await fm_docs_by_token(fm, token, field(current, CLIENT_FIELDS.token));
        for (var i = 0; i < docs.length; i++) await fm_edit(fm, token, LAYOUT_DOCS, docs[i].recordId, { [FIELDS.token]: value });
        return fm_edit(fm, token, LAYOUT_CLIENTS, current.recordId, { [CLIENT_FIELDS.token]: value });
    });
    clear_cache();
    return to_client(record);
}));

// Suppression du client : isDelete = 1 sur la fiche et ses documents, fichiers supprimés dans Dropbox
app.post('/doc_admin_delete_client', route(async function (req) {
    require_admin(req);
    var records = await fmSession(async function (fm, token) {
        var current = await get_client_record(fm, token, req.body.id);
        var list = await fm_docs_by_token(fm, token, field(current, CLIENT_FIELDS.token));
        for (var i = 0; i < list.length; i++) await soft_delete(fm, token, LAYOUT_DOCS, list[i].recordId);
        await soft_delete(fm, token, LAYOUT_CLIENTS, current.recordId);
        return list;
    });
    clear_cache();
    var dropboxErrors = 0;
    for (var i = 0; i < records.length; i++) {
        try {
            await remove_file(field(records[i], FIELDS.path));
        } catch (err) {
            dropboxErrors++;
            console.error('[documentation] suppression Dropbox', err.detail || err);
        }
    }
    if (dropboxErrors) throw new DocError('Client supprimé, mais ' + dropboxErrors + ' fichier(s) n\'ont pas pu être supprimés dans Dropbox.');
    return { deletedFiles: records.length };
}));

// multipart : data = encrypt({ adminToken, clientId, nom, description }), file
app.post('/doc_admin_add_client_file', route(async function (req) {
    require_admin(req);
    var client = to_client(await fmSession(function (fm, token) { return get_client_record(fm, token, req.body.clientId) }));
    var upload = get_upload(req);
    var stored = await save_file(upload, client.value);
    try {
        var record = await fmSession(function (fm, token) {
            return fm_create(fm, token, LAYOUT_DOCS, {
                [FIELDS.token]: client.value,
                [FIELDS.path]: stored.storedName,
                [FIELDS.name]: String(req.body.nom || '').trim().slice(0, 200) || upload.name.replace(/\.[^.]+$/, ''),
                [FIELDS.description]: String(req.body.description || '').trim().slice(0, 2000)
            });
        });
        clear_cache();
        return to_doc(req, record, [client.label]);
    } catch (err) {
        await remove_file(stored.storedName).catch(function () { });
        throw err;
    }
}));

app.post('/doc_admin_edit_client_file', route(async function (req) {
    require_admin(req);
    var data = {};
    if ('nom' in req.body) {
        var nom = String(req.body.nom || '').trim().slice(0, 200);
        if (!nom) throw new DocError('Le nom est obligatoire.');
        data[FIELDS.name] = nom;
    }
    if ('description' in req.body) data[FIELDS.description] = String(req.body.description || '').trim().slice(0, 2000);
    var record = await fmSession(async function (fm, token) {
        if (!(await fm_get(fm, token, LAYOUT_DOCS, req.body.recordId))) throw new DocError('Document introuvable.');
        return fm_edit(fm, token, LAYOUT_DOCS, req.body.recordId, data);
    });
    clear_cache();
    return to_doc(req, record, []);
}));

// multipart : data = encrypt({ adminToken, recordId }), file
app.post('/doc_admin_replace_client_file', route(async function (req) {
    require_admin(req);
    var upload = get_upload(req);
    var current = await fmSession(function (fm, token) { return fm_get(fm, token, LAYOUT_DOCS, req.body.recordId) });
    if (!current) throw new DocError('Document introuvable.');
    var previous = field(current, FIELDS.path);
    var stored = await save_file(upload, field(current, FIELDS.token));
    try {
        var record = await fmSession(function (fm, token) {
            return fm_edit(fm, token, LAYOUT_DOCS, current.recordId, { [FIELDS.path]: stored.storedName });
        });
    } catch (err) {
        await remove_file(stored.storedName).catch(function () { });
        throw err;
    }
    await remove_file(previous).catch(function (e) { console.error('[documentation] ancien fichier', e.detail || e) });
    clear_cache();
    return to_doc(req, record, []);
}));

// Suppression d'un document : isDelete = 1 dans FileMaker puis suppression du fichier dans Dropbox
app.post('/doc_admin_delete_client_file', route(async function (req) {
    require_admin(req);
    var record = await fmSession(async function (fm, token) {
        var current = await fm_get(fm, token, LAYOUT_DOCS, req.body.recordId);
        if (!current) throw new DocError('Document introuvable.');
        await soft_delete(fm, token, LAYOUT_DOCS, current.recordId);
        return current;
    });
    clear_cache();
    try {
        await remove_file(field(record, FIELDS.path));
    } catch (err) {
        throw new DocError('Document masqué (isDelete = 1), mais la suppression dans Dropbox a échoué.', err.detail || err);
    }
    return {};
}));

module.exports = app;
