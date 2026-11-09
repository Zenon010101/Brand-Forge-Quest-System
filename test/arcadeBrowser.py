#!/usr/bin/env python3
"""Optional development UI smoke test; not packaged with the Electron app."""
from pathlib import Path
from playwright.sync_api import sync_playwright
root = Path(__file__).resolve().parent.parent
arcade = root / 'src/modules/arcade'
html = (arcade / 'renderer/index.html').read_text()
css = (arcade / 'renderer/style.css').read_text()
engines = (arcade / 'shared/engines.js').read_text()
ui = (arcade / 'renderer/app.js').read_text()
html = html.replace('<link rel="stylesheet" href="style.css">', f'<style>{css}</style>')
html = html.replace('<script src="../shared/engines.js"></script>', '<script>'+engines+'</script>')
html = html.replace('<script src="app.js"></script>', '<script>'+ui+'</script>')
errors=[]
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox','--disable-gpu'])
    page = browser.new_page(viewport={'width': 1260, 'height': 990}, device_scale_factor=1)
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.set_content(html, wait_until='load')
    page.wait_for_timeout(500)
    assert page.locator('#profileName').inner_text() == 'Preview only'
    assert page.locator('.game-tile').count()==4
    assert page.locator('#gameTitle').inner_text()=='Snake'
    page.locator('#startButton').click()
    assert page.locator('#gameState').inner_text()=='PLAYING'
    page.wait_for_timeout(240)
    page.locator('#pauseButton').click()
    assert page.locator('#gameState').inner_text()=='PAUSED'
    page.locator('#startButton').click()
    assert page.locator('#gameState').inner_text()=='PLAYING'
    page.locator('[data-game="color"]').click()
    assert page.locator('#gameTitle').inner_text()=='Color Match Rush'
    page.locator('#startButton').click()
    page.wait_for_timeout(120)
    target = page.locator('#targetSwatch').evaluate('(el) => getComputedStyle(el).backgroundColor')
    tiles = page.locator('.color-choice')
    assert tiles.count()==9, tiles.count()
    matching_index = next(i for i in range(9) if tiles.nth(i).evaluate('(el) => getComputedStyle(el).backgroundColor')==target)
    tiles.nth(matching_index).click()
    assert page.locator('#currentScore').inner_text() == '0010', page.locator('#currentScore').inner_text()
    page.locator('[data-game="memory"]').click()
    page.locator('#startButton').click()
    assert page.locator('.memory-card').count()==16
    page.locator('.memory-card').nth(0).click()
    assert page.locator('.memory-card.revealed').count()==1
    page.locator('.memory-card').nth(1).click()
    assert '1 moves' in page.locator('#metricSecondary').inner_text()
    page.locator('[data-game="blocks"]').click()
    page.locator('#startButton').click()
    assert page.locator('#gameState').inner_text() == 'PLAYING'
    page.locator('#hardDropButton').click()
    assert int(page.locator('#currentScore').inner_text())>0
    page.locator('#soundToggle').click()
    assert page.locator('#soundToggle').inner_text()=='Sound: Off'
    page.locator('#pauseButton').click()
    assert page.locator('#gameState').inner_text()=='PAUSED'
    # Screen capture with Snake selected.
    page.locator('[data-game="snake"]').click()
    page.screenshot(path='/mnt/data/BrandForge_v1.7.39_Arcade_UI_QA.png', full_page=True)
    assert not errors, errors
    browser.close()
print('PASS Arcade browser UI: navigation, four games, score, pause/resume, sound, rendering')
