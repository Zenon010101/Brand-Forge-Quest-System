"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { moveCard, moveVariation, insertDroppedPhotos, moveReviewedItem } =
    require("../src/modules/slider/renderer/lineupDragDrop");
const { suggestFromSlider } = require("../src/modules/slider/main/combineFromSlider");
const root = path.resolve(__dirname, "../src");
const f = (name) => ({ path: "C:\\images\\" + name + ".png", name: name + ".png" });
const row = (id) => ({ _outputId:id, photo1:null,photo2:null,photo3:null,photo4:null,
    variant1:"",variant2:"",variant3:"",variant4:"",shadow1:false,shadow2:false,shadow3:false,shadow4:false });

// Slider: Dragging a color preserves photo + variant + shadow as one unit.
const a = row("a"), b = row("b");
a.photo1 = f("red"); a.variant1="赤 x 白"; a.shadow1=true;
b.photo2 = f("blue"); b.variant2="BLUE";
const rows = [a,b];
assert.equal(moveVariation(rows,0,1,1,2,"horizontal"),true);
assert.equal(rows[1].photo2.name,"red.png");
assert.equal(rows[1].variant2,"赤 x 白");
assert.equal(rows[1].shadow2,true);
assert.equal(rows[0].photo1.name,"blue.png");
assert.equal(rows[0].variant1,"BLUE");
assert.equal(rows[0].shadow1,false);
assert.equal(moveVariation(rows,1,2,0,1,"paVertical"),false);
assert.equal(moveVariation(rows,1,2,0,1,"vertical"),true);
assert.equal(rows[0].variant1,"赤 x 白");
assert.equal(moveVariation(rows,0,1,1,2,"vertical"),true);
assert.equal(moveVariation(rows,0,1,0,1,"horizontal"),false);

// Slot can be moved into empty position, not duplicated.
assert.equal(moveVariation(rows,0,1,0,2,"horizontal"),true);
assert.equal(rows[0].photo1,null);
assert.equal(rows[0].variant1,"");
assert.equal(rows[0].photo2.name,"blue.png");

// PA Vertical: one color variant is a linked Item + Item Detail pair. Pure reordering keeps both intact.
assert.equal(moveCard(rows,0,1),true);
assert.deepEqual(rows.map(r=>r._outputId),["b","a"]);
assert.equal(moveCard(rows,-1,1),false);

// Four Cut moves exactly ONE occupied variant, never all four in its group.
const fourA = row("four-a"), fourB = row("four-b");
fourA.photo1 = f("canyon"); fourA.variant1 = "CANYON"; fourA.shadow1 = true;
fourA.photo2 = f("ice"); fourA.variant2 = "ICE";
fourA.photo3 = f("volcan"); fourA.variant3 = "997 VOLCAN";
fourA.photo4 = f("aqua"); fourA.variant4 = "AQUA";
fourB.photo1 = f("black"); fourB.variant1 = "ブラック";
const fourSwapRows = [fourA, fourB];
assert.equal(moveVariation(fourSwapRows, 0, 3, 1, 1, "fourCut"), true);
assert.equal(fourSwapRows[1].photo1.name, "volcan.png");
assert.equal(fourSwapRows[1].variant1, "997 VOLCAN");
assert.equal(fourSwapRows[0].photo3.name, "black.png");
assert.equal(fourSwapRows[0].variant3, "ブラック");
assert.equal(fourSwapRows[0].photo1.name, "canyon.png");
assert.equal(fourSwapRows[0].photo2.name, "ice.png");
assert.equal(fourSwapRows[0].photo4.name, "aqua.png");
assert.equal(fourSwapRows[0].shadow1, true);
// PA Vertical treats a color variant as its linked pair (one photo + detail photo).
const pa1 = row("pa1"), pa2 = row("pa2");
pa1.photo1 = f("red-item"); pa1.photo2 = f("red-detail"); pa1.variant1 = "RED";
pa2.photo1 = f("blue-item"); pa2.photo2 = f("blue-detail"); pa2.variant1 = "BLUE";
const paRows = [pa1, pa2];
assert.equal(moveCard(paRows, 0, 1), true);
assert.deepEqual(paRows.map(x => [x.photo1.name, x.photo2.name, x.variant1]),
  [["blue-item.png", "blue-detail.png", "BLUE"], ["red-item.png", "red-detail.png", "RED"]]);

