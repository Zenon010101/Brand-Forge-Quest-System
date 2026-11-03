import pathlib, threading, http.server, socketserver
from playwright.sync_api import sync_playwright
root=pathlib.Path(__file__).resolve().parents[1]/'src/modules/combine/renderer'
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
class Handler(Quiet):
    def __init__(self,*a,**k): super().__init__(*a,directory=str(root),**k)
server=socketserver.TCPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
base=(root/"index.html").as_uri()
mock='''(() => {
  const entries = {
    single:[{path:'C:/mock/SINGLE.png',name:'SINGLE.png',width:600,height:600}],
    lineup:['Black.png','Navy.png','Beige.png','White.png'].map(n=>({path:'C:/mock/'+n,name:n,width:500,height:500})),
    details:['detail01.png','detail02.png','detail03.png'].map(n=>({path:'C:/mock/'+n,name:n,width:500,height:700}))
  };
  function fit(item,x,y) {const w=293, h=293;return {...item,x,y,slotX:x,slotY:y,placedWidth:w,placedHeight:h};}
  window.combineApp={
    getState: async()=>({outputFolder:'C:/Exports',lastOutput:null}),
    chooseFiles: async(section)=>({images:entries[section],failed:[]}),
    addPaths: async(paths)=>({images:paths.map(p=>({...entries.lineup[0],path:p,name:p.split('/').pop()})),failed:[]}),
    getPathForFile:f=>f.name, chooseOutput:async()=>({outputFolder:'C:/Exports'}),
    layout: async(p)=>{
      if(!p.singlePath) throw new Error('Missing Single');
      if(p.lineup.some(x=>!x.colorName.trim())) throw new Error('Color name required');
      const l=p.lineup.map((x,i)=>({...fit({path:x.path,name:x.path.split('/').pop()},i%2?304:3,615+Math.floor(i/2)*342),labelLines:[x.colorName],labelX:i%2?304:3,labelY:615+Math.floor(i/2)*342+299,labelWidth:293,labelHeight:36}));
      let y=600 + ((p.lineup.length || p.details.length) ? 15 : 0);
      if(l.length) y+=Math.ceil(l.length/2)*342-7;
      let header=null, d=[];
      if(p.details.length){
        if(l.length) y+=30;
        header={x:8,y,height:36,fontSize:28};
        y+=36+16;
        d=p.details.map((x,i)=>fit({path:x,name:x.split('/').pop()},i%2?304:3,y+Math.floor(i/2)*300));
        y+=Math.ceil(d.length/2)*293+Math.max(0,Math.ceil(d.length/2)-1)*7+3;
      }
      return {width:600,height:y,format:'psd',sourceCount:1+l.length+d.length,jpegCount:1,
         single:{path:p.singlePath,name:'SINGLE.png',x:0,y:0,placedWidth:600,placedHeight:600},
         lineup:l,details:d,detailsHeader:header};
    },
    preview:async()=>({dataUrl:'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%22100%22%20height=%22100%22%3E%3Crect%20width=%22100%22%20height=%22100%22%20fill=%22%23bea99b%22/%3E%3C/svg%3E'}),
    generate:async()=>({ok:true,format:'psd',outputPath:'C:/Exports/PRODUCT_COMBINE.psd',jpegPaths:['C:/Exports/PRODUCT_COMBINE.jpg']}),
    openOutput:async()=>({ok:true}),reset:async()=>({ok:true}),onProgress:()=>()=>{}
  };
})();'''
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-gpu'])
    ctx=browser.new_context(viewport={'width':1500,'height':940},device_scale_factor=1)
    ctx.add_init_script(mock)
    page=ctx.new_page()
    errors=[]
    page.on('pageerror',lambda error: errors.append(str(error)))
    page.evaluate(mock)
    html = (root/"index.html").read_text()
    css = (root/"style.css").read_text()
    js = (root/"app.js").read_text()
    html = html.replace('<link rel="stylesheet" href="style.css">', "<style>"+css+"</style>").replace('<script src="app.js"></script>', "<script>"+js+"</script>")
    page.set_content(html)
    page.wait_for_timeout(200)
    assert page.locator('h1').inner_text().startswith('COMBINE Generator')
    page.locator('#chooseSingle').click()
    page.locator('#chooseLineup').click()
    page.locator('#chooseDetails').click()
    page.wait_for_timeout(700)
    assert page.locator('#singleItems .file-item').count()==1
    assert page.locator('#lineupItems .file-item').count()==4
    assert page.locator('#detailItems .file-item').count()==3
    assert page.locator('#lineupItems input.name-edit').nth(0).input_value()=='Black'
    page.locator('#bulkColorNames').fill('BROWN\nRED\nBLACK\nWHITE')
    page.locator('#applyColors').click()
    assert page.locator('#lineupItems input.name-edit').nth(0).input_value()=='BROWN'
    # Move last variation up with reorder arrow; its label must move with it.
    page.locator('#lineupItems .file-item').nth(3).locator('button').nth(0).click()
    assert page.locator('#lineupItems input.name-edit').nth(2).input_value()=='WHITE'
    assert page.locator('#lineupItems input.name-edit').nth(3).input_value()=='BLACK'
    page.locator('#lineupItems .file-item').nth(3).drag_to(page.locator('#lineupItems .file-item').nth(0))
    page.wait_for_timeout(200)
    assert page.locator('#lineupItems input.name-edit').nth(0).input_value()=='BLACK'
    page.wait_for_timeout(300)
    assert page.locator('#generate').is_enabled(),page.locator('#warnings').inner_text()
    assert page.locator('#heightStat').inner_text().endswith('px')
    page.screenshot(path='/mnt/data/BrandForge_v1.7.21_Combine_Optional_Line_Up.png',full_page=True)
    page.locator('#generate').click()
    page.wait_for_timeout(100)
    assert 'Completed' in page.locator('#statusText').inner_text()
    # Empty Line Up is a supported first-class case: Details move directly
    # below Single without a fake Line Up row or color-name layers.
    page.locator('#clearLineup').click()
    page.wait_for_timeout(300)
    assert page.locator('#lineupItems .file-item').count()==0
    assert not page.locator('#lineupBulk').is_visible()
    assert 'optional' in page.locator('#lineupItems').inner_text().lower()
    assert page.locator('#generate').is_enabled(),page.locator('#warnings').inner_text()
    assert 'Line Up skipped' in page.locator('#warnings').inner_text()
    assert page.locator('.composition-label').count()==0
    assert page.locator('#lineStat').inner_text().startswith('0')
    assert page.locator('#detailsStat').inner_text().startswith('3')
    page.screenshot(path='/mnt/data/BrandForge_v1.7.21_Combine_Optional_Line_Up.png',full_page=True)
    page.locator('#generate').click()
    page.wait_for_timeout(100)
    assert 'Completed' in page.locator('#statusText').inner_text()
    # Single-only should be allowed, with no unused 15 px trailing gap.
    page.locator('#clearDetails').click()
    page.wait_for_timeout(300)
    assert page.locator('#generate').is_enabled(),page.locator('#warnings').inner_text()
    assert 'Single-only Combine' in page.locator('#warnings').inner_text()
    assert page.locator('#heightStat').inner_text()=='600 px'
    page.locator('#generate').click()
    page.wait_for_timeout(100)
    assert 'Completed' in page.locator('#statusText').inner_text()
    if errors: raise RuntimeError('\n'.join(errors))
    print('PASS Combine UI: all sections, no Line Up with Details, Single-only, ordering and Generate')
    browser.close()
server.shutdown()
