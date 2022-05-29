"use strict";
const http = require('http');
const url = require('url');
const fs = require('fs');
const ejs = require('ejs');
const path = require('path');

const configFile = fs.readFileSync('etc/config.json', 'UTF-8');
const mimeFile = fs.readFileSync('etc/mime.json', 'UTF-8');
const statusFile = fs.readFileSync('etc/status.json', 'UTF-8');
const statusEjs = fs.readFileSync('etc/default_page/status.ejs', 'UTF-8');
const indexEjs = fs.readFileSync('etc/default_page/index.ejs', 'UTF-8');

//default config value
let config = JSON.parse(configFile);
const mime_type = JSON.parse(mimeFile);
const status_code = JSON.parse(statusFile);
const log_file = config['LOG']['dir'] + '/access.log';

//config option
for (let i = 2; i < process.argv.length; i += 2) {
    let value = process.argv[i + 1];
    switch (process.argv[i]) {
        case '-p':
        case '--port':
            value = parseInt(value);
            if (value && 0 < value) {
                config['port'] = value;
            } else {
                console.log("invalid port number");
                process.exit(0);
            }
            break;
        case '-e':
        case '--escapejs':
            value = String(value);
            if (value === 'on' || value === 'off') {
                config['escapejs'] = value;
            } else {
                console.log("escape value is on or off");
                process.exit(0);
            }
            break;
        case '-l':
        case '--log':
            value = String(value);
            if (value === 'on' || value === 'off') {
                config['LOG']['status'] = value;
            } else {
                console.log("log status value is on or off");
                process.exit(0);
            }
            break;
        case '-v':
        case '--version':
            if (config['version']) {
                console.log(config['version']);
                process.exit(0);
            }
            break;
        default:
            console.log(`${config['title']} httpd.js options`);
            console.log("-v, --version : version check");
            console.log("-p, --port [80 or 443 or 1024-65535]");
            console.log("-e, --escapejs [escapejs validate is on or off]");
            console.log("-l, --log [log validate is on or off]");
            process.exit(0);
    }
}

let server = http.createServer(RouteSetting);
const port = parseInt(config['port']);
const uid = process.getuid();
const gid = process.getgroups();
switch (port) {
    case 443:
        const https = require('https');
        try {
            const SSL_AUTH = {
                "key": fs.readFileSync(config['ssl_key_file'], 'UTF-8'),
                "cert": fs.readFileSync(config['ssl_cert_file'], 'UTF-8')
            };
            server = https.createServer(SSL_AUTH, RouteSetting);
        } catch (err) {
            if (err.code === 'ENOENT') {
                console.error("Can't read ssl files");
            } else {
                console.error(`${err.name}:${err.code}`);
            }
            process.exit(-1);
        }
    case 80:
        if (uid != 0 || gid[0] != 0) {
            console.error("Not permission\nPlease root uid or root gid");
            process.exit(-1);
        }
        if (!config['system_user']) {
            console.log("Warnings!! Don's exists system_user from config file");
        }
        server.listen(port, function() {
            process.setuid(config['system_user'] || 'www');
            console.log("root(0) -> child");
        });
        break;
    default:
        if (port < 1024 || port > 65535) {
            console.log("port error [80 or 443 or 1024-65535]");
            process.exit(-1);
        }
        server.listen(process.env.PORT || port);
}

console.log(`PID=${process.pid}`);
console.log(`PORT=${port}\n${config['title']} running!`);


