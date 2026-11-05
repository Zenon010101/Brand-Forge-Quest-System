"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const sharp = require("sharp");
const { inspectBatch } = require("../src/modules/combine/main/assets");
const { DIM, buildCombineLayout } = require("../src/modules/combine/main/planner");
const { preparedEntry } = require("../src/modules/combine/main/photoshop");

function extractFunction(source, name) {
  const start=source.indexOf(`function ${name}(`);
  assert(start>=0,`Missing ${name}`);
  let depth=0, began=false;
  for(let i=source.indexOf('{',start);i<source.length;i++) {
    if(source[i]==='{') {depth++;began=true;}
    else if(source[i]==='}') {depth--;if(began&&!depth)return source.slice(start,i+1);}
  }
  throw new Error(`Unclosed function ${name}`);
}

async function run() {
  const dir=await fs.promises.mkdtemp(path.join(os.tmpdir(),"brandforge-spacing-"));
  try {
    // Dual product image with *large* white space below the actual objects:
    // the old planner used 594px from the source canvas and put text too low.
    const dual=path.join(dir,"dual.png");
    const stamp = await sharp({create:{width:230,height:350,channels:4,background:"#304f62"}}).png().toBuffer();
    await sharp({create:{width:600,height:600,channels:4,background:"#ffffff"}})
      .composite([{input:stamp,left:30,top:25},{input:stamp,left:340,top:30}])
      .png().toFile(dual);
    const regular=path.join(dir,"regular.png");
    const wideStamp=await sharp({create:{width:500,height:170,channels:4,background:"#263b72"}}).png().toBuffer();
    await sharp({create:{width:600,height:600,channels:4,background:"#ffffff"}})
      .composite([{input:wideStamp,left:45,top:40}]).png().toFile(regular);
    const found=await inspectBatch([dual,regular]);
    assert.equal(found.failed.length,0);
    const [a,b]=found.images;
    assert(a.visibleHeight<410,`Dual product height should exclude source white padding: ${a.visibleHeight}`);
    assert(b.visibleHeight<200,`Regular product height should exclude white padding: ${b.visibleHeight}`);
    const duo=buildCombineLayout({single:null,lineup:[{...a,rowMode:"dual",colorName:"Left Green",colorNameRight:"Right Blue"}],details:[],outputName:"DUO"});
    assert(duo.height<510,`Dual label should sit under visible objects, not 600px source: ${duo.height}`);
    assert.equal(duo.lineup[0].labels.length,2);
    assert.equal(duo.lineup[0].labelY-(duo.lineup[0].y+duo.lineup[0].placedHeight),DIM.labelGap);
    const preparedDual=await preparedEntry(duo.lineup[0],0,dir,new Map());
    assert.equal(duo.lineup[0].labelY-(preparedDual.y+preparedDual.placedHeight),DIM.labelGap,
      "Actual scaled Photoshop layer bottom must be immediately above label");

    const pair=buildCombineLayout({single:null,lineup:[{...b,colorName:"Navy"},{...a,colorName:"Green"}],details:[],outputName:"PAIR"});
    assert.equal(pair.lineupRows.length,1);
    assert(pair.lineupRows[0].imageHeight<DIM.cell,"Short products should not reserve full 293px row height");
    for (let i=0;i<2;i++) {
      const entry=pair.lineup[i];
      assert.equal(entry.labelY-(entry.y+entry.placedHeight),DIM.labelGap,
        `Product ${i+1} and editable caption should have a close fixed gap`);
      const prepared=await preparedEntry(entry,i+2,dir,new Map());
      assert.equal(entry.labelY-(prepared.y+prepared.placedHeight),DIM.labelGap);
    }
    assert(pair.height<335,"Dynamic Line Up rows should not keep unnecessary vertical space");
    // UI guard: typing a blank RIGHT caption must not invoke the IPC layout.
    const app=fs.readFileSync(path.join(__dirname,"../src/modules/combine/renderer/app.js"),"utf8");
    const code=extractFunction(app,"missingLineupName")+"\n"+extractFunction(app,"requestLayout");
    let calls=0, errors=0;
    const getResult=(entries)=>{
      calls=0;errors=0;
      const ctx={state:{lineup:entries,layout:null,error:null},planSeq:0,
        allEntries:()=>entries,
        showPlan:()=>{errors++;},
        api:{layout:()=>{calls++;return Promise.resolve({height:100});}},
        payload:()=>({lineup:entries})};
      vm.runInNewContext(code+"\nrequestLayout();",ctx,{timeout:1000});
      return ctx.state;
    };
    const emptyRight=getResult([{rowMode:"dual",colorName:"Off White",colorNameRight:""}]);
    assert.match(emptyRight.error,/RIGHT color name/);
    assert.equal(calls,0,"Unfinished dual item should never spam the IPC handler");
    getResult([{rowMode:"dual",colorName:"Off White",colorNameRight:"Spugnola"}]);
    assert.equal(calls,1,"Completed pair should request the layout normally");
    const blankLeft=getResult([{rowMode:"single",colorName:""}]);
    assert.match(blankLeft.error,/color name/);
    assert.equal(calls,0);
    // Photoshop must use explicit item x/y, rather than recentering it into
    // the fixed source slot after the planner places the image near its text.
    const jsx=fs.readFileSync(path.join(__dirname,"../src/modules/combine/jsx/compose.jsx"),"utf8");
    assert(jsx.includes("px(Number(dest.y) - b.y)"));
    console.log("PASS Combine: measured product bounds, close dual + regular captions, bottom-aligned Photoshop images, and no IPC spam for unfinished names");
  } finally { await fs.promises.rm(dir,{recursive:true,force:true}); }
}
run().catch(e=>{console.error(e);process.exitCode=1;});
