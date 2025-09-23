'use strict';

const http = require('http');
const url = require('url');
const fs = require('fs');
const ejs = require('ejs');
const path = require('path');
const cluster = require('cluster');
const cpu = require('os').cpus();

const root_dir = path.join(__dirname, '../');
const configFile = fs.readFileSync(root_dir + 'etc/config.json', 'UTF-8');
const mimeFile = fs.readFileSync(root_dir + 'etc/mime.json', 'UTF-8');
const statusFile = fs.readFileSync(root_dir + 'etc/status.json', 'UTF-8');
const statusEjs = fs.readFileSync(root_dir + 'etc/default_page/status.ejs', 'UTF-8');
const indexEjs = fs.readFileSync(root_dir + 'etc/default_page/index.ejs', 'UTF-8');
const indexOfEjs = fs.readFileSync(root_dir + 'etc/default_page/indexof.ejs', 'UTF-8');

//default config value
let config = JSON.parse(configFile);
const mime_type = JSON.parse(mimeFile);
const status_code = JSON.parse(statusFile);
const os = process.platform;

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
        case '-d':
        case '--dir':
            if (value) {
                value = String(value);
                config['document_root'] = value;
            } else {
                console.log("root directory value is not");
                process.exit(0);
            }
            break;
        case '-b':
        case '--basic':
            value = String(value);
            if (value === 'on' || value === 'off') {
                config['BASIC']['status'] = value;
            } else {
                console.log("basic auth status value is on or off");
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
        case '-i':
        case '--indexof':
            value = String(value);
            if (value === 'on' || value === 'off') {
                config['indexof'] = value; 
            } else {
                console.log("indexof status value is on or off");
                process.exit(0);
            }
            break;   
        case '-e':
        case '--escapejs':
            value = String(value);
            if (value === 'on' || value === 'off') {
                config['escapejs'] = value; 
            } else {
                console.log("escapejs status value is on or off");
                process.exit(0);
            }
            break;        
        case '-s':
        case '--show':
            value = String(value);
            if(value === 'config'){
                console.log(JSON.stringify(config, null, '  '));
            }else if(value === 'define'){
                console.log(JSON.stringify(JSON.parse(fs.readFileSync(root_dir + 'etc/define.json', 'UTF-8'), null, '  ')));
            }else{
                console.log("show value is config, define");
            }
            process.exit(0);   
        case '-v':
        case '--version':
            if (config['version']) {
                console.log(config['version']);
            }else{
                console.log("version is not");
            }
            process.exit(0);
        default:
            console.log(`${config['title']} httpd.js options`);
            console.log("-d, --dir : root directory path");
            console.log("-p, --port [80 or 443 or 1024-65535]");
            console.log("-b, --basic [basic auth is on or off]");
            console.log("-e, --escapejs [escapejs validate is on or off]");
            console.log("-i, --indexof [idexof validate is on or off]");
            console.log("-l, --log [log validate is on or off]");
            console.log("-s, --show [config, define]");
            console.log("-v, --version : version check");
            process.exit(0);
    }
}

//full path
if (!config['document_root']) config['document_root'] = root_dir + 'www';
if (!config['LOG']['dir']) config['LOG']['dir'] = root_dir + 'log';
if (!config['BASIC']['dir']) config['BASIC']['dir'] = root_dir + 'etc';
const log_file = `${config['LOG']['dir']}/${config['LOG']['file']}`;
const basic_file = `${config['BASIC']['dir']}/${config['BASIC']['file']}`;