// File drops fill only empty slots; new groups are appended with no overwrites.
const groups = [row("1")];
groups[0].photo1=f("existing"); groups[0].variant1="Ivory";
const count = insertDroppedPhotos(groups,[f("x"), f("y"), f("z")],{
    layoutMode:"horizontal",startRow:0,startSlot:1,makeRow:()=>row("new")
});
assert.equal(count,3);
assert.deepEqual(groups.map(g=>g._outputId),["1","new"]);
assert.deepEqual([groups[0].photo1.name,groups[0].photo2.name,groups[1].photo1.name,groups[1].photo2.name],
    ["existing.png","x.png","y.png","z.png"]);
assert.equal(groups[0].variant1,"Ivory");
const four=[row("four")];
insertDroppedPhotos(four,[f("1"),f("2"),f("3"),f("4"),f("5")],{
    layoutMode:"fourCut",makeRow:()=>row("added")
});
assert.deepEqual([four[0].photo1.name,four[0].photo4.name,four[1].photo1.name],
    ["1.png","4.png","5.png"]);

// Review: drag image between Line Up/Details and reorder with no duplicate.
const reviewed=[
    {id:"l1",section:"lineup",path:f("left").path,colorName:"Red"},
    {id:"l2",section:"lineup",path:f("right").path,colorName:"Blue"},
    {id:"d1",section:"details",path:f("sole").path}
];
assert.equal(moveReviewedItem(reviewed,"d1","lineup","l2"),true);
assert.deepEqual(reviewed.map(x=>x.id),["l1","d1","l2"]);
assert.equal(moveReviewedItem(reviewed,"l1","details"),true);
assert.deepEqual(reviewed.map(x=>x.id),["d1","l2","l1"]);
assert.deepEqual(reviewed.map(x=>x.section),["lineup","lineup","details"]);
assert.equal(reviewed.filter(x=>x.id==="l1").length,1);

// Actual Slider -> Combine handoff must observe the changed slot and row order.
const handoff = suggestFromSlider({ layoutMode:"horizontal",lineupRows:groups,creative:[],detail:[],
    outputOrder:groups.map((_,i)=>({type:"lineup",index:i})) });
assert.deepEqual(handoff.items.map(x=>x.name),["existing.png","x.png","y.png","z.png"]);

// Wiring: UI, preload, IPC, original modules unaffected by new drag rules.
const read = relative => fs.readFileSync(path.join(root,relative),"utf8");
const html=read("modules/slider/renderer/index.html");
const app=read("modules/slider/renderer/app.js");
const review=read("modules/slider/renderer/combineNewBrandUi.js");
const preload=read("main/preload.js");
const register=read("modules/slider/main/register.js");
for(const id of ["creativeDropZone","detailDropZone","lineupDropZone","sliderCombineLineupList","sliderCombineDetailList"])
    assert.ok(html.includes(`id="${id}"`),`Missing ${id}`);
assert.match(html,/lineupDragDrop\.js/);
assert.match(app,/lineupDnD\.moveVariation/);
assert.match(app,/lineupDnD\.moveCard/); // PA Vertical linked color variant only
assert.doesNotMatch(app, /kind: "card"/);
assert.doesNotMatch(app, /lineup-card-handle/);
assert.match(app, /slot\.draggable = !state\.busy && !isPaVertical && occupied/);
assert.match(app, /slot\.addEventListener\("dragstart"/);
assert.match(app, /kind: "pa-variant"/);
assert.match(html, /Drag <strong>one color variant tile<\/strong>/);
assert.doesNotMatch(html, /Drag a <strong>card handle<\/strong>/);
assert.match(app,/lineupDnD\.insertDroppedPhotos/);
assert.match(review,/moveReviewedItem/);
assert.match(preload,/slider:describe-dropped-files/);
assert.match(register,/DROP_IMAGE_EXTS/);
assert.match(register,/slider:describe-dropped-files/);
console.log("PASS Slider drag/drop: variant tile dragging (no whole-card UI), PA linked color reorder, photo + caption + shadow transfer, 4-cut fill, review order and export handoff");
