'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const load = p => fs.readFileSync(path.join(root,p),'utf8');
for (const file of ['src/modules/amazon/renderer/index.html','src/modules/slider/renderer/index.html']) {
    const html = load(file);
    assert(html.includes('projectLink.css'), `${file}: missing project styles`);
    assert(html.includes('projectLink.js'), `${file}: missing project controller`);
}
assert(load('src/modules/amazon/renderer/index.html').includes('id="amazonBrandProject"'));
assert(load('src/modules/slider/renderer/index.html').includes('id="sliderBrandProject"'));
assert(load('src/main/preload.js').includes('brandProjectApp'));
assert(load('src/main/main.js').includes('project-location/main/register'));
assert(load('src/modules/amazon/main/register.js').includes('autoColorboxFolder'));
assert(load('src/modules/amazon/main/register.js').includes('verifiedAmazonProject(payload'));
assert(load('src/modules/amazon/renderer/batchWorkspace.js').includes('projectRoot: linkedProjectRoot'));
assert(load('src/modules/amazon/renderer/app.js').includes('projectRoot: linkedProjectRoot'));
assert(load('src/modules/slider/renderer/app.js').includes('projectRoot: state.linkedProjectRoot'));
assert(load('src/modules/slider/main/register.js').includes('assertMarkerSafe(linkedProject'));
assert(load('src/modules/slider/main/register.js').includes('publishGroup('));
assert(!load('src/modules/project-location/main/projectPaths.js').includes('Photoshop.Application'));
// Regression: a new Google Drive locator is a real grid row, not a zero-height
// child painting over the Amazon Export fields (v1.7.17 bug).
const amazonStyle = load('src/modules/amazon/renderer/style.css');
const sliderStyle = load('src/modules/slider/renderer/style.css');
const locator = load('src/modules/project-location/renderer/projectLink.js');
assert(amazonStyle.includes('grid-template-rows: auto auto auto minmax(680px, 1fr)'), 'Amazon locator must have a separate grid row');
assert(sliderStyle.includes('grid-template-rows: auto auto auto minmax(520px, 1fr) auto'), 'Slider locator must have a separate grid row');
assert(amazonStyle.includes('body { overflow-y: auto; }'), 'Amazon must scroll rather than overlap panels');
assert(sliderStyle.includes('overflow-y: auto;'), 'Slider must scroll rather than overlap panels');
assert(locator.includes('selectors[requiredRole]?.value'), 'The apply button must use the module-specific marker selection');
assert(locator.includes('updateApplyState();'), 'Apply state must refresh after selecting a marker');
assert(locator.includes('brandforge:project-linked'), 'Linking must dispatch the event to fill output locations');
console.log('PASS G: locator layout + Apply button gating; Amazon, Slider, Colorbox linking preserved');
