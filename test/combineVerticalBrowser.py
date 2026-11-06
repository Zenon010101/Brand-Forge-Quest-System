"""Optional browser QA for TOP/BOTTOM naming, preview coordinates and OCR reuse.
Uses mocked Electron IPC; Python is not required on BrandForge user's PC.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json

root=Path(__file__).resolve().parents[1]/'src/modules/combine/renderer'
mock=r'''(() => {
 const path='C:/mock/001_shoes.jpg';
 const file={path,name:'001_shoes.jpg',width:600,height:600};
 const white='data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="600" height="600"%3E%3Crect width="600" height="600" fill="white"/%3E%3C/svg%3E';
 window.calls={layouts:[],previews:[],generated:[]};
 window.combineApp={
   getState:async()=>({outputFolder:'C:/out'}),chooseOutput:async()=>({outputFolder:'C:/out'}),
   chooseFiles:async()=>({images:[file],failed:[]}),addPaths:async()=>({images:[file],failed:[]}),
   preview:async p=>{window.calls.previews.push(p);return {dataUrl:white};},
   layout:async p=>{window.calls.layouts.push(p);if(!p.lineup.length)throw Error('No images');
     const entry=p.lineup[0];if(!entry.colorName||entry.rowMode!=='single'&&!entry.colorNameRight)throw Error('Missing color name');
     const isVert=entry.rowMode==='vertical';let ypos=0;
     const labels=isVert?[{lines:[entry.colorName],x:9,y:(entry.captionTopY??.44)*594,width:582,height:36},
       {lines:[entry.colorNameRight],x:9,y:(entry.captionBottomY??.925)*594,width:582,height:36}]
       :[{lines:[entry.colorName],x:3,y:594,width:293,height:36}];
     return {width:600,height:630,format:'psd',jpegCount:1,sourceCount:1,lineupRows:[{kind:isVert?'vertical':entry.rowMode}],
       single:null,details:[],lineup:[{...file, x:3,y:ypos,placedWidth:594,placedHeight:594, labels}],detailsHeader:null};},
   generate:async p=>{window.calls.generated.push(p);return {format:'psd',jpegPaths:['C:/out/a.jpg'],outputPath:'C:/out/a.psd'};},
   openOutput:async()=>({}),reset:async()=>({}),onProgress:()=>{},getPathForFile:f=>f.name,
   scanRakuten:async()=>({images:[],method:'mock'}),downloadRakuten:async()=>({images:[],folder:''}),
   chooseRakutenFolder:async()=>null,openRakutenFolder:async()=>({}),previewRakuten:async()=>white,onRakutenProgress:()=>{},
   chooseCleanupFiles:async()=>({images:[file],failed:[]}),addDownloadedToCleanup:async()=>({images:[],failed:[]}),
   scanCleanup:async()=>({filePath:path,width:600,height:600,previewDataUrl:white,engine:'MockOCR',warning:'',regions:[
     {id:'ocr-top',text:'クラウドホワイト/コアブラック',x:140,y:255,width:320,height:22,confidence:96,suggested:true},
     {id:'ocr-bottom',text:'コアブラック/クラウドホワイト',x:139,y:550,width:322,height:22,confidence:96,suggested:true}]}),
   previewCleanup:async()=>({previewDataUrl:white,methods:['clean fill'],warnings:[]}),
   saveCleanup:async()=>({path:'C:/mock/COMBINE_CLEANED/001_shoes_textclean.png',imported:{images:[{
     path:'C:/mock/COMBINE_CLEANED/001_shoes_textclean.png',name:'001_shoes_textclean.png',width:600,height:600}],failed:[]}})
 };
})();'''

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-gpu'])
    page=browser.new_page(viewport={'width':1480,'height':980},device_scale_factor=1)
    errors=[]
    page.on('pageerror',lambda exc:errors.append(str(exc)))
    page.evaluate(mock)
    html=(root/'index.html').read_text(encoding='utf8')
    html=html.replace('<link rel="stylesheet" href="style.css">', '<style>'+(root/'style.css').read_text(encoding='utf8')+'</style>')
    for script in ['../shared/captionLayout.js','cleanupUi.js','app.js']:
        html=html.replace(f'<script src="{script}"></script>','<script>'+(root/script).read_text(encoding='utf8')+'</script>')
    page.set_content(html)
    page.locator('#chooseLineup').click()
    page.wait_for_function('document.querySelectorAll("#lineupItems .file-item").length===1')
    assert 'vertical' in page.locator('.lineup-mode').locator('option').evaluate_all('els=>els.map(e=>e.value)')
    page.locator('.lineup-mode').select_option('vertical')
    assert page.locator('#lineupItems [data-color-side="right"]').count()==1
    assert page.locator('#lineupItems [data-caption-position="top"]').count()==1
    assert page.locator('#lineupItems [data-caption-position="bottom"]').count()==1
    page.locator('[data-color-side="left"]').fill('TOP WHITE')
    page.locator('[data-color-side="right"]').fill('BOTTOM BLACK')
    page.locator('[data-caption-position="top"]').fill('42.5')
    page.locator('[data-caption-position="bottom"]').fill('92.5')
    page.wait_for_function('document.querySelectorAll(".composition-label").length===2')
    actual=page.evaluate('window.calls.layouts.at(-1).lineup[0]')
    assert actual['rowMode']=='vertical',actual
    assert abs(actual['captionTopY']-0.425)<1e-9,actual
    assert abs(actual['captionBottomY']-0.925)<1e-9,actual
    assert actual['colorName']=='TOP WHITE' and actual['colorNameRight']=='BOTTOM BLACK',actual
    page.wait_for_function('window.calls.previews.some(x=>x.preserveCanvas===true)')
    page.locator('#generate').click()
    page.wait_for_function('window.calls.generated.length===1')
    assert page.evaluate('window.calls.generated[0].lineup[0].rowMode')=='vertical'
    # Bulk TOP :: BOTTOM and LEFT | RIGHT are separate and preserved.
    page.locator('#setAllNormal').click()
    page.locator('#bulkColorNames').fill('TOP NAME :: BOTTOM NAME')
    page.locator('#applyColors').click()
    assert page.locator('.lineup-mode').input_value()=='vertical'
    assert page.locator('[data-color-side="right"]').input_value()=='BOTTOM NAME'
    page.locator('#bulkColorNames').fill('LEFT NAME | RIGHT NAME')
    page.locator('#applyColors').click()
    assert page.locator('.lineup-mode').input_value()=='dual'
    # OCR-approved captions in two vertical positions auto-fill mode and Y.
    page.locator('#cleanupMode').select_option('auto')
    page.locator('#cleanupChoose').click()
    page.wait_for_function('document.querySelector("#cleanupPreview").disabled===false')
    page.locator('#cleanupPreview').click()
    page.wait_for_function('document.querySelector("#cleanupSave").disabled===false')
    page.locator('#cleanupSave').click()
    page.wait_for_function('document.querySelectorAll("#lineupItems .file-item").length===2')
    row=page.locator('#lineupItems .file-item').nth(1)
    assert row.locator('.lineup-mode').input_value()=='vertical'
    assert row.locator('[data-color-side="left"]').input_value()=='クラウドホワイト/コアブラック'
    assert row.locator('[data-color-side="right"]').input_value()=='コアブラック/クラウドホワイト'
    assert abs(float(row.locator('[data-caption-position="top"]').input_value())-42.5)<.1
    assert abs(float(row.locator('[data-caption-position="bottom"]').input_value())-91.7)<.15
    if errors: raise RuntimeError('\n'.join(errors))
    page.screenshot(path='/mnt/data/BrandForge_v1.7.37_Vertical_Naming_UI_QA.png',full_page=True)
    print('PASS UI: vertical select, two fields, position inputs, PSD payload, bulk names, OCR two-caption reuse, horizontal compatibility')
    browser.close()
