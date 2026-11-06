"""Optional Chromium UI QA for precision caption masking. Requires Playwright."""
import ast
from pathlib import Path
from playwright.sync_api import sync_playwright
root = Path(__file__).resolve().parents[1]
renderer = root / 'src/modules/combine/renderer'
# Reuse the existing downloader + cleanup mock, without importing its executable test.
browser_test = ast.parse((root / 'test/combineCleanupBrowser.py').read_text(encoding='utf8'))
mock = next(ast.literal_eval(n.value) for n in browser_test.body if isinstance(n,ast.Assign)
            and any(isinstance(t,ast.Name) and t.id=='mock' for t in n.targets))
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-gpu'])
    page=browser.new_page(viewport={'width':1320,'height':980}, device_scale_factor=1)
    page_errors=[]
    page.on('pageerror', lambda err:page_errors.append(str(err)))
    page.evaluate(mock)
    html=(renderer/'index.html').read_text(encoding='utf8')
    html=html.replace('<link rel="stylesheet" href="style.css">','<style>'+(renderer/'style.css').read_text(encoding='utf8')+'</style>')
    for js in ['../shared/captionLayout.js','cleanupUi.js','app.js']:
        html=html.replace('<script src="'+js+'"></script>','<script>'+(renderer/js).read_text(encoding='utf8')+'</script>')
    page.set_content(html)
    assert page.locator('#cleanupRestore').input_value()=='clean'
    page.locator('#cleanupChoose').click()
    page.wait_for_function('document.querySelectorAll(".cleanup-region-row").length===2')
    page.locator('#cleanupSelectSuggested').click()
    def mask_pixel(x,y):
        return page.evaluate('''([x,y])=>{
            const c=document.getElementById('cleanupMask');
            return c.getContext('2d').getImageData(Math.round(x*c.width/600),Math.round(y*c.height/400),1,1).data[3];
        }''',[x,y])
    assert mask_pixel(200,320)>10, 'Approved OCR text area should be highlighted'
    def paint(source_x, source_y):
        stage=page.locator('#cleanupStage')
        rect=stage.bounding_box()
        x=rect['x']+rect['width']*source_x/600
        y=rect['y']+rect['height']*source_y/400
        page.mouse.move(x,y); page.mouse.down();page.mouse.move(x+2,y+1,steps=2);page.mouse.up()
    page.locator('#cleanupBrush').click()
    assert page.locator('#cleanupBrush').get_attribute('class').find('active')>=0
    paint(405,325)
    assert mask_pixel(405,325)>10,'Brush should ADD to selection'
    page.locator('#cleanupEraser').click()
    assert page.locator('#cleanupRestore').input_value()=='clean'
    paint(200,320)
    assert mask_pixel(200,320)==0, 'Eraser must REMOVE green mask pixels'
    assert page.locator('#cleanupUndo').is_enabled()
    page.locator('#cleanupUndo').click()
    assert mask_pixel(200,320)>10, 'Undo restores the selected region'
    page.locator('#cleanupRedo').click()
    assert mask_pixel(200,320)==0, 'Redo restores the eraser hole'
    assert page.locator('#cleanupSave').is_disabled(), 'Mask change should invalidate preview'
    page.locator('#cleanupPreview').click()
    page.wait_for_function('document.getElementById("cleanupSave").disabled===false')
    payload=page.evaluate('mockCalls.preview.at(-1)')
    assert payload['engine']=='clean'
    assert len(payload['strokes'])==2
    assert payload['strokes'][0]['mode']=='add' and payload['strokes'][1]['mode']=='erase'
    assert payload['areas'][0]['x']==170
    assert payload['feather']==0
    page.locator('#cleanupBefore').click()
    page.locator('#cleanupFeather').select_option('1')
    assert page.locator('#cleanupSave').is_disabled(), 'Feather change invalidates QC'
    page.locator('#cleanupPreview').click()
    page.wait_for_function('document.getElementById("cleanupSave").disabled===false')
    page.locator('#cleanupSave').click()
    page.wait_for_function('document.querySelectorAll("#lineupItems .file-item").length===1')
    assert page.evaluate('mockCalls.save.at(-1).strokes.length')==2
    page.locator('#cleanupRestore').select_option('photoshop')
    assert page.locator('#cleanupSave').is_disabled()
    page.locator('#cleanupPreview').click()
    assert 'require Clean Fill' in page.locator('#cleanupStatus').inner_text()
    page.locator('#cleanupRestore').select_option('clean')
    page.locator('#cleanupClearSelections').click()
    assert page.evaluate('cleanupCurrent().strokes.length')==0
    page.locator('#cleanupUndo').click()
    assert page.evaluate('cleanupCurrent().strokes.length')==2
    page.screenshot(path='/mnt/data/BrandForge_v1.7.33_Precision_Eraser_UI_QA.png',full_page=True)
    if page_errors: raise AssertionError(page_errors)
    browser.close()
    print('PASS Combine brush/eraser UI: precise mask, undo/redo, preview requirement, feather, Photoshop guard, safe save and Combine import')
