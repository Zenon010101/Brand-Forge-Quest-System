"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {iframeUrl,discoverImages,splitImages,generateSnippet,standaloneHtml,decodePage}=require("../src/modules/combine/main/iframeHtml");
const {IframeBatchService,getEntries,buildResultsSheet}=require("../src/modules/combine/main/iframeBatchService");
const {validateImageState,validatePageHeight,WIDTH}=require("../src/modules/combine/main/iframeJpegRenderer");
const {legacyCombineJpegHtml}=require("../src/modules/combine/main/iframeJpegLayout");
assert.equal(WIDTH,600);
assert.equal(validatePageHeight(1800),1800);
assert.throws(()=>validatePageHeight(55000),/exceeds/);
validateImageState({total:13,loaded:13,failed:0},13);
assert.throws(()=>validateImageState({total:13,loaded:12,failed:1,failedUrls:[imageFake()]},13),/did not load/);
function imageFake(){return "https://image.rakuten.co.jp/glv/broken.jpg";}

const sourceUrl="https://www.rakuten.ne.jp/gold/glv/six/tenera/TNR-90.html";
const frame=`<iframe src="${sourceUrl}" scrolling="no" frameborder="0" width="780" height="610"></iframe>`;
const image=i=>`https://image.rakuten.co.jp/glv/cabinet/secrid/sec-84_${i}.jpg`;
const markup=(hasHeading=true)=>`<html><body><table>${Array.from({length:3},(_,i)=>`<tr><td><img src="${image(i+1)}"></td></tr>`).join("")}</table>`+
    (hasHeading?"<h2>DETAILS</h2>":"")+`<table>${Array.from({length:10},(_,i)=>`<tr><td><img src="${image(i+4)}"></td></tr>`).join("")}</table></body></html>`;
