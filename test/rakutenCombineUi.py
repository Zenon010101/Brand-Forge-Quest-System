import pathlib
from playwright.sync_api import sync_playwright
root=pathlib.Path(__file__).resolve().parents[1]/'src/modules/combine/renderer'
mock='''(() => {
  const origin='https://image.rakuten.co.jp/glv/cabinet/lavenham/lvh-97_';
  const images=[1,2,3,4].map(i=>({index:i,url:origin+i+'.jpg',name:'lvh-97_'+i+'.jpg'}));
  const calls={scanned:[],downloads:[],opened:0};
  window.rakTest={calls};
  window.combineApp={
    getState:async()=>({outputFolder:'C:/Output',lastOutput:null}),
    chooseFiles:async()=>({images:[],failed:[]}),addPaths:async()=>({images:[],failed:[]}),
    getPathForFile:file=>file.name,chooseOutput:async()=>({outputFolder:'C:/Output'}),
    preview:async()=>({dataUrl:'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%22200%22%20height=%22100%22%3E%3C/svg%3E'}),
    layout:async payload=>{if(!payload.singlePath)throw Error('Single required');return {width:600,height:600,format:'psd',sourceCount:1,jpegCount:1,single:{path:payload.singlePath,x:0,y:0,placedWidth:600,placedHeight:600},lineup:[],details:[],detailsHeader:null}},
    generate:async()=>({ok:true,format:'psd',outputPath:'C:/Output/TEST.psd',jpegPaths:['C:/Output/TEST.jpg']}),
    openOutput:async()=>({ok:true}),reset:async()=>({ok:true}),onProgress:()=>{},
    scanRakuten:async payload=>{calls.scanned.push(payload);return {sourcePage:payload.url,sliderPage:'https://www.rakuten.ne.jp/gold/glv/six/lavenham/LVH-97.html',method:'lightslider-gallery',images}},
    chooseRakutenFolder:async()=> 'D:/Rakuten Originals',
    downloadRakuten:async folder=>{calls.downloads.push(folder);return {folder:'D:/Rakuten Originals/LVH-97',images:images.map(i=>({...i,path:'D:/Rakuten Originals/LVH-97/00'+i.index+'_lvh-97_'+i.index+'.jpg',width:250,height:170,bytes:2048,status:'downloaded'}))}},
    previewRakuten:async()=> 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%22200%22%20height=%22100%22%3E%3C/svg%3E',
    openRakutenFolder:async()=>{calls.opened++;return {ok:true}},
    onRakutenProgress:()=>{}
  };
})();'''
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-gpu'])
    page=browser.new_page(viewport={'width':1490,'height':970})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.add_init_script(mock)
    page.evaluate(mock)
    html=(root/'index.html').read_text()
    html=html.replace('<link rel="stylesheet" href="style.css">','<style>'+ (root/'style.css').read_text()+'</style>')
    html=html.replace('<script src="app.js"></script>','<script>'+(root/'app.js').read_text()+'</script>')
    page.set_content(html)
    assert page.locator('#rakutenUrl').is_visible()
    assert page.locator('#rakutenDownload').is_enabled()
    assert page.locator('#rakutenOpenFolder').is_disabled()
    assert page.locator('#rakutenSlideList select').count()==0
    assert page.locator('#rakutenAddToCombine').count()==0
    page.locator('#rakutenUrl').fill('https://item.rakuten.co.jp/glv/lvh-97/')
    # No scan and no category interaction: one click scans and downloads.
    page.locator('#rakutenDownload').click()
    page.wait_for_function('document.getElementById("rakutenStatus").textContent.includes("Downloaded 4/4")')
    assert page.locator('.rakuten-slide').count()==4
    assert page.locator('.rakuten-slide-number').all_inner_texts()==['001','002','003','004']
    assert page.locator('#rakutenSlideList select').count()==0
    assert page.locator('#rakutenStatus').inner_text().find('No categorization was applied')!=-1
    assert page.locator('#rakutenOpenFolder').is_enabled()
    assert page.evaluate('window.rakTest.calls.scanned[0].url')=='https://item.rakuten.co.jp/glv/lvh-97/'
    assert page.evaluate('window.rakTest.calls.downloads[0]') is None
    page.locator('#rakutenOpenFolder').click()
    assert page.evaluate('window.rakTest.calls.opened')==1
    page.locator('#rakutenChooseFolder').click()
    page.locator('#rakutenDownload').click()
    page.wait_for_function('window.rakTest.calls.downloads.length===2')
    assert page.evaluate('window.rakTest.calls.downloads[1]')=='D:/Rakuten Originals'
    assert page.locator('#singleItems .file-item').count()==0
    assert page.locator('#lineupItems .file-item').count()==0
    assert page.locator('#detailItems .file-item').count()==0
    page.screenshot(path='/mnt/data/BrandForge_v1.7.23_Rakuten_Download_Only_UI.png',full_page=True)
    if errors:raise RuntimeError('\n'.join(errors))
    print('PASS: Rakuten product URL -> one-click download only, numbered originals, no categorization, optional folder, open folder')
    browser.close()
