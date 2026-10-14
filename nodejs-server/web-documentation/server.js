var http = require('http');
var path = require('path');
var express = require('express');
var app = express();
var fileupload = require('express-fileupload');
var cookieParser = require('cookie-parser')
app.use(cookieParser())

app.use(function(req, res, next) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,FETCH');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

var bodyParser = require('body-parser');
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(bodyParser.json({ limit: '50mb' }));
// defParamCharset : noms de fichiers accentués correctement décodés
app.use(fileupload({ createParentPath: true, defParamCharset: 'utf8' }));
app.disable('x-powered-by');

// API documentation (codes clients, documents, administration)
var restdata = require('./core/datas/data');
app.use('/api/v1', restdata);

// Front Nuxt généré (npm run generate → .output/public copié dans app/)
var appPath = path.join(__dirname, 'app');
app.use('/', express.static(appPath));
app.use('/webdoc', express.static(path.join(__dirname, 'webdoc')));

// Application monopage : toute autre URL renvoie index.html (ex. /docs/xxx, /admin)
app.get(/^\/(?!api\/|webdoc\/).*/, function(req, res) {
    res.sendFile(path.join(appPath, 'index.html'));
});

const whttp = http.createServer(app);
whttp.listen(8096, () => { About(); });

function About() {
    console.log('------------------------------');
    console.log('- Editeur : ACCEN Informatique');
    console.log('- Projet  : web-documentation');
    console.log('- Port    : 8096');
    console.log('------------------------------');
}
