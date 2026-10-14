var request = require("request");

class FileMaker {
    constructor(db) {
        this.URL = "https://hotline.accen.me/fmi/data/v1/databases/" + db;
        //this.URL = "https://" + config.filemaker.host + ":" + config.filemaker.port + "/fmi/data/v1/databases/" + db;
        this.IS_PRODUCTION = false;
    }

    login(auth, callback) {
        var options = {
            rejectUnauthorized: this.IS_PRODUCTION,
            method: 'POST',
            url: this.URL + '/sessions',
            headers: {
                'cache-control': 'no-cache',
                'content-type': 'application/json',
                authorization: auth
            }
        };

        request(options, function(error, response, body) {
            console.log("body", body);
            if (error) {
                callback({ code: '-1', message: 'Erreur interne', data: '' });
            } else {
                var info = JSON.parse(body);
                if (info.messages[0].code == 0) {
                    callback({ code: 0, message: 'OK', data: info.response.token });
                } else {
                    callback({ code: info.messages[0].code, message: info.messages[0].message, data: '' });
                }
            }
        });
    }

    logout(token, callback) {

        var options = {
            method: 'DELETE',
            rejectUnauthorized: this.IS_PRODUCTION,
            url: this.URL + '/sessions/' + token,
            headers: {
                'cache-control': 'no-cache'
            }
        };

        request(options, function(error, response, body) {
            if (error) {
                callback({ code: '-1', message: 'Erreur interne', data: '' });
            } else {
                var info = JSON.parse(body);
                if (info.messages[0].code == 0) {
                    callback({ code: '0', message: 'OK', data: info.response });
                } else {
                    callback({ code: info.messages[0].code, message: info.messages[0].message, data: '' });
                }
            }
        });
    }

    createRecord(token, layout, data, portaldata, script, callback) {
        var bbody = {};
        if (script == "") {
            bbody = { fieldData: data, portalData: portaldata };
        } else {
            bbody = { fieldData: data, portalData: portaldata, script: script };
        }
        var url = "";
        url = this.URL + '/layouts/' + layout + '/records';

        var options = {
            method: 'POST',
            rejectUnauthorized: this.IS_PRODUCTION,
            url: url,
            headers: {
                'cache-control': 'no-cache',
                'content-type': 'application/json',
                authorization: 'Bearer ' + token
            },
            body: bbody,
            json: true
        };

        request(options, function(error, response, body) {
            if (error) {
                callback({ code: '-1', message: 'Erreur interne', data: '' });
            } else {
                var info = body;
                if (info.messages[0].code == 0) {
                    callback({ code: '0', message: 'OK', data: info.response });
                } else {
                    callback({ code: info.messages[0].code, message: info.messages[0].message, data: '' });
                }
            }
        });
    }

    editRecords(token, layout, idrecord, data, portaldata, script, callback) {
        var bbody = {};
        if (script == "") {
            bbody = { fieldData: data, portalData: portaldata };
        } else {
            bbody = { fieldData: data, portalData: portaldata, script: script };
        }
        var options = {
            method: 'PATCH',
            rejectUnauthorized: this.IS_PRODUCTION,
            url: this.URL + '/layouts/' + layout + '/records/' + idrecord,
            headers: {
                'cache-control': 'no-cache',
                authorization: 'Bearer ' + token
            },
            body: bbody,
            json: true
        };

        request(options, function(error, response, body) {
            if (error) {
                callback({ code: '-1', message: 'Erreur interne', data: '' });
            } else {
                var info = body;
                if (info.messages[0].code == 0) {
                    callback({ code: '0', message: 'OK', data: info.response });
                } else {
                    callback({ code: info.messages[0].code, message: info.messages[0].message, data: '' });
                }
            }
        });
    }

