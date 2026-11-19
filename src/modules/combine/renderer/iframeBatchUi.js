"use strict";
// Iframe → HTML / Excel batch UI. Renderer has no filesystem access; all writes
// and allowlisted HTTP reads pass through the Electron main-process service.
(() => {
    const api=window.combineApp;
    const $=id=>document.getElementById(id);
    let selectedExcel=null,outputFolder=null,preview=null,lastOutput=null,busy=false,previewMode="jpeg";
    const modeHtml=$("htmlBatchWorkspace"),modeLegacy=$("legacyCombine");
    function log(message,error=false){
        const node=$("batchLog");
        const line=`[${new Date().toLocaleTimeString()}] ${error?"ERROR: ":""}${String(message)}\n`;
        node.textContent+=(node.textContent?"\n":"")+line;
        if(node.textContent.length>18000)node.textContent=node.textContent.slice(-17000);
        node.scrollTop=node.scrollHeight;
    }
    function countField(id,optional){
        const value=$(id).value.trim();
        if(optional&&!value)return null;
        if(!/^\d+$/.test(value)||Number(value)>250)throw new Error("Line Up Count must be a whole number between 0 and 250.");
        return Number(value);
    }
    function updateButtons(){
        $("batchPreview").disabled=busy;
        $("batchSaveSingle").disabled=busy||!preview||!outputFolder;
        $("batchChooseExcel").disabled=busy;
        $("batchChooseOutput").disabled=busy;
        $("batchInspect").disabled=busy||!selectedExcel;
        $("batchGenerate").disabled=busy||!selectedExcel||!outputFolder;
        $("batchCancel").disabled=!busy;
        $("batchOpenOutput").disabled=busy||!lastOutput;
        $("batchCopyCode").disabled=!preview;
        $("batchViewHtml").disabled=!preview;
        $("batchViewJpeg").disabled=!preview;
        $("switchLegacy").disabled=busy;
    }
    function showMode(legacy){
        modeHtml.hidden=Boolean(legacy);
        modeLegacy.hidden=!legacy;
    }
    $("switchLegacy").addEventListener("click",()=>showMode(true));
    $("switchHtmlBatch").addEventListener("click",()=>showMode(false));
    function showSelectedPreview(mode){
        previewMode=mode;
        if(!preview)return;
        const frame=$("batchLiveFrame");
        const jpeg=mode==="jpeg";
        frame.srcdoc=jpeg?preview.jpegDocument:preview.document;
        frame.style.width=jpeg?"600px":"780px";
        frame.title=jpeg?"Legacy 600px Combine JPEG composition preview":"780px HTML table preview";
        $("batchViewHtml").setAttribute("aria-pressed",String(!jpeg));
        $("batchViewJpeg").setAttribute("aria-pressed",String(jpeg));
        $("batchPreviewInfo").textContent=`${preview.images.length} images · ${preview.lineupCount} Line Up · ${preview.detailsCount} Details · ${jpeg?"JPEG 600px / 2+2 columns":"HTML 780px / 2+3 columns"} · ${preview.method}`;
    }
    $("batchViewHtml").addEventListener("click",()=>showSelectedPreview("html"));
    $("batchViewJpeg").addEventListener("click",()=>showSelectedPreview("jpeg"));
    async function doPreview(){
        const raw=$("batchSingleIframe").value.trim();
        if(!raw)throw new Error("Paste a Rakuten iframe block first.");
        const lineupCount=countField("batchSingleCount",true);
        const defaultLineupCount=countField("batchDefaultCount",false);
        preview=null;$("batchCode").value="";updateButtons();
        log("Analyzing iframe HTML (no image files downloaded)...");
        const result=await api.previewIframeHtml({iframe:raw,lineupCount,defaultLineupCount});
        preview={...result,iframe:raw};
        $("batchCode").value=result.code;
        showSelectedPreview(previewMode);
        if(result.warnings.length)log(`REVIEW: ${result.warnings.join(" | ")}`,true);
        else log(`Preview ready: ${result.lineupCount} Line Up / ${result.detailsCount} Details.`);
        updateButtons();
    }
    $("batchPreview").addEventListener("click",async()=>{
        if(busy)return;
        busy=true;updateButtons();
        try{await doPreview();}catch(e){log(e.message||e,true);}finally{busy=false;updateButtons();}
    });
    $("batchChooseExcel").addEventListener("click",async()=>{
        try{
            const file=await api.chooseHtmlExcel();
            if(!file)return;
            selectedExcel=file;
            $("batchExcelPath").textContent=file;
            $("batchExcelSummary").textContent="Ready to inspect";
            log(`Excel selected: ${file}`);updateButtons();
        }catch(e){log(e.message||e,true);}
    });
    $("batchChooseOutput").addEventListener("click",async()=>{
        try{
            const folder=await api.chooseHtmlOutput();
            if(!folder)return;
            outputFolder=folder;
            $("batchOutputPath").textContent=folder;
            log(`Output location: ${folder}`);updateButtons();
        }catch(e){log(e.message||e,true);}
    });
    $("batchInspect").addEventListener("click",async()=>{
        busy=true;updateButtons();
        try{
            const d=await api.inspectHtmlExcel(selectedExcel);
            $("batchExcelSummary").textContent=`${d.total.toLocaleString()} iframe(s) · ${d.sourceSheet}`;
            log(`Detected ${d.total} iframes in ${d.sourceSheet} (column ${d.inputColumn}). Manual override column: ${d.hasOverrideColumn?"Yes":"No"}.`);
            for(const r of d.preview) if(r.error)log(`Excel row ${r.row}: ${r.error}`,true);
        }catch(e){log(e.message||e,true);}finally{busy=false;updateButtons();}
    });
    $("batchCopyCode").addEventListener("click",async()=>{
        if(!preview)return;
        try{await navigator.clipboard.writeText(preview.code);log("HTML code copied.");}
        catch(e){$("batchCode").focus();$("batchCode").select();log("Select and copy HTML with Ctrl+C.");}
    });
    $("batchSaveSingle").addEventListener("click",async()=>{
        if(!preview||!outputFolder)return;
        busy=true;updateButtons();
        try{
            const saved=await api.saveSingleHtml({iframe:preview.iframe,code:preview.code,document:preview.document,outputFolder});
            log(`HTML saved: ${saved.path}`);
            if(saved.jpegPath)log(`JPEG saved: ${saved.jpegPath}`);
        }catch(e){log(e.message||e,true);}finally{busy=false;updateButtons();}
    });
    $("batchGenerate").addEventListener("click",async()=>{
        if(busy||!selectedExcel||!outputFolder)return;
        let defaultLineupCount;
        try{defaultLineupCount=countField("batchDefaultCount",false);}catch(e){log(e.message,true);return;}
        if(!confirm("Generate a NEW results workbook and HTML files? The original Excel will not be overwritten. Rows without a known DETAILS boundary will be marked REVIEW."))return;
        busy=true;lastOutput=null;$("batchMeterFill").style.width="0%";updateButtons();
        log("Starting Excel iframe batch: HTML, JPEG and adjacent Excel output. No Photoshop.");
        try{
            const output=await api.generateIframeBatch({inputPath:selectedExcel,outputFolder,defaultLineupCount});
            lastOutput=output.outputFolder;
            $("batchStats").textContent=`Completed ${output.total} · Ready ${output.ready} · Review ${output.review} · Failed ${output.failed} · Skipped ${output.skipped} · JPEGs ${output.generatedJpegs} · JPEG issues ${output.jpegErrors}`;
            log(`Workbook: ${output.excelPath}`);
            if(output.failed)log(`${output.failed} errors are listed in the result workbook.`,true);
            if(output.progressionWarning)log(output.progressionWarning,true);
            $("batchMeterFill").style.width="100%";
        }catch(e){log(e.message||e,true);}finally{busy=false;updateButtons();}
    });
    $("batchCancel").addEventListener("click",async()=>{
        try{await api.cancelIframeBatch();log("Stop requested. In-flight pages will finish; partial results will be saved.");}
        catch(e){log(e.message||e,true);}
    });
    $("batchOpenOutput").addEventListener("click",async()=>{
        if(!lastOutput)return;
        try{await api.openHtmlBatchFolder(lastOutput);}catch(e){log(e.message||e,true);}
    });
    api?.onIframeBatchProgress?.(d=>{
        if(d?.stage==="started"){
            $("batchStats").textContent=`0 / ${d.total} · loading ${d.sourceSheet}`;
        }else if(d?.stage==="processing"||d?.stage==="complete"){
            $("batchStats").textContent=`${d.done} / ${d.total} · Ready ${d.ready} · Review ${d.review} · Failed ${d.failed} · JPEGs ${d.jpegs??d.generatedJpegs??0}`;
            $("batchMeterFill").style.width=`${d.total?Math.round(100*d.done/d.total):0}%`;
        }
    });
    updateButtons();
    showMode(false);
})();
