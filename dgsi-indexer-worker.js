const { JSDOM, ResourceLoader } = require("jsdom");
const { workerData } = require("worker_threads");
const ecli = require('./ecli');
const indexer = require('./indexer');
const { strip_empty_html } = require('./util')

let sleep = (time) => new Promise(resolve => {
    setTimeout(resolve, time);
})

let getPage = async (url) => {
    let page = null;
    while(page == null){
        page = await JSDOM.fromURL(url).catch(e => {
            log(`getPage(${url}): ${JSON.stringify(e)}`);
        return null })
        if( page == null ){
            await sleep(Math.random()*1000)
        }
    }

    return page;
}

let count = 0;

const { Tribunal, TribunalCode, link } = workerData;
const log = (msg) => console.log(`[WORKER ${TribunalCode}] ${msg}`)
log(`${link} - ${Tribunal}`);
let builder = new ecli.ECLI_Builder().setCountry("PT").setJurisdiction(TribunalCode).setYear("0000");
const Origem = `dgsi-indexer-${TribunalCode}`;

forEachCourtDecisionLink(async link => {
    let page = await getPage(link+'&ExpandSection=1');
    let tables = Array.from(page.window.document.querySelectorAll("table")).filter( o => o.parentElement.closest("table") == null );
    let table = tables
        .flatMap( table => 
            Array.from(table.querySelectorAll("tr")).filter( row => row.closest("table") == table ) )
        .filter( tr => tr.cells.length > 1 )
        .reduce(
            (acc, tr) => {
                let key = tr.cells[0].textContent.replace(":","").trim()
                let value = tr.cells[1];  
                acc[key] = value;
                return acc;
            }, {})
    
    let processo = table.Processo.textContent.trim().replace(/\s-\s.*$/, "").replace(/ver\s.*/, "");
    if( await indexer.exists({"Tribunal": Tribunal,"Processo": processo, "Origem": Origem}) ){
        return;
    }
    try{
        let Data = getData(table);
        let datePT = USADateToPT(Data);
        let year = USADateToYear(Data);

        let body = {
            "ECLI": builder.setYear(year).setNumber(processo).build(),
            "Tribunal": Tribunal,
            "Processo": processo,
            "Relator": table.Relator.textContent.trim(),
            "Data": datePT,
            "Descritores": getDescritores(table),
            "Sumário": getSumario(table),
            "Texto": getTexto(table),
            "Tipo": "Acórdão",
            "Original URL": link,
            "Votação": getFirst(table, ["Votação"], link),
            "Meio Processual": getFirst(table, ["Meio Processual"], link),
            "Secção": getFirst(table, ["Tribunal", "Nº Convencional", "Secção"], link), // STA tem tribunal (secção) e Nº convecional 
            "Espécie": getFirst(table, ["Espécie"], link),
            "Decisão": getDecisao(table),
            "Aditamento": getFirst(table, ["Aditamento"], link),
            "Origem": Origem
        }
        await indexer.index(body);
        count++;

    }
    catch(e){
        console.log(`Error: ${link}`)
        console.log(e.stack)
    }
})

// JSDOM doenst allow to Accept-Language: en-GB making the dgsi.pt dates come in MM/dd/yyyy format
function USADateToPT(date){
    let m = date.match(/(?<month>\d+)\/(?<day>\d+)\/(?<year>\d+)/)
    return `${m.groups.day}/${m.groups.month}/${m.groups.year}`
}

function USADateToYear(date){
    let m = date.match(/(?<month>\d+)\/(?<day>\d+)\/(?<year>\d+)/)
    return m.groups.year
}

function getDescritores(table){
    if( table.Descritores ){
        // TODO: handle , and ; in descritores (e.g. "Ação Civil; Ação Civil e Administrativa") however dont split some cases (e.g. "Art 321º, do código civil")
        return table.Descritores.textContent.trim().split(/\n|;/).map( desc => desc.trim().replace(/\.$/g,'').replace(/^(:|-|,|"|“|”)/,'').trim() ).filter( desc => desc.length > 0 )
    }
    return []
}

function getTexto(table){
    if( "Decisão Texto Integral" in table ){
        return strip_empty_html(table["Decisão Texto Integral"].innerHTML)
    }
    if( "Texto Integral" in table ){
        return strip_empty_html(table["Texto Integral"].innerHTML)
    }
    return "N.A.";
}

function getSumario(table){
    if( "Sumário" in table ){
        return strip_empty_html(table["Sumário"].innerHTML)
    }
    return "N.A.";
}

function getDecisao(table){
    if( "Decisão" in table ){
        return strip_empty_html(table["Decisão"].innerHTML)
    }
    return "N.A.";
}

function getData(table){
    if( "Data do Acordão" in table ){
        return table["Data do Acordão"].textContent.trim();
    }
    if( "Data da Decisão Sumária" in table ){
        return table["Data da Decisão Sumária"].textContent.trim();
    }
    if( "Data da Reclamação" in table ){
        return table["Data da Reclamação"].textContent.trim();
    }
    throw new Error("No date found")
}

function getFirst(table, keys, link){
    for( let key of keys ){
        if( key in table ){
            return table[key].textContent.trim();
        }
    }
    return "N.A.";
}

async function forEachCourtDecisionLink( fn ){
    let visited = {}
    let start = 1;
    let currurl = link;
    while( true ){
        let page = await getPage(currurl);
        let anchorList = Array.from(page.window.document.querySelectorAll("a"))
        let next = anchorList.find( l => l.textContent == "Seguinte" ).href
        let courtList = anchorList.map(a => a.href).filter(u => u.match(/http:\/\/www\.dgsi\.pt\/(?<trib_acor>.*)\.nsf\/(?<hashsjt>.*)\/(?<hashid>.*)\?OpenDocument/))
        for( let decision of courtList ){
            if( decision in visited ) continue;
            visited[decision] = true
            await fn(decision);
        }
        if( next == currurl ){
            break;
        }
        currurl = next
    }
    log(`TERMINATED: Added ${count} entries`)
}