//request
function RouteSetting(req, res) {
    try {
        const urldata = url.parse(req.url, true);
        const extname = String(path.extname(urldata.pathname)).toLowerCase();
        const POST = [];
        const GET = request_get(urldata.search);
        const COOKIE = get_cookie(req.headers['cookie']);
        const DEFINE = JSON.parse(fs.readFileSync('etc/define.json', 'UTF-8'));
        let content_type = !extname ? 'text/html' : mime_type[extname] || 'text/plain';
        let encode = content_type.split('/', 2)[0] === 'text' ? 'UTF-8' : null;
        let file, page;

        if (config['LOG']['status'] == 'on') {
            const ip = req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',', 2)[0] : req.socket['remoteAddress'];
            const ua = req.headers['user-agent'];
            const log_data = `${urldata.href} <= ${ip} ${ua}\n`;
            fs.appendFile(log_file, log_data, function(err) {
                if (err) {
                    console.error("log write error");
                }
            });
        }
        if (urldata.pathname == '/') { //index
            let index = '';
            fs.readdir(config['root_dir'], function(err, files) {
                if (err) throw err;
                for (let get of files) {
                    if (get == 'index.ejs') {
                        index = get;
                        break;
                    }
                    if (get == 'index.html') {
                        index = get;
                    }
                }
                file = config['root_dir'] + urldata.path + index;
                fs.readFile(String(file), encode, function(err, data) {
                    if (!err) {
                        if (index == 'index.ejs') {
                            if (ejs_render(req, res, data, POST, GET, COOKIE, DEFINE)) return;
                            page = status_page(400);
                        } else {
                            page = data;
                        }
                    } else {
                        page = ejs.render(indexEjs, { config });
                    }
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.write(page);
                    res.end();
                });
            });
        } else {
            file = config['root_dir'] + urldata.path;
            fs.readFile(String(file), encode, function(err, data) {
                if (!err) {
                    if (content_type == 'text/html' && extname == '.ejs') { //.ejs
                        if (ejs_render(req, res, data, POST, GET, COOKIE, DEFINE)) return;
                        page = status_page(400);
                    } else if (content_type === 'text/javascript' && config['escapejs'] === 'on') { //.js
                        page = escapeJS(data);
                    } else {
                        page = data;
                    }
                } else if (err.code === 'ENOENT') { //not page
                    content_type = 'text/html';
                    page = status_page(404);
                } else {
                    content_type = 'text/html';
                    page = status_page(400);
                }
                res.writeHead(200, { 'Content-Type': content_type });
                res.write(page);
                res.end();
            });
        }
    } catch (e) {
        let error = `500 ${status_code['500']}\n${e.name}`;
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(error);
        console.error(error);
    }
}

function ejs_render(req, res, page, POST, GET, COOKIE, DEFINE) {
    try {
        const response = res;
        if (req.method === 'POST') {
            let data = '';
            req.on('data', function(chunk) {
                data += chunk;
            }).on('end', function() {
                if (data) {
                    decodeURIComponent(data).split('&').forEach(function(out) {
                        let key = out.split('=')[0].trim();
                        let value = out.split('=')[1].replace(/\+/g, ' ').trim();
                        POST[key] = value;
                    });
                }
                page = ejs.render(page, { response, POST, GET, COOKIE, DEFINE });
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.write(page);
                res.end();
            });
        } else { //GET
            page = ejs.render(page, { response, POST, GET, COOKIE, DEFINE });
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.write(page);
            res.end();
        }
        return true;
    } catch (e) {
        console.error(e.name);
        return false;
    }
}

function request_get(data) {
    try {
        const array = [];
        if (data) {
            data = decodeURIComponent(data).split('?')[1];
            if (data) {
                data.split('&').forEach(function(out) {
                    let key = out.split('=')[0].trim();
                    let value = out.split('=')[1].trim();
                    array[key] = value;
                });
            }
        }
        return array;
    } catch (e) {
        console.error(e.name);
        return [];
    }
}

function get_cookie(data) {
    try {
        const array = [];
        if (data) {
            decodeURIComponent(data).split(';').forEach(function(out) {
                let key = out.split('=')[0].trim();
                let value = out.split('=')[1].trim();
                array[key] = value;
            });
        }
        return array;
    } catch (e) {
        console.error(e.name);
        return [];
    }
}

function status_page(code) {
    code = String(code);
    for (let i in status_code) {
        if (i === code) {
            return ejs.render(statusEjs, {
                config,
                'STATUS': `${code} ${status_code[code]}`
            });
        }
    }
    return null;
}

function escapeJS(e) {
    return e.replace(/^\/\/.*|\s\/\/.*/g, "")
        .replace(/  /g, "")
        .replace(/\n/g, "");
}