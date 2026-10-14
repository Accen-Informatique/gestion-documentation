var express = require('express');
var app = express();
var fmrestapi = require('../FileMaker');
var config = require('/home/gestion-conge-vue/config');
var CryptoJS = require("crypto-js");
var moment = require('moment')

function encrypt(datas) {
    return CryptoJS.AES.encrypt(JSON.stringify(datas), config.cryptageKey).toString()
}

function decrypt(data) {
    var bytes = CryptoJS.AES.decrypt(data, config.cryptageKey);
    var originalData = JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
    return originalData
}


// fm.runScript(token, "Reservation_web", infoidrecord, "RESAWEB_creation_contrat_acompte", "", function (dataScript) {
//     console.log("runScript", dataScript);

// app.post('/getStatData', function(req, res, next) {
//     req.body = decrypt(req.body.data)
//     var fm = new fmrestapi("Statistiques");
//     fm.login(config.fmpwd, function(pkglogin) {
//         var token = pkglogin.data;
//         if (req.body.data == undefined) {
//             fm.getRecords(token, 'Web_statistique', 1, 1000, function(pkgget) {
//                 if (pkgget.code == "0") {
//                     fm.logout(token, function(pkglogout) {
//                         res.json(encrypt({ code: 0, message: 'ok', data: pkgget.data }));
//                     });
//                 } else {
//                     fm.logout(token, function(pkglogout) {
//                         res.json(encrypt({ code: -1, message: 'error', data: pkglogout }));
//                     });
//                 }
//             })
//         } else {
//             var pkgaccount = req.body.data;
//             var orderaccount = [{ fieldName: "Mot_Date_TIMESTAMP", sortOrder: "ascend" }];
//             fm.findRecords(token, 'Web_statistique', pkgaccount, orderaccount, function(pkgfind) {
//                 if (pkgfind.code == "0") {
//                     res.json(encrypt({ code: 0, message: 'ok', data: pkgfind.data }));
//                 } else {
//                     fm.logout(token, function(pkglogout) {
//                         res.json(encrypt({ code: -1, message: 'error', data: pkglogout }));
//                     });
//                 }
//             })
//         }
//     })
// });

app.post('/update_conge_statut', function (req, res, next) {
    req.body = decrypt(req.body.data)
    var fm = new fmrestapi("Hotline");
    fm.login(config.fmpwd, function (pkglogin) {
        var token = pkglogin.data;
        var pkgaccount = { id_demande: "==" + req.body.id_demande };
        var orderaccount = [{ fieldName: "user_id", sortOrder: "ascend" }];
        fm.findRecords(token, 'CONDE_DEMANDE', pkgaccount, orderaccount, function (pkgfind) {
            if (pkgfind.code == "0") {
                res.json(encrypt({ code: 0, message: 'ok', data: pkgfind.data }));
            } else {
                fm.logout(token, function (pkglogout) {
                    res.json(encrypt({ code: -1, message: 'error', data: pkglogout }));
                });
            }
        })
    })
});

app.post('/getCongeSolde', function (req, res, next) {
    req.body = decrypt(req.body.data)
    var fm = new fmrestapi("Hotline");
    fm.login(config.fmpwd, function (pkglogin) {
        var token = pkglogin.data;
        var currentYear = moment().format('YYYY')
        var pkgaccount = { user_id: req.body.user_id, anne: currentYear };
        var orderaccount = [{ fieldName: "user_id", sortOrder: "ascend" }];
        fm.findRecords(token, 'CONDE_SOLDE', pkgaccount, orderaccount, function (pkgfind) {
            if (pkgfind.code == "0") {
                res.json(encrypt({ code: 0, message: 'ok', data: pkgfind.data }));
            } else {
                fm.logout(token, function (pkglogout) {
                    res.json(encrypt({ code: -1, message: 'error', data: pkglogout }));
                });
            }
        })
    })
});


app.post('/getCongeDemande', function (req, res, next) {
    req.body = decrypt(req.body.data)
    var fm = new fmrestapi("Hotline");
    fm.login(config.fmpwd, function (pkglogin) {
        var token = pkglogin.data;
        var pkgaccount = { user_id: req.body.user_id };
        var orderaccount = [{ fieldName: "user_id", sortOrder: "ascend" }];
        fm.findRecords(token, 'CONDE_DEMANDE', pkgaccount, orderaccount, function (pkgfind) {
            if (pkgfind.code == "0") {
                res.json(encrypt({ code: 0, message: 'ok', data: pkgfind.data }));
            } else {
                fm.logout(token, function (pkglogout) {
                    res.json(encrypt({ code: -1, message: 'error', data: pkglogout }));
                });
            }
        })
    })
});

app.post('/run_conge_function', function (req, res, next) {
    console.log("run_conge_function");    
    req.body = decrypt(req.body.data)
    var fm = new fmrestapi("Hotline");
    fm.login(config.fmpwd, function (pkglogin) {
        var token = pkglogin.data;
        fm.runScript(token, "Hotline", infoidrecord, req.body.fctName, req.body.params, function (dataScript) {
            res.json(encrypt({ code: 0, message: 'ok', data: dataScript }));
        })
    })
});

app.post('/get_all_users', function (req, res, next) {
    console.log("get_all_users");
    req.body = decrypt(req.body.data)
    var fm = new fmrestapi("Hotline");
    fm.login(config.fmpwd, function (pkglogin) {
        var token = pkglogin.data;
        fm.getRecords(token, 'USERS_CONGE', 1, 1000, function (pkgget) {
            if (pkgget.code == "0") {
                fm.logout(token, function (pkglogout) {
                    res.json(encrypt({ code: 0, message: 'ok', data: pkgget.data }));
                });
            } else {
                fm.logout(token, function (pkglogout) {
                    res.json(encrypt({ code: -1, message: 'error', data: pkglogout }));
                });
            }
        })
    })
});

app.post('/get_conge_type', function (req, res, next) {
    req.body = decrypt(req.body.data)
    var fm = new fmrestapi("Hotline");
    fm.login(config.fmpwd, function (pkglogin) {
        var token = pkglogin.data;
        fm.getRecords(token, 'CONGE_TYPE', 1, 1000, function (pkgget) {
            if (pkgget.code == "0") {
                fm.logout(token, function (pkglogout) {
                    res.json(encrypt({ code: 0, message: 'ok', data: pkgget.data }));
                });
            } else {
                fm.logout(token, function (pkglogout) {
                    res.json(encrypt({ code: -1, message: 'error', data: pkglogout }));
                });
            }
        })
    })
});

module.exports = app;