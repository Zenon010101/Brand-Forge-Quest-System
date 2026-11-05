"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const src=fs.readFileSync(path.join(__dirname,"../src/modules/slider/jsx/sliderEngine.jsx"),"utf8");
function fn(name) {
  const start=src.indexOf(`function ${name}(`);
  assert(start>=0,`Missing function ${name}`);
  let d=0;
  for(let i=src.indexOf("{",start);i<src.length;i++) {
    if(src[i]==="{")d++;
    if(src[i]==="}")if(!--d)return src.slice(start,i+1);
  }
  throw new Error(`Unclosed ${name}`);
}
const context={};
vm.runInNewContext(fn("computeCutAwarePlacement"),context,{timeout:1500});
const target={left:0,top:0,width:600,height:550};
for(const [w,h,cut] of [
  [400,800,{}], [1200,500,{}], [600,600,{left:true}],
  [800,500,{right:true}], [600,800,{top:true}],
  [600,800,{bottom:true}], [900,1100,{left:true,right:true,top:true,bottom:true}]
]) {
  const p=context.computeCutAwarePlacement(w,h,0,0,600,550,cut);
  const scaledW=w*p.scale,scaledH=h*p.scale;
  assert(scaledW>=599.999 && scaledH>=549.999,
    `Cut Image ${w}x${h} must cover full 600x550, not fit inside: ${scaledW}x${scaledH}`);
  assert(p.left<=0.001 && p.left+scaledW>=599.999);
  assert(p.top<=0.001 && p.top+scaledH>=549.999);
  if(cut.left&&!cut.right)assert.equal(p.left,0,"left cut must stay flush");
  if(cut.right&&!cut.left)assert(Math.abs(p.left+scaledW-600)<0.01,"right cut must stay flush");
  if(cut.top&&!cut.bottom)assert.equal(p.top,0,"top cut must stay flush");
  if(cut.bottom&&!cut.top)assert(Math.abs(p.top+scaledH-550)<0.01,"bottom cut must stay flush");
}
// Exercise the no-cut-analysis fallback as well: JPEGs must maximize too.
let layer={x:20,y:20,width:480,height:960,source:"test.jpg"};
const mock={
  getSliderPlacementBounds: l=>({left:l.x,top:l.y,right:l.x+l.width,bottom:l.y+l.height}),
  analyzeSourceCutEdges:()=>null,
  resizeSliderPlacement:(l,pct)=>{l.width*=pct/100;l.height*=pct/100;},
  translateSliderPlacement:(l,dx,dy)=>{l.x+=dx;l.y+=dy;},
  liftEditablePSDShadowAfterPlacement:()=>{},
  AnchorPosition:{MIDDLECENTER:0},
  computeCutAwarePlacement:context.computeCutAwarePlacement
};
vm.runInNewContext(fn("fitCutLayerToRegion")+"\nfitCutLayerToRegion(layer, null, 0, 0, 600, 550);",
  {...mock,layer},{timeout:1500});
assert(layer.width>=599.999 && layer.height>=549.999,"Fallback must cover visible canvas");
assert(Math.abs(layer.x+(layer.width-600)/2)<.01,"Fallback should be center aligned");
assert.match(src,/var DETAIL_CUT_BOTTOM_WHITE = 50;/);
assert.match(src,/var DETAIL_CUT_HEIGHT = 550;/);
assert.match(src,/applyNonDestructiveCutClip\([\s\S]*?DETAIL_CUT_BOTTOM_WHITE,/,
  "Existing clip must still preserve 50px white bottom");
assert.match(src,/function applyEditablePSDGroupCutClip/,
  "Editable Main+Shadow PSD Cut group must remain available");
assert.match(src,/var CREATIVE_DETAIL_WIDTH = 570;/,
  "Normal Detail safe area must remain unchanged");
console.log("PASS Slider: all Cut Image aspect ratios cover 600x550, side cuts stay flush, JPEG fallback fills, and the 50px white bottom / editable clip remain");
