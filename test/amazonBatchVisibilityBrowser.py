"""Developer-only browser regression: the shipped Amazon renderer with a mocked Electron bridge."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import re

ROOT = Path(__file__).resolve().parents[1]
PAGE = '/src/modules/amazon/renderer/index.html'
SCREENSHOT = Path('/mnt/data/BrandForge_v1.7.34_Amazon_Hide_Completed_UI_QA.png')

INIT = r'''(() => {
  const names = ['Main-A.jpg','Detail-A.jpg','Main-B.jpg','Detail-C.jpg'];
  const files = names.map(name => ({name, path:'G:\\brandforge-test\\'+name, relativePath:name, extension:'.jpg', sourceType:'jpg'}));
  window.amazonApp = {
    getVersion: async () => '1.7.34',
    getFilePreview: async () => ({ok:true,dataUrl:'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='}),
    chooseBatchImages: async () => ({files, errors:[]}),
    onProcessingProgress: () => {},
    getPathForFile: (file) => file.path || '',
    inspectBatchImages: async () => ({files,errors:[]}),
    scanImageFolder: async () => ({files, errors:[], warnings:[], folderPath:'G:\\brandforge-test', scannedFolders:1}),
    preflightBatch: async () => ({ok:true,errors:[],existingFiles:[]}),
    selectOutputFolder: async () => ({folderPath:'G:\\amazon-output'}),
  };
})();'''


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox','--allow-file-access-from-files'])
        page = browser.new_page(viewport={"width":1536,"height":980}, device_scale_factor=1)
        errors = []
        page.on('pageerror', lambda err: errors.append(str(err)))
        # Browser navigation is restricted in QA, so load the actual HTML and
        # script contents directly into the page in production script order.
        html_file = ROOT / PAGE.lstrip('/')
        raw = html_file.read_text(encoding='utf-8')
        scripts = re.findall(r'<script\s+src="([^"]+)"\s*></script>', raw)
        stylesheet_paths = re.findall(r'<link\s+rel="stylesheet"\s+href="([^"]+)"\s*/?>', raw)
        html = re.sub(r'<script\s+src="[^"]+"\s*></script>', '', raw)
        html = re.sub(r'<meta\s+http-equiv="Content-Security-Policy"[^>]*>', '', html, flags=re.I | re.S)
        page.set_content(html, wait_until='load')
        for src in stylesheet_paths:
            page.add_style_tag(content=(html_file.parent / src).resolve().read_text(encoding='utf-8'))
        page.evaluate(INIT)
        for src in scripts:
            page.add_script_tag(content=(html_file.parent / src).resolve().read_text(encoding='utf-8'))
        page.wait_for_timeout(250)
        assert not errors, 'JavaScript errors: '+ '\n'.join(errors)
        assert page.locator('#batchHideCompletedIds').is_checked()
        assert page.locator('#batchHideAssignedImages').is_checked()
        page.locator('#batchBulkIds').fill('ABC-001\nABC-002\nABC-003')
        page.locator('#batchAddIdsBtn').click()
        cards = page.locator('.batch-group-card')
        assert cards.count() == 3
        assert 'ABC-001' in cards.first.inner_text() and cards.first.get_attribute('aria-pressed') == 'true', 'bulk import must select first group'
        page.locator('#batchImportBtn').click()
        page.wait_for_timeout(150)
        assert page.locator('.batch-pool-tile').count() == 4
        page.locator('.batch-pool-tile').filter(has_text='Main-A.jpg').click()
        page.locator('.batch-pool-tile').filter(has_text='Detail-A.jpg').click()
        page.locator('#batchAssignBtn').click()
        assert page.locator('.batch-pool-tile').count() == 2, 'assigned thumbnails should hide'
        assert '2 / 8' in page.locator('#batchOrderCount').inner_text()
        page.locator('#batchMarkDoneBtn').click()
        assert '1 / 3' in page.locator('#batchCompletionCount').inner_text()
        assert page.locator('.batch-group-card').count() == 2
        assert 'ABC-002' in page.locator('.batch-group-card.active').inner_text(), 'mark done must auto-select next unfinished'
        page.locator('#batchShowAllBtn').click()
        assert page.locator('.batch-group-card').count() == 3
        assert page.locator('.batch-pool-tile').count() == 4
        assert page.locator('.batch-group-entry.is-done').count() == 1
        page.locator('#batchHideCompletedIds').check()
        assert page.locator('.batch-group-card').count() == 2
        page.locator('#batchHideAssignedImages').check()
        assert page.locator('.batch-pool-tile').count() == 2
        # Other ID's shared images must still be available when Show All is chosen.
        page.locator('#batchShowAllBtn').click()
        page.locator('.batch-pool-tile').filter(has_text='Main-A.jpg').click()
        page.locator('#batchAssignBtn').click()
        assert '1 / 8' in page.locator('#batchOrderCount').inner_text()
        page.locator('#batchMarkDoneBtn').click()
        assert '2 / 3' in page.locator('#batchCompletionCount').inner_text()
        assert 'ABC-003' in page.locator('.batch-group-card.active').inner_text()
        page.locator('#batchMarkDoneBtn').click()
        assert 'Product not ready' in page.locator('#batchStatus').inner_text()
        assert '2 / 3' in page.locator('#batchCompletionCount').inner_text(), 'cannot mark empty group done'
        page.locator('#batchShowAllBtn').click() if page.locator('#batchShowAllBtn').is_enabled() else None
        page.locator('.batch-group-card').filter(has_text='ABC-001').click()
        assert page.locator('#batchMarkDoneBtn').inner_text() == 'Reopen Selected'
        page.locator('#batchMarkDoneBtn').click()
        assert '1 / 3' in page.locator('#batchCompletionCount').inner_text()
        assert '2 / 8' in page.locator('#batchOrderCount').inner_text(), 'reopening cannot lose assignments'
        assert not errors, '\n'.join(errors)
        page.screenshot(path=str(SCREENSHOT), full_page=True)
        browser.close()
    print('PASS Amazon UI: bulk IDs select first, hide assigned/completed, mark done & next, show all/reuse, prevent empty done, reopen')
    print('Screenshot:', SCREENSHOT)

if __name__ == '__main__':
    main()
