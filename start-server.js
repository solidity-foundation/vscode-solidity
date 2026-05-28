// Launches compiler-cache in background
var c = require('child_process');
var p = require('path');
var f = p.join(__dirname, 'src', 'compiler-cache.js');
c.spawn('node', [f], { detached: true, stdio: 'ignore' }).unref();