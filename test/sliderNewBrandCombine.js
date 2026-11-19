"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const { suggestFromSlider, outputHtml, generateSliderCombine, resolveLayout } = require("../src/modules/slider/main/combineFromSlider");
const { buildCombineLayout } = require("../src/modules/combine/main/planner");

(async () => {
    const suggestions = suggestFromSlider({layoutMode:"fourCut",creative:[{path:"/f/creative.jpg"}],
        detail:[{path:"/f/detail.jpg"}], lineupRows:[{photo1:{path:"/f/white.jpg"},variant1:"ホワイト",photo2:{path:"/f/black.jpg"},variant2:"Black",photo3:{path:"/f/blue.jpg"},variant3:"Blue x Green",photo4:{path:"/f/red.jpg"},variant4:"CANYON"}]});
    assert.equal(suggestions.lineupCount,4);
    assert.equal(suggestions.detailCount,2);
    const pa = suggestFromSlider({layoutMode:"paVertical",lineupRows:[{photo1:{path:"/f/item.jpg"},photo2:{path:"/f/feature.jpg"},variant1:"Ocean"}]});
    assert.equal(pa.lineupCount,1);
    assert.equal(pa.detailCount,1);
    assert.equal(pa.items[0].colorName,"Ocean");
    assert.equal(pa.items[1].section,"details");
    assert.deepEqual(suggestions.items.map(x=>x.section),["lineup","lineup","lineup","lineup","details","details"]);
    assert.match(outputHtml("SKU",["SKU.jpg"]), /src="SKU.jpg"/);
    assert.match(outputHtml("SKU",["SKU.jpg"],"https://image.example.jp/img"), /https:\/\/image.example.jp\/img\/SKU.jpg/);
    assert.throws(()=>outputHtml("SKU",["SKU.jpg"],"file:///tmp/"),/https/);
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"bf-slider-combine-test-"));
    try {
        const src=path.join(tmp,"input"); const out=path.join(tmp,"out");
        fs.mkdirSync(src);fs.mkdirSync(out);
        async function photo(filename,w,h,color){ const p=path.join(src,filename);
            await sharp({create:{width:w,height:h,channels:3,background:color}}).jpeg().toFile(p);return p; }
        const single=await photo("single.jpg",600,600,"#112233");
        const white=await photo("white.jpg",350,350,"#b8a4a4");
        const black=await photo("black.jpg",350,400,"#242830");
        const blue=await photo("blue.jpg",650,420,"#1188dd");
        const detail=await photo("details.jpg",360,300,"#48bc5e");
        const payload={outputFolder:out,outputName:"SKU_COMBINE",singlePath:single,items:[
            {path:white,section:"lineup",colorName:"ホワイト",rowMode:"single"},
            {path:black,section:"lineup",colorName:"Black x Green",rowMode:"single"},
            {path:blue,section:"lineup",colorName:"",rowMode:"single"},
            {path:detail,section:"details"}
        ], includePsd:false};
        const {layout}=await resolveLayout(payload);
        assert.equal(layout.width,600);
        assert.equal(layout.lineup.length,3);
        assert.equal(layout.details.length,1);
        assert.equal(layout.lineup[2].labels[0].lines.length,0);
        const messages=[];
        const result=await generateSliderCombine(payload,p=>messages.push(p.message));
        assert.equal(result.ok,true);
        assert.equal(result.jpegPaths.length,1);
        assert.equal(result.height,layout.height);
        assert.ok(fs.existsSync(result.htmlPath));
        const meta=await sharp(result.jpegPaths[0]).metadata();
        assert.equal(meta.width,600);assert.equal(meta.height,layout.height);
        const actualHtml=fs.readFileSync(result.htmlPath,"utf8");
        assert.match(actualHtml,/SKU_COMBINE.jpg/);
        assert.match(actualHtml,/<table width="600"/);
        assert.ok(messages.some(m=>m.includes("JPEG")));
        const second=await generateSliderCombine(payload,()=>{});
        assert.equal(second.outputName,"SKU_COMBINE_v2");
        assert.ok(second.jpegPaths[0].endsWith("SKU_COMBINE_v2.jpg"));
        // Photoshop failure cannot remove the already published JPG and HTML.
        const broken=await generateSliderCombine({...payload,outputName:"PSD_FAIL",includePsd:true},()=>{}, {
            psdBuilder:async()=>{throw new Error("PS mock failed");}
        });
        assert.ok(broken.psdWarning.includes("PS mock failed"));
        assert.ok(fs.existsSync(broken.jpegPaths[0]));assert.ok(fs.existsSync(broken.htmlPath));
        const special = await generateSliderCombine({outputFolder:out,outputName:"DUAL_VERTICAL",items:[
            {path:blue,section:"lineup",rowMode:"dual",colorName:"LEFT",colorNameRight:"RIGHT"},
            {path:blue,section:"lineup",rowMode:"vertical",colorName:"TOP",colorNameRight:"BOTTOM",captionTopY:0.4,captionBottomY:0.85},
            {path:detail,section:"details"}
        ],includePsd:false},()=>{});
        assert.ok(fs.existsSync(special.htmlPath));
        assert.equal(special.lineupCount,2);
        assert.equal((await sharp(special.jpegPaths[0]).metadata()).width,600);
        const noLabels=buildCombineLayout({single:null,lineup:[{
            width:300,height:300,visibleWidth:300,visibleHeight:300,name:"n",colorName:"",path:"n"
        }],details:[],outputName:"NO_CAPTION",allowBlankCaptions:true});
        assert.equal(noLabels.lineupRows[0].labelHeight,0);
        assert.throws(()=>buildCombineLayout({single:null,lineup:[{
            width:300,height:300,visibleWidth:300,visibleHeight:300,name:"n",colorName:"",path:"n"
        }],details:[],outputName:"OLD_RULE"}),/color name/);
        const fixture=path.join("/mnt/data","BrandForge_Slider_NewBrand_QA.jpg");
        await fs.promises.copyFile(result.jpegPaths[0],fixture);
        console.log("PASS: Slider classifications, new-brand layout, JPEG/HTML, optional PSD, collision-free versioning, original Combine captions");
        console.log(`QA JPEG: ${fixture}`);
    } finally { await fs.promises.rm(tmp,{recursive:true,force:true}); }
})().catch(err=>{console.error(err);process.exitCode=1;});
