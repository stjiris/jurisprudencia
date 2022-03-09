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
            let w3resource = w3resourceFromLink(link)
            let body = {
                "ECLI": builder.setYear(year).setNumber(processo).build(),
                "Tribunal": Tribunal,
                "Processo": processo,
                "Relator": Relator,
                "Data": data,
                "Descritores": [],
                "Sumário": "N.A.",
                "Texto": await JSDOM.fromURL(w3resource).then(dom => strip_attrs(dom.window.document.body.innerHTML) ).catch(e => "N.A. - Error Importing:" + e),
                "Original URL": link
            }
            await index(body).catch(e => console.log(link, e))
        }
    }
}).catch(e => {
    console.log(e)
})

/*
Converts a link to a w3 resource
Example:
    https://www.tribunalconstitucional.pt/tc/acordaos/20210001.html
    =>
    http://w3.tribunalconstitucional.pt/acordaos/Acordaos21/101-200/20210001.htm
*/
function w3resourceFromLink(link){
    let id = link.match(/[0-9]{8}/).toString()
    let year = id.substring(0, 4);
    let YY = year.substring(2,4);
    let process = id.substring(5, 8);
    let nearestHundred = Math.floor(process / 100) * 100 + 1;
    let nearestHundredUp = nearestHundred + 100 - 1;
    return `http://w3.tribunalconstitucional.pt/acordaos/Acordaos${YY}/${nearestHundred}-${nearestHundredUp}/${id}.htm`
}