const html=markup();
assert.equal(iframeUrl(frame),sourceUrl);
assert.equal(iframeUrl(sourceUrl),sourceUrl);
assert.throws(()=>iframeUrl('<iframe src="file:///C:/Windows/system32/x.html"></iframe>'),/Only public HTTPS|GOLD/i);
assert.throws(()=>iframeUrl('<iframe src="https://evil.example/test.html"></iframe>'),/Only public HTTPS|GOLD/i);
assert.throws(()=>iframeUrl('<iframe src="https://www.rakuten.ne.jp.evil.test/gold/x.html"></iframe>'),/Only public HTTPS|GOLD/i);
const discovery=discoverImages(html,sourceUrl);
assert.equal(discovery.images.length,13);
assert.equal(discovery.images[0].url,image(1));
const split=splitImages(discovery,{defaultLineupCount:4});
assert.equal(split.lineupCount,3);
assert.equal(split.detailsCount,10);
assert.equal(split.method,"source-details-heading");
const snippet=generateSnippet(split);
assert.equal((snippet.match(/<img\b/g)||[]).length,13);
assert.equal((snippet.match(/<table\b/g)||[]).length,3);
assert.match(snippet,/width="380"/);
assert.match(snippet,/width="250"/);
assert.match(snippet,/font-size:28px/);
assert(snippet.indexOf(image(3))<snippet.indexOf("DETAILS"));
assert(snippet.indexOf("DETAILS")<snippet.indexOf(image(4)));
assert.match(snippet,/\r\n    <td><\/td>\r\n/);
assert.match(standaloneHtml(snippet),/^<!doctype html>/);
const legacy=legacyCombineJpegHtml(split);
assert.match(legacy, /width:600px/);
assert.match(legacy, /grid-template-columns:293px 293px/);
assert.match(legacy, /font-size:28px/);
assert.match(legacy, /bf-lineup-slot/);
assert.match(legacy, /bf-details-slot/);
assert.equal((legacy.match(/<img\b/g)||[]).length,13);
assert.equal((legacy.match(/bf-lineup-slot"/g)||[]).length,3);
assert.equal((legacy.match(/bf-details-slot"/g)||[]).length,10);
assert.equal((legacy.match(/class="bf-row"/g)||[]).length,7); // 2 Line Up rows + 5 Detail rows
assert(legacy.indexOf(image(3))<legacy.indexOf("DETAILS"));
assert(legacy.indexOf("DETAILS")<legacy.indexOf(image(4)));
assert(!legacy.includes('width="380"') && !legacy.includes('width="250"'));
assert.match(legacy, /bf-empty/); // last odd Line Up remains in left slot
assert.match(legacyCombineJpegHtml({lineup:[],details:[image(1)]}),/DETAILS/);
assert(!legacyCombineJpegHtml({lineup:[image(1)],details:[]}).includes('<h2>DETAILS</h2>'));
assert.throws(()=>legacyCombineJpegHtml({lineup:["file:///C:/private.jpg"]}),/invalid/);
const noHeading=discoverImages(markup(false),sourceUrl);
const fallback=splitImages(noHeading,{defaultLineupCount:3});
assert.equal(fallback.method,"default-review");
assert(fallback.warnings.some(x=>x.includes("No reliable DETAILS boundary")));
const manual=splitImages(noHeading,{lineupCount:5,defaultLineupCount:3});
assert.equal(manual.lineupCount,5);
assert.equal(manual.method,"manual");
assert.throws(()=>splitImages(noHeading,{lineupCount:50}),/Line Up Count/);
assert.equal(decodePage(Buffer.from("<html>HELLO</html>"),"text/html; charset=utf-8"),"<html>HELLO</html>");
const service=new IframeBatchService({fetcher:async url=>({buffer:Buffer.from(html),contentType:"text/html; charset=utf-8"})});

// Minimal mock for the ExcelJS object model; verifies the batching control flow
// without pretending that the actual ExcelJS binary writer can be tested offline.
class MockCell {constructor(value=null){this.value=value;this.font={};}get text(){return this.value==null?"":String(this.value);}}
class MockRow {
    constructor(values=[]){this.cells=new Map(values.map((v,i)=>[i+1,new MockCell(v)]));this.height=20;}
    get cellCount(){return this.cells.size?Math.max(...this.cells.keys()):0;}
    getCell(col){if(!this.cells.has(col))this.cells.set(col,new MockCell());return this.cells.get(col);}
    commit(){}
}
class MockSheet {
    constructor(name,rows=[]){this.name=name;this.rows=rows.map(r=>new MockRow(r));this.columns=[];this.id=Math.floor(Math.random()*1e7);}
    get rowCount(){return this.rows.length;}
    get columnCount(){return Math.max(1,...this.rows.map(r=>r.cellCount));}
    getRow(index){while(this.rows.length<index)this.rows.push(new MockRow());return this.rows[index-1];}
    eachRow(fn){this.rows.forEach((r,i)=>{if(r.cellCount)fn(r,i+1);});}
    spliceColumns(start,deleteCount,...inserts){
        for(let r=0;r<this.rows.length;r++){
            const row=this.rows[r],replaced=new Map();
            for(const [col,cell] of row.cells){
                if(col<start)replaced.set(col,cell);
                else if(col>=start+deleteCount)replaced.set(col+inserts.length-deleteCount,cell);
            }
            for(let c=0;c<inserts.length;c++){
                const value=inserts[c]?.[r];
                if(value!==null&&value!==undefined)replaced.set(start+c,new MockCell(value));
            }
            row.cells=new Map([...replaced].sort((a,b)=>a[0]-b[0]));
        }
    }
    getCell(a1){const m=/^([A-Z]+)(\d+)$/.exec(a1);const col=[...m[1]].reduce((a,c)=>a*26+c.charCodeAt(0)-64,0);return this.getRow(Number(m[2])).getCell(col);}
    getColumn(idx){if(!this.columns[idx-1])this.columns[idx-1]={};return this.columns[idx-1];}
}
class MockBook {
    constructor(){this.worksheets=[new MockSheet("Input",[
        ["Iframe", "Lineup Count"],[frame,3],[frame,4],["<iframe src='https://evil.example/bad.html'></iframe>",2]
    ])];this.xlsx={readFile:async()=>{},writeFile:async file=>{
        await fs.promises.writeFile(file,JSON.stringify(this.worksheets.map(ws=>({name:ws.name,rows:ws.rows.map(row=>Array.from({length:row.cellCount},(_,i)=>row.getCell(i+1).value))}))),"utf8");
    }};}
    getWorksheet(name){return this.worksheets.find(ws=>ws.name===name);}
    removeWorksheet(id){this.worksheets=this.worksheets.filter(ws=>ws.id!==id);}
    addWorksheet(name){const ws=new MockSheet(name);this.worksheets.push(ws);return ws;}
}
(async()=>{
    const d=getEntries(new MockBook());
    assert.equal(d.items.length,3);
    const big=new MockBook();
    for(let x=0;x<1000;x++)big.worksheets[0].rows.push(new MockRow([frame,3]));
    assert.equal(getEntries(big).items.length,1003, "1000 additional input iframe rows should scan without truncation");
    assert.equal(d.items[0].lineupCount,3);
    assert.equal(d.items[1].lineupCount,4);
    assert.match(d.items[2].inputError,/Only public HTTPS|GOLD/);
    const preview=await service.processIframe(frame,{defaultLineupCount:4});
    assert.equal(preview.status,"READY");
    assert.equal(preview.lineupCount,3);
    assert.match(preview.document,/width="780"/);
    assert.match(preview.jpegDocument,/width:600px/);
    assert.match(preview.jpegDocument,/bf-details-slot/);
    const root=await fs.promises.mkdtemp(path.join(os.tmpdir(),"bf-html-test-"));
    try {
        const input=path.join(root,"input.xlsx");await fs.promises.writeFile(input,"placeholder");
        let captures=0,closes=0;
        const rendererFactory=()=>({
            async capture(htmlFile,jpegFile,{expectedImages,renderHtml}) {
                assert.equal(expectedImages,13);
                const published=await fs.promises.readFile(htmlFile,"utf8");
                assert.match(published,/width="780"/);
                assert.match(published,/width="250"/); // Published HTML remains 3 columns
                assert.match(renderHtml,/width:600px/);
                assert.match(renderHtml,/grid-template-columns:293px 293px/);
                assert.match(renderHtml,/font-size:28px/);
                assert(!renderHtml.includes('width="250"'));
                assert.equal((renderHtml.match(/<img\b/g)||[]).length,expectedImages);
                await fs.promises.writeFile(jpegFile,Buffer.from([0xff,0xd8,0xff,0xd9]));
                captures++;
            },
            async close(){closes++;}
        });
        const result=await new IframeBatchService({fetcher:service.fetcher,excelFactory:()=>new MockBook(),rendererFactory})
            .generateExcel({inputPath:input,outputFolder:root});
        assert.equal(result.total,3);
        assert.equal(result.ready,2);
        assert.equal(result.failed,1);
        assert.equal(result.generatedFiles,2);
        assert.equal(result.generatedJpegs,2);
        assert.equal(result.jpegErrors,0);
        assert.equal(captures,2);
        assert.equal(closes,1);
        assert.equal((await fs.promises.readdir(path.join(result.outputFolder,"JPEG_FILES"))).length,2);
        const files=await fs.promises.readdir(path.join(result.outputFolder,"HTML_FILES"));
        assert.equal(files.length,2);
        assert.match(await fs.promises.readFile(path.join(result.outputFolder,"HTML_FILES",files[0]),"utf8"),/font-size:28px/);
        const report=JSON.parse(await fs.promises.readFile(path.join(result.outputFolder,"BATCH_REPORT.json"),"utf8"));
        assert.equal(report.imageBytesDownloaded,0);
        assert.equal(report.jpegLayout,"legacy-combine-600px-2col-lineup-2col-details");
        const mockWorkbook=JSON.parse(await fs.promises.readFile(result.excelPath,"utf8"));
        assert.equal(mockWorkbook.some(s=>s.name==="HTML_RESULTS"),false,"must not generate a separate results sheet");
        const inputSheet=mockWorkbook.find(s=>s.name==="Input");
        assert.equal(inputSheet.rows[0][0],"Iframe");
        assert.equal(inputSheet.rows[0][1],"OUTPUT");
        assert.equal(inputSheet.rows[0][2],"HTML FILE LINK");
        assert.equal(inputSheet.rows[0][3],"JPEG FILE LINK");
        assert.equal(inputSheet.rows[0][4],"Lineup Count","preexisting B column must shift safely to E");
        assert.equal(inputSheet.rows[1][0],frame,"keep exact iframe in same source row");
        assert.match(inputSheet.rows[1][1],/<table width="780"/);
        assert.match(inputSheet.rows[1][2].hyperlink,/^file:\/\/\//);
        assert.match(inputSheet.rows[1][3].hyperlink,/^file:\/\/\//);
        assert.equal(inputSheet.rows[1][4],3,"keep manual Lineup Count in the same row");
        assert.equal(inputSheet.rows[2][4],4);
        assert.equal(inputSheet.rows[3][1],"","failed iframe should not have stale HTML code");
        assert.equal(inputSheet.rows[3][2],null,"failed iframe should not have HTML file link");
        assert.equal(inputSheet.rows[3][3],null,"failed iframe should not have JPEG file link");
        // Screenshot layout: keep existing OUTPUT column B and reuse blank C.
        const screenshot=new MockBook();
        screenshot.worksheets=[new MockSheet("Screenshot",[["IFRAME","OUTPUT"],[frame,"old html"],[null,null],[frame,"old html"]])];
        buildResultsSheet(screenshot,[
            {raw:frame,sourceRow:2,sourceSheet:"Screenshot",code:snippet,filePath:path.join(root,"a.html"),status:"READY",lineupCount:3,detailsCount:10,method:"manual"},
            {raw:frame,sourceRow:4,sourceSheet:"Screenshot",code:snippet,filePath:path.join(root,"b.html"),status:"READY",lineupCount:3,detailsCount:10,method:"manual"}
        ]);
        const shot=screenshot.worksheets[0];
        assert.equal(shot.getRow(1).getCell(1).value,"IFRAME");
        assert.equal(shot.getRow(1).getCell(2).value,"OUTPUT");
        assert.equal(shot.getRow(1).getCell(3).value,"HTML FILE LINK");
        assert.equal(shot.getRow(1).getCell(4).value,"JPEG FILE LINK");
        assert.equal(shot.getRow(2).getCell(2).value,snippet);
        assert.equal(shot.getRow(3).getCell(2).value,null,"blank input row must remain blank");
        assert.equal(shot.getRow(4).getCell(2).value,snippet);
        const unrelated=new MockBook();
        unrelated.worksheets=[new MockSheet("Custom",[["IFRAME","Product SKU","Reviewer Note"],[frame,"SKU123","Keep this"]])];
        buildResultsSheet(unrelated,[{raw:frame,sourceRow:2,sourceSheet:"Custom",code:snippet,filePath:path.join(root,"c.html"),status:"READY",lineupCount:3,detailsCount:10,method:"manual"}]);
        assert.equal(unrelated.worksheets[0].getRow(2).getCell(5).value,"SKU123","never overwrite existing SKU column");
        assert.equal(unrelated.worksheets[0].getRow(2).getCell(6).value,"Keep this","never overwrite existing reviewer column");
        // A renderer error keeps HTML code and the HTML file, but flags REVIEW
        // and must not create a fake JPEG link.
        const broken=new MockBook();
        broken.worksheets=[new MockSheet("Broken",[["IFRAME"],[frame]])];
        const brokenBatch=await new IframeBatchService({
            fetcher:service.fetcher,excelFactory:()=>broken,
            rendererFactory:()=>({capture:async()=>{throw new Error("Remote image returned HTTP 403");},close:async()=>{}})
        }).generateExcel({inputPath:input,outputFolder:root});
        assert.equal(brokenBatch.generatedFiles,1);
        assert.equal(brokenBatch.generatedJpegs,0);
        assert.equal(brokenBatch.jpegErrors,1);
        assert.equal(brokenBatch.review,1);
        const errXlsx=JSON.parse(await fs.promises.readFile(brokenBatch.excelPath,"utf8"));
        const errRow=errXlsx[0].rows[1];
        assert.match(errRow[1],/<table width="780"/);
        assert.equal(errRow[3],null);
        assert(errRow.some(v=>typeof v==="string"&&v.includes("HTTP 403")));
        const noHeader=new MockBook();
        noHeader.worksheets=[new MockSheet("Plain",[[frame],[frame]])];
        buildResultsSheet(noHeader,[{raw:frame,sourceRow:1,sourceSheet:"Plain",code:snippet,status:"READY",lineupCount:3,detailsCount:10,method:"manual"}]);
        assert.equal(noHeader.worksheets[0].getRow(1).getCell(1).value,frame,"support headerless list");
        assert.equal(noHeader.worksheets[0].getRow(1).getCell(2).value,snippet);
    } finally {await fs.promises.rm(root,{recursive:true,force:true});}
    console.log("Combine HTML 780px (2+3) + legacy JPEG 600px (2+2), 13 images, Excel adjacency, errors and column protection passed.");
})().catch(error=>{console.error(error);process.exitCode=1;});