    setGlobals(token, data, script, callback) {
        var bbody = {};
        if (script == "") {
            bbody = { globalFields: data };
        } else {
            bbody = { globalFields: data, script: script };
        }
        var options = {
            method: 'PATCH',
            rejectUnauthorized: this.IS_PRODUCTION,
            url: this.URL + '/globals',
            headers: {
                'cache-control': 'no-cache',
                'content-type': 'application/json',
                authorization: 'Bearer ' + token
            },
            body: bbody,
            json: true
        };

        request(options, function(error, response, body) {
            if (error) {
                callback({ code: '-1', message: 'Erreur interne', data: '' });
            } else {
                var info = body;
                if (info.messages[0].code == 0) {
                    callback({ code: '0', message: 'OK', data: info.response });
                } else {
                    callback({ code: info.messages[0].code, message: info.messages[0].message, data: '' });
                }
            }
        });
    }

    getRecords(token, layout, start, limit, callback) {
        var options = {
            method: 'GET',
            rejectUnauthorized: this.IS_PRODUCTION,
            url: this.URL + '/layouts/' + layout + '/records',
            qs: { _offset: start, _limit: limit },
            headers: {
                'cache-control': 'no-cache',
                authorization: 'Bearer ' + token
            }
        };

        request(options, function(error, response, body) {
            if (error) {
                callback({ code: '-1', message: 'Erreur interne', data: '' });
            } else {
                var info = JSON.parse(body);
                if (info.messages[0].code == 0) {
                    callback({ code: '0', message: 'OK', data: info.response });
                } else {
                    callback({ code: info.messages[0].code, message: info.messages[0].message, data: '' });
                }
            }
        });
    }

    getRecord(token, layout, idrecord, callback) {
        var options = {
            method: 'GET',
            rejectUnauthorized: this.IS_PRODUCTION,
            url: this.URL + '/layouts/' + layout + '/records/' + idrecord,
            headers: {
                'cache-control': 'no-cache',
                authorization: 'Bearer ' + token
            }
        };

        request(options, function(error, response, body) {
            if (error) {
                callback({ code: '-1', message: 'Erreur interne', data: '' });
            } else {
                console.log(body);
                var info = JSON.parse(body);
                if (info.messages[0].code == 0) {
                    callback({ code: '0', message: 'OK', data: info.response });
                } else {
                    callback({ code: info.messages[0].code, message: info.messages[0].message, data: '' });
                }
            }
        });
    }

    findRecords(token, layout, query, sort, callback) {
        var options = {
            method: 'POST',
            rejectUnauthorized: this.IS_PRODUCTION,
            url: this.URL + '/layouts/' + layout + '/_find',
            headers: {
                'cache-control': 'no-cache',
                'content-type': 'application/json',
                authorization: 'Bearer ' + token
            },
            body: { "query": query, "sort": sort, "offset": "1", "limit": 1000000 },
            json: true
        };

        request(options, function(error, response, body) {
            if (error) {
                callback({ code: '-1', message: 'Erreur interne', data: '' });
            } else {
                var info = body;
                if (info.messages[0].code == 0) {
                    callback({ code: '0', message: 'OK', data: info.response });
                } else {
                    callback({ code: info.messages[0].code, message: info.messages[0].message, data: '' });
                }
            }
        });
    }

    runScript(token, layout, idrecord, script, param, callback) {

        var options = {
            method: 'GET',
            rejectUnauthorized: this.IS_PRODUCTION,
            url: this.URL + '/layouts/' + layout + '/records/' + idrecord,
            qs: { script: script, 'script.param': param },
            headers: {
                'cache-control': 'no-cache',
                authorization: 'Bearer ' + token
            }
        };

        request(options, function(error, response, body) {
            if (error) {
                callback({ code: '-1', message: 'INTERNAL ERROR', data: '' });
            } else {
                var info = JSON.parse(body);
                if (info.messages[0].code == 0) {
                    callback({ code: '0', message: 'OK', data: info.response });
                } else {
                    callback({ code: info.messages[0].code, message: info.messages[0].message, data: '' });
                }
            }
        });
    }
}

module.exports = FileMaker;