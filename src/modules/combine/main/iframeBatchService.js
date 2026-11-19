"use strict";

// Batch HTML-only Combine for Excel-driven Rakuten GOLD iframe work. No Photoshop
// or image-binary downloads. Original workbook is never overwritten.
const fs=require("fs");
const path=require("path");
const {getUrlBuffer}=require("./rakutenImporter");
const {iframeUrl,discoverImages,splitImages,generateSnippet,standaloneHtml,outputStem,decodePage}=require("./iframeHtml");
const {legacyCombineJpegHtml}=require("./iframeJpegLayout");
const MAX_ROWS=15000;
const MAX_EXCEL_CELL=32767;
const SHEET="HTML_RESULTS";
const COLUMNS=[
    {header:"IFRAME",key:"iframe",width:70},
    {header:"OUTPUT",key:"code",width:90},
    {header:"HTML FILE LINK",key:"link",width:50},
    {header:"JPEG FILE LINK",key:"jpeg",width:50}
];
const QC_HEADERS=["STATUS","JPEG STATUS","DETECTED LINE UP","DETECTED DETAILS","SPLIT METHOD","REVIEW / ERROR"];

function cellText(cell) {
    const value=cell?.value;
    if (typeof value==="string") return value.trim();
    if (value && typeof value==="object") {
        if (typeof value.text==="string") return value.text.trim();
        if (value.result != null) return String(value.result).trim();
        if (Array.isArray(value.richText)) return value.richText.map(p=>p.text||"").join("").trim();
    }
    return (cell?.text||"").trim();
}
function looksLikeIframe(raw) {
    return /<iframe\b/i.test(raw)||/^https:\/\/(?:www\.)?rakuten\.ne\.jp\/gold\//i.test(raw);
}
function findInputSheet(workbook) {
    let best={score:0};
    for(const ws of workbook.worksheets) {
        if (ws.name===SHEET) continue;
        const candidateCols=new Map();
        ws.eachRow((row,idx)=>{
            if (idx>MAX_ROWS+25) return;
            const end=Math.min(row.cellCount,60);
            for (let col=1;col<=end;col++) {
                const raw=cellText(row.getCell(col));
                if (looksLikeIframe(raw)) candidateCols.set(col,(candidateCols.get(col)||0)+1);
            }
        });
        for (const [col,count] of candidateCols) if(count>best.score) best={ws,col,score:count};
    }
    if (!best.ws) throw new Error("No iframe blocks found. Paste full <iframe ...></iframe> into the input Excel worksheet.");
    return best;
}
function findOverrideColumn(ws,iframeCol) {
    for(let row=1;row<=Math.min(5,ws.rowCount);row++) {
        for(let col=1;col<=Math.min(60,ws.columnCount||60);col++) {
            const v=cellText(ws.getRow(row).getCell(col));
            if (/^(?:line\s*up|lineup)\s*(?:image\s*)?(?:count|#|images)$/i.test(v)) return col;
        }
    }
    // A simple 2-column template may include an integer alongside each iframe.
    // But never infer it when there is unrelated business data next to the iframe.
    return null;
}
function resultsOverrides(workbook) {
    const ws=workbook.getWorksheet(SHEET);
    const map=new Map();
    if (!ws) return map;
    for(let idx=2;idx<=ws.rowCount;idx++) {
        const r=ws.getRow(idx);
        const source=Number(r.getCell(9).value);
        const url=cellText(r.getCell(10));
        const current=Number(r.getCell(5).value);
        const method=cellText(r.getCell(7));
        if (!Number.isInteger(source)||!url||!Number.isInteger(current)) continue;
        // For previously automatic splits, retain REVIEW until the user edits the count.
        const lastDetected=cellText(r.getCell(12)); // optional private review marker (future-safe)
        map.set(`${source}::${url}`,{count:current,method,lastDetected});
    }
    return map;
}
function getEntries(workbook) {
    const {ws,col,score}=findInputSheet(workbook);
    const countColumn=findOverrideColumn(ws,col);
    const previous=resultsOverrides(workbook);
    const items=[];
    for(let idx=1;idx<=ws.rowCount;idx++) {
        if (items.length>=MAX_ROWS) throw new Error(`More than ${MAX_ROWS} iframes. Split the input workbook into smaller batches.`);
        const raw=cellText(ws.getRow(idx).getCell(col));
        if (!looksLikeIframe(raw)) continue;
        const item={raw,sourceRow:idx,sourceSheet:ws.name,inputColumn:col,lineupCount:null};
        try { item.url=iframeUrl(raw); }
        catch (error) { item.inputError=error.message; }
        const overrideRaw=countColumn?ws.getRow(idx).getCell(countColumn).value:null;
        if (overrideRaw!==null&&overrideRaw!==undefined&&String(overrideRaw).trim()!=="") {
            const num=Number(overrideRaw);
            item.lineupCount=Number.isInteger(num)?num:overrideRaw;
        } else if (item.url) {
            const past=previous.get(`${idx}::${item.url}`);
            // Reuse only previous explicit overrides; never relabel a default guess READY.
            if(past && past.method==="manual") item.lineupCount=past.count;
        }
        items.push(item);
    }
    if (!items.length) throw new Error("Selected worksheet has no usable iframes.");
    return {items,sourceSheet:ws.name,sourceColumn:col,sourceCount:score,overrideColumn:countColumn};
}
function windowsFileUri(filePath) {
    const normalized=path.resolve(filePath).replace(/\\/g,"/");
    return encodeURI("file:///"+normalized).replace(/#/g,"%23");
}
// Place HTML immediately beside its iframe on the ORIGINAL input worksheet in a
// NEW COPY of the workbook. Do not create a separate results sheet and do not
// overwrite any existing business columns (e.g. Lineup Count).
function columnContainsData(ws,col) {
    for(let r=1;r<=ws.rowCount;r++) {
        const value=ws.getRow(r).getCell(col).value;
        if(value!==null && value!==undefined && String(value).trim()!=="") return true;
    }
    return false;
}
function reserveColumn(ws,column,header,hasHeader) {
    const h=ws.getRow(1).getCell(column);
    if(hasHeader && cellText(h).toUpperCase()===header) return column;
    // If this position is occupied, INSERT a new column, shifting the old
    // content to the right; never overwrite another user-controlled column.
    if(columnContainsData(ws,column)) ws.spliceColumns(column,0,[]);
    if(hasHeader) {
        const cell=ws.getRow(1).getCell(column);
        cell.value=header;
        cell.font={bold:true,color:{argb:"FF273847"}};
    }
    return column;
}
function findOrAppendQcColumn(ws,header,hasHeader) {
    if(hasHeader) {
        for(let i=1;i<=ws.columnCount;i++) {
            if(cellText(ws.getRow(1).getCell(i)).toUpperCase()===header) return i;
        }
    }
    const col=Math.max(1,ws.columnCount+1);
    if(hasHeader) {
        const cell=ws.getRow(1).getCell(col);
        cell.value=header;
        cell.font={bold:true,color:{argb:"FF273847"}};
    }
    return col;
}
function buildResultsSheet(workbook,results,sourceInfo) {
    const info=sourceInfo||getEntries(workbook);
    const ws=workbook.getWorksheet(info.sourceSheet);
    if(!ws) throw new Error(`Source worksheet not found: ${info.sourceSheet}`);
    const inputCol=info.sourceColumn;
    const hasHeader=!looksLikeIframe(cellText(ws.getRow(1).getCell(inputCol)));
    const outputCol=reserveColumn(ws,inputCol+1,"OUTPUT",hasHeader);
    const linkCol=reserveColumn(ws,inputCol+2,"HTML FILE LINK",hasHeader);
    const jpegCol=reserveColumn(ws,inputCol+3,"JPEG FILE LINK",hasHeader);
    ws.getColumn(outputCol).width=90;
    ws.getColumn(linkCol).width=50;
    ws.getColumn(jpegCol).width=50;
    const qcCols={};
    let headerlessNext=Math.max(ws.columnCount,jpegCol)+1;
    for(const header of QC_HEADERS) {
        qcCols[header]=hasHeader?findOrAppendQcColumn(ws,header,true):headerlessNext++;
    }
    ws.getColumn(qcCols["STATUS"]).width=16;
    ws.getColumn(qcCols["JPEG STATUS"]).width=19;
    ws.getColumn(qcCols["DETECTED LINE UP"]).width=19;
    ws.getColumn(qcCols["DETECTED DETAILS"]).width=20;
    ws.getColumn(qcCols["SPLIT METHOD"]).width=25;
    ws.getColumn(qcCols["REVIEW / ERROR"]).width=85;

    for(const entry of results) {
        const row=ws.getRow(entry.sourceRow);
        // Original iframe and source row position remain untouched.
        row.getCell(outputCol).value=entry.code||"";
        row.getCell(outputCol).alignment={vertical:"top",wrapText:false};
        const link=row.getCell(linkCol);
        if(entry.filePath) {
            link.value={text:path.basename(entry.filePath),hyperlink:windowsFileUri(entry.filePath),tooltip:"Open generated HTML file"};
            link.font={color:{argb:"FF1664A4"},underline:true};
        } else link.value=null;
        const jpg=row.getCell(jpegCol);
        if(entry.jpegPath){
            jpg.value={text:path.basename(entry.jpegPath),hyperlink:windowsFileUri(entry.jpegPath),tooltip:"Open full Combine JPEG"};
            jpg.font={color:{argb:"FF1664A4"},underline:true};
        } else jpg.value=null;
        row.getCell(qcCols["JPEG STATUS"]).value=entry.jpegStatus||"NOT GENERATED";
        const status=row.getCell(qcCols["STATUS"]);
        status.value=entry.status;
        status.font={color:{argb:entry.status==="READY"?"FF187346":entry.status==="REVIEW"?"FFC57616":"FFB42335"},bold:true};
        row.getCell(qcCols["DETECTED LINE UP"]).value=entry.lineupCount??"";
        row.getCell(qcCols["DETECTED DETAILS"]).value=entry.detailsCount??"";
        row.getCell(qcCols["SPLIT METHOD"]).value=entry.method||"";
        const warning=row.getCell(qcCols["REVIEW / ERROR"]);
        warning.value=entry.warning||"";
        warning.alignment={vertical:"top",wrapText:true};
    }

    // Previous v1.7.44 exported HTML_RESULTS as a duplicate summary sheet.
    // Remove it from the NEW output copy only if its schema matches that
    // automatically generated sheet; do not delete user-created sheets.
    const legacy=workbook.getWorksheet(SHEET);
    if(legacy && cellText(legacy.getRow(1).getCell(1))==="Iframe Input" &&
       cellText(legacy.getRow(1).getCell(2))==="HTML Code" &&
       cellText(legacy.getRow(1).getCell(3))==="HTML File Link") {
        workbook.removeWorksheet(legacy.id);
    }
    return ws;
}

async function uniqueBatchDir(parent) {
    const stamp=new Date().toISOString().replace(/[-:]/g,"").replace(/\..*$/,"").replace("T","_");
    for(let i=1;i<=999;i++) {
        const name=`COMBINE_HTML_${stamp}${i===1?"":`_${i}`}`;
        const final=path.join(parent,name);
        const partial=final+".partial";
        try {
            try { await fs.promises.access(final); continue; }
            catch (e) { if(e.code!=="ENOENT") throw e; }
            await fs.promises.mkdir(partial);
            return {final,partial};
        }
        catch(e){if(e.code!=="EEXIST")throw e;}
    }
    throw new Error("Could not allocate a unique batch output folder.");
}
class IframeBatchService {
    constructor({fetcher=getUrlBuffer,excelFactory=null,rendererFactory=null}={}){
        this.fetcher=fetcher;this.excelFactory=excelFactory;
        this.rendererFactory=rendererFactory||(() => new (require("./iframeJpegRenderer").ElectronJpegRenderer)());
        this.running=false;this.cancelRequested=false;this.lastBatch=null;
    }
    async getExcel(){return this.excelFactory?this.excelFactory():new (require("exceljs")).Workbook();}
    async processIframe(input,{lineupCount=null,defaultLineupCount=3}={}) {
        const url=iframeUrl(input);
        const data=await this.fetcher(url,{maxBytes:12*1024*1024,timeoutMs:16000});
        if (!/^(?:text\/html|text\/plain|application\/xhtml|\s*$)/i.test(data.contentType||"")) throw new Error("Iframe did not return HTML text.");
        const html=decodePage(data.buffer,data.contentType);
        const discovery=discoverImages(html,url);
        const split=splitImages(discovery,{lineupCount,defaultLineupCount});
        const code=generateSnippet(split);
        const document=standaloneHtml(code);
        const jpegDocument=legacyCombineJpegHtml(split);
        const warnings=split.warnings;
        return {url,code,document,jpegDocument,images:[...split.lineup,...split.details],
            lineupCount:split.lineupCount,detailsCount:split.detailsCount,
            method:split.method,warnings,status:warnings.length?"REVIEW":"READY"};
    }
    async inspectExcel(inputPath) {
        const workbook=await this.getExcel();await workbook.xlsx.readFile(inputPath);
        const data=getEntries(workbook);
        return {inputPath,sourceSheet:data.sourceSheet,inputColumn:data.sourceColumn,
            total:data.items.length,hasOverrideColumn:Boolean(data.overrideColumn),
            preview:data.items.slice(0,6).map(x=>({row:x.sourceRow,url:x.url||"",error:x.inputError||"",lineupCount:x.lineupCount}))};
    }
    cancel(){this.cancelRequested=true;return {cancelRequested:true};}
    async generateExcel({inputPath,outputFolder,defaultLineupCount=3},progress=()=>{}) {
        if (this.running) throw new Error("An Excel batch is already processing.");
        this.running=true;this.cancelRequested=false;
        let staging=null;
        let rendererPromise=null;
        let renderQueue=Promise.resolve();
        const captureJpeg=(htmlFile,jpegFile,expectedImages,renderHtml)=>{
            // Only one offscreen page may be active at a time. Up to three HTTP
            // iframe-page fetches may still run concurrently.
            const task=renderQueue.then(async()=>{
                if(!rendererPromise) rendererPromise=Promise.resolve().then(()=>this.rendererFactory());
                const renderer=await rendererPromise;
                return renderer.capture(htmlFile,jpegFile,{expectedImages,renderHtml});
            });
            renderQueue=task.catch(()=>{});
            return task;
        };
        try {
            const src=await fs.promises.realpath(inputPath);
            if(path.extname(src).toLowerCase()!==".xlsx")throw new Error("Please upload .xlsx. Macro-enabled .xlsm workbooks are not supported in HTML-only batch mode.");
            const out=await fs.promises.realpath(outputFolder);
            if(!(await fs.promises.stat(out)).isDirectory()) throw new Error("Output folder must exist.");
            const wb=await this.getExcel();await wb.xlsx.readFile(src);
            const sourceInfo=getEntries(wb);
            const {items,sourceSheet}=sourceInfo;
            const dir=await uniqueBatchDir(out);staging=dir.partial;
            const htmlDir=path.join(staging,"HTML_FILES");await fs.promises.mkdir(htmlDir);
            const jpegDir=path.join(staging,"JPEG_FILES");await fs.promises.mkdir(jpegDir);
            const finalHtmlDir=path.join(dir.final,"HTML_FILES");
            const finalJpegDir=path.join(dir.final,"JPEG_FILES");
            const results=new Array(items.length);
            let index=0,done=0,success=0,review=0,failed=0,jpegs=0,jpegErrors=0;
            progress({stage:"started",total:items.length,done:0,sourceSheet});
            const worker=async()=>{
                while(true){
                    if(this.cancelRequested) return;
                    const i=index++;
                    if(i>=items.length)return;
                    const item=items[i];
                    let result={...item,status:"FAILED",warning:"",code:"",lineupCount:item.lineupCount,jpegStatus:"NOT GENERATED"};
                    try {
                        if(item.inputError)throw new Error(item.inputError);
                        const built=await this.processIframe(item.raw,{lineupCount:item.lineupCount,defaultLineupCount});
                        const excelTooLong=built.code.length>MAX_EXCEL_CELL;
                        const filename=outputStem(built.url,item.sourceRow)+".html";
                        const htmlPath=path.join(htmlDir,filename);
                        await fs.promises.writeFile(htmlPath,built.document,{encoding:"utf8",flag:"wx"});
                        const jpegName=filename.replace(/\.html$/i,".jpg");
                        let jpegPath=null,jpegStatus="FAILED",jpegWarning="";
                        try {
                            await captureJpeg(htmlPath,path.join(jpegDir,jpegName),built.images.length,built.jpegDocument);
                            jpegPath=path.join(finalJpegDir,jpegName);
                            jpegStatus="READY";
                            jpegs++;
                        } catch(jpegError) {
                            jpegErrors++;
                            jpegWarning="JPEG unavailable: "+String(jpegError?.message||jpegError).slice(0,500);
                        }
                        result={...result,code:excelTooLong?"":built.code,filePath:path.join(finalHtmlDir,filename),
                            jpegPath,jpegStatus,status:excelTooLong||jpegStatus!=="READY"?"REVIEW":built.status,
                            lineupCount:built.lineupCount,detailsCount:built.detailsCount,
                            method:built.method,warning:[...built.warnings,...(excelTooLong?
                                [`HTML has ${built.code.length} characters, exceeding Excel's ${MAX_EXCEL_CELL} character limit. Complete HTML is saved in the linked file.`]:[]),...(jpegWarning?[jpegWarning]:[])].join(" | ")};
                        if(result.status==="READY")success++;else review++;
                    } catch(error) {
                        result.warning=String(error?.message||error).slice(0,3000);
                        failed++;
                    }
                    results[i]=result;
                    done++;
                    if(done===items.length||done%5===0)progress({stage:"processing",done,total:items.length,ready:success,review,failed,jpegs,jpegErrors});
                }
            };
            await Promise.all(Array.from({length:Math.min(3,items.length)},worker));
            for(let i=0;i<items.length;i++)if(!results[i])results[i]={...items[i],code:"",filePath:null,
                lineupCount:items[i].lineupCount,status:"SKIPPED",warning:"Batch cancelled before this row."};
            buildResultsSheet(wb,results,sourceInfo);
            const excelName=path.basename(src).replace(/\.xlsx$/i,"")+"_COMBINE_RESULTS.xlsx";
            const newXlsx=path.join(staging,excelName);
            await wb.xlsx.writeFile(newXlsx);
            const audit={created:new Date().toISOString(),sourceWorkbook:src,sourceSheet,total:items.length,
                ready:success,review,failed,skipped:items.length-done,cancelled:this.cancelRequested,
                imageBytesDownloaded:0,photoshopRequired:false,jpegLayout:"legacy-combine-600px-2col-lineup-2col-details",
                generatedFiles:results.filter(x=>x.filePath).length,
                generatedJpegs:jpegs,jpegErrors};
            await fs.promises.writeFile(path.join(staging,"BATCH_REPORT.json"),JSON.stringify(audit,null,2),"utf8");
            await fs.promises.rename(staging,dir.final);staging=null;
            this.lastBatch={...audit,outputFolder:dir.final,excelPath:path.join(dir.final,excelName)};
            progress({stage:"complete",...this.lastBatch,done,total:items.length});
            return this.lastBatch;
        } finally {
            await renderQueue.catch(()=>{});
            if(rendererPromise){
                try { const renderer=await rendererPromise;await renderer?.close?.(); }catch(_){}
            }
            this.running=false;
            // A failed pre-publication batch is never published as a completed result.
            // Leave .partial files for recovery/diagnosis instead of silently deleting data.
        }
    }
}
module.exports={IframeBatchService,getEntries,buildResultsSheet,COLUMNS,cellText,looksLikeIframe};
