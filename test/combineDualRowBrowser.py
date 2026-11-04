"""Optional browser QA for mixed normal/dual Line Up rows and OCR reuse.
Uses a mocked IPC boundary; no Electron, network, OCR service, or Photoshop.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json
import base64

root = Path(__file__).resolve().parents[1] / 'src/modules/combine/renderer'
example = Path('/mnt/data/001_chn-99_1.jpg')
if not example.exists():
    # This example is only for richer visual QA; the project test stays portable.
    preview = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="600" height="600"%3E%3Crect width="600" height="600" fill="white"/%3E%3C/svg%3E'
else:
    preview = 'data:image/jpeg;base64,' + base64.b64encode(example.read_bytes()).decode('ascii')
mock = r'''(() => {
  const entries=['dual01.jpg','dual02.jpg','dual03.jpg'].map(n=>({path:'C:/mock/'+n,name:n,width:600,height:600}));
  const calls={layouts:[],generated:[],cleaned:0}; window.mockCalls=calls;
  const preview=__IMAGE_PREVIEW__;
  const file = path => entries.find(e=>e.path===path) || {path,name:path.split('/').pop(),width:600,height:600};
  const build = p => {
    if(!p.singlePath&&!p.lineup.length&&!p.details.length)throw Error('Add at least one image');
    let y=p.singlePath?615:0;
    let pending=[];const lineup=[],lineupRows=[];
    function putRegular(){if(!pending.length)return;
      const at=y;pending.forEach(({e,i},col)=>{const x=3+301*col;lineup.push({...file(e.path),...e,x,y,slotX:x,slotY:y,slotWidth:293,slotHeight:293,placedWidth:293,placedHeight:293,labelLines:[e.colorName],labelX:x,labelY:y+299,labelWidth:293,labelHeight:36,labels:[{lines:[e.colorName],x,y:y+299,width:293,height:36}]});});
      lineupRows.push({kind:'regular',top:at,imageIndices:pending.map(x=>x.i)});y+=335+7;pending=[];}
    p.lineup.forEach((e,i)=>{if(!e.colorName.trim())throw Error('Missing Left color name');
      if(e.rowMode==='dual'){if(!e.colorNameRight.trim())throw Error('Missing Right color name');putRegular();
        lineup.push({...file(e.path),...e,x:3,y,slotX:3,slotY:y,slotWidth:594,slotHeight:594,placedWidth:594,placedHeight:594,labelLines:[e.colorName],labelX:3,labelY:y+600,labelWidth:293,labelHeight:36,
          labels:[{lines:[e.colorName],x:3,y:y+600,width:293,height:36},{lines:[e.colorNameRight],x:304,y:y+600,width:293,height:36}]});
        lineupRows.push({kind:'dual',top:y,imageIndices:[i]});y+=636+7;
      }else{pending.push({e,i});if(pending.length===2)putRegular();}});
    putRegular();if(lineupRows.length)y-=7;
    calls.layouts.push(p);return {width:600,height:y||600,format:'psd',sourceCount:p.lineup.length+(p.singlePath?1:0),jpegCount:1,single:null,lineup,lineupRows,details:[],detailsHeader:null};
  };
  window.combineApp={
    getState:async()=>({outputFolder:'C:/Export',lastOutput:null}),
    chooseOutput:async()=>({outputFolder:'C:/Export'}),chooseFiles:async section=>({images:section==='lineup'?entries:[],failed:[]}),
    addPaths:async()=>({images:[],failed:[]}),getPathForFile:f=>f.name,
    layout:async p=>build(p),preview:async()=>({dataUrl:preview}),
    generate:async p=>{calls.generated.push(p);return {format:'psd',outputPath:'C:/Export/COMBINE.psd',jpegPaths:['C:/Export/COMBINE.jpg']};},
    openOutput:async()=>({ok:true}),reset:async()=>({}),onProgress:()=>{},
    scanRakuten:async()=>({images:[],method:'fixture'}),downloadRakuten:async()=>({folder:'',images:[]}),
    chooseRakutenFolder:async()=>null,openRakutenFolder:async()=>({}),previewRakuten:async()=>preview,onRakutenProgress:()=>{},
    chooseCleanupFiles:async()=>({images:[{path:'C:/mock/clean-duo.jpg',name:'clean-duo.jpg',width:600,height:600}],failed:[]}),
    addDownloadedToCleanup:async()=>({images:[],failed:[]}),
    scanCleanup:async filePath=>({filePath,width:600,height:600,previewDataUrl:preview,engine:'Mock OCR',warning:'',regions:[
      {id:'ocr-0',text:'Off White (012)',x:69,y:496,width:170,height:27,confidence:97,suggested:true},
      {id:'ocr-1',text:'Spugnola (110)',x:352,y:496,width:170,height:27,confidence:96,suggested:true},
      {id:'ocr-2',text:'BRAND LOGO',x:10,y:20,width:100,height:15,confidence:93,suggested:false}]}),
    previewCleanup:async()=>({previewDataUrl:preview,methods:['matched flat background'],warnings:[]}),
    saveCleanup:async()=>{calls.cleaned++;const path='C:/mock/COMBINE_CLEANED/clean_duo.png';return {path,imported:{images:[{path,name:'clean_duo.png',width:600,height:600}],failed:[]}};}
  };
})();'''.replace('__IMAGE_PREVIEW__', json.dumps(preview))

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox','--disable-gpu'])
    page = browser.new_page(viewport={'width':1440,'height':950}, device_scale_factor=1)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.evaluate(mock)
    html = (root/'index.html').read_text(encoding='utf8').replace('<link rel="stylesheet" href="style.css">','<style>'+(root/'style.css').read_text(encoding='utf8')+'</style>')
    for script in ['cleanupUi.js','app.js']:
        html = html.replace('<script src="'+script+'"></script>','<script>'+(root/script).read_text(encoding='utf8')+'</script>')
    page.set_content(html)
    page.locator('#chooseLineup').click()
    page.wait_for_function('document.querySelectorAll("#lineupItems .file-item").length===3')
    assert page.locator('#singleItems .file-item').count()==0
    # Every newly imported image exposes an obvious per-image second-name button.
    assert page.locator('#lineupItems .lineup-add-variant').count()==3
    assert page.locator('#lineupItems input.name-edit').count()==3
    page.locator('#lineupItems .lineup-add-variant').first.click()
    assert page.locator('#lineupItems .file-item').first.locator('input.name-edit').count()==2
    assert page.locator('#lineupItems .file-item').first.locator('[data-color-side="right"]').count()==1
    assert page.locator('#lineupItems .lineup-mode').first.input_value()=='dual'
    page.wait_for_function('document.getElementById("generate").disabled===true')
    page.locator('#lineupItems .file-item').first.locator('[data-color-side="left"]').fill('Off White (012)')
    page.locator('#lineupItems .file-item').first.locator('[data-color-side="right"]').fill('Spugnola (110)')
    page.wait_for_function('document.querySelectorAll(".composition-label").length===4')
    # Switching to one variant temporarily hides the second name, but retains it.
    page.locator('#lineupItems .lineup-add-variant').first.click()
    assert page.locator('#lineupItems .file-item').first.locator('input.name-edit').count()==1
    # Pasting both captions into the first field automatically restores two-name mode.
    page.evaluate('''() => {
      const field=document.querySelector('#lineupItems .file-item [data-color-side="left"]');
      const clipboard=new DataTransfer();
      clipboard.setData('text/plain','Off White (012) | Spugnola (110)');
      field.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:clipboard}));
    }''')
    assert page.locator('#lineupItems .lineup-mode').first.input_value()=='dual'
    assert page.locator('#lineupItems .file-item').first.locator('[data-color-side="left"]').input_value()=='Off White (012)'
    assert page.locator('#lineupItems .file-item').first.locator('[data-color-side="right"]').input_value()=='Spugnola (110)'
    # Bulk LEFT | RIGHT auto-promotes rows even without pre-selecting dual mode.
    page.locator('#setAllNormal').click()
    assert page.locator('#lineupItems input.name-edit').count()==3
    page.locator('#bulkColorNames').fill('Off White (012) | Spugnola (110)\nNavy (004) | Beige (106)\nBlack (001) | Red (002)')
    page.locator('#applyColors').click()
    assert page.locator('#lineupItems input.name-edit').count()==6
    assert all(v=='dual' for v in page.locator('#lineupItems .lineup-mode').evaluate_all('elements=>elements.map(el=>el.value)'))
    page.locator('#setAllDual').click()
    assert page.locator('#lineupItems .lineup-mode').count()==3
    assert page.locator('#lineupItems input.name-edit').count()==6
    assert all(v=='dual' for v in page.locator('#lineupItems .lineup-mode').evaluate_all('elements=>elements.map(el=>el.value)'))
    page.locator('#bulkColorNames').fill('Off White (012) | Spugnola (110)\nNavy (004) | Beige (106)\nBlack (001) | Red (002)')
    page.locator('#applyColors').click()
    page.wait_for_function('document.getElementById("generate").disabled===false')
    assert page.locator('#lineStat').inner_text()=='3 · 3 rows'
    page.wait_for_function('document.querySelectorAll(".composition-label").length===6')
    page.wait_for_function('document.querySelectorAll(".composition-image").length===3')
    assert page.locator('#fullPreview .composition-label').nth(0).inner_text()=='Off White (012)'
    assert page.locator('#fullPreview .composition-label').nth(1).inner_text()=='Spugnola (110)'
    page.screenshot(path='/mnt/data/BrandForge_v1.7.31_Two_Variant_UI_QA.png', full_page=True)
    # Mixing types flushes an incomplete normal row before each full-width row.
    page.locator('#lineupItems .lineup-mode').nth(1).select_option('single')
    page.wait_for_function('document.querySelectorAll(".composition-label").length===5')
    assert page.locator('#lineStat').inner_text()=='3 · 3 rows'
    page.locator('#generate').click()
    page.wait_for_function('mockCalls.generated.length===1')
    assert [x['rowMode'] for x in page.evaluate('mockCalls.generated[0].lineup')]==['dual','single','dual']
    # OCR-approved two separate labels also create a dual row automatically.
    page.locator('#clearLineup').click()
    page.locator('#cleanupChoose').click()
    page.wait_for_function('document.querySelectorAll(".cleanup-region-row").length===3')
    page.locator('#cleanupSelectSuggested').click()
    assert page.locator('.cleanup-region-row input:checked').count()==2
    page.locator('#cleanupPreview').click()
    page.wait_for_function('document.getElementById("cleanupSave").disabled===false')
    page.locator('#cleanupSave').click()
    page.wait_for_function('document.querySelectorAll("#lineupItems .file-item").length===1')
    assert page.locator('#lineupItems .lineup-mode').first.input_value()=='dual'
    assert page.locator('#lineupItems input.name-edit').nth(0).input_value()=='Off White (012)'
    assert page.locator('#lineupItems input.name-edit').nth(1).input_value()=='Spugnola (110)'
    page.wait_for_function('document.getElementById("generate").disabled===false')
    if errors:
        raise RuntimeError('Browser JS errors: '+str(errors))
    print('PASS v1.7.31 dual-row browser UI: per-image 2nd color button, paste LEFT | RIGHT, bulk auto-dual, mixed rows, PSD payload, OCR reuse')
    browser.close()
