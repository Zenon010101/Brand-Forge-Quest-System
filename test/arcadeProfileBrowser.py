#!/usr/bin/env python3
"""Optional browser test: simulated Electron IPC per-profile state and pause/resume."""
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parent.parent
arcade = root / 'src/modules/arcade'
html = (arcade / 'renderer/index.html').read_text()
css = (arcade / 'renderer/style.css').read_text()
engines = (arcade / 'shared/engines.js').read_text()
ui = (arcade / 'renderer/app.js').read_text().replace('let remaining = 45;', 'let remaining = .65;').replace('remaining = 45; elapsed', 'remaining = .65; elapsed')
bridge = '''<script>
window.__arcadeProfiles = {
 a: { profileId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", displayName: "Designer A", soundEnabled: true, highScores: {snake:0,color:0,memory:0,blocks:0}},
 b: { profileId: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb", displayName: "Designer B", soundEnabled: false, highScores: {snake:0,color:0,memory:0,blocks:0}}
};
window.__currentArcadeUser = "a";
window.arcadeApp = {
 getState: async () => ({...window.__arcadeProfiles[window.__currentArcadeUser],highScores:{...window.__arcadeProfiles[window.__currentArcadeUser].highScores}}),
 saveScore: async (game,score) => {
    const user = window.__arcadeProfiles[window.__currentArcadeUser];
    const updated = score > user.highScores[game];
    if (updated) user.highScores[game] = score;
    return {updated,highScores:{...user.highScores},soundEnabled:user.soundEnabled};
 },
 setSound: async enabled => {window.__arcadeProfiles[window.__currentArcadeUser].soundEnabled=enabled;return {soundEnabled:enabled};}
};
</script>'''
html = html.replace('<link rel="stylesheet" href="style.css">', f'<style>{css}</style>')
html = html.replace('<script src="../shared/engines.js"></script>', '<script>'+engines+'</script>')
html = html.replace('<script src="app.js"></script>', bridge+'<script>'+ui+'</script>')
errors=[]
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox','--disable-gpu'])
    page = browser.new_page(viewport={'width':1160,'height':850})
    page.on('pageerror',lambda err: errors.append(str(err)))
    page.set_content(html)
    page.wait_for_timeout(160)
    assert page.locator('#profileName').inner_text()=='Designer A'
    page.locator('[data-game="color"]').click()
    page.locator('#startButton').click()
    target=page.locator('#targetSwatch').evaluate('(el)=>getComputedStyle(el).backgroundColor')
    tile=next(i for i in range(9) if page.locator('.color-choice').nth(i).evaluate('(el)=>getComputedStyle(el).backgroundColor')==target)
    page.locator('.color-choice').nth(tile).click()
    assert int(page.locator('#currentScore').inner_text())==10
    page.wait_for_timeout(1100)
    assert page.locator('#gameState').inner_text()=='GAME OVER', page.locator('#gameState').inner_text()
    assert page.locator('[data-best="color"]').inner_text()=='10'
    page.locator('[data-game="blocks"]').click()
    page.locator('#startButton').click()
    page.evaluate("window.postMessage({source:'brandforge-shell',type:'arcade-hidden'},'*')")
    page.wait_for_timeout(100)
    assert page.locator('#gameState').inner_text()=='PAUSED'
    page.evaluate("window.postMessage({source:'brandforge-shell',type:'arcade-profile-refresh'},'*')")
    page.wait_for_timeout(100)
    assert page.locator('#gameState').inner_text()=='PAUSED', 'same profile should retain paused game'
    assert page.locator('[data-best="color"]').inner_text()=='10'
    page.evaluate("window.__currentArcadeUser='b';window.postMessage({source:'brandforge-shell',type:'arcade-profile-refresh'},'*')")
    page.wait_for_timeout(120)
    assert page.locator('#profileName').inner_text()=='Designer B'
    assert page.locator('[data-best="color"]').inner_text()=='0', 'profiles must not share scores'
    assert page.locator('#soundToggle').inner_text()=='Sound: Off', 'per-profile sound should be read'
    assert not errors, errors
    browser.close()
print('PASS Arcade profile browser: high scores persisted, paused game retained, profile isolation, sound')
