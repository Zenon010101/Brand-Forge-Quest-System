"""Optional Chromium QA for automatic selected-text OCR -> Combine names.
Mocks IPC; Python is required only to run this test, not to run BrandForge.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1] / 'src/modules/combine/renderer'
mock = r'''(() => {
 const white='data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="600" height="600"%3E%3Crect width="600" height="600" fill="white"/%3E%3C/svg%3E';
 let counter=0, saved=0;
 const paths=['C:/mock/manual-vertical.png','C:/mock/manual-horizontal.png','C:/mock/manual-detail.png'];
 const file=path=>({path,name:path.split('/').pop(),width:600,height:600,visibleWidth:500,visibleHeight:520});
 window.mockCalls={previews:[],saves:[],layouts:[]};
 window.combineApp={
   getState:async()=>({outputFolder:'C:/out'}),chooseOutput:async()=>({outputFolder:'C:/out'}),
   chooseFiles:async()=>({images:[],failed:[]}),addPaths:async()=>({images:[],failed:[]}),
   preview:async()=>({dataUrl:white}),
   layout:async p=>{window.mockCalls.layouts.push(p);
     if(!p.singlePath && !p.lineup.length && !p.details.length)throw Error('No images');
     for(const item of p.lineup)if(!item.colorName || item.rowMode!=='single' && !item.colorNameRight)throw Error('Missing color');
     return {width:600,height:720,format:'psd',sourceCount:1,jpegCount:1,
       single:null,details:[],lineupRows:[],lineup:[],detailsHeader:null};},
   generate:async()=>({format:'psd',jpegPaths:[],outputPath:'C:/out/a.psd'}),openOutput:async()=>({}),reset:async()=>({}),onProgress:()=>{},getPathForFile:f=>f.name,
   scanRakuten:async()=>({images:[],method:'mock'}),downloadRakuten:async()=>({images:[],folder:''}),
   chooseRakutenFolder:async()=>null,openRakutenFolder:async()=>({}),previewRakuten:async()=>white,onRakutenProgress:()=>{},
   chooseCleanupFiles:async()=>({images:[file(paths[counter++])],failed:[]}),addDownloadedToCleanup:async()=>({images:[],failed:[]}),
   scanCleanup:async path=>({filePath:path,width:600,height:600,previewDataUrl:white,engine:'Mock OCR',regions:[],warning:''}),
   previewCleanup:async data=>{window.mockCalls.previews.push(data);
     const names=data.filePath.includes('vertical') ? [
       {text:'1.クラウドホワイト/コアブラック',x:150,y:255,width:300,height:24,confidence:93},
       {text:'2.コアブラック/クラウドホワイト',x:150,y:555,width:300,height:24,confidence:91}]
       : data.filePath.includes('horizontal') ? [] : [
         {text:'Texture information',x:100,y:480,width:300,height:20,confidence:90}];
     return {previewDataUrl:white,methods:['Clean Fill'],warnings:[],captions:names,captionWarnings:names.length?[]:['OCR missed selected text.']};},
   saveCleanup:async data=>{window.mockCalls.saves.push(data);saved++;
     const path='C:/mock/COMBINE_CLEANED/clean_'+saved+'.png';
     return {path,imported:{images:[file(path)],failed:[]}};}
 };
})();'''

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-gpu'])
    page = browser.new_page(viewport={'width':1470,'height':1020},device_scale_factor=1)
    errors=[]
    page.on('pageerror',lambda error: errors.append(str(error)))
    page.evaluate(mock)
    html=(root/'index.html').read_text(encoding='utf8')
    html=html.replace('<link rel="stylesheet" href="style.css">','<style>'+(root/'style.css').read_text(encoding='utf8')+'</style>')
    for script in ['../shared/captionLayout.js','cleanupUi.js','app.js']:
        html=html.replace('<script src="'+script+'"></script>',
            '<script>'+(root/script).resolve().read_text(encoding='utf8')+'</script>')
    page.set_content(html)
    def brush():
        page.locator('#cleanupBrush').click()
        stage=page.locator('#cleanupStage')
        box=stage.bounding_box()
        x=box['x']+box['width']*.33
        y=box['y']+box['height']*.45
        page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+30,y+2,steps=6);page.mouse.up()
        assert page.locator('#cleanupPreview').is_enabled()
    # Vertical: blank initial OCR, text recovered through selected-area OCR at preview.
    page.locator('#cleanupChoose').click()
    page.wait_for_function('document.getElementById("cleanupBrush").disabled===false')
    brush()
    page.locator('#cleanupPreview').click()
    page.wait_for_function('document.querySelector("#cleanupSave").disabled===false')
    assert page.evaluate('mockCalls.previews.at(-1).captureText') is True
    assert not page.locator('#cleanupRecovered').is_hidden()
    assert page.locator('#cleanupCaptionMode').input_value()=='auto'
    assert page.locator('#cleanupCaptionFirst').input_value()=='クラウドホワイト/コアブラック'
    assert page.locator('#cleanupCaptionSecond').input_value()=='コアブラック/クラウドホワイト'
    assert page.locator('#cleanupCaptionFirstLabel').inner_text()=='TOP color name'
    page.locator('#cleanupCaptionFirst').fill('CORRECTED TOP NAME')
    page.locator('#cleanupSave').click()
    page.wait_for_function('document.querySelectorAll("#lineupItems .file-item").length===1')
    row=page.locator('#lineupItems .file-item').first
    assert row.locator('.lineup-mode').input_value()=='vertical'
    assert row.locator('[data-color-side="left"]').input_value()=='CORRECTED TOP NAME'
    assert row.locator('[data-color-side="right"]').input_value()=='コアブラック/クラウドホワイト'
    assert abs(float(row.locator('[data-caption-position="top"]').input_value())-42.5)<.2
    # Horizontal: OCR missing; manual labels are still possible.
    page.locator('#cleanupChoose').click()
    page.locator('#cleanupQueue button').last.click()
    page.wait_for_function('document.getElementById("cleanupBrush").disabled===false')
    brush()
    page.locator('#cleanupPreview').click()
    page.wait_for_function('document.querySelector("#cleanupSave").disabled===false')
    assert page.locator('#cleanupCaptionFirst').input_value()==''
    page.locator('#cleanupCaptionMode').select_option('dual')
    page.locator('#cleanupCaptionFirst').fill('LEFT WHITE')
    page.locator('#cleanupCaptionSecond').fill('RIGHT BLACK')
    page.locator('#cleanupSave').click()
    page.wait_for_function('document.querySelectorAll("#lineupItems .file-item").length===2')
    row=page.locator('#lineupItems .file-item').last
    assert row.locator('.lineup-mode').input_value()=='dual'
    assert row.locator('[data-color-side="left"]').input_value()=='LEFT WHITE'
    assert row.locator('[data-color-side="right"]').input_value()=='RIGHT BLACK'
    # Details: preserve the recovered text in an editable note, not a visible
    # text layer added to a Details photo.
    page.locator('#cleanupChoose').click()
    page.locator('#cleanupQueue button').last.click()
    page.wait_for_function('document.getElementById("cleanupBrush").disabled===false')
    brush()
    page.locator('#cleanupPreview').click()
    page.wait_for_function('document.querySelector("#cleanupSave").disabled===false')
    page.locator('#cleanupTarget').select_option('details')
    page.locator('#cleanupSave').click()
    page.wait_for_function('document.querySelectorAll("#detailItems .file-item").length===1')
    assert page.locator('#detailItems .combine-recovered-note textarea').input_value()=='Texture information'
    # A cleaned image with unreadable text must not be given a fabricated
    # color name based on its filename.
    page.evaluate('''async () => { await addImages('lineup',{images:[{path:'C:/mock/COMBINE_CLEANED/unreadable_textclean.png',
      name:'unreadable_textclean.png',width:600,height:600,
      suggestedLineup:{mode:'single',first:'',second:''}}],failed:[]}); }''')
    assert page.locator('#lineupItems .file-item').last.locator('[data-color-side="left"]').input_value()==''
    assert not errors, errors
    page.screenshot(path='/mnt/data/BrandForge_v1.7.38_Captured_OCR_Auto_Name_UI_QA.png',full_page=True)
    browser.close()
    print('PASS UI: brush-selected OCR, captured text review and correction, automatic vertical/horizontal fields, Details note and captureText IPC')
