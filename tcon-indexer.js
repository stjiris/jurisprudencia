const { JSDOM } = require("jsdom")
const { Worker } = require("worker_threads")
const { init, exists, index } = require("./indexer")
const ecli = require("./ecli")
const { strip_empty_html } = require("./util")

const Origem = "tcon-indexer"
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
            if( await exists({'Tribunal': Tribunal, 'Processo': processo, "Origem": Origem}) ){
                continue
            }
            
            let Relator = tr.querySelector(".relator").textContent.trim().replace(/\s+/g, " ").replace(/\./g, "");
            let data = tr.querySelector(".data").textContent.trim().replace(/\./g, "/");
            let seccao = tr.querySelector(".seccao").textContent.trim();
            let especie = tr.querySelector(".especie").textContent.trim();
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
                "Secção": seccao,
                "Decisão": "N.A.",
                "Sumário": "N.A.",
                "Texto": await JSDOM.fromURL(link).then(parseDomText),
                "Aditamento": "N.A.",
                "Espécie": especie,
                "Tipo": "Acórdão",
                "Original URL": link,
                "Origem": Origem
            }
            await index(body).catch(e => {
                console.log(`${link} len:${body.Texto.length}:`, e )
            })
        }
    }
}).catch(e => {
    console.log(e)
})

function textElement(dom){
    let elements;
    elements = dom.window.document.getElementsByClassName("WordSection1");
    if( elements.length > 0 ){
        return elements[0]
    }
    elements = dom.window.document.getElementsByClassName("Section1");
    if( elements.length > 0 ){
        return elements[0]
    }
    let element = dom.window.document.getElementById("acimport");
    if( element ){
        return element
    }
    throw new Error("No text element found")
}

function parseDomText(dom){
    try{
        return strip_empty_html(textElement(dom).innerHTML);
    }
    catch(e){
            console.log(dom.window.location.href, e.stack)
            return "N.A. - " + e.message
    }
}