//cluster process
if (cluster.isMaster) {
    for (let i = 0; i < cpu.length; i++) {
        cluster.fork({ msg: `ID${i}` })
            .on("message", msg => console.log(msg));
    }
} else {
    const port = parseInt(config['port']);
    const uid = process.getuid();
    const gid = process.getgroups();

    let Exec = RouteSetting;
    if(config['BASIC']['status'] === "on"){
        const auth = require('http-auth');
        const basic = auth.basic({
            realm: 'Enter username and password.',
            file: basic_file
        }); 
        Exec = basic.check(function(req, res){
                RouteSetting(req, res);
        });
    }

    let server = http.createServer(Exec);

    switch (port) {
        case 443:
            try {
                const SSL_AUTH = {
                    "key": fs.readFileSync(config['ssl_key_file'], 'UTF-8'),
                    "cert": fs.readFileSync(config['ssl_cert_file'], 'UTF-8')
                };
                const https = require('https');
                server = https.createServer(SSL_AUTH, Exec);
            } catch (err) {
                if (err.code === 'ENOENT') {
                    console.error("Can't read ssl files");
                } else {
                    console.error(`${err.name}:${err.code}`);
                }
                process.exit(-1);
            }
        case 80:
            if (process.env.PORT) {
                server.listen(process.env.PORT);
            } else {
                if (uid != 0 || gid[0] != 0) {
                    console.error("Not permission\nPlease root uid or root gid");
                    process.exit(-1);
                }
                if (!config['system_user']) {
                    console.log("Warnings!! Don's exists system_user from config file");
                }
                server.listen(port, function() {
                    process.setuid(config['system_user'] || 'root');
                });
            }
            break;
        default:
            if (port < 1024 || port > 65535) {
                console.log("port error [80 or 443 or 1024-65535]");
                process.exit(-1);
            }
            server.listen(process.env.PORT || port);
    }

    const msg = process.env.msg;
    process.send(`from worker (${msg})`);
    console.log(`PORT=${process.env.PORT || port}\n${config['title']} (${os}) running!`);
}

cluster.on('exit', function(worker, code, signal) {
    console.log('Worker %d died with code/signal %s. Restarting worker...', worker.process.pid, signal || code);
    cluster.fork();
});

//request
function RouteSetting(req, res) {
    try {
        const urldata = url.parse(req.url, true);
        const extname = String(path.extname(urldata.pathname)).toLowerCase();
        const dir = get_directory(req, urldata.pathname);
        const ip = req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',', 2)[0] : req.socket['remoteAddress'];
        const ua = req.headers['user-agent'];
        const pid = process.pid;
        const time = new Date().toISOString();
        const log_data = `[${time}] ${req.headers['host']} ${dir} <= ${ip} ${ua} PID=${pid}\n`;
        let content_type = !extname ? 'text/html' : mime_type[extname] || 'text/plain';
        let encode = content_type.split('/', 2)[0] === 'text' ? 'UTF-8' : null;
        
        if (config['CACHE']['status'] === "on") {
            res.setHeader('Pragma', 'cache');
            res.setHeader('Cache-Control', `max-age=${config['CACHE']['max_age']}`)
        }else{
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Cache-Control','no-cache');
        }
        if (config['LOG']['status'] === "on") {
            fs.appendFile(log_file, log_data, function(err) {
                if (err) console.error("log write error");
            });
        }else{
            console.log(log_data);
        }
        
        fs.readdir(dir, function(err, files) {
            let file, page;
            let index = '';
            let code = 200;
            if (!err) { //dir
                for (let get of files) {
                    if (get == 'index.ejs') {
                        index = get;
                        break;
                    }
                    if (get == 'index.html') {
                        index = get;
                    }
                }
                if (urldata.pathname.slice(-1) != '/') {
                    file = String(dir + '/' + index);
                } else {
                    file = String(dir + index);
                }

                fs.readFile(file, encode, function(err, data) {
                    if (!err) {
                        if (index == 'index.ejs') {
                            if (ejs_render(req, res, data)) return;
                            code = 400;
                            page = status_page(code);
                        } else {
                            page = data;
                        }
                    } else if (urldata.pathname == '/') { //top dir
                        page = ejs.render(indexEjs, { config, dir });
                    } else if (config['indexof'] == 'on') { //index of
                        const list = {
                            "path": urldata.pathname,
                            "os": os,
                            "host": req.headers['host'],
                            "files": files
                        };
                        page = ejs.render(indexOfEjs, { config, list });
                    } else {
                        code = 403;
                        page = status_page(code);
                    }

                    res.writeHead(code, {'Content-Type': 'text/html'});
                    res.end(page);
                });
            } else { //not dir
                file = dir;
                fs.readFile(file, encode, function(err, data) {
                    if (!err) {
                        if (content_type == 'text/html' && extname == '.ejs') { //.ejs
                            if (ejs_render(req, res, data)) return;
                            code = 400;
                            page = status_page(code);
                        } else if (content_type === 'text/javascript' && config['escapejs'] === 'on') { //.js
                            page = escapeJS(data);
                        } else {
                            page = data;
                        }
                    } else if (err.code === 'ENOENT') { //not page
                        content_type = 'text/html';
                        code = 404;
                        page = status_page(code);
                    } else {
                        content_type = 'text/html';
                        code = 400;
                        page = status_page(code);
                    }

                    res.writeHead(code, {'Content-Type': content_type});
                    res.end(page);
                });
            }
        });
    } catch (e) {
        let error = `500 ${status_code['500']}`;
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(error);
        console.error(e.name);
    }
}

