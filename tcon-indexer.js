const { JSDOM } = require("jsdom")
const { Worker } = require("worker_threads")
const { init, exists, index } = require("./indexer")
const ecli = require("./ecli")
const { strip_attrs } = require("./util")

const Tribunal = "Tribunal Constitucional"
const TribunalCode = "TCO"
const builder = new ecli.ECLI_Builder().setCountry("PT").setJurisdiction(TribunalCode);


console.log("This process will crawl through all the Tribunal Constitucional acordãos and insert each process in the current elastic search instance.")
console.log("Finding relevant courts databases from www.dgsi.pt...")

init().then( async _ => {
    let dom = await JSDOM.fromURL("https://www.tribunalconstitucional.pt/tc/acordaos/");
    let links = dom.window.document.querySelectorAll(".acordaose")
    for( let l of links){
        let dom = await JSDOM.fromURL(l.href)
        let trs = Array.from(dom.window.document.querySelectorAll("#acbigger  tr:not(:first-child)"))
        for( let tr of trs){
            let anchor = tr.querySelector("a")
            if( !anchor ) continue;
            let link = anchor.href;
            let processo = tr.querySelector(".processo").textContent.trim();
            if( await exists({'Tribunal': Tribunal, 'Processo': processo}) ){
                continue
            }
            console.log( link )

            let Relator = tr.querySelector(".relator").textContent.trim();
            let data = tr.querySelector(".data").textContent.trim().replace(/\./g, "/");
            if( processo == "1209/21" && data == "03/00/2022" )
                data = "03/02/2022";
            
            let year = data.substr(6,4)
            let body = {
                "ECLI": builder.setYear(year).setNumber(processo).build(),
                "Tribunal": Tribunal,
                "Processo": processo,
                "Relator": Relator,
                "Data": data,
                "Descritores": [],
                "Sumário": "N.A.",
                "Texto": await JSDOM.fromURL(link).then(parseDomText),
                "Original URL": link
            }
            await index(body).catch(e => console.log(link, e))
        }
    }
}).catch(e => {
    console.log(e)
})

function parseDomText(dom){
    let wordSection = new JSDOM(strip_attrs(dom.window.document.getElementsByClassName("WordSection1")[0].innerHTML));
    let body = wordSection.window.document.body;
    let c = body.innerHTML;
    let children = Array.from(body.childNodes);
    for( let child of children){
        if( child.textContent.match(/^\s*$/) ){
            child.remove()
        }
    }
    return strip_attrs(body);
}