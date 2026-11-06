"""Optional Browser QA for auto-clean Rakuten UI; Python is not needed to run BrandForge."""
from pathlib import Path
from playwright.sync_api import sync_playwright
root = Path(__file__).resolve().parents[1] / "src/modules/combine/renderer"
mock = r'''(() => {
 const slides=[{index:1,name:'001_colors.jpg',url:'https://image.rakuten.co.jp/glv/cabinet/a_1.jpg'},
               {index:2,name:'002_detail.jpg',url:'https://image.rakuten.co.jp/glv/cabinet/a_2.jpg'}];
 const calls={downloads:[],previews:[]}; window.testCalls=calls;
 const thumb='data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%22100%22%20height=%22100%22%3E%3C/svg%3E';
 window.combineApp = {
  getState:async()=>({outputFolder:'C:/out'}),chooseOutput:async()=>({outputFolder:'C:/out'}),
  preview:async()=>({dataUrl:thumb}),chooseFiles:async()=>({images:[],failed:[]}),addPaths:async()=>({images:[],failed:[]}),
  getPathForFile:f=>f.name,layout:async()=>{throw Error('No images');},generate:async()=>({}),openOutput:async()=>({}),reset:async()=>({}),onProgress:()=>{},
  scanRakuten:async()=>({method:'gallery',images:slides,sourcePage:'https://item.rakuten.co.jp/glv/abc',sliderPage:'https://www.rakuten.ne.jp/gold/glv/item.html'}),
  chooseRakutenFolder:async()=>null,openRakutenFolder:async()=>({}),
  downloadRakuten:async (folder,opts)=> {calls.downloads.push({folder,opts});return {folder:'C:/Downloads/item',images:slides.map((s,i)=>({...s,width:600,height:600,
    path:'C:/Downloads/item/'+s.name,status:'downloaded',cleanup: opts.autoClean ? (i===0 ? {status:'cleaned',removedCount:2,cleanedPath:'C:/Downloads/item/COMBINE_CLEANED/a.png'}
     : {status:'needs-review',warning:'background not uniform'}) : undefined}))};},
  previewRakuten:async(index,options)=>{calls.previews.push({index,options});return thumb;},onRakutenProgress:()=>{},
  chooseCleanupFiles:async()=>({images:[],failed:[]}),addDownloadedToCleanup:async()=>({images:[],failed:[]}),
  scanCleanup:async()=>({regions:[],width:600,height:600,previewDataUrl:thumb,engine:'fixture'}),
  previewCleanup:async()=>({previewDataUrl:thumb}),saveCleanup:async()=>({})
 };
})();'''
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path="/usr/bin/chromium",headless=True,args=["--no-sandbox","--disable-gpu"])
    page=browser.new_page(viewport={"width":1365,"height":920})
    errors=[]
    page.on("pageerror", lambda e:errors.append(str(e)))
    page.evaluate(mock)
    html=(root/"index.html").read_text()
    html=html.replace('<link rel="stylesheet" href="style.css">','<style>'+(root/"style.css").read_text()+'</style>')
    for script in ["cleanupUi.js","app.js"]:
        html=html.replace(f'<script src="{script}"></script>','<script>'+(root/script).read_text()+'</script>')
    page.set_content(html)
    assert page.locator('#rakutenAutoCleanup').is_checked()
    page.locator('#rakutenUrl').fill('https://item.rakuten.co.jp/glv/abc')
    page.locator('#rakutenDownload').click()
    page.wait_for_function('document.getElementById("rakutenStatus").textContent.includes("Downloaded 2/2")')
    assert page.evaluate('window.testCalls.downloads[0].opts.autoClean') is True
    assert 'Cleaned 1 slide' in page.locator('#rakutenStatus').inner_text()
    assert '1 need review' in page.locator('#rakutenStatus').inner_text()
    assert page.locator('#rakutenSlideList').inner_text().count('Original saved')==2
    assert page.locator('#rakutenSlideList').inner_text().find('Cleaned 2 caption(s)')!=-1
    assert page.locator('#rakutenSlideList').inner_text().find('needs review')!=-1
    assert page.locator('#lineupItems .file-item').count()==0, 'Do not auto assign slide categories'
    page.wait_for_function('window.testCalls.previews.length===2')
    page.locator('#rakutenPreviewOriginals').check()
    page.wait_for_function('window.testCalls.previews.length===4')
    assert page.evaluate('window.testCalls.previews[3].options.original') is True
    page.locator('#rakutenAutoCleanup').uncheck()
    page.locator('#rakutenDownload').click()
    page.wait_for_function('window.testCalls.downloads.length===2')
    assert page.evaluate('window.testCalls.downloads[1].opts.autoClean') is False
    page.wait_for_function('document.getElementById("rakutenStatus").textContent.includes("Automatic cleanup was off")')
    if errors: raise RuntimeError('\n'.join(errors))
    print('PASS UI: auto-on, cleaned and review statuses, original thumbnails toggle, auto-off, no Combine auto assign')
    browser.close()