function get_directory(req, pathname){
    try{
        let result = "";
        const domain = req.headers['host'].split(':', 2)[0];
        const root = config['VIRTUAL'] && config['VIRTUAL'][domain]['document_root'] ? String(config['VIRTUAL'][domain]['document_root']) : String(config['document_root']);
        if(fs.existsSync(root)){
            const fullpath = path.join(root, path.normalize(pathname));
            const relative = path.relative(root, fullpath);
            if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
                result = String(fullpath);
            }
        }
        return result;
    }catch(e){
        console.error(e.name + "=get directory error");
        return null;
    }
}

function ejs_render(req, res, page) {
   try {
        const POST = [];
        const GET = request_get(url.parse(req.url, true).search);
        const COOKIE = get_cookie(req.headers['cookie']);
        const DEFINE = JSON.parse(fs.readFileSync(root_dir + 'etc/define.json', 'UTF-8'));
        const SECURE = config['escapehtml'] && config['escapehtml'] === 'on';
        DEFINE['response'] = res;
        
        const locals = {
            POST: SECURE ? sanitizeObject(POST) : POST,
            GET: SECURE ? sanitizeObject(GET) : GET,
            COOKIE: SECURE ? sanitizeObject(COOKIE) : COOKIE,
            DEFINE
        };

        if (req.method === 'POST') {
            let data = '';
            req.on('data', chunk => data += chunk)
            .on('end', () => {
                if(data && req.headers['content-type']){
                    if(req.headers['content-type'].indexOf('application/x-www-form-urlencoded') !== -1){
                        decodeURIComponent(data).split('&').forEach(out => {
                            let key = out.split('=')[0].trim();
                            let value = out.split('=')[1].replace(/\+/g, ' ').trim();
                            POST[key] = value;
                        });
                    }else if(req.headers['content-type'].indexOf('application/json') !== -1){
                        const json = JSON.parse(data);
                        for(let key in json){
                            POST[key] = json[key];
                        }
                    }
                }

                page = ejs.render(page, locals);
                res.writeHead(200, {'Content-Type': 'text/html'});
                res.end(page);
            });
        } else {
            page = ejs.render(page, locals);
            res.writeHead(200, {'Content-Type': 'text/html'});
            res.end(page);
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

function sanitizeObject(obj) {
    const out = {};
    for (let key in obj) {
        out[key] = escapeHTML(obj[key]);
    }
    return out;
}

function escapeHTML(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function escapeJS(code) {
    try {
        code = code.replace(/\/\*[\s\S]*?\*\//g, "");
        code = code.replace(/(^|[^:])\/\/.*$/gm, "$1");
        code = code.replace(/\s{2,}/g, " ")  
        .replace(/\n\s*/g, "");  
        
        return code.trim();
    } catch (err) {
        console.error("escapeJS error:", err);
        return code; 
    }
}
