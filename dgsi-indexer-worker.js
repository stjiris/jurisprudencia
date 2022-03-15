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

const dateFixes = {
    "http://www.dgsi.pt/jtrl.nsf/33182fc732316039802565fa00497eec/9a5395430007aec6802582cf004eeeb3?OpenDocument": "06/21/2018",
    "http://www.dgsi.pt/jtre.nsf/134973db04f39bf2802579bf005f080b/f0611ae129477aae8025827b002d2a47?OpenDocument": "04/10/2018",
    "http://www.dgsi.pt/jtca.nsf/170589492546a7fb802575c3004c6d7d/ecf6730f98261130802571f800347524?OpenDocument": "09/26/2006",
    "http://www.dgsi.pt/jtrg.nsf/86c25a698e4e7cb7802579ec004d3832/765d9792c9acf919802581ad0052038e?OpenDocument": "06/29/2017",
    "http://www.dgsi.pt/jtcn.nsf/89d1c0288c2dd49c802575c8003279c7/75619824943bd597802580020032792e?OpenDocument": "07/01/2016",
    "http://www.dgsi.pt/jtre.nsf/134973db04f39bf2802579bf005f080b/32227fea7dac58e4802581d900341950?OpenDocument": "10/26/2017",
    "http://www.dgsi.pt/jtca.nsf/170589492546a7fb802575c3004c6d7d/f4e14249caaf440580257685005a67ad?OpenDocument": "12/03/2009",
    "http://www.dgsi.pt/jtca.nsf/170589492546a7fb802575c3004c6d7d/f4e14249caaf440580257685005a67ad?OpenDocument": "07/08/2010"
}

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
        if( link in dateFixes ){
            Data = dateFixes[link];
        }
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
            "Tipo": "Acordão",
            "Original URL": link,
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
        return table.Descritores.textContent.trim().split(/\n|;/).map( desc => desc.trim().replace(/\.$/g,'').replace(/^(:|-|,)/,'').trim() ).filter( desc => desc.length > 0 )
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