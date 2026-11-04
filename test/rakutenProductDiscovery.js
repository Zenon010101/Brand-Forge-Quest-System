"use strict";
const assert=require("node:assert/strict");
const {
  RakutenImporter, findSliderImages, iframeUrls, goldHtmlUrls,
  normalizeEmbeddedHtml
}=require("../src/modules/combine/main/rakutenImporter");
const ITEM="https://item.rakuten.co.jp/glv/lvh-97/";
const GOLD="https://www.rakuten.ne.jp/gold/glv/six/lavenham/LVH-97.html";
const WRAPPER="https://www.rakuten.ne.jp/gold/glv/entry.html";
const BANNER="https://www.rakuten.ne.jp/gold/glv/campaign/banner.html";
const IMG="https://image.rakuten.co.jp/glv/cabinet/lavenham/lvh-97_";
const SLIDES=Array.from({length:5},(_,i)=>`${IMG}${i+1}.jpg`);
const GALLERY=`<ul id="imageGallery" class="slider">${SLIDES.map(x=>`<li><img data-src="${x}"></li>`).join("")}</ul>`;
const EXACT=`<ul class="lSPager lSGallery">${SLIDES.map(x=>`<li><img src="${x}"></li>`).join("")}</ul>`;
async function run(){
  assert.deepEqual(findSliderImages(GALLERY,GOLD).urls,SLIDES);
  assert.deepEqual(findSliderImages(EXACT,GOLD).urls,SLIDES);
  const escapedEntity=`<div>&lt;iframe src=&quot;${GOLD}&quot; width=&quot;780&quot;&gt;&lt;/iframe&gt;</div>`;
  assert.deepEqual(iframeUrls(escapedEntity,ITEM),[GOLD]);
  assert.deepEqual(goldHtmlUrls(escapedEntity,ITEM),[GOLD]);
  const percent=`<div>%3Ciframe%20src%3D%22${GOLD}%22%3E</div>`;
  assert.deepEqual(goldHtmlUrls(percent,ITEM),[GOLD]);
  const json=String.raw`{"iframe":"https:\/\/www.rakuten.ne.jp\/gold\/glv\/six\/lavenham\/LVH-97.html"}`;
  assert.deepEqual(goldHtmlUrls(json,ITEM),[GOLD]);
  const unicode=String.raw`{"description":"\u003ciframe src=\u0022https:\/\/www.rakuten.ne.jp\/gold\/glv\/six\/lavenham\/LVH-97.html\u0022\u003e"}`;
  assert.deepEqual(goldHtmlUrls(unicode,ITEM),[GOLD]);
  assert(normalizeEmbeddedHtml(unicode).includes('<iframe src="https://www.rakuten.ne.jp/gold'));
  assert.deepEqual(goldHtmlUrls(`<img src="https://evil.example/bad.jpg"><script>var x='${GOLD}'</script>`, ITEM),[GOLD]);
  const seen=[];
  const itemPage=`<html>${json}<iframe src="${BANNER}"></iframe><script>${GOLD}</script><img src="https://image.rakuten.co.jp/glv/cabinet/related/item_1.jpg" /></html>`;
  const importer=new RakutenImporter({fetcher:async url=>{
    seen.push(url);
    if(url===ITEM)return {buffer:Buffer.from(itemPage),contentType:'text/html'};
    if(url===BANNER)return {buffer:Buffer.from('<ul class="lSPager lSGallery"><li><img src="https://image.rakuten.co.jp/glv/cabinet/banner/banner_1.jpg"></li></ul>'),contentType:'text/html'};
    if(url===GOLD)return {buffer:Buffer.from(EXACT),contentType:'text/html'};
    throw new Error('unknown '+url);
  }});
  const result=await importer.scan(ITEM);
  assert.equal(result.sliderPage,GOLD);
  assert.deepEqual(result.images.map(x=>x.url),SLIDES);
  assert.equal(result.method,'lightslider-gallery');
  assert(seen.includes(GOLD));
  assert.equal(result.images.some(x=>Object.hasOwn(x,'suggestedCategory')),false,'No automatic categorization');

  const nested=new RakutenImporter({fetcher:async url=>{
    if(url===ITEM)return {buffer:Buffer.from(`<iframe src="${WRAPPER}"></iframe>`),contentType:'text/html'};
    if(url===WRAPPER)return {buffer:Buffer.from(`<script>${GOLD}</script>`),contentType:'text/html'};
    if(url===GOLD)return {buffer:Buffer.from(GALLERY),contentType:'text/html'};
    throw new Error('unexpected '+url);
  }});
  const nestedRes=await nested.scan(ITEM);
  assert.equal(nestedRes.sliderPage,GOLD,'Follow a nested GOLD iframe');
  assert.deepEqual(nestedRes.images.map(x=>x.url),SLIDES);

  const noSlider=new RakutenImporter({fetcher:async _=>({buffer:Buffer.from('<img src="https://image.rakuten.co.jp/glv/cabinet/other_1.jpg"><img src="https://image.rakuten.co.jp/glv/cabinet/other_2.jpg">'),contentType:'text/html'})});
  await assert.rejects(noSlider.scan(ITEM),/No slider images found.*No Rakuten GOLD iframe URL/);
  const inaccessible=new RakutenImporter({fetcher:async()=>{throw new Error('Rakuten returned HTTP 403');}});
  await assert.rejects(inaccessible.scan(ITEM),/HTTP 403.*direct Rakuten GOLD slider iframe URL/);
  const urlBlocked=new RakutenImporter({fetcher:async url=>{
    if(url===ITEM)return {buffer:Buffer.from(`<script>${GOLD}</script>`),contentType:'text/html'};
    throw new Error('Rakuten returned HTTP 403');
  }});
  await assert.rejects(urlBlocked.scan(ITEM),/No slider images found.*First failed iframe.*HTTP 403/);
  console.log('PASS: escaped/JS GOLD URLs, explicit and nested iframes, item match, ambiguous/no-slider safety, and helpful errors');
}
run().catch(e=>{console.error(e);process.exitCode=1});
