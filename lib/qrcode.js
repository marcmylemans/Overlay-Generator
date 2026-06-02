/* ===========================================================================
   qrcode.js — self-contained QR Code generator (byte mode, auto version + ECC)
   Adapted from Nayuki's public-domain QR Code generator reference algorithm.

   UMD: exposes `QRCode` on the browser global and via CommonJS `require`.
   API:  QRCode.encode(text, ecl)  ->  { size:Number, get(x,y):Boolean }
         ecl: 'L' | 'M' | 'Q' | 'H'  (default 'M')
   =========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QRCode = api;
})(typeof self !== 'undefined' ? self : this, function () {
  "use strict";

  var ECC = { L:0, M:1, Q:2, H:3 };

  // ECC codewords per block  [ecl][version]
  var ECC_CW = [
    [-1,7,10,15,20,26,18,20,24,30,18,20,24,26,30,22,24,28,30,28,28,28,28,30,30,26,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30],
    [-1,10,16,26,18,24,16,18,22,22,26,30,22,22,24,24,28,28,26,26,26,26,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28],
    [-1,13,22,18,26,18,24,18,22,20,24,28,26,24,20,30,24,28,28,26,30,28,30,30,30,30,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30],
    [-1,17,28,22,16,22,28,26,26,24,28,24,28,22,24,24,30,28,28,26,28,30,24,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30]
  ];
  // number of error correction blocks [ecl][version]
  var ECC_BLK = [
    [-1,1,1,1,1,1,2,2,2,2,4,4,4,4,4,6,6,6,6,7,8,8,9,9,10,12,12,12,13,14,15,16,17,18,19,19,20,21,22,24,25],
    [-1,1,1,1,2,2,4,4,4,5,5,5,8,9,9,10,10,11,13,14,16,17,17,18,20,21,23,25,26,28,29,31,33,35,37,38,40,43,45,47,49],
    [-1,1,1,2,2,4,4,6,6,8,8,8,10,12,16,12,17,16,18,21,20,23,23,25,27,29,34,34,35,38,40,43,45,48,51,53,56,59,62,65,68],
    [-1,1,1,2,4,4,4,5,6,8,8,11,11,16,16,18,16,19,21,25,25,25,34,30,32,35,37,40,42,45,48,51,54,57,60,63,66,70,74,77,81]
  ];

  function getNumRawDataModules(ver){
    var result = (16*ver+128)*ver+64;
    if(ver>=2){
      var numAlign = Math.floor(ver/7)+2;
      result -= (25*numAlign-10)*numAlign-55;
      if(ver>=7) result -= 36;
    }
    return result;
  }
  function getNumDataCodewords(ver,ecl){
    return Math.floor(getNumRawDataModules(ver)/8) - ECC_CW[ecl][ver]*ECC_BLK[ecl][ver];
  }

  // ---- Galois field arithmetic (GF(256), poly 0x11D) ----
  function gfMul(x,y){
    var z=0;
    for(var i=7;i>=0;i--){
      z = (z<<1) ^ ((z>>>7)*0x11D);
      z ^= ((y>>>i)&1)*x;
    }
    return z & 0xFF;
  }
  function rsDivisor(degree){
    var result=[]; for(var i=0;i<degree;i++) result.push(0);
    result[degree-1]=1;
    var root=1;
    for(var i=0;i<degree;i++){
      for(var j=0;j<result.length;j++){
        result[j]=gfMul(result[j],root);
        if(j+1<result.length) result[j]^=result[j+1];
      }
      root=gfMul(root,0x02);
    }
    return result;
  }
  function rsRemainder(data,divisor){
    var result=divisor.map(function(){return 0;});
    data.forEach(function(b){
      var factor = b ^ result.shift();
      result.push(0);
      divisor.forEach(function(coef,i){ result[i]^=gfMul(coef,factor); });
    });
    return result;
  }

  // ---- bit buffer ----
  function appendBits(bb,val,len){ for(var i=len-1;i>=0;i--) bb.push((val>>>i)&1); }

  function getAlignPositions(ver){
    if(ver===1) return [];
    var numAlign=Math.floor(ver/7)+2;
    var step = (ver===32)?26: Math.ceil((ver*4+4)/(numAlign*2-2))*2;
    var result=[6];
    for(var pos=ver*4+10; result.length<numAlign; pos-=step) result.splice(1,0,pos);
    return result;
  }

  function encode(text, eclName){
    var ecl = ECC[(eclName||'M').toUpperCase()]; if(ecl===undefined) ecl=ECC.M;
    // UTF-8 bytes
    var bytes=[];
    for(var i=0;i<text.length;i++){
      var cp=text.charCodeAt(i);
      if(cp<0x80) bytes.push(cp);
      else if(cp<0x800){ bytes.push(0xC0|(cp>>6),0x80|(cp&0x3F)); }
      else { bytes.push(0xE0|(cp>>12),0x80|((cp>>6)&0x3F),0x80|(cp&0x3F)); }
    }
    // choose version (byte mode)
    var ver;
    for(ver=1; ver<=40; ver++){
      var cap = getNumDataCodewords(ver,ecl)*8;
      var ccBits = (ver<10)?8:16;
      var need = 4 + ccBits + bytes.length*8;
      if(need<=cap) break;
    }
    if(ver>40) throw new Error('Data too long for QR');

    // build data bit stream
    var bb=[];
    appendBits(bb,0x4,4); // byte mode
    var ccBits=(ver<10)?8:16;
    appendBits(bb,bytes.length,ccBits);
    bytes.forEach(function(b){ appendBits(bb,b,8); });
    var dataCap = getNumDataCodewords(ver,ecl)*8;
    appendBits(bb,0,Math.min(4,dataCap-bb.length));
    while(bb.length%8!==0) bb.push(0);
    for(var pad=0xEC; bb.length<dataCap; pad^=0xEC^0x11) appendBits(bb,pad,8);

    // bytes
    var dataCw=[];
    for(var i=0;i<bb.length;i+=8){ var b=0; for(var j=0;j<8;j++) b=(b<<1)|bb[i+j]; dataCw.push(b); }

    // ECC interleave
    var numBlocks=ECC_BLK[ecl][ver];
    var blockEccLen=ECC_CW[ecl][ver];
    var rawCw=Math.floor(getNumRawDataModules(ver)/8);
    var numShort=numBlocks-(rawCw%numBlocks);
    var shortLen=Math.floor(rawCw/numBlocks);
    var blocks=[]; var divisor=rsDivisor(blockEccLen);
    var k=0;
    for(var b=0;b<numBlocks;b++){
      var datLen=shortLen-blockEccLen+((b<numShort)?0:1);
      var dat=dataCw.slice(k,k+datLen); k+=datLen;
      var ecc=rsRemainder(dat,divisor);
      blocks.push({dat:dat,ecc:ecc});
    }
    var result=[];
    for(var i=0;i<shortLen-blockEccLen+1;i++){
      for(var b=0;b<blocks.length;b++){
        if(i<blocks[b].dat.length) result.push(blocks[b].dat[i]);
      }
    }
    for(var i=0;i<blockEccLen;i++){
      for(var b=0;b<blocks.length;b++) result.push(blocks[b].ecc[i]);
    }
    var allCw=result;

    // ---- module grid ----
    var size=ver*4+17;
    var modules=[], isFunc=[];
    for(var y=0;y<size;y++){ modules.push(new Array(size).fill(false)); isFunc.push(new Array(size).fill(false)); }

    function setFunc(x,y,val){ modules[y][x]=val; isFunc[y][x]=true; }
    function drawFinder(x,y){
      for(var dy=-4;dy<=4;dy++) for(var dx=-4;dx<=4;dx++){
        var xx=x+dx, yy=y+dy; if(xx<0||xx>=size||yy<0||yy>=size) continue;
        var dist=Math.max(Math.abs(dx),Math.abs(dy));
        setFunc(xx,yy, dist!==2 && dist!==4);
      }
    }
    function drawAlign(x,y){
      for(var dy=-2;dy<=2;dy++) for(var dx=-2;dx<=2;dx++){
        setFunc(x+dx,y+dy, Math.max(Math.abs(dx),Math.abs(dy))!==1);
      }
    }
    // timing
    for(var i=0;i<size;i++){ setFunc(6,i,i%2===0); setFunc(i,6,i%2===0); }
    // finders
    drawFinder(3,3); drawFinder(size-4,3); drawFinder(3,size-4);
    // alignment
    var ap=getAlignPositions(ver);
    for(var i=0;i<ap.length;i++) for(var j=0;j<ap.length;j++){
      if((i===0&&j===0)||(i===0&&j===ap.length-1)||(i===ap.length-1&&j===0)) continue;
      drawAlign(ap[i],ap[j]);
    }
    // reserve format/version (mark as func, filled later)
    function reserveFormat(){
      for(var i=0;i<=8;i++){ if(i!==6) setFunc(i,8,false); if(i!==6) setFunc(8,i,false); }
      for(var i=size-8;i<size;i++) setFunc(8,i,false);
      for(var i=size-8;i<size;i++) setFunc(i,8,false);
      setFunc(8,size-8,true); // dark module
    }
    reserveFormat();
    if(ver>=7){
      for(var i=0;i<18;i++){ var a=Math.floor(i/3), bb2=size-11+i%3; setFunc(bb2,a,false); setFunc(a,bb2,false); }
    }

    // draw codewords (zigzag)
    var bits=[];
    allCw.forEach(function(cw){ for(var i=7;i>=0;i--) bits.push((cw>>>i)&1); });
    var bi=0;
    for(var right=size-1; right>=1; right-=2){
      if(right===6) right=5;
      for(var vert=0; vert<size; vert++){
        for(var jj=0; jj<2; jj++){
          var x=right-jj;
          var upward=((right+1)&2)===0;
          var y=upward?(size-1-vert):vert;
          if(!isFunc[y][x] && bi<bits.length){ modules[y][x]=bits[bi]!==0; bi++; }
        }
      }
    }

    // mask + format
    function applyMask(mask){
      for(var y=0;y<size;y++) for(var x=0;x<size;x++){
        if(isFunc[y][x]) continue;
        var inv;
        switch(mask){
          case 0: inv=(x+y)%2===0; break;
          case 1: inv=y%2===0; break;
          case 2: inv=x%3===0; break;
          case 3: inv=(x+y)%3===0; break;
          case 4: inv=(Math.floor(x/3)+Math.floor(y/2))%2===0; break;
          case 5: inv=(x*y)%2+(x*y)%3===0; break;
          case 6: inv=((x*y)%2+(x*y)%3)%2===0; break;
          case 7: inv=((x+y)%2+(x*y)%3)%2===0; break;
        }
        if(inv) modules[y][x]=!modules[y][x];
      }
    }
    function drawFormat(mask){
      var fb=[1,0,3,2][ecl];      // format-info ECC indicator (≠ table ordinal)
      var data=fb<<3|mask;
      var rem=data;
      for(var i=0;i<10;i++) rem=(rem<<1)^((rem>>>9)*0x537);
      var bitsF=((data<<10|rem)^0x5412)&0x7FFF;
      for(var i=0;i<=5;i++) modules[i][8]=((bitsF>>>i)&1)!==0;
      modules[7][8]=((bitsF>>>6)&1)!==0;
      modules[8][8]=((bitsF>>>7)&1)!==0;
      modules[8][7]=((bitsF>>>8)&1)!==0;
      for(var i=9;i<15;i++) modules[8][14-i]=((bitsF>>>i)&1)!==0;
      for(var i=0;i<8;i++) modules[8][size-1-i]=((bitsF>>>i)&1)!==0;
      for(var i=8;i<15;i++) modules[size-15+i][8]=((bitsF>>>i)&1)!==0;
      modules[size-8][8]=true;
    }
    function drawVersion(){
      if(ver<7) return;
      var rem=ver;
      for(var i=0;i<12;i++) rem=(rem<<1)^((rem>>>11)*0x1F25);
      var bitsV=ver<<12|rem;
      for(var i=0;i<18;i++){
        var bit=((bitsV>>>i)&1)!==0;
        var a=Math.floor(i/3), b2=size-11+i%3;
        modules[a][b2]=bit; modules[b2][a]=bit;
      }
    }

    function penalty(){
      var p=0;
      // rows & cols runs
      for(var y=0;y<size;y++){
        var run=1;
        for(var x=1;x<size;x++){
          if(modules[y][x]===modules[y][x-1]) run++; else { if(run>=5) p+=3+(run-5); run=1; }
        }
        if(run>=5) p+=3+(run-5);
      }
      for(var x=0;x<size;x++){
        var run=1;
        for(var y=1;y<size;y++){
          if(modules[y][x]===modules[y-1][x]) run++; else { if(run>=5) p+=3+(run-5); run=1; }
        }
        if(run>=5) p+=3+(run-5);
      }
      // 2x2 blocks
      for(var y=0;y<size-1;y++) for(var x=0;x<size-1;x++){
        var c=modules[y][x];
        if(c===modules[y][x+1]&&c===modules[y+1][x]&&c===modules[y+1][x+1]) p+=3;
      }
      // finder-like patterns (1:1:3:1:1 bounded by 4 light) — N3 = 40
      var P1=[true,false,true,true,true,false,true,false,false,false,false];
      var P2=[false,false,false,false,true,false,true,true,true,false,true];
      function matches(arr,i,pat){ for(var t=0;t<11;t++){ if(arr[i+t]!==pat[t]) return false; } return true; }
      for(var y=0;y<size;y++){
        var row=modules[y];
        for(var x=0;x<=size-11;x++){ if(matches(row,x,P1)||matches(row,x,P2)) p+=40; }
      }
      for(var x=0;x<size;x++){
        var col=[]; for(var y=0;y<size;y++) col.push(modules[y][x]);
        for(var y=0;y<=size-11;y++){ if(matches(col,y,P1)||matches(col,y,P2)) p+=40; }
      }
      // dark ratio
      var dark=0; for(var y=0;y<size;y++) for(var x=0;x<size;x++) if(modules[y][x]) dark++;
      var total=size*size;
      var k2=Math.floor((Math.abs(dark*20-total*10)+total-1)/total)-1;
      p+=k2*10;
      return p;
    }

    // try all masks
    var best=-1, bestPenalty=Infinity, bestGrid=null;
    var baseModules = modules.map(function(r){return r.slice();});
    for(var m=0;m<8;m++){
      modules = baseModules.map(function(r){return r.slice();});
      applyMask(m);
      drawFormat(m);
      drawVersion();
      var pen=penalty();
      if(pen<bestPenalty){ bestPenalty=pen; best=m; bestGrid=modules.map(function(r){return r.slice();}); }
    }
    modules=bestGrid;

    return {
      size:size,
      get:function(x,y){ return (x>=0&&x<size&&y>=0&&y<size)?modules[y][x]:false; },
      modules:modules
    };
  }

  return { encode:encode };
});
