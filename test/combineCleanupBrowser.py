"""Optional UI QA. Requires local Chromium + playwright; no Electron runtime."""
from pathlib import Path
from playwright.sync_api import sync_playwright
root = Path(__file__).resolve().parents[1] / 'src/modules/combine/renderer'
mock = r'''(() => {
 const slides=[1,2].map(i=>({index:i,name:'item_'+i+'.jpg',status:'downloaded',path:'C:/Downloads/item/00'+i+'_item_'+i+'.jpg',url:'https://image.rakuten.co.jp/glv/cabinet/item_'+i+'.jpg',width:600,height:400}));
 const calls={scan:[],preview:[],save:[], downloaded:0}; window.mockCalls=calls;
 const preview='data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%22600%22%20height=%22400%22%3E%3Crect%20width=%22600%22%20height=%22400%22%20fill=%22%23f3e4d5%22/%3E%3C/svg%3E';
 window.combineApp = {
   getState:async()=>({outputFolder:'C:/Export',lastOutput:null}),
   chooseOutput:async()=>({outputFolder:'C:/Export'}),chooseFiles:async()=>({images:[],failed:[]}),
   addPaths:async()=>({images:[],failed:[]}),getPathForFile:f=>f.name,
   layout:async p=>{if(!p.singlePath&&!p.lineup.length&&!p.details.length)throw Error('Add at least one image');if(p.lineup.some(x=>!x.colorName))throw Error('missing name');
     return {width:600,height:335,format:'psd',sourceCount:p.lineup.length+p.details.length+(p.singlePath?1:0),jpegCount:1,single:p.singlePath?{path:p.singlePath,x:0,y:0,placedWidth:600,placedHeight:600}:null,
       lineup:p.lineup.map((x,i)=>({...x,name:'clean.png',x:3,y:0,placedWidth:293,placedHeight:293,labelLines:[x.colorName],labelX:3,labelY:300,labelWidth:293,labelHeight:36})),details:[],detailsHeader:null}},
   preview:async()=>({dataUrl:preview}),generate:async()=>({format:'psd',outputPath:'C:/Export/COMBINE.psd',jpegPaths:['C:/Export/COMBINE.jpg']}),
   openOutput:async()=>({ok:true}),reset:async()=>({}),onProgress:()=>{},
   scanRakuten:async()=>({images:slides,method:'fixture'}),
   downloadRakuten:async()=>{calls.downloaded++;return {folder:'C:/Downloads/item',images:slides}},
   chooseRakutenFolder:async()=>null,openRakutenFolder:async()=>({}),previewRakuten:async()=>preview,onRakutenProgress:()=>{},
   chooseCleanupFiles:async()=>({images:[{path:slides[0].path,name:slides[0].name,width:600,height:400}],failed:[]}),
   addDownloadedToCleanup:async()=>({images:slides.map(i=>({path:i.path,name:i.name,width:600,height:400})),failed:[]}),
   scanCleanup:async file=>{calls.scan.push(file);return {filePath:file,width:600,height:400,previewDataUrl:preview,engine:'Fixture OCR',warning:'',regions:[
     {id:'ocr-0',text:'ブラック',x:170,y:310,width:90,height:24,confidence:92,suggested:true},
     {id:'ocr-1',text:'DO NOT REMOVE LOGO',x:10,y:10,width:150,height:26,confidence:92,suggested:false}]};},
   previewCleanup:async data=>{calls.preview.push(data);return {previewDataUrl:preview,width:600,height:400,methods:['matched background'],warnings:[]}},
   saveCleanup:async data=>{calls.save.push(data);const name='clean_'+calls.save.length+'.png';return {ok:true,path:'C:/Downloads/item/COMBINE_CLEANED/'+name,
     methods:['matched background'],warnings:[],imported:{images:[{path:'C:/Downloads/item/COMBINE_CLEANED/'+name,name,width:600,height:400}],failed:[]}};}
 };
})();'''
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-gpu'])
    page=browser.new_page(viewport={'width':1300,'height':950})
    failures=[]
    page.on('pageerror',lambda error:failures.append(str(error)))
    page.evaluate(mock)
    html=(root/'index.html').read_text(encoding='utf8')
    html=html.replace('<link rel="stylesheet" href="style.css">', '<style>'+(root/'style.css').read_text(encoding='utf8')+'</style>')
    for script in ['cleanupUi.js', 'app.js']:
        html=html.replace('<script src="'+script+'"></script>', '<script>'+(root/script).read_text(encoding='utf8')+'</script>')
    page.set_content(html)
    page.wait_for_timeout(250)
    assert page.locator('#cleanupChoose').is_enabled(), 'cleanup buttons should work on load'
    assert page.locator('#cleanupFromDownloads').is_disabled(), 'download step should remain independent'
    page.locator('#rakutenUrl').fill('https://item.rakuten.co.jp/glv/test')
    page.locator('#rakutenDownload').click()
    page.wait_for_function('document.getElementById("rakutenStatus").textContent.includes("Downloaded 2/2")')
    assert page.locator('#lineupItems .file-item').count()==0
    page.locator('#cleanupFromDownloads').click()
    page.wait_for_function('document.querySelectorAll(".cleanup-region-row").length===2')
    assert page.locator('.cleanup-region-row input:checked').count()==0,'review mode must not auto erase'
    page.locator('#cleanupSelectSuggested').click()
    assert page.locator('.cleanup-region-row input:checked').count()==1,'only likely caption selected'
    assert page.locator('#cleanupSave').is_disabled(),'must inspect a preview before saving'
    page.locator('#cleanupPreview').click()
    page.wait_for_function('document.getElementById("cleanupAfter").disabled===false')
    assert page.locator('#cleanupSave').is_enabled()
    page.locator('#cleanupSave').click()
    page.wait_for_function('document.querySelectorAll("#lineupItems .file-item").length===1')
    assert page.locator('#singleItems .file-item').count()==0
    assert page.locator('#generate').is_enabled(),'optional Single must continue to work'
    assert page.evaluate('mockCalls.save[0].areas.length')==1
    assert page.evaluate('mockCalls.save[0].areas[0].x')==170
    assert page.evaluate('mockCalls.save[0].engine')=='clean'
    # Changing restoration method invalidates QC and requires a new preview.
    page.locator('#cleanupRestore').select_option('photoshop')
    assert page.locator('#cleanupSave').is_disabled()
    page.locator('#cleanupRestore').select_option('clean')
    page.locator('#cleanupMode').select_option('auto')
    page.locator('#cleanupQueue button').nth(1).click()
    page.wait_for_function('document.querySelectorAll(".cleanup-region-row").length===2')
    assert page.locator('.cleanup-region-row input:checked').count()==1
    page.locator('#cleanupManual').click()
    stage=page.locator('#cleanupStage'); bounds=stage.bounding_box()
    page.mouse.move(bounds['x']+bounds['width']*0.34,bounds['y']+bounds['height']*0.76)
    page.mouse.down()
    page.mouse.move(bounds['x']+bounds['width']*0.59,bounds['y']+bounds['height']*0.88,steps=6)
    page.mouse.up()
    assert page.locator('.cleanup-region-row input:checked').count()==2
    assert page.locator('#cleanupSave').is_disabled()
    page.screenshot(path='/mnt/data/BrandForge_Combine_Text_Cleanup_UI_QA.png',full_page=True)
    if failures: raise RuntimeError('\n'.join(failures))
    print('PASS Combine cleanup UI: download-only isolation, review approval, before/after, safe save, optional Single, engine switching, auto selection, manual draw')
    browser.close()
