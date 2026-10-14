var fs = require('fs');
var { createReadStream, createWriteStream } = require('fs');
var { Encrypt, Decrypt } = require('node-aescrypt');
var mysql = require("mysql2/promise");
var config = require('/home/web-apps-gesn/config');

class Tools {
    constructor() {

    }

    async set_history(ag, ip, method, body, result, response) {
        var customer = "web-apps-deltatemp";
        var project = "Web";
        var ct = await mysql.createConnection({ host: '172.16.1.127', user: 'accen', password: 'einstein', dateStrings: true, decimalNumbers: true });
        await ct.execute("insert into weblog.journal set customer='" + customer + "',project='" + project + "',os='" + ag.os + "',browser='" + ag.browser + " " + ag.version + "',ipaddress='" + ip + "',webmethod='" + method + "',webbody='" + JSON.stringify(body) + "',webresult='" + result + "',webresponse='" + JSON.stringify(response) + "'");
        await ct.close();
    }

    file_encrypt(filename, callback) {
        try {
            var pwd = config.cryptpwd;
            fs.copyFileSync(filename, filename + '.accen');
            fs.unlinkSync(filename);
            const from = createReadStream(filename + '.accen');
            const to = createWriteStream(filename);
            var through = new Encrypt(pwd);

            from.pipe(through).pipe(to)
                .on('error', () => callback(false))
                .on('finish', () => {
                    fs.unlinkSync(filename + '.accen');
                    callback(true);
                });
        } catch (err) {
            callback(false);
        }
    }

    file_decrypt(filename, callback) {
        try {
            var pwd = config.cryptpwd;
            fs.copyFileSync(filename, filename + '.accen');
            const from = createReadStream(filename + '.accen');
            const to = createWriteStream(filename + 'accen');
            const through = new Decrypt(pwd);

            from
                .pipe(through)
                .pipe(to)
                .on('error', () => { callback(false) })
                .on('finish', () => {
                    fs.unlinkSync(filename + '.accen');
                    callback(true);
                });
        } catch (err) {
            callback(false);
        }
    }
}

module.exports = Tools;